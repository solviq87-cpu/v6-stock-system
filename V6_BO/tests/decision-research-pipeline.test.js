'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildDecisionResearch,runHistoricalValidation}=require('../src/core/decision-research-pipeline');
const snapshot={date:'2026-11-05',source:'fixture-unverified',universeSize:2,stocks:[{code:'000001',pctChange:1},{code:'000002',pctChange:-2}]};
test('end-to-end research preserves legacy order and scores; no trading',async()=>{
 const candidates=[{code:'000001',finalScore:60},{code:'000002',finalScore:95,isST:true}];
 const result=await buildDecisionResearch({fetchSnapshot:async()=>snapshot,now:Date.UTC(2026,10,5),candidates});
 assert.deepEqual(result.ranked.map(x=>x.originalScore),[60,95]);
 assert.equal(result.ranked[1].riskStatus,'blocked');
 assert.equal(result.canTrade,false);assert.equal(result.releaseGate.eligible,false);
 assert.equal(result.historical.status,'not-tested');
 assert.equal(result.systems.systems.python.available,false);
 assert.deepEqual(candidates.map(x=>x.finalScore),[60,95]);
});
test('no fabricated backtest success when provenance missing',()=>{
 assert.equal(runHistoricalValidation({stocks:[{}]}).status,'invalid');
 assert.equal(runHistoricalValidation().metrics,null);
});
test('invalid historical bars are reported, not silently passed',()=>{
 const r=runHistoricalValidation({source:'fixture',asOf:'2026-11-05',stocks:[{code:'000001',bars:[]}],splitDay:30});
 assert.notEqual(r.status,'research-only');
});
test('invalid candidate input rejected before fetching network',async()=>{
 let called=false;
 await assert.rejects(buildDecisionResearch({candidates:Array(51).fill({code:'000001'}),fetchSnapshot:async()=>{called=true;return snapshot;}}));
 assert.equal(called,false);
});
