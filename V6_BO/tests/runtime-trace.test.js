'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRuntimeTrace}=require('../src/core/runtime-trace');
const hash='a'.repeat(64);
test('observations preserve return values, exceptions and hashed allowlisted metadata',()=>{
 let mono=0;const trace=createRuntimeTrace({clock:()=>1000,monotonic:()=>++mono});
 const result={privateValue:'not a trace payload'};
 assert.equal(trace.sync('task.tick',()=>{
  const parent=trace.capture();assert.ok(parent);assert.ok(Object.isFrozen(parent.links));
  return trace.sync('risk.entry',()=>result,{versions:{riskPolicy:'private policy text'},refs:{account:hash,rawAccount:'private secret'},body:result});
 }),result);
 const error=Object.assign(Error('private error'),{reasonCodes:['RISK_REJECTED','private token']});
 assert.throws(()=>trace.sync('risk.entry',()=>{throw error;}),e=>e===error);
 const data=trace.read(),[inner,outer,failed]=data.spans;
 assert.equal(inner.traceId,outer.traceId);assert.equal(inner.parentSpanId,outer.spanId);
 assert.equal(inner.refs.account,hash);assert.match(inner.versions.riskPolicy,/^[a-f0-9]{64}$/);
 assert.equal(failed.status,'blocked');assert.equal(failed.reasonCode,'RISK_REJECTED');
 assert.doesNotMatch(JSON.stringify(data),/private policy text|private secret|private token|private error|privateValue/);
 assert.equal(data.canTrade,false);assert.equal(data.writesAccount,false);
});
test('overlapping async roots and dropped stages stay isolated',async()=>{
 let mono=0;const trace=createRuntimeTrace({maxActive:2,clock:()=>1000,monotonic:()=>++mono});
 let releaseA,releaseB;const a=new Promise(resolve=>releaseA=resolve),b=new Promise(resolve=>releaseB=resolve);
 const one=trace.async('task.tick',async()=>{const root=trace.capture();await a;assert.equal(trace.capture(),root);
  await trace.async('market.snapshot',async()=>{trace.markCurrent('failed','STAGE_FAILED');});
  return root.traceId;});
 const two=trace.async('task.pool',async()=>{const root=trace.capture();await b;assert.equal(trace.capture(),root);return root.traceId;});
 releaseA();const idA=await one;releaseB();const idB=await two;assert.notEqual(idA,idB);
 const spans=trace.read();assert.equal(spans.dropped,1);assert.equal(spans.spans.length,2);
 assert.ok(spans.spans.every(s=>s.status==='completed'));
});
test('original per-operation stages survive ring saturation and actual exceptions',async()=>{
 let mono=0;const trace=createRuntimeTrace({capacity:1,maxActive:1,clock:()=>1000,monotonic:()=>++mono});
 await trace.async('task.pool',async()=>{
  const local=trace.createStageTrace();
  assert.equal(local.syncStage('原读取',()=>42),42);
  const original=Error('private');
  await assert.rejects(local.asyncStage('原失败',async()=>{throw original;}),e=>e===original);
  assert.deepEqual(local.stages.map(s=>[s.stage,s.status]),[['原读取','completed'],['原失败','failed']]);
  assert.ok(local.stages.every(s=>!Object.hasOwn(s,'traceId')&&Number.isFinite(s.durationMs)));
  assert.equal(local.stages[1].errorCode,'STAGE_FAILED');
 });
 assert.equal(trace.read().active,0);assert.equal(trace.read().dropped,2);
 const normal=trace.createStageTrace();normal.syncStage('原研究',()=>null);
 assert.match(normal.stages[0].traceId,/^[a-f0-9]{32}$/);
 assert.equal(trace.read().spans.length,1);assert.equal(trace.read().evicted,1);
});
test('allowlisted skips and queue links reflect executed spans only; forged contexts are ignored',()=>{
 const trace=createRuntimeTrace({capacity:8,clock:()=>1000});let origin;
 trace.sync('task.tick',span=>{origin=trace.capture();span.mark('skipped','ALREADY_RUNNING');});
 assert.equal(trace.read().spans[0].reasonCode,'ALREADY_RUNNING');
 trace.resume({...origin},()=>assert.equal(trace.capture(),null));
 trace.withLinks([origin,origin,{...origin}],()=>trace.sync('notification.queue',()=>{}));
 const linked=trace.read().spans.at(-1);assert.deepEqual(linked.links,[{traceId:origin.traceId,spanId:origin.spanId}]);
 assert.equal(trace.summary().stages.find(s=>s.stage==='market').status,'not-observed');
 assert.equal(trace.inWorker({version:1,traceId:origin.traceId,spanId:origin.spanId,versions:{}},()=>trace.capture()),null);
});
test('invalid diagnostic clocks never change results or invent durations',()=>{
 const trace=createRuntimeTrace({clock:()=>{throw Error('private clock');},monotonic:()=>NaN});
 assert.equal(trace.sync('market.snapshot',()=>7),7);
 const row=trace.read().spans[0];assert.equal(row.startedAt,null);assert.equal(row.finishedAt,null);assert.equal(row.durationMs,null);
 const trace2=createRuntimeTrace({clock:()=>1000,monotonic:()=>NaN});
 const batch=trace2.batch('factor.evaluate');assert.equal(batch.run(()=>1),1);assert.equal(batch.run(()=>2),2);
 batch.end();assert.equal(trace2.read().spans[0].durationMs,null);assert.equal(trace2.read().spans[0].calls,2);
});

