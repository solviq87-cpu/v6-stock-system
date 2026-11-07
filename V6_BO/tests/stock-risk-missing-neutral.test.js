'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeStock}=require('../src/strategy/snapshot-normalizer');
const {evaluateCandidate}=require('../src/strategy/strategy-service');

const strong={code:'600000',trendScore:90,relativeStrengthScore:90,maAlignmentScore:90,momentumScore:90,closeStrengthScore:90,turnoverQualityScore:90,breakoutScore:90,volumeScore:90,positionScore:90,fundFlowScore:90,liquidityScore:90};

test('missing or unusable risk observations are neutral, never observed zero risk',()=>{
  for(const value of [undefined,null,'','  ','N/A',NaN,false]){
    const stock = value === undefined ? {} : {riskScore:value};
    assert.equal(normalizeStock(stock).riskScore,50,String(value));
  }
});

test('genuine zero and other observed risks are preserved',()=>{
  for(const value of [0,25,90,'0','25']){
    assert.equal(normalizeStock({riskScore:value}).riskScore,Number(value));
  }
  assert.equal(normalizeStock({'风险评分':25}).riskScore,25);
});

test('missing risk cannot earn the explicit low-risk factor bonus',()=>{
  const missing=evaluateCandidate({stock:strong});
  const observedZero=evaluateCandidate({stock:{...strong,riskScore:0}});
  assert.equal(missing.snapshot.riskScore,50);
  assert.equal(missing.strategies.find(s=>s.name==='quality').hits.some(x=>x.id==='risk'),false);
  assert.equal(observedZero.strategies.find(s=>s.name==='quality').hits.some(x=>x.id==='risk'),true);
  assert.ok(missing.finalScore < observedZero.finalScore);
  assert.equal(missing.pass,true);
  assert.equal(observedZero.pass,true);
});
