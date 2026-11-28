'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRuntimeTrace}=require('../src/core/runtime-trace');
const {buildSystemReadiness}=require('../src/core/system-readiness');
const start=Date.parse('2026-11-25T10:00:00+08:00');
function fixture(capacity=32){
 let now=start,trace=createRuntimeTrace({capacity,clock:()=>now,monotonic:()=>now});
 return {trace,tick(stage,outcome,code){const span=trace.begin(stage);now+=10;span.end(outcome,code);},
  report(){return buildSystemReadiness({now,trace:trace.summary()}).runtimeTrace.diagnosticIssues;},get now(){return now;}};
}
test('H01 repeated unavailable-source observations retain exact timestamps and one group, not root cause',()=>{
 const f=fixture();f.tick('market.snapshot','failed','SOURCE_UNAVAILABLE');f.tick('market.snapshot','failed','SOURCE_UNAVAILABLE');
 f.tick('market.history','failed','SOURCE_UNAVAILABLE');const r=f.report();
 assert.equal(r.groups.length,2);const x=r.groups.find(g=>g.stage==='market.snapshot');
 assert.equal(x.observations,2);assert.equal(x.firstObservedAt,start+10);assert.equal(x.lastObservedAt,start+20);
 assert.equal(x.severity,'warning');assert.equal(x.rootCauseStatus,'unverified');
 assert.equal(r.rootCauseCertified,false);assert.equal(r.recoveryAuthorized,false);
});
test('H01 quote diagnosis separates stale original, missing, future, receipt, conflict and read-only evidence',()=>{
 const q=(code,patch={})=>({code,price:10,quoteSource:'tencent',quoteAt:start-15000,receivedAt:start,canTrade:true,...patch});
 const rows=[q('600001'),q('600002',{quoteAt:start-15001}),q('600003',{quoteAt:null}),
 q('600004',{quoteAt:start+1}),q('600005',{receivedAt:start+1}),q('600006',{sourceConflict:true}),
 q('600007',{readOnlyBackup:true}),q('600008',{quoteAt:start-20000,receivedAt:null}),
 q('600009'),q('600009',{price:null})];
 const a=buildSystemReadiness({now:start,session:{trading:true},quoteRows:rows}).components[0],d=a.diagnosticReasonCounts;
 assert.equal(a.coverage.recentOriginal,1);assert.equal(d['stale-original-time'],1);assert.equal(d['missing-original-time'],1);
 assert.equal(d['future-original-time'],1);assert.equal(d['invalid-reception-time'],1);assert.equal(d['conflicting-quote-evidence'],1);
 assert.equal(d['observation-only-source'],1);assert.equal(d['missing-received-time'],1);assert.equal(d['duplicate-security'],2);
 assert.equal(Object.values(d).reduce((a,b)=>a+b,0),9);assert.equal(a.tradePermissionCertified,false);
});
test('H01 queue pressure and intentional duplicate suppression are not actual duplicate execution or risk failure',()=>{
 const f=fixture();f.tick('notification.queue','blocked','QUEUE_FULL');f.tick('task.tick','skipped','ALREADY_RUNNING');
 f.tick('risk.entry','blocked','RISK_REJECTED');f.tick('task.tick','skipped','SESSION_CLOSED');
 const r=f.report();assert.equal(r.groups.length,2);
 assert.equal(r.groups.find(g=>g.reasonCode==='ALREADY_RUNNING').severity,'info');
 assert.equal(r.groups.find(g=>g.reasonCode==='QUEUE_FULL').severity,'warning');
 assert.equal(r.currentFaultCertified,false);assert.equal(r.canTrade,false);
});
test('H01 strategy failures and notification retry, failure and unknown delivery stay distinct',()=>{
 const f=fixture();f.tick('strategy.evaluate','failed','STAGE_FAILED');f.tick('notification.attempt','failed','DELIVERY_RETRY');
 f.tick('notification.attempt','unknown','DELIVERY_UNKNOWN');f.tick('notification.attempt','failed','DELIVERY_FAILED');
 f.tick('notification.attempt','completed',null);f.tick('factor.worker-execute','failed','private secret');
 const r=f.report();assert.equal(r.groups.length,5);assert.ok(r.groups.some(g=>g.reasonCode==='UNCLASSIFIED_FAILURE'));
 assert.equal(r.deliveryCertified,false);assert.equal(r.canNotify,false);
 assert.doesNotMatch(JSON.stringify(r),/private secret/);
});
test('H01 missing and rolled-back trace clocks remain unknown instead of being replaced by report time',()=>{
 let now=start;const tr=createRuntimeTrace({clock:()=>now,monotonic:()=>0});
 const s=tr.begin('market.snapshot');now-=100;s.end('failed','SOURCE_UNAVAILABLE');
 const r=buildSystemReadiness({now:start,trace:tr.summary()}).runtimeTrace.diagnosticIssues.groups[0];
 assert.equal(r.firstObservedAt,null);assert.equal(r.lastObservedAt,null);assert.equal(r.unknownTimeCount,1);
});
test('H01 invalid count, duplicate group, future time, unapproved code or stage cannot appear as valid diagnostics',()=>{
 const f=fixture();f.tick('market.snapshot','failed','SOURCE_UNAVAILABLE');
 const clean=f.trace.summary(),run=t=>buildSystemReadiness({now:f.now,trace:t}).runtimeTrace.diagnosticIssues;
 for(const patch of [{observations:2},{unknownTimeCount:2},{lastObservedAt:f.now+1},{reasonCode:'private-token'},{stage:'market.private'}]){
  const a=structuredClone(clean);Object.assign(a.diagnosticIssues.groups[0],patch);assert.equal(run(a).status,'invalid-evidence');
 }
 const duplicate=structuredClone(clean);duplicate.diagnosticIssues.groups.push(duplicate.diagnosticIssues.groups[0]);
 assert.equal(run(duplicate).status,'invalid-evidence');
 const wrong=structuredClone(clean);wrong.observedSpanCount=2;assert.equal(run(wrong).status,'invalid-evidence');
});
test('H01 ring eviction never turns absent issue evidence into a healthy runtime certificate',()=>{
 const f=fixture(1);assert.equal(f.report().status,'not-observed');f.tick('market.snapshot','failed','SOURCE_UNAVAILABLE');
 f.tick('market.snapshot','completed',null);const r=f.report();assert.equal(r.status,'no-classified-issues-in-retained-window');
 assert.equal(r.groups.length,0);assert.equal(r.currentFaultCertified,false);assert.equal(f.trace.summary().evicted,1);
});
test('H01 repeated diagnostics are read-only, preserve existing timings and do not invent old-version receipts',()=>{
 const f=fixture();f.tick('market.history','failed','STAGE_FAILED');f.tick('market.history','completed',null);
 const a=f.trace.summary();assert.deepEqual(f.report(),f.report());assert.deepEqual(f.trace.summary(),a);
 const h=a.hooks.find(x=>x.stage==='market.history');assert.equal(h.samples,2);assert.equal(h.timedSamples,2);assert.equal(h.p95Ms,10);
 const old=structuredClone(a);delete old.diagnosticIssues;
 assert.equal(buildSystemReadiness({now:f.now,trace:old}).runtimeTrace.diagnosticIssues.status,'not-observed');
});
