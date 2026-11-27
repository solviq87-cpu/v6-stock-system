'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateRuleWeightReview:review}=require('../src/strategy/research-rule-weight-review');
const {proposeSandboxPriorities:propose}=require('../src/core/sandbox-rule-priority-learning');
function fixture(){
 const folds=[],events=[];
 for(let i=0;i<3;i++){
  const m=String(i+1).padStart(2,'0');
  folds.push({fold:i+1,frozenRuleParameters:true,optimizedOnTraining:false,embargoSessions:2,
   trainEndDate:i?'2026-'+String(i).padStart(2,'0')+'-20':'2025-12-20',testStartDate:'2026-'+m+'-01',testEndDate:'2026-'+m+'-28'});
  for(let k=0;k<16;k++)events.push({fold:i+1,symbol:String(600001+k%8),signalDate:'2026-'+m+'-0'+(1+Math.floor(k/8)),
   ruleId:'rule-a',horizon:5,marketRegime:k%2?'systemic-selloff':'not-systemic-selloff',status:'modeled',netReturnPct:k%4?1.5:-.3});
 }
 const a={mode:'frozen-public-rule-forward-audit',historicalOnly:true,source:'imported',provider:'declared-research-feed',canTrade:false,verifiedLive:false,weightsChanged:false,autoPromotion:false,
  configuration:{windows:3,gapDays:2,horizons:[5],feeBps:8,slippageBps:10,sellTaxBps:5},folds,events,
  sampleIntegrity:{eventsRetained:48,blockedEventsRetained:0,marketUnknownCount:0},rules:[{id:'rule-a',byHorizon:{5:{}}}],
  overlapDiagnostics:{byRule:{'rule-a':{signalDays:48,sameFamilyOverlapDays:0}}},temporalOverlapDiagnostics:{byHorizon:{5:{byRule:{'rule-a':{signalDays:48,nonoverlapEpisodes:24,serialRepeatDays:24}}}}}};
 refresh(a);return a;
}
const summary=a=>a.rules[0].byHorizon[5];
const serial=a=>a.temporalOverlapDiagnostics.byHorizon[5].byRule['rule-a'];
function refresh(a){
 const modeled=a.events.filter(e=>e.status==='modeled'),blocked={};for(const e of a.events)if(e.status!=='modeled')blocked[e.status]=(blocked[e.status]||0)+1;
 Object.assign(summary(a),{signals:a.events.length,modeled:modeled.length,blocked,winRatePct:100*modeled.filter(e=>e.netReturnPct>0).length/modeled.length,
  averageNetReturnPct:modeled.reduce((n,e)=>n+e.netReturnPct,0)/modeled.length,worstNetReturnPct:Math.min(...modeled.map(e=>e.netReturnPct)),realizedTradingReturn:false,statisticallyCertified:false});
 a.sampleIntegrity.eventsRetained=a.events.length;a.sampleIntegrity.blockedEventsRetained=a.events.length-modeled.length;
}
function unavailable(a){const r=review(a);assert.equal(r.status,'unavailable');assert.deepEqual(r.byRule,{});assert.equal(propose(a).proposals.length,0);}
function insufficient(a){const r=review(a).byRule['rule-a'];assert.equal(r.review,'insufficient-evidence');assert.ok(r.blockers.length);assert.equal(propose(a).proposals[0].proposedResearchPriorityDeltaPct,0);return r;}
test('valid evidence retains original manual review and sandbox-only limits',()=>{const a=fixture(),before=structuredClone(a);assert.equal(review(a).byRule['rule-a'].review,'manual-up-review');const r=propose(a);assert.equal(r.proposals[0].proposedResearchPriorityDeltaPct,3);assert.equal(r.proposals[0].productionWeightDeltaPct,0);assert.equal(r.tradingEnabled,false);assert.deepEqual(a,before);});
test('arbitrary regime strings do not prove two market environments',()=>{const a=fixture();a.events.forEach((e,i)=>e.marketRegime=i%2?'invented-a':'invented-b');insufficient(a);});
test('legacy alias and canonical label cannot count as distinct regimes',()=>{const a=fixture();a.events.forEach((e,i)=>e.marketRegime=i%2?'normal':'not-systemic-selloff');insufficient(a);});
test('unrecognized regime values count against existing missing-context threshold',()=>{const a=fixture();a.events.slice(0,12).forEach(e=>e.marketRegime='not-verified');insufficient(a);});
test('impossible episode count below raw count still fails the calendar upper bound',()=>{const a=fixture();serial(a).nonoverlapEpisodes=25;serial(a).serialRepeatDays=23;insufficient(a);});
test('declared serial repeats must reconcile with episode count',()=>{const a=fixture();serial(a).serialRepeatDays=0;insufficient(a);});
test('declared overlap denominator must reconcile with event count',()=>{const a=fixture();a.overlapDiagnostics.byRule['rule-a'].signalDays=47;insufficient(a);});
test('unregistered rule or horizon cannot disappear from the full audit',()=>{for(const patch of [{ruleId:'orphan'},{horizon:20}]){const a=fixture();a.events.push({...a.events[0],...patch,netReturnPct:-50});a.sampleIntegrity.eventsRetained++;unavailable(a);}});
test('sparse event array fails closed instead of preserving a favorable subset',()=>{const a=fixture();a.events.length++;a.sampleIntegrity.eventsRetained++;unavailable(a);});
test('reserved rule identity cannot replace the result object prototype',()=>{const a=fixture();a.rules[0].id='__proto__';a.events.forEach(e=>e.ruleId='__proto__');unavailable(a);});
test('producer cost and embargo limits remain authoritative',()=>{for(const patch of [{feeBps:201},{slippageBps:201},{sellTaxBps:201},{horizons:[5,5]}]){const a=fixture();Object.assign(a.configuration,patch);unavailable(a);}const a=fixture();a.folds[0].trainEndDate='2025-12-31';unavailable(a);});
test('explicit contradictory authority flags cannot become a review verdict',()=>{for(const k of ['canTrade','verifiedLive']){const a=fixture();a[k]=true;unavailable(a);}const a=fixture();a.events[0].canTrade=true;insufficient(a);});
test('numeric security identity is not a six-character frozen code',()=>{const a=fixture();a.events[0].symbol=600001;insufficient(a);});
test('unknown status or blocked event carrying a return cannot influence review',()=>{for(const status of ['made-up-status','blocked-exit']){const a=fixture();a.events[0].status=status;refresh(a);insufficient(a);}});
test('explicit entry and exit evidence must respect next-day and five-day minimum span',()=>{for(const [entryDate,exitDate] of [['2026-01-01','2026-01-07'],['2026-01-02','2026-01-03'],['2026-01-02',undefined]]){const a=fixture();Object.assign(a.events[0],{entryDate,exitDate});insufficient(a);}});
test('blocked-event and worst-return summaries cannot hide losses',()=>{for(const patch of [{blocked:{pending:1}},{worstNetReturnPct:0},{realizedTradingReturn:true},{statisticallyCertified:true}]){const a=fixture();Object.assign(summary(a),patch);insufficient(a);}});
test('declared whole-audit retained counters must agree with raw events',()=>{for(const k of ['blockedEventsRetained','marketUnknownCount']){const a=fixture();a.sampleIntegrity[k]=1;unavailable(a);}});
test('nonfinite derived mean remains unknown rather than leaking infinite output',()=>{const a=fixture();a.events.forEach(e=>e.netReturnPct=Number.MAX_VALUE);refresh(a);summary(a).averageNetReturnPct=Number.MAX_VALUE;const r=insufficient(a);assert.equal(r.averageModeledNetPct,null);assert.deepEqual(r.foldAverageNetPct,[null,null,null]);});
