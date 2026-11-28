'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {compareFrozenRankModels}=require('../src/core/factor-rank-baselines');
const {assessFactorRedundancy}=require('../src/core/factor-redundancy');
const dates=[];for(let t=Date.parse('2026-09-01T00:00:00Z');dates.length<40;t+=86400000)if(![0,6].includes(new Date(t).getUTCDay()))dates.push(new Date(t).toISOString().slice(0,10));
const at=(d,h='15:00:00')=>Date.parse(d+'T'+h+'+08:00');
function fixture(){
 const make=(start,n)=>dates.slice(start,start+n).flatMap((day,i)=>Array.from({length:6},(_,j)=>({id:day+'-'+j,market:'CN',code:String(600000+j),day,targetDay:dates[start+i+1],signalAt:at(day),labelKnownAt:at(dates[start+i+1])+1000,values:{A:j,B:[0,3,1,5,2,4][j],C:j},returnPct:j-2})));
 const phases={train:make(0,15),validation:make(17,5),test:make(24,5)};
 const raw=dates.slice(0,15).map(day=>({day,rows:phases.train.filter(r=>r.day===day).map(r=>({code:r.code,values:r.values}))}));
 const redundancy=assessFactorRedundancy(raw,['A','B','C'],{A:{reliable:true,meanIC:.5},B:{reliable:true,meanIC:.2},C:{reliable:true,meanIC:.4}});
 const input={phases,factorIds:['A','B','C'],markets:['CN'],trainingFingerprint:'a'.repeat(64),redundancy,trainCutoff:at(dates[17],'09:30:00'),validationCutoff:at(dates[24],'09:30:00'),asOf:at(dates[31]),minRows:5,minTrainDays:15};return {input,run:()=>compareFrozenRankModels(input)};
}
test('F10.2 same-pool equal and linear use frozen training-only direction and weights with explicit label/cost limits',()=>{
 const f=fixture(),before=JSON.stringify(f.input),r=f.run();assert.equal(r.status,'descriptive-fold-comparison');assert.equal(r.training.coverage.evaluatedDays,15);assert.equal(r.validation.coverage.evaluatedDays,5);assert.equal(r.test.coverage.evaluatedDays,5);assert.equal(r.topK,3);assert.ok(r.weights.linear.A>r.weights.linear.B);assert.equal(r.netReturnPct,null);assert.equal(r.tree.status,'not-run');assert.equal(r.executionCostsVerified,false);assert.equal(r.canApprove,false);assert.equal(r.productionWeightsChanged,false);assert.ok(r.work.scoreProducts>0);assert.equal(JSON.stringify(f.input),before);
 for(const row of f.input.phases.test)row.returnPct*=-1;const changed=f.run();assert.deepEqual(changed.weights,r.weights);assert.notDeepEqual(changed.test,r.test);assert.deepEqual(changed.training,r.training);
});
test('F10.3 original redundancy screen drops duplicate C; original marginal evaluator compares retained factors without changing weights',()=>{
 const f=fixture(),r=f.run();assert.deepEqual(r.retainedFactors,['A','B']);assert.deepEqual(r.suppressedFactors,['C']);assert.equal(r.weights.equal.C,undefined);assert.ok(r.marginalContribution.factors.length===2);assert.equal(r.marginalContribution.canTrade,false);assert.equal(r.marginalContribution.productionWeightsChanged,false);
 for(const row of Object.values(f.input.phases).flat())row.values.C=1e50;const changed=f.run();assert.deepEqual(changed.weights,r.weights);assert.deepEqual(changed.test,r.test);
});
test('F10.2 tied Top-K boundary is shared; constant scores do not create an artificial rank IC or profitable arbitrary pick',()=>{
 const f=fixture();for(const row of f.input.phases.test)row.values={A:0,B:0,C:0};const r=f.run();assert.equal(r.test.equal.meanRankIC,null);assert.equal(r.test.linear.meanRankIC,null);assert.ok(Math.abs(r.test.equal.meanTopKPriceLabelPct-.5)<1e-12);assert.ok(Math.abs(r.test.linear.meanTopKPriceLabelPct-.5)<1e-12);assert.equal(r.test.equal.tiedBoundaryCells,5);assert.equal(r.test.pairedTopKDeltaPct,0);
});
test('F10.2 missing feature blocks whole same-day comparison and preserves attempted denominator',()=>{
 const f=fixture();f.input.phases.test[0].values.A=null;const r=f.run();assert.equal(r.test.status,'insufficient-common-days');assert.equal(r.test.coverage.attemptedRows,30);assert.equal(r.test.coverage.excludedRows,6);assert.equal(r.test.coverage.evaluatedDays,4);assert.equal(r.test.linear,null);assert.equal(r.test.equal,null);assert.equal(r.test.pairedTopKDeltaPct,null);
});
test('future label, duplicate security, overlapping phase and invalid original redundancy cannot support comparisons',()=>{
 for(const mutate of [f=>f.input.phases.train[0].labelKnownAt=f.input.trainCutoff,f=>f.input.phases.train.push({...f.input.phases.train[0]}),f=>f.input.phases.test[0].signalAt=f.input.validationCutoff-1,f=>f.input.phases.train.at(-1).targetDay=dates[17],f=>f.input.redundancy.canTrade=true]){const f=fixture();mutate(f);const r=f.run();assert.equal(r.status,'unknown');assert.equal(r.weights,null);}
});
