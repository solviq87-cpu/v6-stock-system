'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {researchLiveMarket}=require('../src/core/live-market-research');
const day='2026-11-05',now=Date.parse(day+'T10:00:00+08:00');
const scores={indexTrendScore:65,marketVolumeScore:60,riskScore:20,volatilityScore:30,sentimentScore:70};
const candidate={code:'000001',finalScore:70};
const snapshot={date:day,source:'fixture-market',universeSize:1,stocks:[{code:candidate.code,pctChange:2,vendorQuoteAt:now-1000}]};
const opts={now,scoreSource:'fixture-index',scoreDate:day,scores,candidates:[candidate]};
test('payload retrieval time cannot advance frozen replay or make a future quote recent',async()=>{
 const future=now+3600000;
 const r=await researchLiveMarket({...opts,fetchSnapshot:async()=>({...snapshot,retrievedAt:new Date(future).toISOString(),stocks:[{...snapshot.stocks[0],vendorQuoteAt:future-1000}]})});
 assert.equal(r.regime.usable,false);assert.equal(r.quoteTimeAudit.counts.future,1);
 assert.equal(r.candidateIntersection.items[0].quoteTimeStatus,'future');assert.equal(r.riskEvidence.items[0].evidenceReady,false);
 assert.equal(r.riskEvidence.canTrade,false);assert.equal(r.quoteTimeAudit.asOf,new Date(now).toISOString());
});
test('independent completion clock accepts legitimate nonzero acquisition duration',async()=>{
 const done=now+3000;let calls=0;
 const r=await researchLiveMarket({...opts,clock:()=>done,fetchSnapshot:async({clock})=>{
  calls++;assert.equal(clock(),done);return {...snapshot,startedAt:new Date(now).toISOString(),retrievedAt:new Date(done).toISOString(),samplingDurationMs:3000};
 }});
 assert.equal(calls,1);assert.equal(r.regime.usable,true);assert.equal(r.regime.timingEvidence.decisionAt,done);
 assert.equal(r.quoteTimeAudit.asOf,new Date(done).toISOString());assert.equal(r.riskEvidence.items[0].evidenceReady,true);assert.equal(r.riskEvidence.items[0].canTrade,false);
});
test('independent clock rollback or invalid completion fails closed',async()=>{
 for(const clock of [()=>now-1,()=>NaN,()=>String(now),()=>now/1000])
  await assert.rejects(researchLiveMarket({...opts,clock,fetchSnapshot:async()=>snapshot}),/时钟/);
});
test('late same-day scoring evidence cannot mark the candidate evidence ready',async()=>{
 const r=await researchLiveMarket({...opts,scores:{...scores,knownAt:now+1},fetchSnapshot:async()=>snapshot});
 assert.equal(r.regime.usable,false);assert.equal(r.quoteTimeAudit.recentSourceTimeCount,1);
 assert.equal(r.riskEvidence.items[0].evidenceReady,false);assert.equal(candidate.finalScore,70);
});
test('injected replay defaults to fixed clock rather than machine wall time',async()=>{
 const r=await researchLiveMarket({...opts,fetchSnapshot:async({clock})=>{
  assert.equal(clock(),now);return snapshot;
 }});
 assert.equal(r.regime.usable,true);assert.equal(r.regime.timingEvidence.status,'unknown');assert.equal(r.quoteTimeAudit.asOf,new Date(now).toISOString());
});