// The original transport owns delivery; observations must not leak message content
// or confuse queue admission, transport callback and actual receiver confirmation.
function tracedQueue(send,options={}){
 const {createQueue}=require('../feishuq');
 let now=1000,nextId=0;const timers=new Map();
 const later=(ms,run)=>{const id=++nextId;timers.set(id,{at:now+ms,run});return id;};
 const trace=options.trace||createRuntimeTrace({clock:()=>now,monotonic:()=>now});
 const q=createQueue(send,{minGap:5,guardMs:50,now:()=>now,sleep:later,setTimer:(run,ms)=>later(ms,run),clearTimer:id=>timers.delete(id),...options,trace});
 const step=()=>{const item=[...timers].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!item)return false;
  timers.delete(item[0]);now=item[1].at;item[1].run();return true;};
 return {trace,q,step,run:()=>{for(let i=0;timers.size;i++){assert.ok(i<100);step();}}};
}
test('48 original queued notifications preserve separate roots through wait, retry, and reentrant callbacks',()=>{
 const sent=[],callbacks=[],counts=new Map();let h;
 h=tracedQueue((message,cb)=>{sent.push(message);const count=(counts.get(message)||0)+1;counts.set(message,count);
  if(message==='private-A'&&count===1)cb(false,'HTTP 429');else cb(true,'gateway accepted');});
 const {trace,q}=h;
 trace.sync('task.tick',()=>q.send('private-A',ok=>{callbacks.push(ok);q.send('private-C');}));
 trace.sync('task.pool',()=>q.send('private-B'));
 h.run();assert.deepEqual(sent,['private-A','private-A','private-B','private-C']);assert.deepEqual(callbacks,[true]);
 const rows=trace.read().spans,tick=rows.find(r=>r.stage==='task.tick'),pool=rows.find(r=>r.stage==='task.pool');
 const queue=rows.filter(r=>r.stage==='notification.queue'),attempt=rows.filter(r=>r.stage==='notification.attempt');
 assert.equal(queue.length,3);assert.equal(attempt.length,4);
 const a=queue.find(r=>r.parentSpanId===tick.spanId),b=queue.find(r=>r.parentSpanId===pool.spanId),c=queue.find(r=>r.parentSpanId===a.spanId);
 assert.ok(a&&b&&c);assert.equal(a.traceId,c.traceId);assert.notEqual(a.traceId,b.traceId);
 assert.deepEqual(attempt.filter(r=>r.parentSpanId===a.spanId).map(r=>[r.status,r.reasonCode]),[['failed','DELIVERY_RETRY'],['completed',null]]);
 assert.ok(attempt.every(r=>queue.some(q=>q.spanId===r.parentSpanId&&q.traceId===r.traceId)));
 assert.ok(b.durationMs>=1500);assert.equal(trace.read().active,0);
 assert.equal(rows.some(r=>r.stage==='notification.delivery'),false);
 assert.doesNotMatch(JSON.stringify(rows),/private-[ABC]|gateway accepted|HTTP 429/);
});
test('48 queue eviction and rejection are not attempts, and guard/late callbacks stay unknown',()=>{
 const callbacks=[],sent=[];let late;
 const h=tracedQueue((message,cb)=>{sent.push(message);if(message==='private-timeout')late=cb;else cb(true,'ok');},{maxQ:1});
 h.q.send('private-timeout',ok=>callbacks.push(ok));
 h.q.send('private-evicted');h.q.send('private-priority',null,{priority:true});h.q.send('private-rejected');
 h.run();late(true,'late callback');
 assert.deepEqual(sent,['private-timeout','private-priority']);assert.deepEqual(callbacks,[false]);
 const rows=h.trace.read().spans,queue=rows.filter(r=>r.stage==='notification.queue'),attempt=rows.filter(r=>r.stage==='notification.attempt');
 const blocked=queue.filter(r=>r.reasonCode==='QUEUE_FULL');assert.equal(queue.length,4);assert.equal(blocked.length,2);
 assert.ok(blocked.every(r=>r.status==='blocked'&&!attempt.some(a=>a.parentSpanId===r.spanId)));
 assert.deepEqual(attempt.map(r=>[r.status,r.reasonCode]),[['unknown','DELIVERY_UNKNOWN'],['completed',null]]);
 assert.equal(h.trace.read().active,0);assert.equal(h.q.running,false);assert.equal(h.q.stats().retried,0);
 assert.doesNotMatch(JSON.stringify(rows),/private-|late callback/);
});
test('48 pre-dispatch denial and thrown transport retain original callbacks without false delivery or retry',()=>{
 const sent=[],done=[];const h=tracedQueue((message,cb)=>{sent.push(message);if(message==='private-throw')throw Error('sensitive HTTP 429');cb(false,'business rejected');});
 h.q.send('private-denied',(ok,info)=>done.push([ok,info]),{beforeSend:()=>({ok:false,why:'private reason HTTP 429'})});
 h.q.send('private-throw',(ok,info)=>done.push([ok,info]));h.q.send('private-reject',ok=>done.push([ok]));
 h.run();assert.deepEqual(sent,['private-throw','private-reject']);assert.equal(done.length,3);assert.equal(h.q.stats().retried,0);
 const rows=h.trace.read().spans,attempt=rows.filter(r=>r.stage==='notification.attempt');
 assert.deepEqual(attempt.map(r=>[r.status,r.reasonCode]),[['blocked','NOTIFICATION_BLOCKED'],['unknown','DELIVERY_UNKNOWN'],['failed','DELIVERY_FAILED']]);
 assert.equal(h.trace.read().active,0);assert.equal(rows.some(r=>r.stage==='notification.delivery'),false);
 assert.doesNotMatch(JSON.stringify(rows),/private-|private reason|sensitive HTTP|business rejected/);
});
test('48 saturated diagnostic budget never changes queue behavior or leaves active spans',()=>{
 const trace=createRuntimeTrace({maxActive:1,capacity:2}),sent=[];
 const h=tracedQueue((message,cb)=>{sent.push(message);cb(true,'ok');},{trace});
 trace.sync('task.tick',()=>{h.q.send('a');h.q.send('b');});h.run();
 assert.deepEqual(sent,['a','b']);assert.equal(h.q.running,false);assert.equal(trace.read().active,0);assert.ok(trace.read().dropped>=2);
});

