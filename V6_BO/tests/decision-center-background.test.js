'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDecisionCenterBackground}=require('../src/server/decision-center-background');
function financialEvidence(code,receivedAt){
  const {parseFinancials}=require('../src/core/public-stock-financials');
  const row=(date,roe)=>({SECURITY_CODE:code,SECUCODE:code+'.SH',CURRENCY:'CNY',REPORT_DATE:date,
    NOTICE_DATE:date==='2025-09-30'?'2025-10-30':'2026-10-30',UPDATE_DATE:'2026-10-30',ROEJQ:roe,
    ZCFZL:40,PARENTNETPROFITTZ:20,TOTALOPERATEREVETZ:10});
  const rows=[row('2025-09-30',10),row('2026-09-30',12)],raw=data=>JSON.stringify({success:true,result:{data}});
  const period=parseFinancials(raw(rows),{symbol:code,kind:'period',receivedAt:receivedAt-1000});
  const quarter=parseFinancials(raw([rows[1]]),{symbol:code,kind:'quarter',receivedAt,period});
  return {symbol:code,source:'eastmoney-financials',datasets:{period,quarter}};
}
function fixture() {
  const s={now:Date.parse('2026-11-25T10:00:00+08:00'),primary:true,enabled:true,session:{openDay:true,trading:true,minute:600,day:'20261125'},calls:[]};
  const collect=kind=>async value=>{s.calls.push({kind,...value});return kind==='history'?{ok:true,result:{status:'admitted'}}:
    {ok:true,result:{marketContext:{financials:financialEvidence(value.code,s.now)}}};};
  const worker=createDecisionCenterBackground({clock:()=>s.now,enabled:()=>s.enabled,isPrimary:()=>s.primary,session:()=>s.session,
    candidates:()=>['600000','600001','600000','bad'],collectHistory:collect('history'),collectFinancials:collect('financials')});
  return {s,worker};
}
test('only the primary collects, one research task per minute and no history before close',async()=>{
  const {s,worker}=fixture();s.primary=false;await worker.tick();assert.equal(s.calls.length,0);
  s.primary=true;s.enabled=false;await worker.tick();assert.equal(s.calls.length,0);
  s.enabled=true;await worker.tick();await worker.tick();assert.equal(s.calls.length,1);assert.equal(s.calls[0].kind,'financials');
  s.now+=60000;await worker.tick();assert.equal(s.calls.length,2);assert.notEqual(s.calls[0].code,s.calls[1].code);
  s.now+=60000;await worker.tick();assert.equal(s.calls.length,2,'successful financials are not recaptured every minute');
  s.session.minute=915;s.session.trading=false;s.now+=60000;await worker.tick();assert.equal(s.calls.length,2);
  s.session.minute=960;s.now+=60000;await worker.tick();assert.equal(s.calls[2].kind,'history');
  assert.equal(s.calls[2].day,'2026-11-25');assert.equal(worker.status().running,false);
});
test('failed evidence stays missing and retries are bounded; a busy collector never overlaps',async()=>{
  let now=Date.parse('2026-11-25T15:15:00+08:00'),calls=0,release;
  const worker=createDecisionCenterBackground({clock:()=>now,enabled:()=>true,isPrimary:()=>true,
    session:()=>({openDay:true,trading:false,minute:960,day:'20261125'}),candidates:()=>['600000'],
    collectHistory:()=>{calls++;return new Promise(r=>{release=r;});},collectFinancials:async()=>({ok:false})});
  const first=worker.tick();await worker.tick();assert.equal(calls,1);release({ok:false});await first;
  assert.equal(worker.status().lastResult.status,'incomplete');
  now+=60000;await worker.tick();assert.equal(calls,1);
  now+=15*60000;const second=worker.tick();await new Promise(setImmediate);release({ok:false});await second;assert.equal(calls,2);
  now+=15*60000;const third=worker.tick();await new Promise(setImmediate);if(calls===3){release({ok:false});await third;}else await third;
  // Let the other independently bounded source task take its turn.
  if(calls<3){now+=15*60000;const retry=worker.tick();await new Promise(setImmediate);release({ok:false});await retry;}
  now+=20*60000;await worker.tick();assert.equal(calls,3,'three failed source captures per code/day at most');
});
test('holidays and lunch never start collection and next day has its own close evidence',async()=>{
  const {s,worker}=fixture();s.session.openDay=false;await worker.tick();assert.equal(s.calls.length,0);
  s.session.openDay=true;s.session.trading=false;s.session.minute=720;await worker.tick();assert.equal(s.calls.length,0);
  s.session.minute=960;await worker.tick();assert.equal(s.calls.length,1);
  s.now+=86400000;s.session.day='20261126';await worker.tick();assert.equal(s.calls[1].day,'2026-11-26');
});
test('a prior frozen signal keeps its outcome collection after it leaves every current pool',async()=>{
  let now=Date.parse('2026-11-26T16:00:00+08:00'),reads=0;
  const calls=[];
  const worker=createDecisionCenterBackground({clock:()=>now,enabled:()=>true,isPrimary:()=>true,
    session:()=>({openDay:true,trading:false,minute:960,day:'20261126'}),candidates:()=>[],
    historyCandidates:async()=>{reads++;return {ok:true,codes:['600000'],coverage:{nextCursor:40}};},
    collectHistory:async value=>{calls.push(value);return {ok:true,result:{status:'admitted'}};},
    collectFinancials:async()=>{assert.fail('no current candidate financial collection');}});
  await worker.tick();assert.equal(calls.length,1);assert.equal(calls[0].code,'600000');
  assert.equal(calls[0].day,'2026-11-26');
  now+=60000;await worker.tick();assert.equal(reads,1);assert.equal(calls.length,1);
  now+=5*60000;await worker.tick();assert.equal(reads,2);assert.equal(calls.length,1,'already completed code is not recaptured');
});
test('pending history is paged and retains unresolved codes without confusing per-code retries',async()=>{
  let now=Date.parse('2026-11-26T16:00:00+08:00');const calls=[],cursors=[];
  const worker=createDecisionCenterBackground({clock:()=>now,enabled:()=>true,isPrimary:()=>true,
    session:()=>({openDay:true,trading:false,minute:960,day:'20261126'}),candidates:()=>['600009'],
    historyCandidates:async({cursor})=>{cursors.push(cursor);return {ok:true,codes:[cursor===0?'600000':'600001'],coverage:{nextCursor:cursor===0?40:0}};},
    collectHistory:async value=>{calls.push(value.code);return value.code==='600000'?{ok:false}:{ok:true,result:{status:'admitted'}};},
    collectFinancials:async()=>({ok:false})});
  await worker.tick();assert.deepEqual(calls,['600000'],'pending outcome has priority over current picks');
  now+=5*60000;await worker.tick();assert.deepEqual(cursors,[0,40]);assert.deepEqual(calls,['600000','600001']);
  now+=11*60000;await worker.tick();assert.equal(calls.at(-1),'600000','unresolved previous page is retained');
});
test('an archive lookup cannot overlap and a role change during the lookup cannot dispatch collectors',async()=>{
  let primary=true,release,reads=0,calls=0;
  const worker=createDecisionCenterBackground({clock:()=>Date.parse('2026-11-26T16:00:00+08:00'),enabled:()=>true,isPrimary:()=>primary,
    session:()=>({openDay:true,trading:false,minute:960,day:'20261126'}),candidates:()=>[],
    historyCandidates:()=>{reads++;return new Promise(resolve=>{release=resolve;});},
    collectHistory:async()=>{calls++;},collectFinancials:async()=>{calls++;}});
  const running=worker.tick();await worker.tick();assert.equal(reads,1);
  primary=false;release({ok:true,codes:['600000']});await running;
  assert.equal(calls,0);assert.equal(worker.status().running,false);
});
test('a partial financial capture remains incomplete and retries instead of entering the six-hour success cache',async()=>{
  let now=Date.parse('2026-11-25T10:00:00+08:00'),calls=0;
  const worker=createDecisionCenterBackground({clock:()=>now,enabled:()=>true,isPrimary:()=>true,
    session:()=>({openDay:true,trading:true,minute:600,day:'20261125'}),candidates:()=>['600000'],
    collectHistory:async()=>assert.fail('no intraday history'),collectFinancials:async()=>{
      calls++;const financials=financialEvidence('600000',now);
      if(calls===1)delete financials.datasets.period;
      return {ok:true,result:{marketContext:{financials}}};
    }});
  await worker.tick();assert.equal(worker.status().lastResult.status,'incomplete');
  now+=60000;await worker.tick();assert.equal(calls,1);
  now+=15*60000;await worker.tick();assert.equal(calls,2);assert.equal(worker.status().lastResult.status,'collected');
  now+=15*60000;await worker.tick();assert.equal(calls,2);
});
test('a new trading day clears retries but continues the bounded archive scan cursor',async()=>{
  let now=Date.parse('2026-11-25T16:00:00+08:00'),day='20261125';const cursors=[];
  const worker=createDecisionCenterBackground({clock:()=>now,enabled:()=>true,isPrimary:()=>true,
    session:()=>({openDay:true,trading:false,minute:960,day}),candidates:()=>[],
    historyCandidates:async({cursor})=>{cursors.push(cursor);return {ok:true,codes:[],coverage:{nextCursor:cursor+40}};},
    collectHistory:async()=>assert.fail('no pending code'),collectFinancials:async()=>assert.fail('no current candidate')});
  await worker.tick();now+=86400000;day='20261126';await worker.tick();
  assert.deepEqual(cursors,[0,40]);
});

