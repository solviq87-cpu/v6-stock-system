'use strict';
/** Fail-closed, read-only eligibility for exporting sector research to shadow-learning.
 * A valid sector score is NOT training evidence until source quality and time
 * consistency pass. This gate never trains or mutates model weights.
 */
const {auditSectorResearchInputs}=require('./sector-research-evidence-audit');
const {bridgeExistingMarketSector}=require('./sector-breadth-market-bridge');
function inspectSectorShadowEligibility(snapshot,membership,{asOf,maxQuoteAgeMs=300000}={}){
 const audit=auditSectorResearchInputs(snapshot,membership,{asOf,maxQuoteAgeMs});
 const fail=reason=>({schemaVersion:1,status:'blocked',reason,
  quality:audit,shadowSample:null,canTrain:false,canTrade:false,
  autoPromotion:false,weightsChanged:false});
 if(audit.status!=='observed-unverified')return fail('quality-gate-'+(audit.reasons?.join(',')||'unknown'));
 const bridge=bridgeExistingMarketSector(snapshot,membership,{asOf,maxQuoteAgeMs});
 if(bridge.status!=='imported-unverified'||bridge.study?.rankedSectorCount<3)
  return fail('sector-strength-not-comparable:'+String(bridge.reason||'no-comparable-sectors'));
 const version=membership?.classificationVersion;
 if(typeof version!=='string'||!version||version.length>150)
  return fail('missing-frozen-classification-version');
 const sectors=bridge.study.sectors.filter(s=>s.rank!==null&&s.rank!==undefined);
 if(sectors.length<3)return fail('insufficient-ranked-sector-groups');
 return {schemaVersion:1,status:'shadow-input-preview-unverified',
  tradeDate:bridge.tradeDate,classificationVersion:version,
  quality:audit,canTrain:false,canTrade:false,autoPromotion:false,
  weightsChanged:false,shadowSample:{
   schemaVersion:1,mode:'sector-shadow-candidate-not-training',
   tradeDate:bridge.tradeDate,classificationVersion:version,
   quoteSource:bridge.quoteProvider,membershipSource:bridge.membershipProvider,
   marketQuoteCoveragePct:bridge.marketQuoteCoveragePct,
   observedAt:bridge.observedAt,
   sectors:sectors.map(s=>({category:s.category,code:s.code,
    score:s.score,upPct:s.upPct,coveragePct:s.coveragePct,
    state:s.state,rank:s.rank})),
   labelsAvailable:false,outOfSampleValidated:false,
   canTrain:false,canTrade:false},
  note:'仅生成可人工核验的影子候选样本；未提供未来收益标签、交易日历或样本外评估，不允许直接训练、改权重或下单'};
}
module.exports={inspectSectorShadowEligibility};
