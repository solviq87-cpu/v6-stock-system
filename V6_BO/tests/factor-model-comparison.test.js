'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {compareShadowVersions}=require('../src/core/factor-model-comparison');
const tradingDays=n=>Array.from({length:n},(_,i)=>({
 day:new Date(Date.UTC(2026,5,1+i)).toISOString().slice(0,10),
 original:.10,accepted:.12,proposed:.16
}));
const score=(rows,_ids,weights)=>({
 days:1,meanIC:weights.factor===1?rows[0].original:
  weights.factor===2?rows[0].accepted:rows[0].proposed
});
const run=days=>compareShadowVersions(days,['factor','other'],
 {factor:1,other:1},{factor:2,other:1},{factor:3,other:1},score);
test('original, accepted and proposed variants share the same fresh daily scorecard',()=>{
 const r=run(tradingDays(10));
 assert.equal(r.status,'paired-scorecard-unverified');
 assert.equal(r.assessedDays,10);
 assert.equal(r.original.meanIC,.10);
 assert.equal(r.accepted.meanIC,.12);
 assert.equal(r.proposed.meanIC,.16);
 assert.equal(r.proposedVsOriginal.meanDeltaIC,.06);
 assert.equal(r.proposedVsAccepted.meanDeltaIC,.04);
 assert.equal(r.proposedVsOriginal.betterDayPct,100);
 assert.equal(r.originalGatePassed,true);
 assert.equal(r.perDay.length,10);
 assert.equal(r.perDay[0].day,'2026-06-01');
 assert.equal(r.canTrade,false);
 assert.equal(r.productionWeightsChanged,false);
});
test('a challenger slightly beats a weak accepted model but stays below immutable base: do not promote',()=>{
 const rows=tradingDays(10).map(x=>({...x,original:.28,accepted:.08,proposed:.12}));
 const r=run(rows);
 assert.ok(r.proposedVsAccepted.meanDeltaIC>.002);
 assert.ok(r.proposedVsOriginal.meanDeltaIC<0);
 assert.equal(r.originalGatePassed,false);
 assert.equal(r.status,'paired-scorecard-unverified');
});
test('a handful of exceptional days cannot hide deterioration in recent half',()=>{
 const rows=tradingDays(10).map((x,i)=>({...x,
  original:.10,accepted:.10,proposed:i<5?.35:.08}));
 const r=run(rows);
 assert.ok(r.proposedVsOriginal.meanDeltaIC>.002);
 assert.equal(r.proposedVsOriginal.betterDayPct,50);
 assert.ok(r.proposedVsOriginal.recentHalfDeltaIC<-.001);
 assert.equal(r.originalGatePassed,false);
});
test('insufficient or unmatched fresh daily coverage fail closed',()=>{
 const short=run(tradingDays(4));
 assert.equal(short.status,'insufficient-fresh-evidence');
 assert.equal(short.originalGatePassed,false);
 const badScore=(_rows,_ids,weights)=>({days:weights.factor===3?0:1,meanIC:.1});
 const mismatched=compareShadowVersions(tradingDays(10),['factor','other'],
  {factor:1,other:1},{factor:2,other:1},{factor:3,other:1},badScore);
 assert.equal(mismatched.status,'incomparable-fresh-evidence');
 assert.equal(mismatched.originalGatePassed,false);
});
test('only latest twenty unseen matured days contribute and no duplicate chronological day is allowed',()=>{
 const r=run(tradingDays(25));
 assert.equal(r.assessedDays,20);
 assert.equal(r.firstDay,'2026-06-06');
 assert.equal(r.lastDay,'2026-06-25');
 assert.equal(r.perDay.length,20);
 const duplicate=tradingDays(10);
 duplicate[5].day=duplicate[4].day;
 assert.throws(()=>run(duplicate),/严格递增/);
 const backwards=tradingDays(10);
 backwards.reverse();
 assert.throws(()=>run(backwards),/严格递增/);
});
test('impossible factor scores and malformed baseline definitions cannot qualify as gain',()=>{
 const invalid=(_rows,_ids,weights)=>({days:1,meanIC:weights.factor===3?NaN:.2});
 assert.throws(()=>compareShadowVersions(tradingDays(10),['factor','other'],
  {factor:1,other:1},{factor:2,other:1},{factor:3,other:1},invalid),/IC不是有限/);
 assert.throws(()=>compareShadowVersions(tradingDays(10),['factor','other'],
  {factor:1,other:1},{factor:2,other:1},{factor:0,other:1},score),/权重缺失/);
});

test('paired robustness reports leave-one-out and complete five-observation blocks without promoting',()=>{
 const r=run(tradingDays(10));
 const frag=r.proposedVsOriginal.fragility;
 assert.equal(frag.status,'descriptive-unverified');
 assert.equal(frag.assessedDays,10);
 assert.equal(frag.worstLeaveOneOutMeanDeltaIC,.06);
 assert.equal(frag.bestLeaveOneOutMeanDeltaIC,.06);
 assert.equal(frag.singleDayDependent,false);
 assert.equal(frag.completeFiveObservationBlocks.length,2);
 assert.equal(frag.allCompleteBlocksPositive,true);
 assert.equal(frag.incompleteTailDays,0);
 assert.equal(frag.changesPromotionGate,false);
 assert.equal(frag.canTrade,false);
 assert.equal(r.originalGatePassed,true);
 assert.equal(r.proposedVsAccepted.fragility.worstLeaveOneOutMeanDeltaIC,.04);
});

test('a large single-day outlier is reported as fragile even when mean improvement is positive',()=>{
 const rows=tradingDays(10).map((row,i)=>({...row,
  original:.10,accepted:.10,proposed:i===0?.99:.08}));
 const r=run(rows);
 assert.ok(r.proposedVsOriginal.meanDeltaIC>0);
 assert.equal(r.proposedVsOriginal.fragility.singleDayDependent,true);
 assert.equal(r.proposedVsOriginal.fragility.worstLeaveOneOutMeanDeltaIC,-.02);
 assert.equal(r.proposedVsOriginal.fragility.allCompleteBlocksPositive,false);
 assert.equal(r.originalGatePassed,false);
});

test('five unseen days remain explicitly low evidence and partial blocks are not counted',()=>{
 const short=run(tradingDays(5));
 assert.equal(short.proposedVsOriginal.fragility.status,'limited-fresh-observations');
 assert.equal(short.proposedVsOriginal.fragility.completeFiveObservationBlocks.length,1);
 assert.equal(short.proposedVsOriginal.fragility.allCompleteBlocksPositive,null);
 assert.equal(short.proposedVsOriginal.fragility.changesPromotionGate,false);
 const eleven=run(tradingDays(11));
 assert.equal(eleven.proposedVsOriginal.fragility.completeFiveObservationBlocks.length,2);
 assert.equal(eleven.proposedVsOriginal.fragility.incompleteTailDays,1);
 assert.equal(eleven.proposedVsOriginal.fragility.completeFiveObservationBlocks[1].lastDay,'2026-06-10');
});
