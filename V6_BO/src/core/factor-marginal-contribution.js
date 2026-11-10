'use strict';
/**
 * Research-only counterfactual impact of EACH proposed factor weight change.
 * All other proposed factor weights stay fixed while one adjustment is undone
 * back to the last accepted shadow value. Use matched frozen cross-sections;
 * never turn this scorecard into an order/production-weight update.
 */
const MIN_TRAIN=15,MIN_EVAL=5,MAX_DAYS=400;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=(x,n=6)=>x===null?null:+x.toFixed(n);
const average=xs=>xs.reduce((sum,x)=>sum+x,0)/xs.length;
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
function evaluateScope(days,ids,proposal,without,score,required){
 const sample={status:'insufficient',requiredDays:required,observedDays:days.length,
  comparedDays:0,firstDay:days[0]?.day||null,lastDay:days.at(-1)?.day||null,
  meanDeltaIC:null,earlyDeltaIC:null,recentDeltaIC:null,
  betterDayPct:null,worseDayPct:null,worstDeltaIC:null,
  supportsIncrement:false,stronglyHarmful:false};
 if(days.length<required)return sample;
 const delta=[];
 for(const d of days){
  const withIt=score([d],ids,proposal);
  const withoutIt=score([d],ids,without);
  if(!withIt||!withoutIt||withIt.days!==1||withoutIt.days!==1)
   return {...sample,status:'incomparable',comparedDays:delta.length};
  if(!finite(withIt.meanIC)||!finite(withoutIt.meanIC)||
     Math.abs(withIt.meanIC)>1||Math.abs(withoutIt.meanIC)>1)
   throw Error('因子反事实IC证据超出有限相关范围');
  delta.push(withIt.meanIC-withoutIt.meanIC);
 }
 const mid=Math.floor(delta.length/2);
 const mean=average(delta),early=average(delta.slice(0,mid)),
  recent=average(delta.slice(mid));
 const plus=delta.filter(x=>x>.00000001).length/delta.length,
  minus=delta.filter(x=>x<-.00000001).length/delta.length;
 return {...sample,status:'paired-unverified',comparedDays:delta.length,
  meanDeltaIC:round(mean),earlyDeltaIC:round(early),recentDeltaIC:round(recent),
  betterDayPct:round(plus*100,2),worseDayPct:round(minus*100,2),
  worstDeltaIC:round(Math.min(...delta)),
  supportsIncrement:mean>.002&&plus>=.6&&early>=-.001&&recent>=-.001,
  stronglyHarmful:mean<=-.01&&minus>=.6&&early<=-.002&&recent<=-.002};
}
function assessFactorMarginalContribution({
 training,validation,holdout,ids,acceptedWeights,proposedWeights,score
}={}){
 if(!Array.isArray(ids)||ids.length<2||new Set(ids).size!==ids.length||
    ids.some(x=>typeof x!=='string'||!x)||
    typeof score!=='function')
  throw Error('因子反事实评估协议无效');
 for(const weights of [acceptedWeights,proposedWeights]){
  if(!weights||typeof weights!=='object'||Array.isArray(weights)||
    ids.some(id=>!Object.hasOwn(weights,id)||!finite(weights[id])||weights[id]<=0))
   throw Error('因子反事实研究权重缺失或无效');
 }
 const sets=[['training',training,MIN_TRAIN],['validation',validation,MIN_EVAL],
  ['holdout',holdout,MIN_EVAL]];
 for(const [name,days] of sets){
  if(!Array.isArray(days)||days.length>MAX_DAYS)
   throw Error('因子反事实'+name+'研究批次无效');
  for(let i=0;i<days.length;i++){
   if(!validDate(days[i]?.day)||(i&&days[i-1].day>=days[i].day))
    throw Error('因子反事实研究日期必须严格递增');
  }
 }
 const factors=[];
 for(const id of ids){
  if(acceptedWeights[id]===proposedWeights[id])continue;
  const without={...proposedWeights,[id]:acceptedWeights[id]};
  const trainingScore=evaluateScope(training,ids,proposedWeights,without,score,MIN_TRAIN);
  const validationScore=evaluateScope(validation,ids,proposedWeights,without,score,MIN_EVAL);
  const holdoutScore=evaluateScope(holdout,ids,proposedWeights,without,score,MIN_EVAL);
  const comparable=[trainingScore,validationScore,holdoutScore]
   .every(x=>x.status==='paired-unverified');
  const harmful=comparable&&validationScore.stronglyHarmful&&
   holdoutScore.stronglyHarmful;
  const supported=comparable&&trainingScore.supportsIncrement&&
   validationScore.supportsIncrement&&holdoutScore.supportsIncrement;
  factors.push({factorId:id,
   change:proposedWeights[id]>acceptedWeights[id]?'increase':'decrease',
   acceptedWeight:acceptedWeights[id],proposedWeight:proposedWeights[id],
   training:trainingScore,validation:validationScore,holdout:holdoutScore,
   comparable,supportedIncrement:supported,confirmedHarm:harmful,
   status:!comparable?'incomparable':harmful?'harmful-adjustment':
    supported?'supported-unverified':'increment-unconfirmed'});
 }
 const harmfulFactorIds=factors.filter(x=>x.confirmedHarm).map(x=>x.factorId),
  supportedFactorIds=factors.filter(x=>x.supportedIncrement).map(x=>x.factorId),
  incomparableFactorIds=factors.filter(x=>!x.comparable).map(x=>x.factorId);
 return {status:!factors.length?'no-weight-changes':
   incomparableFactorIds.length?'incomparable-evidence':
   harmfulFactorIds.length?'harmful-factor-change-detected':'paired-evaluated',
  evidenceBasis:'frozen-factor-training-and-time-isolated-forward-observation',
  counterfactual:'revert-one-factor-to-accepted-weight-others-stay-proposed',
  changedFactorCount:factors.length,factors,
  harmfulFactorIds,supportedFactorIds,incomparableFactorIds,
  blocksPromotion:harmfulFactorIds.length>0||incomparableFactorIds.length>0,
  canTrade:false,productionWeightsChanged:false};
}
module.exports={assessFactorMarginalContribution};