test('actual background collection and incomplete receipts use one bounded parent trace without extra dispatch',async()=>{
 const {createRuntimeTrace}=require('../src/core/runtime-trace');
 let now=Date.parse('2026-11-25T16:00:00+08:00'),calls=0;
 const trace=createRuntimeTrace({clock:()=>now});
 const worker=createDecisionCenterBackground({trace,clock:()=>now,enabled:()=>true,isPrimary:()=>true,
  session:()=>({openDay:true,trading:false,minute:960,day:'20261125'}),candidates:()=>['600000'],
  collectHistory:async()=>{calls++;return {ok:false,privatePayload:'must not enter trace'};},
  collectFinancials:async()=>assert.fail('history must retain priority')});
 await worker.tick();await worker.tick();
 assert.equal(calls,1);
 const rows=trace.read().spans,root=rows.find(r=>r.stage==='task.decision-background'),stage=rows.find(r=>r.stage==='market.history');
 assert.ok(root&&stage);assert.equal(root.traceId,stage.traceId);assert.equal(stage.parentSpanId,root.spanId);
 assert.equal(stage.status,'unknown');assert.equal(root.status,'unknown');
 assert.equal(trace.read().active,0);
 // Match the symbol as a field value, not digits inside a valid timestamp/hash.
 assert.doesNotMatch(JSON.stringify(rows),/"600000"|must not enter trace|privatePayload/);
 for(const row of rows){assert.deepEqual(row.refs,{});assert.deepEqual(row.versions,{});}
});

