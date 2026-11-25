'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {bindAuthoritativePlan,decisionPlanPayload}=require('../src/core/paper-decision-plan');
const {buildPaperExecutionChecklist,buildPaperExecutionReport}=require('../src/core/paper-execution-checklist');
const {createPaperExecutionReportStore,MAX_TARGET_RUNS_PER_DAY}=require('../src/core/paper-execution-report-store');
const {createPaperExecutionReportRuntime}=require('../src/server/paper-execution-report-runtime');
const {createPaperExecutionChecklistCache}=require('../src/server/paper-execution-checklist-cache');
const {createPaperApplicationService}=require('../src/core/paper-application-service');
const {createConditionalOrderStore}=require('../src/core/paper-conditional-orders');
const {observePaperPlans,sessions}=require('../src/core/paper-plan-observer');
const {createAutomaticInputProvenance}=require('../src/core/paper-input-provenance');
const {createFillEvidence}=require('../src/core/paper-fill-evidence');

const entryDay='2026-11-06',exitDay='2026-11-09',planId='plan-00000000-0000-4000-8000-000000000001';
const stamp=(day,time)=>Date.parse(day+'T'+time+'+08:00'),clone=value=>JSON.parse(JSON.stringify(value));
const calendar={isOpen:day=>[entryDay,exitDay].includes(day)};
function card(day=entryDay){return {authority:'fayo-decision-center',decisionId:'a'.repeat(64),code:'600000',name:'隔离测试',day,
  calculatedAt:stamp(day,'09:29:40'),strategyAt:stamp(day,'09:29:00'),quoteBasis:{source:'tencent',quoteAt:stamp(day,'09:29:39')},
  plan:{buyLow:9.8,buyHigh:10.1,stop:9.4,target:10.8,positionPct:19.6}};}
function plan(){const c=card();return bindAuthoritativePlan({id:planId,sampleSet:'real',frozenAt:new Date(stamp(entryDay,'09:29:50')).toISOString(),...decisionPlanPayload(c)},c);}
function book(entered=false){
  const entry={eventId:'original-buy',orderId:'buy-order',side:'buy',symbol:'600000',quantity:200,tradeDate:entryDay,
    timestamp:stamp(entryDay,'10:00:00'),price:10,reason:'作战台计划['+planId+'] 原账户风控'};
  return {revision:1,legacy:{enabled:true},feePolicy:{version:'legacy-A-B',feeBps:2.5,minFee:5,sellTaxBps:5},
    account:{cash:10000,events:entered?[entry]:[],positions:entered?{'600000':{quantity:200,
      lots:[{quantity:200,buyDate:entryDay,sellableDate:null,sourceEventId:entry.eventId}]}}:{}},orders:{}};
}
function quote(day,now,price=10){
  const row={code:'600000',name:'隔离测试',price,preClose:10,volume:100000,quoteSource:'tencent',quoteMode:'public-live-unverified',
    quoteAt:now,receivedAt:now,canTrade:true,suspended:false,tradable:true};
  return {symbol:'600000',price,quoteSource:'tencent',provider:'tencent',quoteAt:now,timestamp:now,receivedAt:now,tradeDate:day,
    mode:'public-live-unverified',volumeUnit:'shares',volume:10000000,upperLimit:11,lowerLimit:9,suspended:false,tradable:true,
    inputProvenance:createAutomaticInputProvenance({stock:row,observation:row,stockOrigin:'S.lastPx.wireQuote',priceOrigin:'S.lastPx.wireQuote',limitPct:.1})};
}
function observed(state,day,now,price=10){
  const q=quote(day,now,price),p=plan();
  const result=observePaperPlans({plans:[p],book:state,quotes:{'600000':q},day,now,calendar,continuous:true,
    entryEligibilityByPlan:{[p.id]:{allowed:true,reason:'原只读预检允许',checkedAt:now,quoteAt:now}},
    exitEligibilityByPlan:{[p.id]:{allowed:true,reason:'原只读退出检查允许',checkedAt:now,quoteAt:now}}});
  assert.deepEqual(result.rejected,[]);return result.records;
}
function sell(state,now,quantity){
  const q=quote(exitDay,now,9.3),event={eventId:'sell-'+now,orderId:'sell-order-'+now,side:'sell',symbol:'600000',quantity,
    tradeDate:exitDay,timestamp:now,price:9.3};
  event.fillEvidence=createFillEvidence(q,{executionAt:now,executionKind:'automatic-paper',symbol:'600000',tradeDate:exitDay,price:9.3});
  state.account.events.push(event);state.account.positions['600000'].quantity-=quantity;state.account.positions['600000'].lots[0].quantity-=quantity;
  if(!state.account.positions['600000'].quantity)delete state.account.positions['600000'];
}
function fixture(t,initial=stamp(entryDay,'15:15:00')){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'execution-report-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const state={now:initial,primary:true,enabled:true},root=path.join(base,'private-reports');
  const options={root,clock:()=>state.now,canWrite:()=>state.primary&&state.enabled};
  return {base,root,state,options,store:createPaperExecutionReportStore(options)};
}
const reportInput=(now,state=book(),day=entryDay)=>({day,now,book:state,plans:[plan()],observations:[],conditionalOrders:[],
  sources:{archiveRevision:1,observationRevision:0,conditionalRevision:0,ledgerReadAt:now}});

