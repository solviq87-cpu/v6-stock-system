'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDecisionEvidenceRuntime,selectActivePlans}=require('../src/server/decision-evidence-runtime');
const day='2026-11-25',time=Date.parse(day+'T10:00:00+08:00');
function setup(patch={}){
 let now=time,primary=true,continuous=true,configured=false,archiveReads=0,writes=0,sends=0,collections=0;
 const seen=new Set(),records=[],observations=[];
 const dependencies={clock:()=>now,isPrimary:()=>primary,session:()=>({day,continuous}),
  readArchive:async()=>{archiveReads++;return {ok:true,state:{plans:[{id:'p',intendedDate:day,decisionAuthority:'fayo-decision-center'}]}};},
  readContext:async()=>({now:now-1}),observe:input=>{observations.push(input);return {records:[{id:now}],alerts:[{id:'entry',day,quoteAt:now-500}]};},
  store:{async append(batch){writes++;records.push(...batch.records);const alerts=batch.alerts.filter(a=>!seen.has(a.id));alerts.forEach(a=>seen.add(a.id));return {alerts};}},
  privateReady:()=>configured,sendPrivate:async()=>{sends++;},historyDay:()=>day,historySymbols:()=>['600000','600001','600002','600003'],
  collectHistory:async input=>{collections++;return {status:'collected',summary:{symbols:input.symbols},missing:['原始源端时刻']};},...patch};
 const runtime=createDecisionEvidenceRuntime(dependencies);
 return {runtime,observations,records,set:v=>{if(v.now!==undefined)now=v.now;if(v.primary!==undefined)primary=v.primary;
  if(v.continuous!==undefined)continuous=v.continuous;if(v.configured!==undefined)configured=v.configured;},
  counts:()=>({archiveReads,writes,sends,collections})};
}
test('observer never acts outside original primary continuous session',async()=>{
 const x=setup();x.set({primary:false});await x.runtime.tick();await x.runtime.tickHistory();
 assert.deepEqual(x.counts(),{archiveReads:0,writes:0,sends:0,collections:0});
 x.set({primary:true,continuous:false});await x.runtime.tick();assert.equal(x.counts().writes,0);
});
test('only actual snapshots are persisted and unconfigured alerts are not replayed when a channel appears',async()=>{
 const x=setup();await x.runtime.tick();
 assert.equal(x.observations[0].now,time-1);assert.equal(x.runtime.status().privateChannel,'unconfigured');
 assert.equal(x.counts().sends,0);x.set({now:time+5000,configured:true});await x.runtime.tick();
 assert.equal(x.counts().writes,2);assert.equal(x.counts().archiveReads,1);assert.equal(x.counts().sends,0);
 x.runtime.invalidate();await x.runtime.tick();assert.equal(x.counts().archiveReads,2);
});
test('pending reads share a busy guard and role loss before persistence cancels the observation',async()=>{
 let resolve;const x=setup({readContext:()=>new Promise(r=>resolve=r)});
 const first=x.runtime.tick();await new Promise(r=>setImmediate(r));await x.runtime.tick();
 x.set({primary:false});resolve({now:time});await first;assert.equal(x.counts().writes,0);
});
test('private channel receives only committed new alerts; failed or stale observations cannot send',async()=>{
 const x=setup();x.set({configured:true});await x.runtime.tick();await x.runtime.tick();assert.equal(x.counts().sends,1);
 const failed=setup({store:{async append(){throw Error('证据写入失败');}}});failed.set({configured:true});await failed.runtime.tick();
 assert.equal(failed.counts().sends,0);assert.equal(failed.runtime.status().status,'evidence-unavailable');
 const stale=setup({readContext:async()=>({now:time-15001})});stale.set({configured:true});await stale.runtime.tick();
 assert.equal(stale.counts().writes,0);assert.match(stale.runtime.status().lastError,/过期/);
});
test('history uses at most three actual symbols and bounded retry; a missing timestamp is retained',async()=>{
 const x=setup();await x.runtime.tickHistory();assert.equal(x.counts().collections,1);
 assert.equal(x.runtime.status().history.summary.symbols.length,3);assert.deepEqual(x.runtime.status().history.missing,['原始源端时刻']);
 x.set({now:time+3600000});await x.runtime.tickHistory();assert.equal(x.counts().collections,1);
 let attempts=0;const y=setup({collectHistory:async()=>{attempts++;throw Error('unavailable');}});
 for(let i=0;i<5;i++){y.set({now:time+i*900000});await y.runtime.tickHistory();}assert.equal(attempts,3);
});
test('unsupported history markets cannot poison a supported batch and remain explicit in coverage',async()=>{
 const x=setup({historySymbols:()=>['920001','830001','600000','000001','300001','600001']});
 await x.runtime.tickHistory();
 assert.deepEqual(x.runtime.status().history.summary.symbols,['600000','000001','300001']);
 assert.deepEqual(x.runtime.status().history.coverage.excludedSymbols,['920001','830001']);
 const y=setup({historySymbols:()=>['920001']});await y.runtime.tickHistory();
 assert.equal(y.counts().collections,0);assert.equal(y.runtime.status().history.status,'no-supported-symbols');
});
test('active observations retain today and original held lots, excluding closed, archived and later round trips',()=>{
 const id='plan-00000000-0000-4000-8000-000000000001';
 const plan={id,code:'600000',intendedDate:'2026-11-24',decisionAuthority:'fayo-decision-center'};
 const today={...plan,id:'today',intendedDate:day},future={...plan,id:'future',intendedDate:'2026-11-26'};
 const book={account:{positions:{'600000':{quantity:100,lots:[{quantity:100,sourceEventId:'buy'}]}},
  events:[{side:'buy',symbol:'600000',eventId:'buy',reason:'作战台计划['+id+'] 原风控'}]}};
 const plans=[plan,today,future],before=JSON.stringify({plans,book});
 assert.deepEqual(selectActivePlans(plans,book,day),[plan,today]);
 assert.equal(JSON.stringify({plans,book}),before);
 book.account.positions['600000'].lots[0].sourceEventId='later-buy';
 assert.deepEqual(selectActivePlans(plans,book,day),[today]);
 book.archives=[{account:{events:book.account.events}}];book.account.events=[];
 assert.deepEqual(selectActivePlans(plans,book,day),[today]);
});
test('unbound legacy history remains delegated and never starts a competing collection loop',async()=>{
 const x=setup({historyDay:undefined,historySymbols:undefined,collectHistory:undefined});
 assert.equal(x.runtime.status().history.status,'delegated');assert.equal(x.runtime.status().history.owner,'decision-center-background');
 await x.runtime.tickHistory();assert.equal(x.counts().collections,0);
 await x.runtime.tick();assert.equal(x.counts().writes,1);
});