test('late history lookup cannot dispatch or advance its cursor across the trading-day boundary',async()=>{
 let now=Date.parse('2026-11-25T16:00:00+08:00'),day='20261125',release;
 const calls=[],cursors=[];
 const worker=createDecisionCenterBackground({clock:()=>now,enabled:()=>true,isPrimary:()=>true,
  session:()=>({openDay:true,trading:false,minute:960,day}),candidates:()=>[],
  historyCandidates:({cursor})=>{cursors.push(cursor);return cursors.length===1?new Promise(r=>{release=r;}):
   Promise.resolve({ok:true,codes:['600001'],coverage:{nextCursor:40}});},
  collectHistory:async v=>{calls.push(v);return {ok:true,result:{status:'admitted'}};},
  collectFinancials:async()=>assert.fail('no current candidate')});
 const first=worker.tick();await new Promise(setImmediate);
 now+=86400000;day='20261126';release({ok:true,codes:['600000'],coverage:{nextCursor:999}});
 await first;assert.equal(calls.length,0);assert.equal(worker.status().lastAttempt,null);
 await worker.tick();assert.deepEqual(cursors,[0,0]);
 assert.equal(calls.length,1);assert.equal(calls[0].day,'2026-11-26');assert.equal(calls[0].code,'600001');
});
test('disabled collector while awaiting archive does not consume its real attempt budget',async()=>{
 let now=Date.parse('2026-11-26T16:00:00+08:00'),enabled=true,release,reads=0,calls=0;
 const worker=createDecisionCenterBackground({clock:()=>now,enabled:()=>enabled,isPrimary:()=>true,
  session:()=>({openDay:true,trading:false,minute:960,day:'20261126'}),candidates:()=>['600000'],
  historyCandidates:()=>++reads===1?new Promise(r=>{release=r;}):Promise.resolve([]),
  collectHistory:async()=>{calls++;return {ok:true,result:{status:'admitted'}};},
  collectFinancials:async()=>assert.fail('history must take priority')});
 const first=worker.tick();await new Promise(setImmediate);
 enabled=false;release([]);await first;assert.equal(calls,0);assert.equal(worker.status().lastAttempt,null);
 enabled=true;now+=60000;await worker.tick();assert.equal(calls,1);
});

