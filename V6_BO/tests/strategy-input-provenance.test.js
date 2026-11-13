'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {auditStrategyInputProvenance}=require('../src/strategy/strategy-input-provenance');
test('genuine zero is observed, while missing and empty values are not',()=>{
 const result=auditStrategyInputProvenance({riskScore:0,trendScore:null,relativeStrength:'',capitalScore:false});
 assert.equal(result.fields.riskScore.status,'raw_observed');
 for(const field of ['trendScore','relativeStrengthScore','capitalScore'])assert.equal(result.fields[field].status,'default_or_derived');
});
test('aliases preserve the actual original field name',()=>{
 const result=auditStrategyInputProvenance({'趋势评分':80,'相对强度':60});
 assert.equal(result.fields.trendScore.sourceField,'趋势评分');
 assert.equal(result.fields.relativeStrengthScore.sourceField,'相对强度');
});
test('no original input is never reported as observed',()=>{
 const result=auditStrategyInputProvenance({});
 assert.equal(result.rawObserved,0);
 assert.equal(result.missingDirectEvidence.length,result.total);
});

test('coercible containers and non-finite values cannot supply observed scores',()=>{
 for(const value of [[],[1],{}, {valueOf:()=>80},false,' ',NaN,Infinity])
  assert.equal(auditStrategyInputProvenance({trendScore:value}).rawObserved,0);
 assert.equal(auditStrategyInputProvenance({trendScore:'0'}).rawObserved,1);
 assert.equal(auditStrategyInputProvenance(Object.create({trendScore:80})).rawObserved,0);
});