test('plan trace measures committed observation, not delivery; read-only and duplicate alerts do not dispatch',async()=>{
 const {createRuntimeTrace}=require('../src/core/runtime-trace');
 const trace=createRuntimeTrace({clock:()=>time});
 const x=setup({trace});x.set({primary:false,configured:true});await x.runtime.tick();
 assert.equal(trace.read().spans.length,0);
 x.set({primary:true});await x.runtime.tick();await x.runtime.tick();
 assert.equal(x.counts().writes,2);assert.equal(x.counts().sends,1);
 const rows=trace.read().spans,roots=rows.filter(r=>r.stage==='task.decision-evidence');
 assert.equal(roots.length,2);
 for(const root of roots){
  const stages=rows.filter(r=>r.traceId===root.traceId&&r.parentSpanId===root.spanId);
  assert.ok(stages.some(r=>r.stage==='risk.plan-context'));
  assert.ok(stages.some(r=>r.stage==='risk.plan-observation'));
  assert.ok(stages.some(r=>r.stage==='risk.plan-persist'));
 }
 const dispatched=rows.filter(r=>r.stage==='notification.dispatch');
 assert.equal(dispatched.length,1);assert.equal(dispatched[0].status,'unknown');
 assert.equal(dispatched[0].reasonCode,'DELIVERY_UNKNOWN');
 assert.equal(rows.some(r=>r.stage==='notification.delivery'),false);
 assert.equal(trace.read().active,0);
});
test('persistence failure traces the failed original stage and never creates a dispatch span',async()=>{
 const {createRuntimeTrace}=require('../src/core/runtime-trace');
 const trace=createRuntimeTrace({clock:()=>time});
 const x=setup({trace,store:{async append(){throw Error('private persistence detail');}}});
 x.set({configured:true});await x.runtime.tick();
 const rows=trace.read().spans;
 assert.equal(rows.find(r=>r.stage==='risk.plan-persist').status,'failed');
 assert.equal(rows.find(r=>r.stage==='task.decision-evidence').status,'failed');
 assert.equal(rows.some(r=>r.stage.startsWith('notification.')),false);
 assert.equal(x.counts().sends,0);assert.equal(trace.read().active,0);
 assert.doesNotMatch(JSON.stringify(rows),/private persistence detail/);
});

test('invalidating an archive while a plan context is in flight prevents stale observation and persistence',async()=>{
 let release,reads=0;
 const x=setup({readContext:()=>++reads===1?new Promise(r=>{release=r;}):Promise.resolve({now:time})});
 x.set({configured:true});const first=x.runtime.tick();await new Promise(setImmediate);
 x.runtime.invalidate();release({now:time});await first;
 assert.equal(x.counts().writes,0);assert.equal(x.counts().sends,0);assert.equal(x.observations.length,0);
 await x.runtime.tick();assert.equal(x.counts().archiveReads,2);assert.equal(x.counts().writes,1);assert.equal(x.counts().sends,1);
});
test('committed alert with a missing or future original quote time never dispatches',async()=>{
 for(const quoteAt of [undefined,null,NaN,time+1,time-15001]){
  const x=setup({store:{async append(){return {alerts:[{id:'bad',day,quoteAt}]};}}});
  x.set({configured:true});await x.runtime.tick();assert.equal(x.counts().sends,0);
 }
 const valid=setup({store:{async append(){return {alerts:[{id:'valid',day,quoteAt:time-15000}]};}}});
 valid.set({configured:true});await valid.runtime.tick();assert.equal(valid.counts().sends,1);
});
test('invalidation during persistence retains committed records but blocks stale outbound reminders',async()=>{
 let release;
 const x=setup({store:{append:()=>new Promise(r=>{release=r;})}});
 x.set({configured:true});const running=x.runtime.tick();await new Promise(setImmediate);
 x.runtime.invalidate();release({alerts:[{id:'committed',day,quoteAt:time}]});
 await running;assert.equal(x.counts().sends,0);assert.equal(x.observations.length,1);
});