test('F25 delayed collector receipt cannot report current success across day, role, permission, phase or clock change',async()=>{
 const {createRuntimeTrace}=require('../src/core/runtime-trace');
 for(const change of ['day','role','permission','phase','clock']){
  let now=Date.parse('2026-11-25T16:00:00+08:00'),day='20261125',primary=true,enabled=true,minute=960,release,calls=0;
  const trace=createRuntimeTrace({clock:()=>now});
  const worker=createDecisionCenterBackground({trace,clock:()=>now,enabled:()=>enabled,isPrimary:()=>primary,
   session:()=>({openDay:true,trading:minute<900,minute,day}),candidates:()=>['600000'],
   collectHistory:()=>{calls++;return new Promise(resolve=>release=resolve);},collectFinancials:async()=>assert.fail('unexpected collection')});
  const running=worker.tick();await new Promise(setImmediate);await worker.tick();assert.equal(calls,1);
  if(change==='day'){now+=86400000;day='20261126';}
  if(change==='role')primary=false;
  if(change==='permission')enabled=false;
  if(change==='phase')minute=915;
  if(change==='clock')now--;
  release({ok:true,result:{status:'admitted'}});await running;
  const state=worker.status();assert.equal(state.running,false);assert.equal(state.lastResult.status,'superseded');
  assert.equal(state.lastAttempt.day,'2026-11-25');assert.equal(state.lastSuccessAt,null);
  assert.equal(state.lastResult.completedAt,change==='clock'?null:now);
  const spans=trace.read().spans;assert.equal(spans.find(x=>x.stage==='market.history').status,'blocked');
  assert.equal(spans.find(x=>x.stage==='task.decision-background').status,'blocked');
 }
});
test('F25 superseded history does not enter success cache and next trading day remains independent',async()=>{
 let now=Date.parse('2026-11-25T16:00:00+08:00'),day='20261125',release,calls=[];
 const worker=createDecisionCenterBackground({clock:()=>now,enabled:()=>true,isPrimary:()=>true,
  session:()=>({openDay:true,trading:false,minute:960,day}),candidates:()=>['600000'],
  collectHistory:v=>{calls.push(v);return calls.length===1?new Promise(r=>release=r):Promise.resolve({ok:true,result:{status:'admitted'}});},
  collectFinancials:async()=>({ok:false})});
 const first=worker.tick();await new Promise(setImmediate);now+=86400000;day='20261126';
 release({ok:true,result:{status:'admitted'}});await first;
 assert.equal(worker.status().lastSuccessAt,null);await worker.tick();
 assert.deepEqual(calls.map(x=>x.day),['2026-11-25','2026-11-26']);
 assert.equal(worker.status().lastResult.status,'collected');assert.equal(worker.status().lastSuccessAt,now);
});
test('F25 a rejected late callback is historical, not a current failure or success',async()=>{
 let primary=true,reject;
 const worker=createDecisionCenterBackground({clock:()=>Date.parse('2026-11-25T16:00:00+08:00'),enabled:()=>true,isPrimary:()=>primary,
  session:()=>({openDay:true,trading:false,minute:960,day:'20261125'}),candidates:()=>['600000'],
  collectHistory:()=>new Promise((resolve,r)=>reject=r),collectFinancials:async()=>assert.fail('unexpected')});
 const p=worker.tick();await new Promise(setImmediate);primary=false;reject(Error('late supplier failure'));await p;
 assert.equal(worker.status().lastResult.status,'superseded');assert.equal(worker.status().lastSuccessAt,null);
});
