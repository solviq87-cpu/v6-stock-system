'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assessFactorMarginalContribution}=require('../src/core/factor-marginal-contribution');
const ids=['a','b','c'];
const old={a:1,b:1,c:1};
const proposed={a:1.08,b:1.08,c:1};
const days=(date,n,a=.07,b=.05)=>{
 const begin=Date.parse(date+'T00:00:00Z');
 return Array.from({length:n},(_,i)=>({
  day:new Date(begin+i*86400000).toISOString().slice(0,10),effectA:a,effectB:b
 }));
};
const score=(items,_ids,weights)=>({
 days:1,meanIC:.15+((weights.a-1)/.08)*items[0].effectA+
  ((weights.b-1)/.08)*items[0].effectB
});
const run=(overrides={})=>assessFactorMarginalContribution({
 training:days('2026-01-01',25),validation:days('2026-02-01',8),
 holdout:days('2026-03-01',10),ids,acceptedWeights:old,
 proposedWeights:proposed,score,...overrides
});
test('paired one-factor counterfactuals independently validate positive contributions on the same frozen days',()=>{
 const r=run();
 assert.equal(r.status,'paired-evaluated');
 assert.equal(r.changedFactorCount,2);
 assert.deepEqual(r.supportedFactorIds,['a','b']);
 assert.deepEqual(r.harmfulFactorIds,[]);
 assert.deepEqual(r.incomparableFactorIds,[]);
 assert.equal(r.blocksPromotion,false);
 const a=r.factors.find(x=>x.factorId==='a');
 assert.equal(a.status,'supported-unverified');
 assert.equal(a.training.meanDeltaIC,.07);
 assert.equal(a.validation.meanDeltaIC,.07);
 assert.equal(a.holdout.meanDeltaIC,.07);
 assert.equal(a.training.comparedDays,25);
 assert.equal(a.holdout.comparedDays,10);
 assert.equal(a.holdout.betterDayPct,100);
 assert.equal(a.acceptedWeight,1);
 assert.equal(a.proposedWeight,1.08);
 assert.equal(r.productionWeightsChanged,false);
 assert.equal(r.canTrade,false);
});
test('strongly harmful factor adjustment on both validation and fresh holdout blocks shadow promotion',()=>{
 const training=days('2026-01-01',25,.07,.05);
 const validation=days('2026-02-01',8,-.08,.05);
 const holdout=days('2026-03-01',10,-.07,.05);
 const r=run({training,validation,holdout});
 assert.equal(r.status,'harmful-factor-change-detected');
 assert.deepEqual(r.harmfulFactorIds,['a']);
 assert.equal(r.factors[0].validation.stronglyHarmful,true);
 assert.equal(r.factors[0].holdout.stronglyHarmful,true);
 assert.equal(r.factors[0].training.supportsIncrement,true);
 assert.equal(r.factors[1].supportedIncrement,true);
 assert.equal(r.blocksPromotion,true);
});
test('non-incremental factor stays visibly unconfirmed, never claimed independent alpha',()=>{
 const r=run({training:days('2026-01-01',25,0,.05),
  validation:days('2026-02-01',8,0,.05),
  holdout:days('2026-03-01',10,0,.05)});
 const a=r.factors.find(x=>x.factorId==='a');
 assert.equal(a.status,'increment-unconfirmed');
 assert.equal(a.supportedIncrement,false);
 assert.equal(a.holdout.betterDayPct,0);
 assert.equal(a.holdout.meanDeltaIC,0);
 assert.equal(r.supportedFactorIds.includes('a'),false);
 assert.equal(r.harmfulFactorIds.includes('a'),false);
});
test('one disastrous day with mostly helpful changes does not falsely trigger persistent-harm guard',()=>{
 const holdout=days('2026-03-01',10,.07,.05);
 holdout[2].effectA=-.5;
 const r=run({holdout});
 assert.equal(r.factors[0].holdout.stronglyHarmful,false);
 assert.equal(r.blocksPromotion,false);
});
test('missing one counterfactual daily score cannot be silently counted as zero or certified',()=>{
 const incomplete=(items,_,weights)=>({
  days:items[0].day==='2026-03-03'&&weights.a===1?0:1,
  meanIC:score(items,null,weights).meanIC
 });
 const r=run({score:incomplete});
 assert.equal(r.status,'incomparable-evidence');
 assert.deepEqual(r.incomparableFactorIds,['a']);
 assert.equal(r.factors[0].holdout.status,'incomparable');
 assert.equal(r.factors[0].holdout.comparedDays,2);
 assert.equal(r.blocksPromotion,true);
});
test('invalid dates, duplicated dates, missing weights and forged IC are rejected',()=>{
 const duplicate=days('2026-01-01',25);
 duplicate[2].day=duplicate[1].day;
 assert.throws(()=>run({training:duplicate}),/日期必须严格递增/);
 assert.throws(()=>run({proposedWeights:{a:1.08,b:0,c:1}}),/权重缺失或无效/);
 const NaNIC=()=>({days:1,meanIC:NaN});
 assert.throws(()=>run({score:NaNIC}),/超出有限相关范围/);
});
test('unchanged factor pack has no marginal change and cannot manufacture evidence',()=>{
 const r=run({proposedWeights:{...old}});
 assert.equal(r.status,'no-weight-changes');
 assert.equal(r.changedFactorCount,0);
 assert.equal(r.blocksPromotion,false);
 assert.deepEqual(r.factors,[]);
});
test('new untouched holdout must contain five comparable days; short windows fail closed',()=>{
 const r=run({holdout:days('2026-03-01',4)});
 assert.equal(r.status,'incomparable-evidence');
 assert.deepEqual(r.incomparableFactorIds,['a','b']);
 assert.equal(r.factors[0].holdout.status,'insufficient');
 assert.equal(r.blocksPromotion,true);
});