test('checklist reads original pending/cancelled intents and ledger facts; no pending intention is a fill',t=>{
  const x=fixture(t,stamp(entryDay,'10:01:00')),p=plan(),b=book();
  const intents=createConditionalOrderStore({root:path.join(x.base,'intents'),clock:()=>x.state.now});
  const value=intents.create({requestId:'report-intent-001',plan:p,authorization:{mode:'local',principal:null,generation:0}},{readBook:()=>b});
  const input={day:entryDay,now:x.state.now,plans:[p],book:b,candidates:[card()]};
  assert.equal(buildPaperExecutionChecklist({...input,plans:[]}).items[0].state,'not-planned');
  assert.equal(buildPaperExecutionChecklist(input).items[0].state,'frozen');
  assert.equal(buildPaperExecutionChecklist({...input,conditionalOrders:value.orders}).items[0].state,'waiting-condition');
  const cancelled=intents.cancel({orderId:value.order.id,expectedRevision:value.revision},{readBook:()=>b});
  assert.equal(buildPaperExecutionChecklist({...input,conditionalOrders:cancelled.orders}).items[0].state,'frozen');
  const executed=buildPaperExecutionChecklist({...input,book:book(true)}).items[0];
  assert.equal(executed.state,'executed');assert.equal(executed.entry.eventId,'original-buy');
  assert.equal(executed.observation.riskStatus,'unknown');assert.equal(executed.review,null);
  const fake={...value.orders[0],status:'executed',fill:{eventId:'not-in-original-ledger'}};
  assert.equal(buildPaperExecutionChecklist({...input,conditionalOrders:[fake]}).items[0].state,'unknown');
  assert.equal(buildPaperExecutionChecklist({...input,book:null}).items[0].state,'unknown');
  assert.equal(b.account.events.length,0);
});

test('real observed stop remains pending through partial exit; full exit clears risk without inventing a complete review',()=>{
  const b=book(true),trigger=stamp(exitDay,'10:00:00'),records=observed(b,exitDay,trigger,9.3),before=JSON.stringify(b);
  const input={day:exitDay,now:trigger,plans:[plan()],book:b,observations:records};
  const first=buildPaperExecutionChecklist(input).items[0];
  assert.equal(first.state,'risk-pending');assert.equal(first.risk[0].source,'tencent');assert.equal(first.risk[0].availability,'allowed');
  assert.equal(JSON.stringify(b),before);
  sell(b,trigger+5000,100);
  assert.equal(buildPaperExecutionChecklist({...input,now:trigger+5000}).items[0].state,'risk-pending');
  sell(b,trigger+10000,100);
  const last=buildPaperExecutionChecklist({...input,now:trigger+10000}).items[0];
  assert.equal(last.state,'executed');assert.equal(last.remainingQuantity,0);assert.equal(last.review,null);
  const report=buildPaperExecutionReport({...input,now:stamp(exitDay,'15:15:00')});
  assert.equal(report.score.score,null);assert.equal(report.score.unknown,1,'one trigger cannot prove the full stop observation interval');
});

