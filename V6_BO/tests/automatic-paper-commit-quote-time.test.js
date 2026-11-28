'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createPaperApplicationService}=require('../src/core/paper-application-service');
const {createFillEvidence}=require('../src/core/paper-fill-evidence');
const initialTime=Date.parse('2026-11-05T10:00:00+08:00');
const day=now=>new Date(now+28800000).toISOString().slice(0,10);
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function setup(t,{at=initialTime,side='buy'}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'automatic-paper-quote-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'pool.json');let now=at;
 const make=()=>createPaperApplicationService({file,clock:()=>now,calendar:{isOpen:()=>true}});
 const app=make(),positions=side==='sell'?{'600000':{code:'600000',shares:100,buyPrice:10,buyTs:at-86400000,basis:1005}}:{};
 app.adoptLegacy({initial:100000,cash:side==='sell'?98995:100000,realized:0,enabled:true,positions,trades:[]});
 const legacy=app.legacy(),trade={t:at,side:side==='buy'?'买入':'卖出',code:'600000',price:10,shares:100,
  amount:1000,fee:side==='buy'?5:5.5,pnl:side==='buy'?null:-10.5,reason:'isolated quote boundary'};
 const input={...legacy,cash:side==='buy'?98995:99989.5,realized:side==='buy'?0:-10.5,
  positions:side==='buy'?{'600000':{code:'600000',shares:100,buyTs:at,buyPrice:10,basis:1005}}:{},trades:[trade]};
 const quote=(age=1000)=>({symbol:'600000',tradeDate:day(at),timestamp:at-age,quoteAt:at-age,receivedAt:at,
  provider:'tencent',quoteSource:'tencent',mode:'public-live-unverified',suspended:false,tradable:true,
  volumeUnit:'shares',volume:10000,price:10,lowerLimit:9,upperLimit:11});
 return {app,make,file,input,trade,quote,now:()=>now,advance:ms=>{now+=ms;},
  save:q=>app.saveLegacy(input,app.read().revision,{quotes:{'600000':q}})};
}
function rejectWithoutFinancialChange(x,quote,pattern=/自动成交行情/){
 const before=fs.readFileSync(x.file);assert.throws(()=>x.save(quote),pattern);
 assert.deepEqual(fs.readFileSync(x.file),before);
 assert.equal(x.app.read().account.events.length,0);
}

test('new automatic buys and sells accept exactly 15 seconds but reject 15001 ms and older original quotes',t=>{
 for(const side of ['buy','sell']){
  const valid=setup(t,{side});assert.equal(valid.save(valid.quote(15000)).account.events.length,1);
  for(const age of [15001,60000,180000,180001]){
   const x=setup(t,{side});rejectWithoutFinancialChange(x,x.quote(age));
  }
 }
});

test('a fresh receive time cannot refresh the provider quote clock at the authoritative commit',t=>{
 const x=setup(t),quote=x.quote(60000);quote.receivedAt=x.now();
 rejectWithoutFinancialChange(x,quote);
 const audit=x.app.audit();assert.equal(audit.total,1);
 assert.deepEqual(audit.events[0].reasonCodes,['AUTOMATIC_QUOTE_NOT_CURRENT']);
});

test('missing, future and conflicting original clocks fail without changing the account',t=>{
 const variants=[q=>{delete q.quoteAt;delete q.timestamp;},q=>{q.quoteAt=q.timestamp=initialTime+1;},
  q=>{q.quoteAt=initialTime-60000;},q=>{q.quoteAt=q.timestamp=0;},q=>{q.quoteAt=q.timestamp=NaN;},
  q=>{q.quoteAt=q.timestamp='1793843999000';}];
 for(const change of variants){const x=setup(t),quote=x.quote();change(quote);rejectWithoutFinancialChange(x,quote);}
});

test('explicit read-only quotes reject both automatic buys and sells with a separate audit reason',t=>{
 for(const side of ['buy','sell'])for(const patch of [{canTrade:false},{readOnlyBackup:true}]){
  const x=setup(t,{side});rejectWithoutFinancialChange(x,{...x.quote(),...patch});
  const audit=x.app.audit();assert.equal(audit.total,1);
  assert.deepEqual(audit.events[0].reasonCodes,['AUTOMATIC_QUOTE_READ_ONLY']);
 }
});

