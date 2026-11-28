'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {compareShadowVersions}=require('../src/core/factor-model-comparison');
const {freezeHealthBaseline,evaluateFactorHealth}=require('../src/core/factor-health');
test('F46 original health report retains baseline fingerprint and separates matched scores',()=>{
 const at=Date.parse('2026-01-05T08:00:00Z'),feed={source:'fixture',provider:'synthetic-test',datasetId:'fixture'};
 const row=(symbol,v,t)=>({symbol,sectorHeatScore:v,factorEvidence:{sectorHeatScore:{source:feed.provider,timestamp:t}}});
 const base={schemaVersion:1,feed,factorIds:['sector_heat'],policy:{maxAgeMs:10000,minValidSamples:1,minValidFraction:.5,maxMeanShift:10},baseline:{schemaVersion:1,feed,asOf:at,rows:[row('600000',40,at),row('600001',100,at)]}};
 const frozen=freezeHealthBaseline(base,{now:at+1}),result=evaluateFactorHealth(frozen,{schemaVersion:1,feed,asOf:at+2,rows:[row('600000',50,at+2),row('600002',0,at+2)]},{now:at+3});
 assert.equal(result.baselineFingerprint,frozen.fingerprint);assert.equal(result.factors[0].meanShift,-45);assert.equal(result.factors[0].matchedInputDrift.pairedMeanShift,10);assert.equal(result.weightsChanged,false);
});
test('F46/47 original comparison consumes diagnostics and leaves frozen gate unchanged',()=>{const dates=Array.from({length:5},(_,i)=>({day:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),regime:i===0?'systemic-selloff':'unknown'}));const r=compareShadowVersions(dates,['a','b'],{a:1,b:1},{a:2,b:1},{a:3,b:1},(_,__,w)=>({days:1,meanIC:w.a*.1}));assert.equal(r.originalGatePassed,true);assert.equal(r.evidenceBreakdown.environment[0].signalDays,1);assert.equal(r.evidenceBreakdown.ranking.pairedDays,0);assert.equal(r.productionWeightsChanged,false);});