test('daily report saves unknown evidence, persists late fills as a new version, supports as-of reads and is idempotent across restart',t=>{
  const x=fixture(t),empty=book(),firstAt=x.state.now;
  const first=x.store.save(reportInput(firstAt,empty));
  assert.equal(first.report.score.score,null);assert.equal(first.reportVersion,1);assert.equal(first.checklist.items[0].state,'frozen');
  const original=fs.readFileSync(path.join(x.root,'days',entryDay,'000001.json'));
  x.state.now+=3600000;
  const late=book(true),second=x.store.save(reportInput(x.state.now,late));
  assert.equal(second.reportVersion,2);assert.equal(second.report.score.score,100);
  assert.equal(second.checklist.items[0].state,'reviewed');assert.equal(second.checklist.items[0].review.recordedAt,x.state.now);
  assert.equal(second.previousReportHash,first.reportHash);assert.deepEqual(fs.readFileSync(path.join(x.root,'days',entryDay,'000001.json')),original);
  assert.equal(x.store.read({day:entryDay,asOf:firstAt}).report.score.score,null);
  assert.equal(x.store.history({day:entryDay}).versions.length,2);
  x.state.now+=60000;
  const reopened=createPaperExecutionReportStore(x.options),same=reopened.save(reportInput(x.state.now,late));
  assert.equal(same.reused,true);assert.equal(same.reportVersion,2);assert.equal(same.recordedAt,second.recordedAt);
  assert.equal(same.report.sources.ledger.receivedAt,second.recordedAt,'an unchanged input does not backdate or refresh the saved evidence time');
});

test('reading and saving reports leaves the actual authority ledger byte-identical and never creates private storage on denied/empty reads',t=>{
  const x=fixture(t),file=path.join(x.base,'original-pool.json');
  const account=createPaperApplicationService({file,clock:()=>x.state.now,calendar});account.initialize(10000);
  const before=fs.readFileSync(file),snapshot=account.read();
  assert.equal(x.store.read({day:entryDay}).status,'missing');assert.equal(fs.existsSync(x.root),false);
  x.state.primary=false;assert.throws(()=>x.store.save(reportInput(x.state.now,snapshot)),/原主实例/);
  assert.throws(()=>x.store.reserve({day:entryDay,now:x.state.now}),/原主实例/);assert.equal(fs.existsSync(x.root),false);
  x.state.primary=true;x.store.save(reportInput(x.state.now,snapshot));x.store.read({day:entryDay});
  assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(account.read(),snapshot);
  assert.equal(fs.statSync(path.join(x.root,'days',entryDay,'000001.json')).mode&0o777,0o600);
  assert.equal(fs.statSync(x.root).mode&0o777,0o700);
});

test('role revocation immediately before commit leaves no report; corrupt or linked report paths refuse reads and updates',t=>{
  const x=fixture(t),revoked=createPaperExecutionReportStore({...x.options,faultInjector:phase=>{
    if(phase==='before-report-write')x.state.primary=false;
  }});
  assert.throws(()=>revoked.save(reportInput(x.state.now)),/原主实例/);
  assert.equal(revoked.read({day:entryDay}).status,'missing');
  x.state.primary=true;x.store.save(reportInput(x.state.now));
  const file=path.join(x.root,'days',entryDay,'000001.json'),valid=fs.readFileSync(file),broken=JSON.parse(valid);
  broken.data.report.score.score=100;fs.writeFileSync(file,JSON.stringify(broken));const bad=fs.readFileSync(file);
  assert.throws(()=>x.store.read({day:entryDay}),/完整性/);assert.throws(()=>x.store.save(reportInput(x.state.now)),/完整性/);
  assert.deepEqual(fs.readFileSync(file),bad);fs.writeFileSync(file,valid);
  const outside=path.join(x.base,'outside');fs.mkdirSync(outside,{mode:0o700});
  const linked=path.join(x.base,'linked');fs.symlinkSync(outside,linked);
  assert.throws(()=>createPaperExecutionReportStore({root:linked}),/符号链接/);
});

test('the report process lock rejects an overlapping writer; repeated identical saves produce one immutable version',t=>{
  const x=fixture(t),inputFile=path.join(x.base,'input.json'),modulePath=require.resolve('../src/core/paper-execution-report-store');
  fs.writeFileSync(inputFile,JSON.stringify(reportInput(x.state.now)),{mode:0o600});let other;
  const first=createPaperExecutionReportStore({...x.options,faultInjector:phase=>{
    if(phase!=='before-report-write')return;
    const script=`const fs=require('node:fs');const {createPaperExecutionReportStore}=require(process.argv[1]);const input=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));try{createPaperExecutionReportStore({root:process.argv[2],clock:()=>input.now,canWrite:()=>true}).save(input);process.exitCode=3;}catch(e){if(!/正在处理/.test(e.message))throw e;}`;
    other=spawnSync(process.execPath,['-e',script,modulePath,x.root,inputFile],{encoding:'utf8',timeout:15000});
  }});
  first.save(reportInput(x.state.now));assert.equal(other.status,0,other.stderr);
  assert.equal(x.store.save(reportInput(x.state.now)).reused,true);assert.equal(x.store.history({day:entryDay}).total,1);
});

