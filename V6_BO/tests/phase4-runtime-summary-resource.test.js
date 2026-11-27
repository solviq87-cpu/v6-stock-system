'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRuntimeTrace}=require('../src/core/runtime-trace');
const statuses=['completed','failed','blocked','unknown','skipped'];
const names=['task.tick','task.pool','market.snapshot','market.history','factor.evaluate','strategy.evaluate','candidate.publish','risk.entry',
 'paper.transaction','notification.queue','notification.attempt','research.stage','research.worker-dispatch','notification.dispatch'];
function populate(trace,count,clock){
 const expected=[];
 for(let i=0;i<count;i++){
  const stage=names[i%names.length],status=statuses[i%statuses.length],duration=i%11===0?null:i%23/4;
  clock.value=i*30;const h=trace.begin(stage);
  clock.value=duration===null?NaN:clock.value+duration;
  h.end(status);expected.push({stage,status,durationMs:duration});
 }
 return expected;
}
function reference(stage,rows){
 const times=rows.map(x=>x.durationMs).filter(Number.isFinite).sort((a,b)=>a-b);
 return {stage,status:rows.length?'observed':'not-observed',samples:rows.length,
  ...Object.fromEntries(statuses.map(status=>[status,rows.filter(x=>x.status===status).length])),
  timedSamples:times.length,p50Ms:times.length?times[Math.ceil(times.length*.5)-1]:null,
  p95Ms:times.length?times[Math.ceil(times.length*.95)-1]:null};
}
test('single-pass runtime statistics preserve exact counts, null durations and percentiles across a saturated ring',()=>{
 const clock={value:0},trace=createRuntimeTrace({capacity:1024,clock:()=>1000,monotonic:()=>clock.value});
 const expected=populate(trace,2048,clock).slice(-1024);
 const s=trace.summary();
 assert.equal(s.capacity,1024);assert.equal(s.observedSpanCount,1024);assert.equal(s.evicted,1024);assert.equal(s.active,0);
 for(const group of s.stages)assert.deepEqual(group,reference(group.stage,expected.filter(x=>x.stage.startsWith(group.stage+'.'))));
 for(const hook of s.hooks)assert.deepEqual(hook,reference(hook.stage,expected.filter(x=>x.stage===hook.stage)));
 assert.equal(s.canTrade,false);assert.equal(s.writesAccount,false);assert.deepEqual(s.spans,[]);
 assert.deepEqual(trace.summary(),s,'reading summary does not consume or reorder observations');
});
test('resource budget: summary does not repeatedly filter the full retained span ring',()=>{
 // Instrument only this disposable VM's array filtering, not the app or
 // test runner. Count full-ring predicate visits instead of flaky timings.
 const src=fs.readFileSync(path.resolve(__dirname,'../src/core/runtime-trace.js'),'utf8');
 const module={exports:{}},context=vm.createContext({module,exports:module.exports,require,visits:0});
 vm.runInContext('const originalFilter=Array.prototype.filter;Array.prototype.filter=function(fn,...rest){if(this.length===1024)visits+=this.length;return originalFilter.call(this,fn,...rest);};',context);
 vm.runInContext(src,context);
 const clock={value:0},trace=module.exports.createRuntimeTrace({capacity:1024,clock:()=>1000,monotonic:()=>clock.value});
 populate(trace,1024,clock);
 context.visits=0;const s=trace.summary();
 assert.equal(s.observedSpanCount,1024);assert.equal(context.visits,0,'avoid repeated full-ring filtering');
 assert.equal(trace.read({recent:128}).spans.length,128);
});
test('an active or dropped observation does not manufacture summary samples',()=>{
 const trace=createRuntimeTrace({maxActive:1,capacity:1,clock:()=>1000,monotonic:()=>5});
 const active=trace.begin('task.tick');trace.begin('market.history').end();
 let s=trace.summary();assert.equal(s.active,1);assert.equal(s.dropped,1);assert.equal(s.observedSpanCount,0);
 active.end('blocked','RISK_REJECTED');
 s=trace.summary();assert.equal(s.active,0);assert.equal(s.stages.find(r=>r.stage==='task').blocked,1);
 assert.equal(s.hooks.find(r=>r.stage==='market.history').samples,0);
});
