'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {rollingPaperDiagnosis}=require('../src/core/strategy-health-monitor');
const {settledPnlAttribution}=require('../src/core/intelligence-execution-validation');
// Synthetic unit fixtures, not effectiveness evidence or independent market sessions.
const dates=Array.from({length:64},(_,i)=>new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10));
const rows=dates.flatMap((signalDate,i)=>['a','b'].map(symbol=>({signalDate,symbol,verdict:'pass',outcome:{status:'paper-estimate',exitDate:dates[i+2],netReturnPct:i<40?2:-2}})));
const input={sessionDates:dates,splitDate:dates[0],universeCount:2,marketQuality:{reviewReady:true}};
test('common windows purge label overlap and warn only on descriptive paper deterioration',()=>{
 const r=rollingPaperDiagnosis(rows,input);
 assert.equal(r.status,'paper-deterioration-review');
 assert.equal(r.verifiedDecay,false);assert.equal(r.canTrade,false);
 assert.ok(dates.indexOf(r.recent.startDate)-dates.indexOf(r.previous.endDate)>2);
 assert.equal(r.causalEvidence.observedCost,null);
});
test('poor input quality and inadequate coverage cannot identify decay',()=>{
 assert.equal(rollingPaperDiagnosis(rows,{...input,marketQuality:{reviewReady:false}}).reason,'data-quality-unverified');
 assert.equal(rollingPaperDiagnosis(rows.filter(r=>r.symbol==='a'),input).status,'unknown');
 assert.equal(rollingPaperDiagnosis([],input).status,'unknown');
});
test('actual settled cost and estimated pressure do not become portfolio attribution',()=>{
 const r=settledPnlAttribution([{exitGrossCents:110000,entryGrossCents:100000,costCents:200,netCents:9800}],{slippageBps:20,feeMultiplier:2});
 assert.equal(r.actual.grossPricePnlCny,100);assert.equal(r.actual.recordedCostsCny,2);
 assert.equal(r.actual.netPnlCny,98);assert.equal(r.actual.reconciliationResidualCny,0);
 assert.equal(r.estimatedStress.netPnlCny,91.8);assert.equal(r.portfolioEquity,null);
 assert.equal(r.unattributed.marketCny,null);assert.equal(settledPnlAttribution([]).actual.netPnlCny,null);
});
