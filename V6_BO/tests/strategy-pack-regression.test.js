'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {evaluateMultiStrategy}=require('../src/core/multi-strategy-engine');

const pack=JSON.parse(fs.readFileSync(path.join(__dirname,'../strategies/a-share-strategy-pack.json'),'utf8'));
const snapshot={
  trendScore:75,relativeStrengthScore:70,maAlignmentScore:70,
  momentumScore:65,closeStrengthScore:65,turnoverQualityScore:60,
  breakoutScore:68,volumeScore:62,positionScore:65,
  fundFlowScore:70,liquidityScore:70,riskScore:25,
  oversoldScore:20,reversalScore:20
};
const market={
  breadthScore:68,indexTrendScore:72,marketVolumeScore:65,
  riskScore:30,volatilityScore:42,sentimentScore:70
};

// Freeze the verified normal scenario, so malformed-input safety fixes cannot
// silently alter existing A-share strategy ranking or aggregate score.
test('normal A-share strategy-pack scoring matches the review baseline',()=>{
  const result=evaluateMultiStrategy({snapshot,market,strategies:pack.strategies});
  assert.equal(result.pass,true);
  assert.equal(result.regime.regime,'trend');
  assert.equal(result.finalScore,80.08);
  assert.deepEqual(result.topDrivers.map(driver=>driver.strategy),['trend','momentum','breakout']);
});

test('missing inputs cannot award an unearned score to a rule',()=>{
  const partial={...snapshot};
  delete partial.trendScore;
  const result=evaluateMultiStrategy({snapshot:partial,market,strategies:pack.strategies});
  const trend=result.strategies.find(item=>item.name==='trend');
  assert.equal(trend.hits.some(hit=>hit.id==='short_trend'),false);
  assert.equal(trend.score,45);
  assert.equal(trend.pass,false);
});
