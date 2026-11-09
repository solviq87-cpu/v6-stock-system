'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assessFactorReliability,pairedStability}=require('../src/core/factor-learning-reliability');
const rows=(ics,regime='unknown')=>ics.map((ic,i)=>({day:'d'+i,regime,ic}));
test('persistent directional information is eligible for bounded, confidence-adjusted shadow learning',()=>{
 const r=assessFactorReliability(rows(Array(30).fill(.36)));
 assert.equal(r.reliable,true);
 assert.equal(r.days,30);
 assert.equal(r.directionConsistencyPct,100);
 assert.equal(r.suggestedWeightMultiplier>0,true);
 assert.equal(r.suggestedWeightMultiplier<=.08,true);
 assert.equal(r.productionWeightsChanged,false);
 const reverse=assessFactorReliability(rows(Array(30).fill(-.31)));
 assert.equal(reverse.reliable,true);
 assert.ok(reverse.suggestedWeightMultiplier<0);
});
test('a short positive spike followed by decay cannot increase a factor',()=>{
 const d=[...Array(8).fill(.99),...Array(22).fill(-.12)];
 const r=assessFactorReliability(rows(d));
 assert.equal(r.reliable,false);
 assert.equal(r.suggestedWeightMultiplier,0);
 assert.ok(r.reasons.includes('recent-factor-decay-or-sign-reversal'));
});
test('few days and random daily sign patterns cannot be mistaken for persistent information',()=>{
 const short=assessFactorReliability(rows(Array(9).fill(.8)));
 assert.equal(short.reliable,false);
 assert.ok(short.reasons.includes('insufficient-independent-days'));
 const noisy=assessFactorReliability(rows(Array.from({length:30},(_,i)=>i%2?.65:-.5)));
 assert.equal(noisy.suggestedWeightMultiplier,0);
 assert.ok(noisy.reasons.includes('unstable-daily-sign'));
});
test('opposing bull/weak-market regimes block a misleading overall positive IC',()=>{
 const mixed=Array.from({length:32},(_,i)=>({
  day:'d'+i,ic:i%2===0?.5:-.2,
  regime:i%2===0?'not-systemic-selloff':'systemic-selloff'
 }));
 const r=assessFactorReliability(mixed);
 assert.equal(r.opposingRegimeEffects,true);
 assert.ok(r.reasons.includes('opposing-market-regime-effects'));
 assert.equal(r.suggestedWeightMultiplier,0);
 assert.equal(r.assessedRegimes['systemic-selloff'].days,16);
});
test('regime comparison never treats unknown market labels as proven context',()=>{
 const d=rows(Array(30).fill(.4));
 const r=assessFactorReliability(d);
 assert.equal(r.reliable,true);
 assert.equal(r.regimeCoverageDays,0);
 assert.equal(r.assessedRegimes['not-systemic-selloff'].days,0);
});
test('unstable improvement across validation halves blocks promotion',()=>{
 const baseline={x:1},candidate={x:2};
 const days=Array.from({length:10},(_,i)=>({day:'d'+i,improvement:i<5?.1:-.08}));
 const ic=(window,_,weights)=>({
  days:1,meanIC:weights.x===1?0:window[0].improvement
 });
 const result=pairedStability(days,['x'],baseline,candidate,ic);
 assert.equal(result.comparableDays,10);
 assert.equal(result.halfPeriodsConsistent,false);
 assert.ok(result.earlyDeltaIC>0);
 assert.ok(result.recentDeltaIC<0);
});
test('single extreme point and invalid IC values are rejected or conservatively gated',()=>{
 assert.throws(()=>assessFactorReliability([{ic:2}]),/范围/);
 assert.throws(()=>assessFactorReliability([{ic:NaN}]),/范围/);
 const oneHit=assessFactorReliability(rows([...Array(29).fill(0),1]));
 assert.equal(oneHit.reliable,false);
 assert.equal(oneHit.suggestedWeightMultiplier,0);
});