test('training, validation and holdout cannot reuse the same dates or reverse chronological order',()=>{
 let calls=0;
 const counted=(...args)=>{calls++;return score(...args);};
 for(const overrides of [
  {validation:days('2026-01-25',8)},
  {holdout:days('2026-02-08',10)},
  {holdout:days('2025-12-01',10)},
  {validation:[],holdout:days('2026-01-20',10)}
 ])assert.throws(()=>run({...overrides,score:counted}),/阶段日期重叠或顺序无效/);
 assert.equal(calls,0);
});
const withTargets=(date,n)=>days(date,n).map(r=>({...r,targetDate:new Date(Date.parse(r.day+'T00:00:00Z')+5*86400000).toISOString().slice(0,10)}));
const timed=()=>({training:withTargets('2026-01-01',25),validation:withTargets('2026-02-01',8),holdout:withTargets('2026-03-01',10)});
test('a previous stage label must mature strictly before the next stage begins',()=>{
 for(const [phase,targetDate] of [['training','2026-02-01'],['training','2026-02-02'],['validation','2026-03-01']]){
  const inputs=timed();inputs[phase].at(-1).targetDate=targetDate;
  assert.throws(()=>run(inputs),/收益标签跨越研究阶段/);
 }
});
test('explicit target-date evidence must be complete and strictly later than its signal',()=>{
 for(const value of [undefined,null,'','2026-02-30','2026-01-01','2025-12-31']){
  const inputs=timed();inputs.training[0].targetDate=value;
  assert.throws(()=>run(inputs),/收益标签日期无效或缺失/);
 }
 const inputs=timed();delete inputs.holdout[0].targetDate;
 assert.throws(()=>run(inputs),/收益标签日期无效或缺失/);
});
test('strictly separated mature label dates retain the original paired score and leave inputs immutable',()=>{
 const inputs=timed();inputs.training.at(-1).targetDate='2026-01-31';
 const before=JSON.stringify(inputs),r=run(inputs);
 assert.equal(r.status,'paired-evaluated');assert.equal(r.blocksPromotion,false);
 assert.equal(r.labelTimeEvidence,'provided-and-checked');
 assert.deepEqual(r.supportedFactorIds,['a','b']);
 assert.equal(JSON.stringify(inputs),before);assert.equal(r.canTrade,false);
});
test('date-only legacy diagnostics remain descriptive, with missing label dates explicitly disclosed',()=>{
 const r=run();assert.equal(r.labelTimeEvidence,'not-provided');
 assert.equal(r.status,'paired-evaluated');assert.equal(r.canTrade,false);
 assert.equal(r.productionWeightsChanged,false);
});

test('F26 disposition separates non-triggered, blocked, negative and inconclusive experiments',()=>{
 const positive=run();
 assert.deepEqual(positive.dispositions.map(x=>x.status),['positive-ic-unverified','positive-ic-unverified','not-triggered']);
 const blocked=run({holdout:days('2026-03-01',4)});
 assert.deepEqual(blocked.dispositions.map(x=>x.status),['data-blocked','data-blocked','not-triggered']);
 const negative=run({validation:days('2026-02-01',8,-.08,0),holdout:days('2026-03-01',10,-.08,0)});
 assert.deepEqual(negative.dispositions.map(x=>x.status),['negative-ic-evidence','inconclusive-ic','not-triggered']);
 for(const x of negative.dispositions){
  assert.equal(x.permanentlyInvalid,false);
  assert.equal(x.canPromote,false);
  assert.deepEqual(x.approvedUses,[]);
  assert.equal(x.economicValue.netReturnDelta,null);
  assert.equal(x.economicValue.latencyDeltaMs,null);
 }
 assert.equal(negative.independentEconomicValueVerified,false);
 assert.equal(negative.automaticPromotionAuthorized,false);
});