test('one read-only quote rolls back a whole automatic batch after an earlier fill was staged',t=>{
 const x=setup(t),before=fs.readFileSync(x.file),remove=fs.rmSync;let staged=0;
 t.mock.method(fs,'rmSync',(target,...args)=>{
  const result=remove(target,...args);
  if(typeof target==='string'&&path.basename(target).startsWith('.legacy-stage-'))staged++;
  return result;
 });
 const second={...x.trade,code:'600001'},input={...x.input,cash:97990,
  positions:{...x.input.positions,'600001':{...x.input.positions['600000'],code:'600001'}},
  trades:[second,x.trade]};
 assert.throws(()=>x.app.saveLegacy(input,x.app.read().revision,{quotes:{
  '600000':x.quote(),'600001':{...x.quote(),symbol:'600001',readOnlyBackup:true}
 }}),/自动成交行情只读/);
 assert.equal(staged,1,'the first valid fill must reach staging before the second is rejected');
 assert.deepEqual(fs.readFileSync(x.file),before);
 assert.equal(x.make().read().account.events.length,0);assert.equal(x.make().read().account.cash,100000);
 assert.deepEqual(x.app.audit().events[0].reasonCodes,['AUTOMATIC_QUOTE_READ_ONLY']);
});

test('the legacy timestamp alias is still original quote time when quoteAt was never present',t=>{
 const x=setup(t),quote=x.quote(15000);delete quote.quoteAt;
 const book=x.save(quote);assert.equal(book.account.events[0].fillEvidence.quoteAt,quote.timestamp);
});

test('a quote crossing midnight is not eligible even within 15 seconds and an old trade time cannot hide the new day',t=>{
 const at=Date.parse('2026-11-06T00:00:01+08:00');
 const x=setup(t,{at});rejectWithoutFinancialChange(x,x.quote(2000));
 const y=setup(t,{at:at-2000}),quote=y.quote(0);y.advance(2000);
 rejectWithoutFinancialChange(y,quote);
});

test('clock time consumed while obtaining the account lock is checked inside the locked operation',t=>{
 const x=setup(t),quote=x.quote(14000),open=fs.openSync;
 t.mock.method(fs,'openSync',(file,...args)=>{
  const fd=open(file,...args);if(file===x.file+'.guard')x.advance(1001);return fd;
 });
 rejectWithoutFinancialChange(x,quote);
});

test('processing a staged fill cannot publish after its quote expires',t=>{
 const x=setup(t),quote=x.quote(1000),remove=fs.rmSync;
 t.mock.method(fs,'rmSync',(target,...args)=>{
  const result=remove(target,...args);
  if(typeof target==='string'&&path.basename(target).startsWith('.legacy-stage-'))x.advance(14001);
  return result;
 });
 rejectWithoutFinancialChange(x,quote);
});

function delayFinalSnapshotSync(t,x,delay){
 const open=fs.openSync,sync=fs.fsyncSync;let snapshotFd,delayed=false;
 t.mock.method(fs,'openSync',(file,...args)=>{
  const fd=open(file,...args);
  if(typeof file==='string'&&path.dirname(file)===path.dirname(x.file)&&
    path.basename(file).startsWith('.'+path.basename(x.file)+'.')&&file.endsWith('.tmp'))snapshotFd=fd;
  return fd;
 });
 t.mock.method(fs,'fsyncSync',fd=>{
  const result=sync(fd);
  if(fd===snapshotFd&&!delayed){delayed=true;x.advance(delay);}
  return result;
 });
 return ()=>assert.equal(delayed,true,'the delay must occur in the final authoritative snapshot fsync');
}
function assertNoStagedSnapshot(x){
 assert.deepEqual(fs.readdirSync(path.dirname(x.file)).filter(name=>name.endsWith('.tmp')||name.startsWith('.legacy-stage-')),[]);
}

