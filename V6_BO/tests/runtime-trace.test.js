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
