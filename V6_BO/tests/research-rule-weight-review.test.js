'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateRuleWeightReview:review}=require('../src/strategy/research-rule-weight-review');
function mock(mode='up',opts={}){
 const foldCount=opts.folds??3;
 const folds=[],events=[];
 for(let i=0;i<foldCount;i++){
  const month=String(i+1).padStart(2,'0');
  const first='2026-'+month+'-01',last='2026-'+month+'-28';
  folds.push({fold:i+1,frozenRuleParameters:true,optimizedOnTraining:false,
   embargoSessions:2,trainEndDate:i===0?'2025-12-20':'2026-'+String(i).padStart(2,'0')+'-20',
   testStartDate:first,testEndDate:last});
  for(let k=0;k<16;k++){
   const day=String(1+Math.floor(k/8)).padStart(2,'0');
   const good=k%4!==0;
   const val=mode==='up'?(good?1.5:-.3):
    mode==='down'?(good?-1.5:.3):(k%2?1:-1);
   events.push({fold:i+1,symbol:String(600001+k%8),
    signalDate:'2026-'+month+'-'+day,ruleId:'rule-a',horizon:5,
    marketRegime:k%2===0?'normal':'broad-selloff',
    status:'modeled',netReturnPct:val});
  }
 }
 if(opts.blocked){
  for(let i=0;i<foldCount;i++)for(let k=0;k<8;k++)
   events.push({fold:i+1,symbol:String(600001+k),
    signalDate:'2026-'+String(i+1).padStart(2,'0')+'-03',
    ruleId:'rule-a',horizon:5,marketRegime:'normal',status:'suspended'});
 }
 const modeled=events.filter(e=>e.status==='modeled');
 return {mode:'frozen-public-rule-forward-audit',historicalOnly:true,
  source:opts.source??'imported',provider:'declared-test-feed',canTrade:false,
  weightsChanged:false,autoPromotion:false,
  configuration:{windows:foldCount,gapDays:2,horizons:[5],feeBps:8,slippageBps:10,sellTaxBps:5},
  folds,events,sampleIntegrity:{eventsRetained:events.length},
  rules:[{id:'rule-a',label:'研究规则A',byHorizon:{
   5:{signals:events.length,modeled:modeled.length}}}],
  overlapDiagnostics:{byRule:{'rule-a':{sameFamilyOverlapDays:opts.overlap??0}}},
  temporalOverlapDiagnostics:{byHorizon:{5:{byRule:{'rule-a':{
   nonoverlapEpisodes:opts.episodes??24,signalDays:events.length
  }}}}}
 };
}
test('good, weak, mixed and insufficient windows produce only manual-review labels',()=>{
 for(const [mode,expected] of [['up','manual-up-review'],['down','manual-down-review'],
   ['mixed','hold-mixed-evidence']]){
  const audit=mock(mode),before=structuredClone(audit),r=review(audit);
  assert.equal(r.status,'descriptive-only');assert.equal(r.byRule['rule-a'].review,expected);
  assert.equal(r.weightsChanged,false);assert.equal(r.autoPromotion,false);
  assert.equal(r.recommendedDeltaPct,null);assert.equal(r.canTrade,false);
  assert.equal(r.statisticallyCertified,false);assert.equal(r.verifiedLive,false);
  assert.deepEqual(audit,before);
 }
 const few=review(mock('up',{folds:2}));
 assert.equal(few.byRule['rule-a'].review,'insufficient-evidence');
 assert.ok(few.byRule['rule-a'].blockers.some(x=>x.includes('不足3个')));
});
test('simulated samples, duplicate family evidence and blocked outcomes stop manual promotion',()=>{
 const cases=[
  mock('up',{source:'fixture'}),
  mock('up',{overlap:30}),
  mock('up',{blocked:true}),
  mock('up',{episodes:7})
 ];
 for(const sample of cases){
  const r=review(sample),row=r.byRule['rule-a'];
  assert.equal(r.status,'descriptive-only');
  assert.equal(row.review,'insufficient-evidence',row.reason);
  assert.ok(row.blockers.length>0);
 }
});
test('missing market regimes or impossible price evidence cannot become a weight verdict',()=>{
 const x=mock();
 x.events.forEach(r=>r.marketRegime='unknown');
 assert.equal(review(x).byRule['rule-a'].review,'insufficient-evidence');
 const y=mock();y.events[0].netReturnPct=NaN;
 assert.equal(review(y).byRule['rule-a'].review,'insufficient-evidence');
 const z=mock();z.events[0].signalDate='2027-01-01';
 assert.equal(review(z).byRule['rule-a'].review,'insufficient-evidence');
});
test('audit mismatch, missing fold freeze, absent de-dup or absent cost fail closed',()=>{
 for(const change of [
  d=>delete d.temporalOverlapDiagnostics,
  d=>delete d.overlapDiagnostics,
  d=>d.configuration.horizons=[1,20],
  d=>d.configuration.feeBps=0,
  d=>d.sampleIntegrity.eventsRetained--,
  d=>d.folds[0].optimizedOnTraining=true,
  d=>d.folds[0].embargoSessions=0,
  d=>d.mode='live-trading'
 ]){
  const x=mock();change(x);
  const r=review(x);
  assert.equal(r.status,'unavailable');
  assert.deepEqual(r.byRule,{});
  assert.equal(r.weightsChanged,false);
 }
});
test('original event order and negative/blocked cases are not silently removed',()=>{
 const x=mock('down',{blocked:true});
 const r=review(x).byRule['rule-a'];
 assert.equal(r.totalSignalDays,x.events.length);
 assert.equal(r.blockedEvents,x.events.filter(e=>e.status!=='modeled').length);
 assert.equal(r.modeledEvents,x.events.filter(e=>e.status==='modeled').length);
 assert.equal(r.review,'insufficient-evidence');
});