test('durable attempt reservations survive crash/restart, enforce backoff/limits and reject corrupt run journals',t=>{
  const x=fixture(t,stamp(exitDay,'00:15:00'));
  const first=x.store.reserve({day:entryDay,now:x.state.now});assert.equal(first.reserved,true);
  let reopened=createPaperExecutionReportStore(x.options);
  assert.equal(reopened.reserve({day:entryDay,now:x.state.now}).status,'backoff');
  assert.equal(reopened.schedule().attempts[0].completed,false);
  for(let i=1;i<MAX_TARGET_RUNS_PER_DAY;i++){
    x.state.now+=15*60000;reopened=createPaperExecutionReportStore(x.options);
    const attempt=reopened.reserve({day:entryDay,now:x.state.now});assert.equal(attempt.reserved,true);
    reopened.complete(attempt,{status:'unavailable',reason:'来源暂缺'});
  }
  x.state.now+=15*60000;assert.equal(reopened.reserve({day:entryDay,now:x.state.now}).status,'target-daily-limit');
  assert.equal(reopened.schedule().attempts.length,MAX_TARGET_RUNS_PER_DAY);
  const file=path.join(x.root,'runs',exitDay,'000001.json');fs.appendFileSync(file,'invalid');
  assert.throws(()=>reopened.schedule(),/JSON|Unexpected/);
});

function runtimeFixture(x,{readArchive,readObservations}={}){
  const source={book:book(true),calls:[]};
  const options={clock:()=>x.state.now,isPrimary:()=>x.state.primary,enabled:()=>x.state.enabled,
    session:()=>({day:new Date(x.state.now+28800000).toISOString().slice(0,10).replaceAll('-',''),
      minute:new Date(x.state.now+28800000).getUTCHours()*60+new Date(x.state.now+28800000).getUTCMinutes()}),calendar,
    readArchive:readArchive||(async()=>{source.calls.push('archive');return {ok:true,state:{plans:[plan()],revision:1}};}),
    readBook:()=>{source.calls.push('ledger');return clone(source.book);},
    readObservations:readObservations||(async({day})=>{source.calls.push('observations:'+day);return {day,records:[],revision:0};}),
    readConditionalOrders:()=>{source.calls.push('intent');return {orders:[],revision:0};},store:x.store};
  return {source,options,runtime:createPaperExecutionReportRuntime(options)};
}

test('bounded close scheduler persists one day per job, discovers historical evidence and resumes from durable throttles',async t=>{
  const x=fixture(t,stamp(exitDay,'15:14:00')),r=runtimeFixture(x);
  assert.equal((await r.runtime.tick()).status,'waiting-close');assert.equal(r.source.calls.length,0);
  x.state.now+=60000;const first=await r.runtime.tick();assert.equal(first.status,'saved');assert.equal(first.lastResult.day,exitDay);
  const reads=r.source.calls.length;await r.runtime.tick();assert.equal(r.source.calls.length,reads);
  x.state.now+=5*60000;
  const restarted=createPaperExecutionReportRuntime(r.options),second=await restarted.tick();
  assert.equal(second.lastResult.day,entryDay);assert.equal(second.lastResult.score,100);
  assert.equal(x.store.read({day:exitDay}).reportVersion,1);assert.equal(x.store.read({day:entryDay}).reportVersion,1);
  x.state.now+=15*60000;const unchanged=await restarted.tick();
  assert.equal(unchanged.lastResult.day,exitDay);assert.equal(unchanged.status,'unchanged');
  assert.equal(x.store.read({day:exitDay}).reportVersion,1);
});

test('a 17:30 late ledger receipt still appends a new daily report after earlier successful checks and restart',async t=>{
  const x=fixture(t),r=runtimeFixture(x);r.source.book=book();
  const first=await r.runtime.tick();assert.equal(first.lastResult.score,null);const firstHash=first.lastResult.reportHash;
  for(let i=0;i<4;i++){x.state.now+=15*60000;await r.runtime.tick();}
  assert.equal(x.store.read({day:entryDay}).reportVersion,1);
  x.state.now=stamp(entryDay,'17:30:00');r.source.book=book(true);
  const reopened=createPaperExecutionReportRuntime(r.options),updated=await reopened.tick();
  assert.equal(updated.status,'saved');assert.equal(updated.lastResult.reportVersion,2);assert.equal(updated.lastResult.score,100);
  const daily=x.store.read({day:entryDay});assert.equal(daily.previousReportHash,firstHash);
  assert.equal(daily.recordedAt,stamp(entryDay,'17:30:00'));assert.equal(daily.report.sources.ledger.receivedAt,daily.recordedAt);
  assert.equal(x.store.schedule().attempts.length,6);
});

