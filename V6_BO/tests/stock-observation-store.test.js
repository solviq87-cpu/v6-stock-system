'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');
const {retainStockObservation:retain,readObservedStock:read}=require('../src/core/stock-observation-store');
const baseTime=Date.parse('2026-01-10T08:00:00Z');
const choice={provider:'provider-a',priceBasis:'forward-adjusted'};
function stock(extra={}){return {symbol:'600001',name:'原始观察',source:'public-a',...choice,bars:[{date:'2026-01-05',open:10,high:12,low:9,close:11,volume:100}],...extra};}
function files(root){return fs.readdirSync(root,{recursive:true}).filter(n=>/^\d{6}\.json$/.test(path.basename(n))).map(n=>path.join(root,n));}
function temp(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'stock-observations-'));try{const result=fn(root);if(result?.then)return result.finally(()=>fs.rmSync(root,{recursive:true,force:true}));fs.rmSync(root,{recursive:true,force:true});return result;}catch(e){fs.rmSync(root,{recursive:true,force:true});throw e;}}
function clock(fn){const original=Date.now;let time=baseTime+1000;Date.now=()=>time;try{return fn(value=>{time=value;});}finally{Date.now=original;}}
test('old historical bars are first known at real receipt, immutable files stay private and input is untouched',()=>temp(root=>clock(()=>{
 const input=stock();input.bars[0].source='declared-row-source';input.bars[0].provenance={rawHash:'abc',endpoint:'/history'};const untouched=structuredClone(input);
 const saved=retain(root,{stock:input,observedAt:baseTime,context:{trigger:'push'}});
 assert.equal(saved.changed,true);assert.equal(saved.revision,1);assert.equal(saved.stock.bars[0].knownAt,baseTime);assert.equal(saved.stock.bars[0].firstObservedAt,baseTime);assert.equal(saved.stock.bars[0].source,'declared-row-source');assert.deepEqual(input,untouched);
 assert.equal(saved.canTrade,false);assert.equal(saved.canNotify,false);assert.equal(saved.predictiveUseVerified,false);
 const [file]=files(root);assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(fs.statSync(path.dirname(file)).mode&0o777,0o700);
 const archive=JSON.parse(fs.readFileSync(file));assert.deepEqual(archive.rawStock,input);assert.deepEqual(archive.context,{trigger:'push'});
 assert.equal(read(root,'600001',choice).stock.bars[0].knownAt,baseTime);
})));
test('repeat receipts and refreshed provenance timestamps do not consume revisions or replace first knowledge',()=>temp(root=>clock(setTime=>{
 const input=stock();input.bars[0].provenance={retrievedAt:baseTime,rawHash:'original'};const first=retain(root,{stock:input,observedAt:baseTime});
 setTime(baseTime+2000);input.bars[0].provenance={retrievedAt:baseTime+2000,rawHash:'another-envelope'};
 const again=retain(root,{stock:input,observedAt:baseTime+2000,context:{changed:'context only'}});
 assert.equal(again.changed,false);assert.equal(again.revision,1);assert.equal(again.observationHash,first.observationHash);assert.equal(again.stock.observedAt,baseTime);assert.equal(again.stock.bars[0].knownAt,baseTime);assert.equal(files(root).length,1);
 const returned=retain(root,{stock:first.stock,observedAt:baseTime+2000});assert.equal(returned.changed,false);
})));
test('new amount and corrections advance aggregate knownAt while retaining price availability and old versions',()=>temp(root=>clock(setTime=>{
 const input=stock();retain(root,{stock:input,observedAt:baseTime});setTime(baseTime+2000);input.bars[0].amount=12345;
 const amount=retain(root,{stock:input,observedAt:baseTime+2000});assert.equal(amount.stock.bars[0].knownAt,baseTime+2000);assert.equal(amount.stock.bars[0].priceKnownAt,baseTime);assert.equal(amount.stock.bars[0].amountKnownAt,baseTime+2000);
 setTime(baseTime+3000);input.bars[0].close=10.5;const corrected=retain(root,{stock:input,observedAt:baseTime+3000});assert.equal(corrected.revision,3);assert.equal(corrected.stock.bars[0].knownAt,baseTime+3000);assert.equal(corrected.stock.bars[0].amountKnownAt,baseTime+2000);
 assert.equal(JSON.parse(fs.readFileSync(files(root).sort()[0])).stock.bars[0].close,11);
 const historical=read(root,'600001',{...choice,asOf:baseTime+1500});assert.equal(historical.revision,1);assert.equal(historical.stock.bars[0].amount,undefined);
})));
test('status, company action and limit evidence retain independent observation times without manufacturing missing flags',()=>temp(root=>clock(setTime=>{
 const input=stock();const first=retain(root,{stock:input,observedAt:baseTime});assert.equal(first.stock.bars[0].tradable,undefined);assert.equal(first.stock.bars[0].corporateAction,undefined);
 setTime(baseTime+2000);input.bars[0].tradable=true;const status=retain(root,{stock:input,observedAt:baseTime+2000});assert.equal(status.stock.bars[0].statusKnownAt,baseTime+2000);assert.equal(status.stock.bars[0].knownAt,baseTime);assert.equal(status.stock.bars[0].suspended,undefined);
 setTime(baseTime+3000);delete input.bars[0].tradable;input.bars[0].corporateAction=false;input.bars[0].limitUpPrice=12.1;
 const evidence=retain(root,{stock:input,observedAt:baseTime+3000});assert.equal(evidence.stock.bars[0].tradable,true);assert.equal(evidence.stock.bars[0].statusKnownAt,baseTime+2000);assert.equal(evidence.stock.bars[0].corporateActionKnownAt,baseTime+3000);assert.equal(evidence.stock.bars[0].limitKnownAt,baseTime+3000);assert.equal(evidence.stock.bars[0].noPriceLimit,undefined);
 setTime(baseTime+4000);input.bars[0].isST=false;const updated=retain(root,{stock:input,observedAt:baseTime+4000});assert.equal(updated.stock.bars[0].statusKnownAt,baseTime+4000);assert.equal(updated.stock.bars[0].corporateActionKnownAt,baseTime+3000);
})));
test('new observations cannot assert earlier availability, including new status and amount on an old bar',()=>temp(root=>clock(setTime=>{
 for(const key of ['knownAt','priceKnownAt','firstObservedAt']){const input=stock();input.bars[0][key]=baseTime-1000;assert.throws(()=>retain(root,{stock:input,observedAt:baseTime}),/倒填/);}
 const input=stock();const saved=retain(root,{stock:input,observedAt:baseTime});setTime(baseTime+2000);
 const status=stock();Object.assign(status.bars[0],{isST:false,statusKnownAt:baseTime});assert.throws(()=>retain(root,{stock:status,observedAt:baseTime+2000}),/倒填/);
 const amount=structuredClone(saved.stock);amount.bars[0].amount=10;assert.throws(()=>retain(root,{stock:amount,observedAt:baseTime+2000}),/倒填/);
 const action=stock();Object.assign(action.bars[0],{corporateAction:false,corporateActionKnownAt:baseTime});assert.throws(()=>retain(root,{stock:action,observedAt:baseTime+2000}),/倒填/);
 assert.equal(read(root,'600001',choice).revision,1);
})));
test('same symbol provider and price basis identities never merge and reads require explicit identity',()=>temp(root=>clock(()=>{
 retain(root,{stock:stock(),observedAt:baseTime});retain(root,{stock:stock({provider:'provider-b'}),observedAt:baseTime});retain(root,{stock:stock({priceBasis:'unadjusted'}),observedAt:baseTime});
 assert.equal(files(root).length,3);assert.equal(read(root,'600001',choice).revision,1);assert.equal(read(root,'600001',{...choice,provider:'provider-b'}).stock.provider,'provider-b');assert.equal(read(root,'600001',{...choice,priceBasis:'unadjusted'}).stock.priceBasis,'unadjusted');
 assert.throws(()=>read(root,'600001'),/提供者/);assert.throws(()=>read(root,'600001',{provider:'provider-a'}),/价格口径/);assert.equal(read(root,'600001',{...choice,provider:'absent'}).stock,null);
})));
test('read asOf requires both receipt and recording, and later revisions cannot alter a prior view',()=>temp(root=>clock(setTime=>{
 retain(root,{stock:stock(),observedAt:baseTime});assert.equal(read(root,'600001',{...choice,asOf:baseTime+500}).stock,null);
 const before=read(root,'600001',{...choice,asOf:baseTime+1000});setTime(baseTime+3000);const amended=stock();amended.bars[0].amount=100;retain(root,{stock:amended,observedAt:baseTime+2000});
 assert.deepEqual(read(root,'600001',{...choice,asOf:baseTime+1000}),before);assert.equal(read(root,'600001',{...choice,asOf:baseTime+2500}).revision,1);assert.equal(read(root,'600001',{...choice,asOf:baseTime+3000}).revision,2);
 assert.equal(read(root,'600001',choice).observations.length,2);
})));
test('shorter responses preserve previously observed dated bars and source changes reset the submitted price evidence',()=>temp(root=>clock(setTime=>{
 const initial=stock();initial.bars.push({...initial.bars[0],date:'2026-01-06'});retain(root,{stock:initial,observedAt:baseTime});
 setTime(baseTime+2000);const short=stock({source:'public-b'});const next=retain(root,{stock:short,observedAt:baseTime+2000});assert.equal(next.stock.bars.length,2);assert.equal(next.stock.bars[0].knownAt,baseTime+2000);assert.equal(next.stock.bars[0].source,'public-b');assert.equal(next.stock.bars[1].source,'public-a');assert.equal(next.stock.bars[1].knownAt,baseTime);
})));
test('a different row source cannot become same-source historical evidence when a later response omits status and provenance',()=>temp(root=>clock(setTime=>{
 const {analyzeStockHistory}=require('../src/core/stock-intelligence-memory');
 const dates=Array.from({length:27},(_,i)=>new Date(Date.UTC(2025,11,15+i)).toISOString().slice(0,10));
 const initial=stock({bars:dates.slice(0,25).map(date=>({...stock().bars[0],date,source:'public-b',amount:12345,suspended:false,tradable:true,isST:false,corporateAction:false,noPriceLimit:false,limitUpPrice:12.1,limitReferencePrice:11,market:'main',limitPct:10,ipoNoLimit:false,provenance:{rawHash:'other-source'},derivation:{method:'other-source'}}))});
 const first=retain(root,{stock:initial,observedAt:baseTime});assert.throws(()=>analyzeStockHistory(first.stock,{asOf:baseTime,tradeDates:dates}),/提供者/);
 const later=stock({bars:initial.bars.map(bar=>({date:bar.date,open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:bar.volume}))});setTime(baseTime+2000);
 const second=retain(root,{stock:later,observedAt:baseTime+2000});assert.equal(second.revision,2);
 const absent=['amount','amountKnownAt','suspended','tradable','isST','statusKnownAt','corporateAction','corporateActionKnownAt','noPriceLimit','limitUpPrice','limitReferencePrice','limitKnownAt','market','limitPct','ipoNoLimit','provenance','derivation'];
 for(const bar of second.stock.bars){assert.equal(bar.source,'public-a');assert.equal(bar.knownAt,baseTime+2000);for(const key of absent)assert.equal(bar[key],undefined,key);}
 const result=analyzeStockHistory(second.stock,{asOf:baseTime+2000,tradeDates:dates});assert.equal(result.coverage.latestFormationUsable,false);assert.equal(result.direction.state,null);assert.equal(result.direction.probability,null);
 setTime(baseTime+3000);const repeated=retain(root,{stock:later,observedAt:baseTime+3000});assert.equal(repeated.changed,false);assert.equal(read(root,'600001',choice).stock.bars[0].tradable,undefined);
 const archive=JSON.parse(fs.readFileSync(files(root).sort()[0]));assert.equal(archive.stock.bars[0].source,'public-b');assert.equal(archive.stock.bars[0].tradable,true);
})));
test('a row provider change discards absent groups and only fresh submitted evidence receives the new receipt time',()=>temp(root=>clock(setTime=>{
 const initial=stock();Object.assign(initial.bars[0],{provider:'other-row-provider',amount:100,tradable:true,isST:false,corporateAction:false,noPriceLimit:false,limitUpPrice:12.1,provenance:{provider:'other-row-provider'}});retain(root,{stock:initial,observedAt:baseTime});
 setTime(baseTime+2000);const fresh=stock();fresh.bars[0].isST=false;const updated=retain(root,{stock:fresh,observedAt:baseTime+2000});const bar=updated.stock.bars[0];
 assert.equal(bar.provider,'provider-a');assert.equal(bar.isST,false);assert.equal(bar.statusKnownAt,baseTime+2000);assert.equal(bar.knownAt,baseTime+2000);for(const key of ['amount','amountKnownAt','tradable','corporateAction','corporateActionKnownAt','noPriceLimit','limitUpPrice','limitKnownAt','provenance'])assert.equal(bar[key],undefined,key);
 setTime(baseTime+3000);const same=retain(root,{stock:stock(),observedAt:baseTime+3000});assert.equal(same.changed,false);assert.equal(same.stock.bars[0].statusKnownAt,baseTime+2000);assert.equal(same.stock.bars[0].tradable,undefined);
})));
test('invalid OHLCV, future dates, unbounded input and out-of-order observations are rejected',()=>temp(root=>clock(setTime=>{
 for(const amend of [b=>b.volume=1.2,b=>b.low=20,b=>b.amount=-1,b=>b.tradable='false',b=>b.date='2026-02-30',b=>b.date='2026-01-11']){const input=stock();amend(input.bars[0]);assert.throws(()=>retain(root,{stock:input,observedAt:baseTime}));}
 assert.throws(()=>retain(root,{stock:stock({bars:[]}),observedAt:baseTime}));assert.throws(()=>retain(root,{stock:stock({bars:Array.from({length:501},()=>stock().bars[0])}),observedAt:baseTime}),/500/);
 assert.throws(()=>retain(root,{stock:stock(),observedAt:baseTime,context:{large:'x'.repeat(32769)}}),/上限/);
 retain(root,{stock:stock(),observedAt:baseTime});setTime(baseTime+2000);assert.throws(()=>retain(root,{stock:stock(),observedAt:baseTime-1}),/倒退/);
})));
test('merged history has a 500 bar bound and raw provenance has a byte bound',()=>temp(root=>clock(setTime=>{
 const bars=Array.from({length:500},(_,i)=>({...stock().bars[0],date:new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10)}));retain(root,{stock:stock({bars}),observedAt:baseTime});
 setTime(baseTime+2000);assert.throws(()=>retain(root,{stock:stock(),observedAt:baseTime+2000}),/累计K线超过500/);
 const large=stock({provider:'large'});large.bars[0].provenance={raw:'x'.repeat(8193)};assert.throws(()=>retain(root,{stock:large,observedAt:baseTime}),/上限/);
})));
test('private directory, ordinary file, chain hash and consecutive revision checks fail closed',()=>temp(root=>clock(()=>{
 const publicRoot=path.join(root,'public','private');assert.throws(()=>retain(publicRoot,{stock:stock(),observedAt:baseTime}),/公开/);
 const open=path.join(root,'open');fs.mkdirSync(open,{mode:0o755});fs.chmodSync(open,0o755);assert.throws(()=>retain(open,{stock:stock(),observedAt:baseTime}),/0700/);
 const alias=path.join(root,'alias');fs.symlinkSync(root,alias);assert.throws(()=>retain(alias,{stock:stock(),observedAt:baseTime}),/符号链接/);
 const archive=path.join(root,'archive');retain(archive,{stock:stock(),observedAt:baseTime});const [file]=files(archive),original=fs.readFileSync(file);
 fs.chmodSync(file,0o644);assert.throws(()=>read(archive,'600001',choice),/0600/);fs.chmodSync(file,0o600);
 const altered=JSON.parse(original);altered.stock.bars[0].close=10;fs.writeFileSync(file,JSON.stringify(altered));assert.throws(()=>read(archive,'600001',choice),/完整性/);fs.writeFileSync(file,original);
 const moved=path.join(path.dirname(file),'000002.json');fs.renameSync(file,moved);assert.throws(()=>read(archive,'600001',choice),/链缺失/);fs.renameSync(moved,file);
 fs.unlinkSync(file);fs.symlinkSync('/etc/passwd',file);assert.throws(()=>read(archive,'600001',choice),/普通文件/);
})));
test('unpublished crash artifacts cannot conceal a committed chain and publication conflicts retry',()=>temp(root=>clock(setTime=>{
 retain(root,{stock:stock(),observedAt:baseTime});const [file]=files(root);fs.writeFileSync(path.join(path.dirname(file),'000002.json.0123456789abcdef.tmp'),'unpublished',{mode:0o600});
 assert.equal(read(root,'600001',choice).revision,1);setTime(baseTime+2000);const amended=stock();amended.bars[0].amount=100;
 const link=fs.linkSync;let calls=0;fs.linkSync=(...args)=>{if(++calls===1){const e=Error('simulated compare-and-swap loss');e.code='EEXIST';throw e;}return link(...args);};
 try{const result=retain(root,{stock:amended,observedAt:baseTime+2000});assert.equal(result.revision,2);assert.equal(calls,2);}finally{fs.linkSync=link;}
 assert.equal(read(root,'600001',choice).revision,2);
})));
test('publication retry is bounded and exhaustion leaves the prior chain intact',()=>temp(root=>clock(setTime=>{
 retain(root,{stock:stock(),observedAt:baseTime});setTime(baseTime+2000);const input=stock();input.bars[0].amount=20;
 const link=fs.linkSync;let calls=0;fs.linkSync=()=>{calls++;const e=Error('conflict');e.code='EEXIST';throw e;};
 try{assert.throws(()=>retain(root,{stock:input,observedAt:baseTime+2000}),/并发发布冲突/);assert.equal(calls,5);}finally{fs.linkSync=link;}
 assert.equal(read(root,'600001',choice).revision,1);assert.equal(files(root).length,1);
})));
test('500 content revisions are bounded while a duplicate at capacity is still reusable',()=>temp(root=>clock(setTime=>{
 const input=stock();for(let i=0;i<500;i++){setTime(baseTime+i+1000);input.bars[0].amount=i;assert.equal(retain(root,{stock:input,observedAt:baseTime+i}).revision,i+1);}
 setTime(baseTime+3000);assert.equal(retain(root,{stock:input,observedAt:baseTime+2000}).changed,false);input.bars[0].amount=501;assert.throws(()=>retain(root,{stock:input,observedAt:baseTime+2000}),/500上限/);assert.equal(read(root,'600001',choice).revision,500);
})));
test('a full validated 180 revision by 500 bar archive can be read with a 96MiB heap',()=>temp(root=>{
 const bars=Array.from({length:500},(_,i)=>({...stock().bars[0],date:new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10),amount:1000,suspended:false,tradable:true,isST:false,corporateAction:false,provenance:{receipt:'evidence-'+i+'-'+('raw-data-'.repeat(15))}}));
 clock(()=>retain(root,{stock:stock({bars}),observedAt:baseTime}));
 const firstFile=files(root)[0],dir=path.dirname(firstFile),template=JSON.parse(fs.readFileSync(firstFile,'utf8'));
 const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])])):value;
 const encode=value=>JSON.stringify(sorted(value));let previousHash=template.observationHash,totalBytes=fs.statSync(firstFile).size;
 // Populate a real schema-compatible chain from the first published record.
 // Direct fixture writes avoid 180 quadratic intake scans/fsyncs; the child
 // still verifies every hash, projection, availability field and file boundary.
 for(let i=1;i<180;i++){
  const {observationHash,...event}=template;event.revision=i+1;event.previousHash=previousHash;event.observedAt=baseTime+i;event.recordedAt=baseTime+1000+i;event.stock.observedAt=baseTime+i;
  event.rawStock.bars.at(-1).amount=1000+i;Object.assign(event.stock.bars.at(-1),{amount:1000+i,knownAt:baseTime+i,amountKnownAt:baseTime+i,firstObservedAt:baseTime+i});
  const digest=crypto.createHash('sha256').update(encode(event)).digest('hex'),serialized=encode({...event,observationHash:digest});previousHash=digest;totalBytes+=Buffer.byteLength(serialized);fs.writeFileSync(path.join(dir,String(i+1).padStart(6,'0')+'.json'),serialized,{flag:'wx',mode:0o600});
 }
 assert.ok(totalBytes>72*1024*1024);assert.ok(totalBytes<128*1024*1024);
 const modulePath=require.resolve('../src/core/stock-observation-store');
 const script=`const {readObservedStock}=require(${JSON.stringify(modulePath)});const root=process.argv[1],choice=${JSON.stringify(choice)},latest=readObservedStock(root,'600001',choice),earlier=readObservedStock(root,'600001',{...choice,asOf:${baseTime+1089}});process.stdout.write(JSON.stringify({latestRevision:latest.revision,latestCount:latest.observationCount,bars:latest.stock.bars.length,latestAmount:latest.stock.bars.at(-1).amount,earlierRevision:earlier.revision,earlierCount:earlier.observationCount,earlierAmount:earlier.stock.bars.at(-1).amount}));`;
 const result=spawnSync(process.execPath,['--max-old-space-size=96','-e',script,root],{encoding:'utf8',timeout:45000,maxBuffer:128*1024});
 assert.equal(result.error,undefined,result.error?.message);assert.equal(result.signal,null,result.stderr);assert.equal(result.status,0,result.stderr);
 assert.deepEqual(JSON.parse(result.stdout),{latestRevision:180,latestCount:180,bars:500,latestAmount:1179,earlierRevision:90,earlierCount:90,earlierAmount:1089});
 // An asOf query must still reject corruption in a later, invisible revision.
 const lastFile=path.join(dir,'000180.json'),last=JSON.parse(fs.readFileSync(lastFile,'utf8'));last.stock.bars.at(-1).amount++;fs.writeFileSync(lastFile,JSON.stringify(last));assert.throws(()=>read(root,'600001',{...choice,asOf:baseTime+1089}),/完整性/);
}));
test('two processes racing the same content publish one revision and loser reuses the winning evidence',async()=>temp(async root=>{
 const observedAt=Date.now()-1000;retain(root,{stock:stock(),observedAt});const barrier=path.join(root,'publish'),modulePath=require.resolve('../src/core/stock-observation-store');
 const script=`const fs=require('node:fs'),{retainStockObservation}=require(${JSON.stringify(modulePath)});const original=fs.linkSync;fs.linkSync=(...args)=>{process.stdout.write('ready\\n');const deadline=Date.now()+10000;while(!fs.existsSync(process.argv[2])){if(Date.now()>deadline)throw Error('barrier timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}return original(...args);};process.stdout.write(JSON.stringify(retainStockObservation(process.argv[1],{stock:JSON.parse(process.argv[3]),observedAt:Number(process.argv[4])}))+'\\n');`;
 const input=stock();input.bars[0].amount=10;const workers=[];
 for(let i=0;i<2;i++){
  const child=spawn(process.execPath,['-e',script,root,barrier,JSON.stringify(input),String(observedAt+1)],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';let readyResolve;
  const ready=new Promise(resolve=>{readyResolve=resolve;});child.stdout.on('data',data=>{stdout+=data;if(stdout.includes('ready\n'))readyResolve();});child.stderr.on('data',data=>{stderr+=data;});
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code?reject(Error(stderr||'child failed '+code)):resolve(JSON.parse(stdout.trim().split('\n').at(-1))));});workers.push({child,ready,done});
 }
 try{await Promise.all(workers.map(w=>w.ready));fs.writeFileSync(barrier,'go');const results=await Promise.all(workers.map(w=>w.done));assert.equal(results.filter(r=>r.changed).length,1);assert.equal(results.filter(r=>!r.changed).length,1);assert.equal(read(root,'600001',choice).revision,2);}
 finally{for(const w of workers)if(w.child.exitCode===null)w.child.kill();}
}));
