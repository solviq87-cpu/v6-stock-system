'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {commonCohorts,strategyCompetition,fusionStudy}=require('../src/core/evolution-research-statistics');
const {SYSTEMS}=require('../src/core/independent-strategy-attribution');
const day=i=>new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10);
const at=i=>Date.parse(day(i)+'T16:30:00+08:00');
const settings={asOf:at(100),horizon:5};
function cohort(i=0,net=2,gross=2.5){
 return SYSTEMS.map((system,j)=>({system,symbol:'600000',signalDate:day(i),entryDate:day(i+1),exitDate:day(i+6),
  signalAt:at(i),recordedAt:at(i)+1,outcomeKnownAt:at(i+6),provider:'tencent',priceBasis:'unadjusted',
  version:'native-v1',regime:'range',horizon:5,costFingerprint:'a'.repeat(64),scopeFingerprint:'b'.repeat(64),
  verdict:j===0?'pass':'fail',status:'paper-estimate',netReturnPct:net,priceReturnPct:gross,
  benchmarkReturnPct:1,runId:'frozen-'+i+'/'+j}));
}
test('direct cohort input excludes explicit teaching and synthetic purpose markers from all comparisons',()=>{
 for(const marker of [{sampleSet:'test'},{sampleSet:'demo'},{scope:'demo'},{testSample:true},{simulated:true},{synthetic:true},
  {mock:true},{source:'fixture'},{provenance:'mock-source'},{quality:'演示样本'}]){
  const bad=cohort().map(row=>({...row,...marker}));
  const c=strategyCompetition(bad,settings),f=fusionStudy(bad,settings);
  assert.equal(c.commonSamples,0);assert.equal(c.exclusions['test-or-demo-observation'],4);
  assert.equal(f.groups.length,0);
 }
 const rows=cohort();rows[3].sampleSet='test';
 assert.equal(strategyCompetition(rows,settings).commonSamples,0);
});
test('clean paper estimates remain eligible and a marked test duplicate cannot contaminate the original',()=>{
 const rows=cohort().map(r=>({...r,source:'V6 模拟成交'})),before=JSON.stringify(rows);
 const out=strategyCompetition([...rows,{...rows[0],sampleSet:'test',netReturnPct:999}],settings);
 assert.equal(out.commonSamples,1);assert.equal(out.exclusions['test-or-demo-observation'],1);
 assert.equal(JSON.stringify(rows),before);assert.equal(out.canTrade,false);
});
test('impossible losses and negative modeled cost are quarantined before every statistic',()=>{
 for(const [net,gross] of [[-101,-99],[-101,-101],[10,9],[-1,-2],[0,-101]]){
  const rows=cohort(0,net,gross),c=strategyCompetition(rows,settings),f=fusionStudy(rows,settings);
  assert.equal(c.commonSamples,0);assert.equal(c.exclusions['impossible-paper-outcome'],1);
  assert.equal(c.groups.length,0);assert.equal(f.groups.length,0);
 }
});
test('one corrupt strategy outcome cannot be repaired by three matching valid outcomes',()=>{
 const rows=cohort();rows[3].netReturnPct=rows[3].priceReturnPct+1;
 const c=commonCohorts(rows,settings);
 assert.equal(c.groups.length,0);assert.equal(c.exclusions['impossible-paper-outcome'],1);
});
test('true zero, equal gross and net, and bounded total loss retain exact meanings',()=>{
 for(const [net,gross] of [[0,0],[2,2],[-100,-100],[-100,-99.9]]){
  const c=strategyCompetition(cohort(0,net,gross),settings);
  assert.equal(c.commonSamples,1);
  assert.equal(c.groups[0].systems[0].selectedOutcome.mean,net);
  assert.equal(c.groups[0].systems[1].meanNetReturnPct,0);
 }
});
test('impossible benchmark return is unknown and cannot supply excess-return evidence',()=>{
 const rows=cohort().map(x=>({...x,benchmarkReturnPct:-101}));
 const c=commonCohorts(rows,settings);
 assert.equal(c.groups[0].rows[0].benchmarkReturnPct,null);
 assert.equal(commonCohorts(cohort(),settings).groups[0].rows[0].benchmarkReturnPct,1);
});
test('malformed security identity and ambiguous version or regime labels are rejected',()=>{
 for(const patch of [{symbol:600000},{version:'native-v1 '},{version:'\u0000v1'},{regime:' range'}]){
  const r=strategyCompetition(cohort().map(x=>({...x,...patch})),settings);
  assert.equal(r.commonSamples,0);assert.equal(r.exclusions['invalid-time-source-or-contract'],4);
 }
});
test('selected and rejected outcomes partition the same mature denominator without inventing causal attribution',()=>{
 const rows=[...cohort(0,3,4),...cohort(7,-2,-1.5),...cohort(14,0,.5)];
 for(const r of rows)if(r.signalDate===day(7)&&r.system==='fourteen')r.verdict='fail';
 const out=strategyCompetition(rows,settings),systems=out.groups[0].systems;
 const first=systems.find(x=>x.system==='fourteen'),review=first.outcomeReview;
 assert.equal(out.commonSamples,3);assert.equal(first.passed,2);assert.equal(first.rejected,1);
 assert.equal(first.selectedOutcome.n,2);assert.equal(first.rejectedOutcome.n,1);
 assert.equal(first.rejectedOutcome.mean,-2);assert.equal(review.selectedPositive,1);assert.equal(review.selectedFlat,1);
 assert.equal(review.rejectedNegative,1);assert.equal(review.rejectedPositive,0);
 assert.equal(review.attribution,'descriptive-counterfactual-not-causal');assert.equal(review.rejectedExposure,'cash');
 for(const s of systems){
  const a=s.outcomeReview;
  assert.equal(a.selectedPositive+a.selectedNegative+a.selectedFlat+a.rejectedPositive+a.rejectedNegative+a.rejectedFlat,a.denominator);
 }
 assert.equal(first.meanNetReturnPct,1); // rejected trade is cash, not -2.
 const unknown=[...rows.map(x=>({...x})),...cohort(21,8,9)];unknown.at(-1).verdict='unknown';
 assert.equal(strategyCompetition(unknown,settings).commonSamples,3);
 assert.equal(strategyCompetition(unknown,settings).exclusions['unknown-verdict'],1);
});