for(const side of ['buy','sell']){
 test('automatic '+side+' remains eligible at exactly 15 seconds after final snapshot fsync',t=>{
  const x=setup(t,{side}),quote=x.quote(1000),assertDelayed=delayFinalSnapshotSync(t,x,14000);
  const result=x.save(quote);assertDelayed();
  assert.equal(x.now()-quote.quoteAt,15000);assert.equal(result.account.events.length,1);
  assert.equal(result.account.cash,x.input.cash);assertNoStagedSnapshot(x);
 });
 test('automatic '+side+' cannot publish when final snapshot fsync takes the quote to 15001 ms',t=>{
  const x=setup(t,{side}),quote=x.quote(1000),assertDelayed=delayFinalSnapshotSync(t,x,14001);
  rejectWithoutFinancialChange(x,quote);assertDelayed();
  assert.equal(x.now()-quote.quoteAt,15001);assertNoStagedSnapshot(x);
  const audit=x.app.audit();assert.deepEqual(audit.events[0].reasonCodes,['AUTOMATIC_QUOTE_NOT_CURRENT']);
  // The failed publication releases its account lock and remains readable after restart.
  const restarted=x.make(),before=restarted.read();
  assert.equal(before.account.events.length,0);
  assert.equal(restarted.saveLegacy(restarted.legacy(),before.revision).account.events.length,0);
 });
 test('automatic '+side+' cannot publish across midnight during final snapshot fsync',t=>{
  const x=setup(t,{side,at:Date.parse('2026-11-05T23:59:59.500+08:00')}),quote=x.quote(100),
   assertDelayed=delayFinalSnapshotSync(t,x,501);
  rejectWithoutFinancialChange(x,quote);assertDelayed();
  assert.equal(x.now()-quote.quoteAt,601);assertNoStagedSnapshot(x);
 });
}

test('a final snapshot fsync failure preserves the old account and removes the temporary file',t=>{
 const x=setup(t),quote=x.quote(),open=fs.openSync,sync=fs.fsyncSync;let snapshotFd,failed=false;
 t.mock.method(fs,'openSync',(file,...args)=>{
  const fd=open(file,...args);
  if(typeof file==='string'&&path.dirname(file)===path.dirname(x.file)&&
    path.basename(file).startsWith('.'+path.basename(x.file)+'.')&&file.endsWith('.tmp'))snapshotFd=fd;
  return fd;
 });
 t.mock.method(fs,'fsyncSync',fd=>{
  if(fd===snapshotFd&&!failed){failed=true;throw Object.assign(Error('injected final snapshot fsync failure'),{code:'EIO'});}
  return sync(fd);
 });
 rejectWithoutFinancialChange(x,quote,/injected final snapshot fsync failure/);assertNoStagedSnapshot(x);
});

test('restarting and retrying an already committed event does not require a fresh quote or duplicate cash',t=>{
 const x=setup(t),first=x.save(x.quote()),event=first.account.events[0];x.advance(3*86400000);
 const reopened=x.make(),before=reopened.read();
 const result=reopened.saveLegacy(x.input,before.revision,{quotes:{}});
 assert.equal(result.account.cash,first.account.cash);assert.equal(result.account.events.length,1);
 assert.deepEqual(result.account.events[0],event);assert.equal(Object.keys(result.orders).length,1);
});

test('previously persisted automatic evidence keeps its old validation window and is not rewritten on read',t=>{
 const x=setup(t),book=x.save(x.quote()),event=book.account.events[0],item=book.orders[event.orderId];
 const evidence=createFillEvidence(x.quote(60000),{executionAt:initialTime,executionKind:'automatic-paper',
  symbol:'600000',tradeDate:day(initialTime),price:10});
 event.fillEvidence=evidence;item.events[0].fillEvidence=evidence;
 book.account.eventHashes[event.eventId]=hash({orderId:event.orderId,fill:item.events[0],tradeDate:day(initialTime)});
 book.account.fingerprint=hash({cash:book.account.cash,positions:book.account.positions,events:book.account.events});
 delete book.fingerprint;book.fingerprint=hash(book);fs.writeFileSync(x.file,JSON.stringify(book));
 const before=fs.readFileSync(x.file),old=x.make().read();
 assert.equal(old.account.events[0].fillEvidence.quoteAt,initialTime-60000);
 assert.deepEqual(fs.readFileSync(x.file),before);
});

