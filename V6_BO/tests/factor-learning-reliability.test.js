'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assessFactorReliability,pairedStability,assessShadowDecay}=require('../src/core/factor-learning-reliability');
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

// Rolling 5-session outcomes can overlap in time even when each daily IC is
// valid. Strong earlier weeks must not hide a recent block reversal.
test('late five-session block reversal pauses automatic research reweighting despite positive overall and recent-half IC',()=>{
 const ic=[...Array(20).fill(.4),...Array(10).fill(-.1)];
 const r=assessFactorReliability(rows(ic));
 assert.ok(r.meanIC>.03);
 assert.ok(r.recentMeanIC>.05);
 assert.ok(r.directionConsistencyPct>=60);
 assert.equal(r.completeBlockCount,6);
 assert.equal(r.blockDirectionConsistencyPct,66.67);
 assert.equal(r.latestBlockMeanIC,-.1);
 assert.equal(r.reliable,false);
 assert.equal(r.suggestedWeightMultiplier,0);
 assert.ok(r.reasons.includes('unstable-five-session-block-direction'));
 assert.ok(r.reasons.includes('latest-five-session-block-reversal'));
 assert.equal(r.productionWeightsChanged,false);
});
test('one extraordinary day cannot create a reliable learned factor when remaining days are weak',()=>{
 const ic=[...Array(17).fill(.025),...Array(12).fill(-.002),1];
 const r=assessFactorReliability(rows(ic));
 assert.ok(r.meanIC>.03);
 assert.ok(r.recentMeanIC>.05);
 assert.ok(r.directionConsistencyPct>=60);
 assert.ok(r.outlierRemovedMeanIC<.02);
 assert.ok(r.reasons.includes('single-day-influence-dominates'));
 assert.equal(r.reliable,false);
 assert.equal(r.confidence,0);
 assert.equal(r.suggestedWeightMultiplier,0);
});
test('steady positive and negative learning have full horizon-block evidence and nonzero bounded shadow-only adjustment',()=>{
 for(const ic of [.32,-.32]){
  const r=assessFactorReliability(rows(Array(30).fill(ic)));
  assert.equal(r.completeBlockCount,6);
  assert.equal(r.blockDirectionConsistencyPct,100);
  assert.equal(r.latestBlockMeanIC,ic);
  assert.equal(r.outlierRemovedMeanIC,ic);
  assert.equal(r.reliable,true);
  assert.equal(Math.sign(r.suggestedWeightMultiplier),Math.sign(ic));
  assert.equal(r.canTrade,false);
  assert.equal(r.productionWeightsChanged,false);
 }
});
test('incomplete last block cannot inflate the complete five-session confirmation count',()=>{
 const r=assessFactorReliability(rows([...Array(15).fill(.3),.9,.9]));
 assert.equal(r.days,17);
 assert.equal(r.completeBlockCount,3);
 assert.equal(r.latestBlockMeanIC,.3);
 assert.ok(r.blockDirectionConsistencyPct<=100);
 assert.equal(r.productionWeightsChanged,false);
});
// Prospective shadow-decay tests. Controlled IC values are synthetic and
// deliberately not used as evidence of actual market performance.
test('accepted shadow underperforms immutable base on fresh days: pause and request research rollback review only',()=>{
 const days=Array.from({length:10},(_,i)=>({day:'new-'+i,base:.16,shadow:-.23}));
 const score=(sample,_ids,weight)=>({days:1,
  meanIC:weight.x===1?sample[0].base:sample[0].shadow});
 const report=assessShadowDecay(days,['x','y'],{x:1,y:1},{x:2,y:1},score);
 assert.equal(report.status,'decay-alert-unverified');
 assert.equal(report.assessedDays,10);
 assert.equal(report.negativeDeltaPct,100);
 assert.equal(report.alert,true);
 assert.equal(report.rollbackReviewSuggested,true);
 assert.equal(report.canTrade,false);
 assert.equal(report.productionWeightsChanged,false);
});
test('two losing variants alone cannot manufacture relative shadow decay, and four days cannot certify it',()=>{
 const score=(sample,_ids,weights)=>({days:1,
  meanIC:weights.x===1?sample[0].base:sample[0].shadow});
 const days=Array.from({length:10},(_,i)=>({day:'new-'+i,base:-.4,shadow:-.39}));
 const stable=assessShadowDecay(days,['x','y'],{x:1},{x:2},score);
 assert.equal(stable.alert,false);
 assert.equal(stable.status,'no-decay-detected');
 const short=assessShadowDecay(days.slice(0,4).map(x=>({...x,base:.2,shadow:-.5})),
  ['x','y'],{x:1},{x:2},score);
 assert.equal(short.status,'insufficient-fresh-evidence');
 assert.equal(short.alert,false);
});
test('decay uses newest ten matured samples rather than dilution from older historical success',()=>{
 const score=(sample,_ids,weights)=>({days:1,
  meanIC:weights.x===1?sample[0].base:sample[0].shadow});
 const days=[
  ...Array.from({length:15},(_,i)=>({day:'old-'+i,base:0,shadow:.5})),
  ...Array.from({length:10},(_,i)=>({day:'new-'+i,base:.15,shadow:-.15}))
 ];
 const r=assessShadowDecay(days,['x','y'],{x:1},{x:2},score);
 assert.equal(r.windowDays,10);
 assert.equal(r.assessedDays,10);
 assert.equal(r.alert,true);
 assert.ok(r.deltaIC<-.02);
});
test('mismatched per-day IC coverage cannot be compared as equal evidence',()=>{
 const score=(_sample,_ids,weights)=>({days:weights.x===1?1:0,meanIC:.2});
 assert.throws(()=>assessShadowDecay(
  Array.from({length:5},(_,i)=>({day:String(i)})),['x','y'],{x:1},{x:2},score
 ),/覆盖不一致/);
});
