'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync,spawn}=require('node:child_process');
const {createConditionalOrderStore}=require('../src/core/paper-conditional-orders');
const {bindAuthoritativePlan,decisionPlanPayload}=require('../src/core/paper-decision-plan');
const {createAutomaticInputProvenance}=require('../src/core/paper-input-provenance');
const day='2026-11-06',open=Date.parse(day+'T10:00:00+08:00');
function plan(){
 const card={authority:'fayo-decision-center',decisionId:'a'.repeat(64),code:'600000',day,calculatedAt:open-3000,
  strategyAt:open-10000,quoteBasis:{source:'tencent',quoteAt:open-3500,receivedAt:open-3200,price:10},
  strategyBasis:{day,score:88},plan:{buyLow:9.8,buyHigh:10.1,stop:9,target:12,positionPct:19.6}};
 return bindAuthoritativePlan({id:'plan-00000000-0000-4000-8000-000000000001',sampleSet:'real',frozenAt:new Date(open-2000).toISOString(),...decisionPlanPayload(card)},card);
}
function setup(t,{shares=100}={}){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'conditional-order-')),root=path.join(base,'intent');
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 let now=open,allowed=true,continuous=true,executions=0,notes=0,quotePatch={},executeError=null;
 const p=plan(),book={account:{events:[],positions:{}}},auth={principal:'device-digest',gen:3,issuedAt:now};
 const readBook=()=>structuredClone(book),store=createConditionalOrderStore({root,clock:()=>now});
 const wire=()=>{
  const q={symbol:p.code,tradeDate:new Date(now+28800000).toISOString().slice(0,10),price:10,
   quoteAt:now-100,timestamp:now-100,receivedAt:now-50,quoteSource:'tencent',provider:'tencent',mode:'public-live-unverified',volume:100000,volumeUnit:'shares',
   lowerLimit:8,upperLimit:13,suspended:false,tradable:true,...quotePatch};
  const row={...q,code:q.symbol,preClose:10.5,volume:q.volume/100};
  return {...q,inputProvenance:createAutomaticInputProvenance({stock:row,observation:row,stockOrigin:'S.lastPx.wireQuote',priceOrigin:'S.lastPx.wireQuote',limitPct:2.5/10.5}),...quotePatch};
 };
 const execute=()=>{executions++;if(executeError)throw Error(executeError);
  const event={eventId:'original-fill',symbol:p.code,side:'buy',price:10,quantity:shares,tradeDate:day,timestamp:now,
   reason:'作战台计划['+p.id+'] 原账户风控'};
  book.account.events.push(event);book.account.positions[p.code]={quantity:shares};return {status:'executed',eventId:event.eventId};};
 const args=()=>({now,day:new Date(now+28800000).toISOString().slice(0,10),replica:false,continuous,authorized:()=>allowed,
  planFor:()=>p,quoteFor:wire,readBook,execute,exitAllowedFor:()=>({allowed:true,reason:'原账户可卖窗口'}),
  notificationOwner:'conditional-order',notify:()=>{notes++;return {status:'queued'};}});
 return {base,root,p,book,auth,store,readBook,wire,args,
  create:requestId=>store.create({requestId:requestId||'request-1234',plan:p,authorization:auth},{readBook}),
  tick:patch=>store.tick({...args(),...patch}),get executions(){return executions;},get notes(){return notes;},
  setTime:value=>{now=value;},setQuote:value=>{quotePatch=value;},setAllowed:value=>{allowed=value;},
  setContinuous:value=>{continuous=value;},setError:value=>{executeError=value;}};
}
test('empty reads create no files; explicit intents persist without disclosing authorization and retries stay idempotent',t=>{
 const x=setup(t);assert.equal(x.store.read().orders.length,0);assert.equal(fs.existsSync(x.root),false);
 const first=x.create();assert.equal(first.order.status,'pending');assert.equal(x.executions,0);
 assert.equal(Object.hasOwn(first.order,'authorization'),false);assert.equal(JSON.stringify(first).includes('device-digest'),false);
 const bytes=fs.readFileSync(path.join(x.root,'conditional-orders.json'));
 assert.equal(x.create().order.id,first.order.id);assert.equal(x.create('another-request').order.id,first.order.id);
 assert.equal(x.store.create({requestId:'request-1234',plan:x.p,authorization:{...x.auth,issuedAt:open+1,signature:'new-signature'}},{readBook:x.readBook}).order.id,first.order.id);
 assert.deepEqual(fs.readFileSync(path.join(x.root,'conditional-orders.json')),bytes);
 assert.throws(()=>x.store.create({requestId:'request-1234',plan:x.p,authorization:{...x.auth,gen:4}},{readBook:x.readBook}),/内容冲突/);
 const reopened=createConditionalOrderStore({root:x.root,clock:()=>open});assert.equal(reopened.read().orders[0].id,first.order.id);
 assert.equal(fs.statSync(path.join(x.root,'conditional-orders.json')).mode&0o777,0o600);
});
test('missing, stale, future, wrong-day, suspended, partial and sealed quotes never invoke execution; original gate rejection stays pending',t=>{
 const x=setup(t);x.create();
 for(const patch of [{quoteAt:open-15001,timestamp:open-15001},{quoteAt:open+1,timestamp:open+1},{tradeDate:'2026-11-05'},
  {quoteAt:null,timestamp:null},{quoteSource:null},{receivedAt:open+1},{volume:null},{volumeUnit:null},{suspended:true},
  {tradable:false},{price:13},{price:8},{price:11},{quoteSource:'mock-feed'}]){x.setQuote(patch);x.tick();assert.equal(x.executions,0);}
 x.setQuote({});x.setError('候选已经撤销');assert.equal(x.tick().orders[0].status,'pending');assert.equal(x.executions,1);
 assert.match(x.store.read().orders[0].lastReason,/候选已经撤销/);assert.equal(x.book.account.events.length,0);
});
test('lunch pauses, replicas do not write, expiry and cancellation cannot revive on restart',t=>{
 const x=setup(t);const first=x.create();x.setContinuous(false);x.tick();assert.equal(x.executions,0);
 const file=path.join(x.root,'conditional-orders.json'),before=fs.readFileSync(file);x.tick({replica:true});assert.deepEqual(fs.readFileSync(file),before);
 assert.throws(()=>x.store.cancel({orderId:first.order.id,expectedRevision:0},{readBook:x.readBook}),/版本/);
 const state=x.store.read();x.store.cancel({orderId:first.order.id,expectedRevision:state.revision},{readBook:x.readBook});
 x.setContinuous(true);x.tick();assert.equal(x.executions,0);assert.equal(x.store.read().orders[0].status,'cancelled');
 const y=setup(t);y.create();y.setTime(Date.parse(day+'T14:57:00+08:00'));y.tick();
 assert.equal(y.executions,0);assert.equal(y.store.read().orders[0].status,'expired');assert.equal(y.store.read().orders[0].canCancel,false);
 const z=setup(t);z.create();z.setTime(Date.parse('2026-11-09T10:00:00+08:00'));z.tick({planFor:()=>null});assert.equal(z.store.read().orders[0].status,'expired');
});
test('revocation is checked again immediately before execution, and never resumes an unauthorized order silently',t=>{
 const x=setup(t);x.create();let reads=0;
 x.tick({authorized:()=>++reads===1});assert.equal(x.executions,0);assert.equal(x.store.read().orders[0].status,'unauthorized');
 x.tick();assert.equal(x.executions,0);
});
test('resetting the original account epoch cancels earlier pending intentions without touching its new balance',t=>{
 const x=setup(t);x.book.revision=4;x.create();
 x.book.archives=[{revision:4,account:{fingerprint:'prior-original-period'}}];x.book.revision=5;
 const before=JSON.stringify(x.book);x.tick();assert.equal(x.executions,0);assert.equal(x.store.read().orders[0].status,'cancelled');
 assert.match(x.store.read().orders[0].lastReason,/期次/);assert.equal(JSON.stringify(x.book),before);
 const y=setup(t);y.book.revision=8;y.create();y.book.revision=1;y.tick();assert.equal(y.executions,0);assert.equal(y.store.read().orders[0].status,'cancelled');
});
test('only a matching original durable fill marks success; restart and duplicate ticks cannot buy twice',t=>{
 const x=setup(t);x.create();const after=x.tick();
 assert.equal(x.executions,1);assert.equal(after.orders[0].status,'executed');assert.equal(after.orders[0].fill.eventId,'original-fill');
 x.tick();assert.equal(x.executions,1);assert.equal(x.book.account.events.length,1);
 const reopened=createConditionalOrderStore({root:x.root,clock:()=>open});reopened.tick(x.args());assert.equal(x.executions,1);
 assert.ok(after.orders[0].observations.some(row=>row.kind==='entry'&&row.source==='tencent'&&row.originalFreshGate));
 const y=setup(t);y.create();y.tick({execute:()=>({ok:true,eventId:'invented-reply'})});
 assert.equal(y.store.read().orders[0].status,'pending');assert.equal(y.store.read().orders[0].fill,null);
});
test('process death after original commit but before intent acknowledgement reconciles instead of buying again',t=>{
 const x=setup(t);x.create();const bookFile=path.join(x.base,'book.json');fs.writeFileSync(bookFile,JSON.stringify(x.book));
 const modulePath=path.resolve(__dirname,'../src/core/paper-conditional-orders.js');
 const child=spawnSync(process.execPath,['-e',`
  const fs=require('node:fs'),{createConditionalOrderStore}=require(process.argv[1]);
  const root=process.argv[2],bookFile=process.argv[3],p=JSON.parse(process.argv[4]),now=Number(process.argv[5]);
  const store=createConditionalOrderStore({root,clock:()=>now});
  store.tick({now,day:p.intendedDate,replica:false,continuous:true,authorized:()=>true,planFor:()=>p,
    quoteFor:()=>JSON.parse(process.argv[6]),
    readBook:()=>JSON.parse(fs.readFileSync(bookFile)),execute:()=>{const b=JSON.parse(fs.readFileSync(bookFile));
      b.account.events.push({eventId:'committed-before-kill',symbol:p.code,side:'buy',price:10,quantity:100,tradeDate:p.intendedDate,timestamp:now,reason:'作战台计划['+p.id+'] 原账户风控'});
      b.account.positions[p.code]={quantity:100};fs.writeFileSync(bookFile,JSON.stringify(b));process.exit(23);}});
 `,modulePath,x.root,bookFile,JSON.stringify(x.p),String(open),JSON.stringify(x.wire())],{encoding:'utf8'});
 assert.equal(child.status,23,child.stderr);assert.equal(x.store.read().orders[0].status,'pending');
 const reopened=createConditionalOrderStore({root:x.root,clock:()=>open});
 const state=reopened.tick({...x.args(),readBook:()=>JSON.parse(fs.readFileSync(bookFile)),execute:()=>assert.fail('must not re-execute')});
 assert.equal(state.orders[0].status,'executed');assert.equal(state.orders[0].fill.eventId,'committed-before-kill');
});
test('original quote triggers record T+1/window evidence and private delivery acceptance is not called delivered',t=>{
 const x=setup(t);x.create();x.tick();x.setQuote({price:8.8});x.tick();
 let order=x.store.read().orders[0];assert.equal(order.observations.find(row=>row.kind==='stop').sellable,false);
 assert.equal(x.notes,1);assert.equal(order.alerts[0].status,'queued');x.tick();assert.equal(x.notes,1);
 x.setTime(Date.parse('2026-11-09T10:00:00+08:00'));x.tick();order=x.store.read().orders[0];
 assert.equal(order.observations.find(row=>row.kind==='stop'&&row.day==='2026-11-09').sellable,true);
 assert.equal(x.notes,2);assert.equal(order.coverage.every(row=>row.completeSession===false),true);
 x.book.account.events.push({eventId:'original-sell',side:'sell',symbol:'600000',price:8.8,quantity:100,tradeDate:'2026-11-09',timestamp:Date.parse('2026-11-09T10:00:01+08:00')});
 x.book.account.positions={};x.setTime(Date.parse('2026-11-09T10:00:02+08:00'));x.tick();assert.equal(x.store.read().orders[0].monitoringActive,false);
});
test('two processes racing the same intent share the OS lock and produce one original account callback',async t=>{
 const x=setup(t);x.create();const bookFile=path.join(x.base,'race-book.json');fs.writeFileSync(bookFile,JSON.stringify(x.book));
 const source=`const fs=require('node:fs'),{createConditionalOrderStore}=require(process.argv[1]);
 const root=process.argv[2],file=process.argv[3],plan=JSON.parse(process.argv[4]),now=Number(process.argv[5]);
 const store=createConditionalOrderStore({root,clock:()=>now});
 const run=()=>store.tick({now,day:plan.intendedDate,replica:false,continuous:true,authorized:()=>true,planFor:()=>plan,
  quoteFor:()=>JSON.parse(process.argv[6]),
  readBook:()=>JSON.parse(fs.readFileSync(file)),execute:()=>{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,80);
   const b=JSON.parse(fs.readFileSync(file));b.account.events.push({eventId:'once',symbol:plan.code,side:'buy',price:10,quantity:100,tradeDate:plan.intendedDate,timestamp:now,reason:'作战台计划['+plan.id+']'});
   b.account.positions[plan.code]={quantity:100};fs.writeFileSync(file,JSON.stringify(b));}});
 (async()=>{for(let i=0;i<30;i++){try{run();return;}catch(e){if(!/正在处理/.test(e.message))throw e;await new Promise(r=>setTimeout(r,20));}}throw Error('lock timeout');})().catch(e=>{process.stderr.write(e.stack);process.exitCode=1;});`;
 const worker=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['-e',source,path.resolve(__dirname,'../src/core/paper-conditional-orders.js'),x.root,bookFile,JSON.stringify(x.p),String(open),JSON.stringify(x.wire())]);
  let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(stderr||'child '+code)));});
 await Promise.all([worker(),worker()]);assert.equal(JSON.parse(fs.readFileSync(bookFile)).account.events.length,1);
 assert.equal(x.store.read().orders[0].status,'executed');
});
test('a verified stop window plus original sale is scored; corrupted, blocked or absent observations stay unknown',t=>{
 const {paperExecutionScore}=require('../src/core/paper-decision-plan');
 const {createFillEvidence}=require('../src/core/paper-fill-evidence');
 const x=setup(t);x.create();x.tick();const observedAt=Date.parse('2026-11-09T10:00:00+08:00');
 x.setTime(observedAt);x.setQuote({price:8.8});x.tick();
 const sale={eventId:'timely-stop',symbol:'600000',side:'sell',price:8.8,quantity:100,tradeDate:'2026-11-09',timestamp:observedAt+2000};
 sale.fillEvidence=createFillEvidence(x.wire(),{executionAt:sale.timestamp,executionKind:'automatic-paper',symbol:sale.symbol,tradeDate:sale.tradeDate,price:sale.price});
 x.book.account.events.push(sale);x.book.account.positions={};
 const inputs={book:x.readBook(),plans:[x.p],conditionalOrders:x.store.read().orders,day:'2026-11-09',now:Date.parse('2026-11-09T15:01:00+08:00')};
 const score=paperExecutionScore(inputs);assert.equal(score.score,100);assert.equal(score.rows[0].facts[1].status,'符合');
 assert.equal(score.rows[0].facts[1].eventId,'timely-stop');
 const forged=structuredClone(inputs.conditionalOrders);forged[0].observations.find(p=>p.kind==='stop').price=1;
 assert.equal(paperExecutionScore({...inputs,conditionalOrders:forged}).score,null);
 assert.equal(paperExecutionScore({...inputs,conditionalOrders:[]}).score,null);
 assert.equal(score.rows[0].coverage.complete,false);assert.equal(score.rows[0].facts[1].sessionCoverageComplete,false);
 const late=structuredClone(inputs.book),last=late.account.events.at(-1);last.timestamp=observedAt+20000;
 x.setTime(last.timestamp);last.fillEvidence=createFillEvidence(x.wire(),
  {executionAt:last.timestamp,executionKind:'automatic-paper',symbol:last.symbol,tradeDate:last.tradeDate,price:last.price});
 assert.equal(paperExecutionScore({...inputs,book:late}).score,null);
});
test('partial original sales keep the original remaining lot monitored and cannot score as a full stop exit',t=>{
 const {paperExecutionScore}=require('../src/core/paper-decision-plan'),{createFillEvidence}=require('../src/core/paper-fill-evidence');
 const x=setup(t,{shares:200});x.create();x.tick();const at=Date.parse('2026-11-09T10:00:00+08:00');
 x.setTime(at);x.setQuote({price:8.8});x.tick();
 const sale={eventId:'partial-original-sell',side:'sell',symbol:x.p.code,quantity:100,price:8.8,tradeDate:'2026-11-09',timestamp:at+1000};
 sale.fillEvidence=createFillEvidence(x.wire(),{executionAt:sale.timestamp,executionKind:'automatic-paper',symbol:sale.symbol,tradeDate:sale.tradeDate,price:sale.price});
 x.book.account.events.push(sale);x.book.account.positions[x.p.code].quantity=100;x.setTime(at+2000);x.tick();
 let order=x.store.read().orders[0];assert.equal(order.monitoringActive,true);assert.equal(order.remainingQuantity,100);
 const input={book:x.readBook(),plans:[x.p],conditionalOrders:[order],day:'2026-11-09',now:Date.parse('2026-11-09T15:01:00+08:00')};
 assert.equal(paperExecutionScore(input).score,null);assert.equal(paperExecutionScore(input).rows[0].facts[1].status,'资料不足');
 const last={...sale,eventId:'remaining-original-sell',timestamp:at+3000};
 last.fillEvidence=createFillEvidence(x.wire(),{executionAt:last.timestamp,executionKind:'automatic-paper',symbol:last.symbol,tradeDate:last.tradeDate,price:last.price});
 x.book.account.events.push(last);x.book.account.positions={};x.setTime(at+4000);x.tick();
 order=x.store.read().orders[0];assert.equal(order.monitoringActive,false);assert.equal(order.remainingQuantity,0);
 const complete=paperExecutionScore({...input,book:x.readBook(),conditionalOrders:[order]});
 assert.equal(complete.score,100);assert.deepEqual(complete.rows[0].facts[1].eventIds,['partial-original-sell','remaining-original-sell']);
});
test('plan observer owns notifications by default even if a stale caller still passes notify',t=>{
 const x=setup(t);x.create();x.tick();x.setQuote({price:8.8});
 const args=x.args();delete args.notificationOwner;
 x.store.tick(args);x.store.tick(args);
 const order=x.store.read().orders[0];assert.equal(x.notes,0);assert.equal(order.notificationOwner,'plan-observer');
 assert.equal(order.alerts.length,1);assert.equal(order.alerts[0].status,'delegated');
 assert.equal(order.alerts[0].owner,'plan-observer');assert.equal(order.alerts[0].planId,x.p.id);
 assert.equal(order.alerts[0].entryEventId,'original-fill');assert.match(order.alerts[0].observerAlertId,/^[a-f0-9]{64}$/);
});
test('damaged intent files, mismatched frozen plan and unsafe paths fail closed without invoking account execution',t=>{
 const x=setup(t);x.create();x.tick({planFor:()=>({...x.p,stop:8})});assert.equal(x.executions,0);
 const file=path.join(x.root,'conditional-orders.json'),v=JSON.parse(fs.readFileSync(file));v.orders[0].plan.entryMax=100;fs.writeFileSync(file,JSON.stringify(v));
 assert.throws(()=>x.tick(),/完整性/);assert.equal(x.executions,0);
 assert.throws(()=>createConditionalOrderStore({root:path.join(x.base,'public','intent')}),/禁止公开/);
 const link=path.join(x.base,'linked');fs.symlinkSync(x.root,link);assert.throws(()=>createConditionalOrderStore({root:link}),/符号链接/);
});


