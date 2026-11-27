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
// A comparison must consume one frozen input snapshot. Keep native and legacy
// date-only diagnostics distinct; never allow a scorer to rewrite the evidence.
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function ownValue(x,k){const d=object(x)?Object.getOwnPropertyDescriptor(x,k):null;return d&&Object.hasOwn(d,'value')?d.value:undefined;}
function freezeTree(x,seen=new WeakSet()){
 if(x!==null&&typeof x==='object'&&!seen.has(x)){seen.add(x);for(const v of Object.values(x))freezeTree(v,seen);Object.freeze(x);}
 return x;
}
function weightTotal(ids,weights){
 const sum=ids.reduce((n,id)=>n+weights[id],0);
 if(!finite(sum)||sum<=0)throw Error('因子反事实研究权重合计无效');
}
function assertNativeSections(phases,ids){
 const present=phases.some(days=>days.some(d=>Object.hasOwn(d,'rows')));
 if(!present)return false;
 const lastTarget=new Map();
 for(const days of phases)for(const d of days){
  const rows=ownValue(d,'rows');
  if(!validDate(d.targetDate)||!Array.isArray(rows)||rows.length<5||rows.length>500)throw Error('因子反事实成熟截面证据缺失或无效');
  const symbols=new Set();
  for(const row of rows){
   if(!object(row)||typeof row.symbol!=='string'||!/^\d{6}$/.test(row.symbol)||symbols.has(row.symbol)||
      row.signalDate!==d.day||row.targetDate!==d.targetDate||!finite(row.returnPct)||row.returnPct< -100||
      !object(row.values)||ids.some(id=>!finite(ownValue(row.values,id))))throw Error('因子反事实成熟截面证据缺失或无效');
   if(lastTarget.has(row.symbol)&&lastTarget.get(row.symbol)>=d.day)throw Error('因子反事实截面收益标签重叠');
   symbols.add(row.symbol);lastTarget.set(row.symbol,row.targetDate);
  }
 }
 return true;
}
function captureDaily(result){
 // Capture primitive fields immediately: a scorer may reuse its result object.
 if(ownValue(result,'days')!==1)return null;
 const value=ownValue(result,'meanIC');
 if(value===undefined)return null;
 if(!finite(value)||Math.abs(value)>1)throw Error('因子反事实IC证据超出有限相关范围');
 return value;
}
function evaluateScope(days,ids,proposal,without,score,required){
 const sample={status:'insufficient',requiredDays:required,observedDays:days.length,
  comparedDays:0,firstDay:days[0]?.day||null,lastDay:days.at(-1)?.day||null,
  meanDeltaIC:null,earlyDeltaIC:null,recentDeltaIC:null,
  betterDayPct:null,worseDayPct:null,worstDeltaIC:null,
  supportsIncrement:false,stronglyHarmful:false};
 if(days.length<required)return sample;
 const delta=[];
 for(const d of days){
  const withIt=captureDaily(score(Object.freeze([d]),ids,proposal));
  const withoutIt=captureDaily(score(Object.freeze([d]),ids,without));
  if(withIt===null||withoutIt===null)
   return {...sample,status:'incomparable',comparedDays:delta.length};
  delta.push(withIt-withoutIt);
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
    Array.from(ids).some(x=>typeof x!=='string'||! /^[A-Za-z0-9_-]{1,100}$/.test(x)||Object.hasOwn(Object.prototype,x)||x==='prototype')||
    typeof score!=='function')
  throw Error('因子反事实评估协议无效');
 for(const weights of [acceptedWeights,proposedWeights]){
  if(!weights||typeof weights!=='object'||Array.isArray(weights)||
    ids.some(id=>!finite(ownValue(weights,id))||ownValue(weights,id)<=0))
   throw Error('因子反事实研究权重缺失或无效');
 }
 ids=Object.freeze([...ids]);
 acceptedWeights=Object.freeze(Object.fromEntries(ids.map(id=>[id,ownValue(acceptedWeights,id)])));
 proposedWeights=Object.freeze(Object.fromEntries(ids.map(id=>[id,ownValue(proposedWeights,id)])));
 weightTotal(ids,acceptedWeights);weightTotal(ids,proposedWeights);
 for(const id of ids)weightTotal(ids,{...proposedWeights,[id]:acceptedWeights[id]});
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
 // Keep the three declared phases independent before invoking any scorer.
 // Empty phases retain their original insufficient-sample handling.
 const phases=sets.map(([,days])=>days).filter(days=>days.length);
 for(let i=1;i<phases.length;i++)
  if(phases[i-1].at(-1).day>=phases[i][0].day)
   throw Error('因子反事实研究阶段日期重叠或顺序无效');
 // Native matured cross-sections supply targetDate. Check every declared
 // label date and reject any that reaches a later research phase. Older
 // date-only diagnostic inputs remain descriptive and explicitly unverified.
 const hasLabelDates=phases.some(days=>days.some(row=>Object.hasOwn(row,'targetDate')));
 if(hasLabelDates){
  for(let i=0;i<phases.length;i++){
   const cutoff=phases[i+1]?.[0]?.day;
   for(const row of phases[i]){
    if(!validDate(row.targetDate)||row.targetDate<=row.day)
     throw Error('因子反事实收益标签日期无效或缺失');
    if(cutoff&&row.targetDate>=cutoff)
     throw Error('因子反事实收益标签跨越研究阶段');
   }
  }
 }
 const nativeSections=assertNativeSections(phases,ids);
 // Copy once, not once per factor/day. Native score uses only immutable data.
 [training,validation,holdout]=[training,validation,holdout].map(days=>freezeTree(structuredClone(days)));
 const factors=[];
 for(const id of ids){
  if(acceptedWeights[id]===proposedWeights[id])continue;
  const without=Object.freeze({...proposedWeights,[id]:acceptedWeights[id]});
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
  labelTimeEvidence:hasLabelDates?'provided-and-checked':'not-provided',
  crossSectionEvidence:nativeSections?'validated-frozen-rows':'legacy-descriptive-only',
  counterfactual:'revert-one-factor-to-accepted-weight-others-stay-proposed',
  changedFactorCount:factors.length,factors,
  harmfulFactorIds,supportedFactorIds,incomparableFactorIds,
  blocksPromotion:harmfulFactorIds.length>0||incomparableFactorIds.length>0,
  canTrade:false,productionWeightsChanged:false};
}
module.exports={assessFactorMarginalContribution};
