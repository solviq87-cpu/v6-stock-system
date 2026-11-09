'use strict';
/**
 * Research-only automatic prioritization from already frozen out-of-sample
 * reviews. Never writes the four production strategies or 15 factor weights.
 */
const {evaluateRuleWeightReview}=require('../strategy/research-rule-weight-review');
function proposeSandboxPriorities(audit,{marketShock=null}={}){
 const result=evaluateRuleWeightReview(audit);
 const paused=marketShock?.deferLearningUpdate===true;
 const base={schemaVersion:1,mode:'automatic-sandbox-rule-priorities',
  status:result.status==='descriptive-only'?
   paused?'paused-on-market-shock':'research-preview-only':'unavailable',
  evidenceReviewStatus:result.status,pausedForMarketShock:paused,
  formalStrategyWeightsChanged:false,formalFactorWeightsChanged:false,
  tradingEnabled:false,autoPromotion:false,appliedToResearchRanking:false,
  requiresIndependentValidation:true,proposals:[]};
 if(result.status!=='descriptive-only')return base;
 const proposals=Object.entries(result.byRule).sort(([a],[b])=>a.localeCompare(b))
  .map(([ruleId,row])=>{
   let candidate=0,reason='保留现有研究优先级';
   if(!paused&&row.review==='manual-up-review'){
    candidate=3;reason='冻结5日多窗口研究一致偏强，提出小幅研究优先级升权假设';
   }else if(!paused&&row.review==='manual-down-review'){
    candidate=-3;reason='冻结5日多窗口研究一致偏弱，提出小幅研究优先级降权假设';
   }else if(paused)reason='市场急跌保护：不生成权重变动假设';
   else if(row.review==='insufficient-evidence')reason='样本不足或未通过门禁，禁止根据结果调权';
   return {ruleId,review:row.review,proposedResearchPriorityDeltaPct:candidate,
    reason,blockers:row.blockers||[],model:'fixed-bounded-heuristic-v1',
    statisticallyCertified:false,productionWeightDeltaPct:0,
    independentlyApproved:false};
  });
 return {...base,proposals,proposedUp:proposals.filter(x=>x.proposedResearchPriorityDeltaPct>0).length,
  proposedDown:proposals.filter(x=>x.proposedResearchPriorityDeltaPct<0).length,
  unchanged:proposals.filter(x=>x.proposedResearchPriorityDeltaPct===0).length,
  note:'±3%只是隔离研究排序试验候选，不是优化后收益或可执行权重；需要下一段独立样本外检验及人工批准。'};
}
module.exports={proposeSandboxPriorities};