test('conditional entry rejects read-only, simulated, conflicted, incomplete and pre-freeze quote evidence',t=>{
 for(const patch of [{canTrade:false},{readOnlyBackup:true},{simulated:true},{imported:true},{mode:'historical-replay'},
  {sourceConflict:true},{conflict:true},{evidenceStatus:'conflict'},{quoteStatus:'conflict'},{provider:'other-provider'},
  {receivedAt:null},{inputProvenance:null},{quoteAt:open-2001,timestamp:open-2001}]){
  const x=setup(t);x.create();x.setQuote(patch);const order=x.tick().orders[0];
  assert.equal(x.executions,0,JSON.stringify(patch));assert.equal(order.status,'pending');assert.equal(order.observations.length,0);assert.equal(order.coverage[0].missing,1);
 }
});
test('conditional entry independently checks continuous-session boundaries and revalidates the original quote before execution',t=>{
 const a=setup(t);a.setTime(Date.parse(day+'T11:30:01+08:00'));a.create();a.tick();assert.equal(a.executions,0);
 const b=setup(t);b.setTime(Date.parse(day+'T13:00:01+08:00'));b.create();b.setQuote({quoteAt:Date.parse(day+'T12:59:59+08:00'),timestamp:Date.parse(day+'T12:59:59+08:00')});b.tick();assert.equal(b.executions,0);
 const c=setup(t);c.create();let reads=0;c.tick({quoteFor:()=>++reads===1?c.wire():{...c.wire(),canTrade:false}});
 assert.equal(c.executions,0);assert.equal(c.store.read().orders[0].status,'pending');
});
test('durable trigger cannot execute after the original time window or expiry has passed',t=>{
 const x=setup(t);x.create();let checks=0;
 x.tick({authorized:()=>{if(++checks===2)x.setTime(open+16000);return true;}});
 assert.equal(x.executions,0);assert.equal(x.store.read().orders[0].status,'pending');
 const y=setup(t);y.setTime(Date.parse(day+'T14:56:59+08:00'));y.create();let approvals=0;
 y.tick({authorized:()=>{if(++approvals===2)y.setTime(Date.parse(day+'T14:57:00+08:00'));return true;}});
 assert.equal(y.executions,0);assert.equal(y.store.read().orders[0].status,'expired');
});

test('a real original fill committed milliseconds after the tick start reconciles against the actual completion time',t=>{
 const x=setup(t);x.create();
 const result=x.tick({execute:()=>{x.setTime(open+5);return x.args().execute();}});
 assert.equal(x.executions,1);assert.equal(result.orders[0].status,'executed');assert.equal(result.orders[0].fill.executionAt,open+5);
 assert.equal(x.tick().orders[0].status,'executed');assert.equal(x.executions,1);
});