// H05.9: distinguish elapsed observations from sums of synchronous calls.
test('H05 separate local span duration from batch total without changing legacy counters',()=>{
 let now=0;const t=createRuntimeTrace({monotonic:()=>now,clock:()=>1000});
 t.sync('factor.evaluate',()=>{now+=2;});const b=t.batch('factor.evaluate');
 b.run(()=>{now+=4;});b.run(()=>{now+=6;});b.end();
 const s=t.summary(),v=s.timingBreakdown.find(x=>x.stage==='factor.evaluate');
 assert.deepEqual(v.elapsedSpan,{samples:1,timedSamples:1,p50Ms:2,p95Ms:2});
 assert.deepEqual(v.sumOfActualCalls,{samples:1,timedSamples:1,p50Ms:10,p95Ms:10});
 assert.equal(s.hooks.find(x=>x.stage==='factor.evaluate').p95Ms,10);
 assert.deepEqual(t.summary(),s);
});
test('H05 unknown batch timing stays unknown instead of becoming zero',()=>{
 let now=0;const t=createRuntimeTrace({monotonic:()=>now,clock:()=>1000});const b=t.batch('factor.evaluate');
 b.run(()=>{now=NaN;});b.end();
 assert.deepEqual(t.summary().timingBreakdown.find(x=>x.stage==='factor.evaluate').sumOfActualCalls,
 {samples:1,timedSamples:0,p50Ms:null,p95Ms:null});
});
function h05Receipt(t,child={}){
 const p=t.capture(),root={traceId:p.traceId,spanId:'a'.repeat(32),parentSpanId:p.spanId,stage:'factor.worker-execute',status:'completed',reasonCode:null,startedAt:1000,finishedAt:1001,durationMs:1};
 return {p,root,leaf:{...root,spanId:'b'.repeat(32),parentSpanId:root.spanId,stage:'factor.evaluate',durationMs:.5,...child}};
}
test('H05 worker receipt retains validated batch timing metadata',()=>{
 const t=createRuntimeTrace({clock:()=>1000});t.sync('factor.worker-dispatch',()=>{
  const {p,root,leaf}=h05Receipt(t,{calls:3,timing:'sum-of-actual-calls'});
  assert.equal(t.importWorkerReceipt(p,{version:1,spans:[root,leaf]},root.stage),true);
 });const row=t.read().spans.find(x=>x.stage==='factor.evaluate');
 assert.equal(row.calls,3);assert.equal(row.timing,'sum-of-actual-calls');
 assert.equal(t.summary().timingBreakdown.find(x=>x.stage==='factor.evaluate').sumOfActualCalls.timedSamples,1);
});
test('H05 malformed batch timing cannot poison the original dispatch receipt',()=>{
 for(const bad of [{calls:0,timing:'sum-of-actual-calls'},{calls:2},{calls:2,timing:'bogus'},{calls:1.5,timing:'sum-of-actual-calls'}]){
  const t=createRuntimeTrace({clock:()=>1000});t.sync('factor.worker-dispatch',()=>{
   const {p,root,leaf}=h05Receipt(t,bad);
   assert.equal(t.importWorkerReceipt(p,{version:1,spans:[root,leaf]},root.stage),false);
   assert.equal(t.importWorkerReceipt(p,{version:1,spans:[root]},root.stage),true);
  });
 }
});
test('H05 legacy elapsed worker receipts keep their original durations',()=>{
 const t=createRuntimeTrace({clock:()=>1000});t.sync('factor.worker-dispatch',()=>{
  const {p,root}=h05Receipt(t);assert.equal(t.importWorkerReceipt(p,{version:1,spans:[root]},root.stage),true);
 });assert.equal(t.read().spans.find(x=>x.stage==='factor.worker-execute').durationMs,1);
});