test('explicit imported or simulated manual research retains its separate 180-second contract',t=>{
 for(const source of ['simulated','imported']){
  const x=setup(t);x.app.submit({orderId:'manual',symbol:'600000',side:'buy',quantity:100,limitPrice:11,tradeDate:day(initialTime)});
  const quote={...x.quote(180000),source,mode:source};
  const result=x.app.fill('manual','manual-fill',quote);
  assert.equal(result.account.events[0].fillEvidence.executionKind,'research-manual');
  assert.equal(result.account.events[0].fillEvidence.quoteAt,initialTime-180000);
 }
});

test('a nearby legacy fill price cannot hide an original quote at or beyond either price limit',t=>{
 for(const side of ['buy','sell'])for(const boundary of [
  {price:10.01,upperLimit:10.01},
  {price:9.99,lowerLimit:9.99},
  {price:10.01,upperLimit:10},
  {price:9.99,lowerLimit:10}
 ]){
  const x=setup(t,{side});rejectWithoutFinancialChange(x,{...x.quote(),...boundary});
  assert.equal(x.make().read().account.events.length,0,'a fresh process sees the unchanged authoritative account');
 }
});

test('interior quotes retain the existing legacy price tolerance and committed retries keep their historical evidence',t=>{
 for(const side of ['buy','sell'])for(const price of [9.99,10.01]){
  const x=setup(t,{side}),first=x.save({...x.quote(),price});
  assert.equal(first.account.events[0].price,10);assert.equal(first.account.events[0].fillEvidence.quotePrice,price);
  x.advance(86400000);
  const retried=x.make().saveLegacy(x.input,first.revision,{quotes:{'600000':{...x.quote(),price,upperLimit:price}}});
  assert.deepEqual(retried.account,first.account);assert.deepEqual(retried.orders,first.orders);
 }
});

test('a limit quote in a later automatic fill rolls back earlier staged fills',t=>{
 const x=setup(t),before=fs.readFileSync(x.file),remove=fs.rmSync;let staged=0;
 t.mock.method(fs,'rmSync',(target,...args)=>{
  const result=remove(target,...args);
  if(typeof target==='string'&&path.basename(target).startsWith('.legacy-stage-'))staged++;
  return result;
 });
 const second={...x.trade,code:'600001'},input={...x.input,cash:97990,
  positions:{...x.input.positions,'600001':{...x.input.positions['600000'],code:'600001'}},trades:[second,x.trade]};
 assert.throws(()=>x.app.saveLegacy(input,x.app.read().revision,{quotes:{
  '600000':x.quote(),'600001':{...x.quote(),symbol:'600001',price:10.01,upperLimit:10.01}
 }}),/自动成交行情/);
 assert.equal(staged,1);assert.deepEqual(fs.readFileSync(x.file),before);
 assert.equal(x.make().read().account.cash,100000);
});

test('an original quote changed to its limit during final snapshot staging cannot publish a fill',t=>{
 const x=setup(t),quote=x.quote(),open=fs.openSync,sync=fs.fsyncSync;let snapshotFd,changed=false;
 t.mock.method(fs,'openSync',(file,...args)=>{
  const fd=open(file,...args);
  if(typeof file==='string'&&path.dirname(file)===path.dirname(x.file)&&
    path.basename(file).startsWith('.'+path.basename(x.file)+'.')&&file.endsWith('.tmp'))snapshotFd=fd;
  return fd;
 });
 t.mock.method(fs,'fsyncSync',fd=>{
  const result=sync(fd);
  if(fd===snapshotFd&&!changed){changed=true;quote.price=quote.upperLimit;}
  return result;
 });
 rejectWithoutFinancialChange(x,quote);assert.equal(changed,true);assertNoStagedSnapshot(x);
 assert.deepEqual(x.app.audit().events[0].reasonCodes,['AUTOMATIC_QUOTE_PRICE_LIMIT']);
});
