'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {proposeSandboxPriorities}=require('../src/core/sandbox-rule-priority-learning');
function audit(mode){
 const folds=[],events=[];
 for(let i=0;i<3;i++){
  const mm=String(i+1).padStart(2,'0');
  folds.push({fold:i+1,frozenRuleParameters:true,optimizedOnTraining:false,
   embargoSessions:2,trainEndDate:i===0?'2025-12-20':'2026-'+String(i).padStart(2,'0')+'-20',
   testStartDate:'2026-'+mm+'-01',testEndDate:'2026-'+mm+'-28'});
  for(let k=0;k<16;k++){
   const good=k%4!==0;
   events.push({fold:i+1,symbol:String(600001+k%8),
    signalDate:'2026-'+mm+'-'+String(1+Math.floor(k/8)).padStart(2,'0'),
    ruleId:'rule-a',horizon:5,marketRegime:k%2?'normal':'broad-selloff',
    status:'modeled',netReturnPct:mode==='up'?(good?1.5:-.3):(good?-1.5:.3)});
  }
 }
 const mean=events.reduce((n,x)=>n+x.netReturnPct,0)/events.length;
 return {mode:'frozen-public-rule-forward-audit',historicalOnly:true,
  source:'imported',provider:'declared-historical-feed',canTrade:false,
  weightsChanged:false,autoPromotion:false,
  configuration:{windows:3,gapDays:2,horizons:[5],feeBps:8,slippageBps:10,sellTaxBps:5},
  folds,events,sampleIntegrity:{eventsRetained:events.length},
  rules:[{id:'rule-a',byHorizon:{5:{signals:48,modeled:48,
   averageNetReturnPct:mean,winRatePct:100*events.filter(x=>x.netReturnPct>0).length/48}}}],
  overlapDiagnostics:{byRule:{'rule-a':{sameFamilyOverlapDays:0}}},
  temporalOverlapDiagnostics:{byHorizon:{5:{byRule:{'rule-a':{
   nonoverlapEpisodes:24,signalDays:48}}}}}};
}
test('frozen multi-fold evidence automatically proposes bounded sandbox-only changes',()=>{
 for(const [m,delta] of [['up',3],['down',-3]]){
  const x=audit(m),before=structuredClone(x),r=proposeSandboxPriorities(x);
  assert.equal(r.status,'research-preview-only');
  assert.equal(r.proposals[0].proposedResearchPriorityDeltaPct,delta);
  assert.equal(r.proposals[0].productionWeightDeltaPct,0);
  assert.equal(r.formalFactorWeightsChanged,false);
  assert.equal(r.appliedToResearchRanking,false);
  assert.deepEqual(x,before);
 }
});
test('broad selloff pauses candidate changes, and poor sample quality blocks proposals',()=>{
 const r=proposeSandboxPriorities(audit('up'),{marketShock:{deferLearningUpdate:true}});
 assert.equal(r.status,'paused-on-market-shock');
 assert.equal(r.proposals[0].proposedResearchPriorityDeltaPct,0);
 const q=audit('up');q.source='fixture';
 const blocked=proposeSandboxPriorities(q);
 assert.equal(blocked.proposals[0].proposedResearchPriorityDeltaPct,0);
 assert.equal(blocked.proposals[0].review,'insufficient-evidence');
 assert.ok(blocked.proposals[0].blockers.length);
});
test('missing or corrupt frozen audit fails closed without inventing an AI advantage',()=>{
 for(const x of [null,{}, {mode:'wrong'}]){
  const r=proposeSandboxPriorities(x);
  assert.equal(r.status,'unavailable');
  assert.equal(r.proposals.length,0);
  assert.equal(r.autoPromotion,false);
 }
});