test('close scheduler records an attempt before await; revocation, concurrent ticks and bad source evidence cannot publish a report',async t=>{
  const x=fixture(t);let release,reads=0;
  const r=runtimeFixture(x,{readArchive:()=>{reads++;return new Promise(resolve=>{release=resolve;});}});
  const first=r.runtime.tick();await new Promise(setImmediate);
  assert.equal(x.store.schedule().attempts.length,1);await r.runtime.tick();assert.equal(reads,1);
  x.state.primary=false;release({ok:true,state:{plans:[plan()],revision:1}});
  assert.equal((await first).status,'disabled-or-replica');assert.equal(x.store.read({day:entryDay}).status,'missing');
  assert.equal(x.store.schedule().attempts[0].completed,false);
  x.state.primary=true;x.state.now+=15*60000;
  const failed=runtimeFixture(x,{readObservations:async()=>{throw Error('原观察链指纹损坏');}});
  const result=await failed.runtime.tick();assert.equal(result.status,'evidence-unavailable');assert.match(result.lastError,/指纹损坏/);
  assert.equal(x.store.read({day:entryDay}).status,'missing');assert.equal(x.store.schedule().attempts.length,2);
});

test('homepage checklist is memory-only, invalidates frozen/filled state, and never scans full observation journals',async t=>{
  const x=fixture(t,stamp(entryDay,'10:01:00'));let reads=0,current=book(),plans=[];
  const cache=createPaperExecutionChecklistCache({clock:()=>x.state.now,isPrimary:()=>x.state.primary,enabled:()=>x.state.enabled,
    readArchive:async()=>{reads++;return {ok:true,state:{plans:clone(plans),revision:1}};},readBook:()=>clone(current),
    readConditionalOrders:()=>({orders:[],revision:0}),readDailyReport:()=>({status:'missing'})});
  for(let i=0;i<50;i++)assert.equal(cache.read({day:entryDay,candidates:[card()]}).items[0].state,'unknown');
  assert.equal(reads,0);await cache.tick();assert.equal(reads,1);
  for(let i=0;i<50;i++)assert.equal(cache.read({day:entryDay,candidates:[card()]}).items[0].state,'not-planned');
  await cache.tick();assert.equal(reads,1);
  plans=[plan()];cache.invalidate();assert.equal(cache.read({day:entryDay,candidates:[card()]}).items[0].state,'unknown');
  await cache.tick();assert.equal(cache.read({day:entryDay,candidates:[card()]}).items[0].state,'frozen');
  current=book(true);cache.invalidate();await cache.tick();assert.equal(cache.read({day:entryDay}).items[0].state,'executed');
  x.state.enabled=false;assert.equal(cache.read({day:entryDay,candidates:[card()]}).status,'disabled-or-replica');
  const before=reads;await cache.tick();assert.equal(reads,before);assert.equal(fs.existsSync(x.root),false);
});

test('only complete persisted daily assessment marks reviewed, including after a live-cache restart',async t=>{
  const x=fixture(t),b=book(),records=[];
  for(const [start,end] of sessions(entryDay))for(let at=start;at<end;at+=15000)records.push(...observed(b,entryDay,at,10.5));
  const saved=x.store.save({...reportInput(x.state.now,b),observations:records});
  assert.equal(saved.report.score.score,100);assert.equal(saved.checklist.items[0].state,'reviewed');
  const cache=createPaperExecutionChecklistCache({clock:()=>x.state.now,isPrimary:()=>true,enabled:()=>true,
    readArchive:async()=>({ok:true,state:{plans:[plan()],revision:1}}),readBook:()=>b,
    readConditionalOrders:()=>({orders:[],revision:0}),readDailyReport:({day})=>x.store.read({day})});
  cache.read({day:entryDay});await cache.tick();
  const item=cache.read({day:entryDay}).items[0];assert.equal(item.state,'reviewed');assert.equal(item.review.reportHash,saved.reportHash);
  assert.equal(item.review.facts[0].status,'符合');assert.equal(item.review.coverageComplete,true);
  assert.throws(()=>buildPaperExecutionReport({...reportInput(stamp(entryDay,'14:59:00'),b)}),/收盘/);
  assert.throws(()=>buildPaperExecutionReport({...reportInput(x.state.now,b),sources:{ledgerReadAt:x.state.now+1}}),/时点/);
});
