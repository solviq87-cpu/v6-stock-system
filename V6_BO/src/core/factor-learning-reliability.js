'use strict';
/**
 * Independent research-only IC stability and market-regime reliability gate.
 * A big average is not evidence of durable usefulness when its sign flips.
 * No access to production strategy weights or order execution.
 */
const MIN_DAYS=15,MIN_REGIME_DAYS=8;
const HORIZON_BLOCK_DAYS=5,MIN_BLOCK_DIRECTION_FRACTION=.75,MIN_ROBUST_IC=.02;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=(x,n=4)=>x===null?null:+x.toFixed(n);
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const median=xs=>{
 if(!xs.length)return null;
 const s=[...xs].sort((a,b)=>a-b),i=Math.floor(s.length/2);
 return s.length%2?s[i]:(s[i-1]+s[i])/2;
};
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const REGIMES=['systemic-selloff','not-systemic-selloff'];
const validDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&
 Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
// Research evidence must be explicit own data, not inherited values or getters.
const ownData=(o,k,error)=>{
 const d=o&&Object.getOwnPropertyDescriptor(o,k);
 if(!d||!Object.hasOwn(d,'value'))throw Error(error);
 return d.value;
};
const record=o=>o!==null&&typeof o==='object'&&
 (Object.getPrototypeOf(o)===Object.prototype||Object.getPrototypeOf(o)===null);
function denseRows(rows,error){
 if(!Array.isArray(rows)||rows.length>400)throw Error(error);
 return Array.from({length:rows.length},(_,i)=>ownData(rows,i,error));
}
function assertChronology(rows){
 const error='因子研究日期必须有效、唯一且严格递增';
 let previous=null;
 for(const r of denseRows(rows,error)){
  if(!record(r))throw Error(error);
  const date=ownData(r,'day',error);
  if(!validDay(date)||(previous!==null&&previous>=date))throw Error(error);
  previous=date;
 }
}
// Clone the JSON-like evidence once, rejecting accessors and sparse nested
// arrays before scoring. Each variant sees the same immutable snapshot.
function snapshot(value,error,active=new Set()){
 if(value===null||value===undefined||['number','string','boolean'].includes(typeof value))return value;
 if((!Array.isArray(value)&&!record(value))||active.has(value))throw Error(error);
 active.add(value);
 let out;
 if(Array.isArray(value)){
  out=Array.from({length:value.length},(_,i)=>snapshot(ownData(value,i,error),error,active));
 }else{
  out=Object.create(Object.getPrototypeOf(value));
  for(const k of Object.keys(value))Object.defineProperty(out,k,{
   value:snapshot(ownData(value,k,error),error,active),enumerable:true,writable:false,configurable:false});
 }
 active.delete(value);
 return Object.freeze(out);
}
function comparisonInput(days,ids,base,next){
 const error='样本外因子与权重证据无效';
 const factors=denseRows(ids,error);
 if(!factors.length||factors.some(id=>typeof id!=='string'||!id.trim()||
    ['__proto__','prototype','constructor'].includes(id))||new Set(factors).size!==factors.length)throw Error(error);
 const keys=w=>{
  if(!record(w))throw Error(error);
  const names=Object.keys(w);
  if(!names.length||names.some(k=>!factors.includes(k)))throw Error(error);
  const values=names.map(k=>ownData(w,k,error));
  if(values.some(x=>!finite(x)||x<=0)||!finite(values.reduce((a,b)=>a+b,0)))throw Error(error);
  return names.sort();
 };
 // Keep existing partial-weight callback fixtures compatible, but require
 // both variants to have the same explicit supplied factor coverage.
 const baseKeys=keys(base),nextKeys=keys(next);
 if(baseKeys.length!==nextKeys.length||baseKeys.some((k,i)=>k!==nextKeys[i]))throw Error(error);
 const rows=snapshot(denseRows(days,'因子研究日期证据无效'),error);
 assertChronology(rows);
 return {rows,ids:Object.freeze(factors),base:snapshot(base,error),next:snapshot(next,error)};
}
// Capture each receipt before invoking the other scorer: a scorer may reuse
// one object, but cannot thereby rewrite the previous variant's result.
function scoreReceipt(scorer,day,ids,weights,error){
 const r=scorer(Object.freeze([day]),ids,weights);
 if(!record(r))throw Error(error);
 const days=ownData(r,'days',error),meanIC=ownData(r,'meanIC',error);
 return {days,meanIC};
}
function assertPair(a,b,coverageError,icError){
 if(a.days!==b.days)throw Error(coverageError);
 for(const r of [a,b])if(![0,1].includes(r.days)||(r.days===0?r.meanIC!==null:!finite(r.meanIC)||Math.abs(r.meanIC)>1))
  throw Error(icError);
}
function assessFactorReliability(daily){
 if(!Array.isArray(daily)||daily.length>400)
  throw Error('单因子每日IC证据协议无效');
 const error='单因子IC范围或证据无效';
 const rows=denseRows(daily,error).map(r=>{
  if(!record(r))throw Error(error);
  const ic=ownData(r,'ic',error);
  if(!finite(ic)||ic< -1||ic>1)throw Error(error);
  const day=ownData(r,'day','因子研究日期证据无效');
  const regime=Object.hasOwn(r,'regime')?ownData(r,'regime',error):undefined;
  return {day,ic,regime};
 });
 assertChronology(rows);
 const ics=rows.map(r=>r.ic),n=ics.length;
 const overall=mean(ics),mid=Math.floor(n/2);
 const early=mean(ics.slice(0,mid)),recent=mean(ics.slice(mid));
 const direction=Math.sign(overall||0);
 const agreed=n?ics.filter(x=>x*direction>0).length/n:0;
 const med=median(ics);
 // Adjacent five-session outcomes can share the same future-price window.
 // Evaluate non-overlapping COMPLETE horizon blocks rather than treating
 // every correlated daily IC as independent confirmation. Partial trailing
 // blocks remain in ordinary daily statistics but cannot certify persistence.
 const blockMeans=[];
 for(let i=0;i+HORIZON_BLOCK_DAYS<=n;i+=HORIZON_BLOCK_DAYS)
  blockMeans.push(mean(ics.slice(i,i+HORIZON_BLOCK_DAYS)));
 const latestBlockMean=blockMeans.length?blockMeans.at(-1):null;
 // The last complete block anchored to the oldest observation can be stale
 // by four observations. Keep its count, but inspect a trailing full window
 // as a separate diagnostic rather than double counting it as another block.
 const latestRollingMean=n>=HORIZON_BLOCK_DAYS?mean(ics.slice(-HORIZON_BLOCK_DAYS)):null;
 const incompleteTail=ics.slice(n-n%HORIZON_BLOCK_DAYS);
 const blockAgreement=blockMeans.length?
  blockMeans.filter(x=>x*direction>0).length/blockMeans.length:0;
 // A single exceptional day must not supply the whole training signal.
 // Removing the strongest absolute IC is an influence check, not a new
 // optimization objective or a replacement for future holdout testing.
 const biggest=ics.reduce((best,x,i)=>Math.abs(x)>Math.abs(ics[best])?i:best,0);
 const outlierRemovedMean=n>1?mean(ics.filter((_,i)=>i!==biggest)):null;
 // The largest absolute outlier can oppose the signal, making its removal
 // artificially strengthen IC. Also remove the strongest SUPPORTING day.
 const support=ics.reduce((best,x,i)=>x*direction>ics[best]*direction?i:best,0);
 const supportRemovedMean=n>1?mean(ics.filter((_,i)=>i!==support)):null;
 // The decision must use raw means. Rounded regime summaries are display-only:
 // e.g. 0.07996 prints as 0.0800 but has NOT crossed the 0.08 gate.
 const rawRegimes=Object.fromEntries(REGIMES.map(key=>{
  const xs=rows.filter(r=>r.regime===key).map(r=>r.ic);
  return [key,{days:xs.length,meanIC:mean(xs)}];
 }));
 const byRegime=Object.fromEntries(REGIMES.map(key=>[key,{
  days:rawRegimes[key].days,meanIC:round(rawRegimes[key].meanIC)
 }]));
 const a=rawRegimes[REGIMES[0]],b=rawRegimes[REGIMES[1]];
 const contradictory=a.days>=MIN_REGIME_DAYS&&b.days>=MIN_REGIME_DAYS&&
  Math.abs(a.meanIC)>=.08&&Math.abs(b.meanIC)>=.08&&a.meanIC*b.meanIC<0;
 // A regime-specific reversal can hide inside positive aggregate IC.
 // Split the same regime's chronological observations, preserving the
 // existing minimum of eight and 0.08 signal threshold on BOTH halves.
 const regimeStability=Object.fromEntries(REGIMES.map(key=>{
  const observed=rows.filter(r=>r.regime===key),half=Math.floor(observed.length/2);
  const first=observed.slice(0,half),last=observed.slice(half);
  const firstMean=mean(first.map(x=>x.ic)),lastMean=mean(last.map(x=>x.ic));
  const comparable=first.length>=MIN_REGIME_DAYS&&last.length>=MIN_REGIME_DAYS;
  const reversal=comparable&&Math.abs(firstMean)>=.08&&Math.abs(lastMean)>=.08&&firstMean*lastMean<0;
  return [key,{earlyDays:first.length,recentDays:last.length,earlyMeanIC:round(firstMean),
   recentMeanIC:round(lastMean),comparable,reversal,firstObservationDay:observed[0]?.day??null,
   lastObservationDay:observed.at(-1)?.day??null}];
 }));
 const regimeReversals=REGIMES.filter(key=>regimeStability[key].reversal);
 const reasons=[];
 if(n<MIN_DAYS)reasons.push('insufficient-independent-days');
 if(n>=MIN_DAYS&&Math.abs(overall)<.03)reasons.push('weak-average-information');
 if(n>=MIN_DAYS&&agreed<.6)reasons.push('unstable-daily-sign');
 if(n>=MIN_DAYS&&(!finite(early)||!finite(recent)||
   early*recent<=0||recent*direction<.05))
  reasons.push('recent-factor-decay-or-sign-reversal');
 if(n>=MIN_DAYS&&blockAgreement<MIN_BLOCK_DIRECTION_FRACTION)
  reasons.push('unstable-five-session-block-direction');
 if(n>=MIN_DAYS&&(!finite(latestBlockMean)||
    latestBlockMean*direction<=0))
  reasons.push('latest-five-session-block-reversal');
 if(n>=MIN_DAYS&&(!finite(latestRollingMean)||latestRollingMean*direction<=0))
  reasons.push('latest-five-observation-rolling-reversal');
 if(n>=MIN_DAYS&&(!finite(outlierRemovedMean)||
    outlierRemovedMean*direction<MIN_ROBUST_IC||
    !finite(supportRemovedMean)||supportRemovedMean*direction<MIN_ROBUST_IC))
  reasons.push('single-day-influence-dominates');
 if(contradictory)reasons.push('opposing-market-regime-effects');
 if(regimeReversals.length)reasons.push('within-market-regime-sign-reversal');
 const reliable=reasons.length===0;
 // Shrink toward zero when the number of observed days, directional
 // consistency or recent performance are weak. Never increase a factor
 // just because one extreme observation swamps the mean.
 const confidence=reliable?
  clamp(n/30,0,1)*clamp(agreed/.85,0,1)*
  clamp(Math.abs(recent)/Math.max(Math.abs(overall),.01),0,1)*
  clamp(blockAgreement,0,1)*
  clamp(Math.min(Math.abs(outlierRemovedMean),Math.abs(supportRemovedMean))/Math.max(Math.abs(overall),.01),0,1):0;
 const multiplier=reliable?clamp(overall*.2*confidence,-.08,.08):0;
 return {
  days:n,meanIC:round(overall),medianIC:round(med),
  earlyMeanIC:round(early),recentMeanIC:round(recent),
  directionConsistencyPct:round(agreed*100,2),
  fiveSessionBlockDays:HORIZON_BLOCK_DAYS,
  completeBlockCount:blockMeans.length,
  blockDirectionConsistencyPct:round(blockAgreement*100,2),
  latestBlockMeanIC:round(latestBlockMean),
  latestRollingFiveMeanIC:round(latestRollingMean),
  incompleteTailDays:incompleteTail.length,
  incompleteTailMeanIC:round(mean(incompleteTail)),
  observationBlocksProveIndependence:false,
  outlierRemovedMeanIC:round(outlierRemovedMean),
  supportRemovedMeanIC:round(supportRemovedMean),
  assessedRegimes:byRegime,regimeStability,regimeReversals,
  regimeCoverageDays:rows.filter(r=>REGIMES.includes(r.regime)).length,
  opposingRegimeEffects:contradictory,
  confidence:round(confidence,6),reliable,
  reasons,suggestedWeightMultiplier:round(multiplier,8),
  canTrade:false,productionWeightsChanged:false
 };
}
function pairedStability(days,ids,baseline,proposed,dailyScore){
 if(!Array.isArray(days)||days.length<5)throw Error('样本外稳定性比较缺少足够交易日');
 if(typeof dailyScore!=='function')throw Error('样本外IC评估器无效');
 const input=comparisonInput(days,ids,baseline,proposed);
 const deltas=[];
 for(const d of input.rows){
  const old=scoreReceipt(dailyScore,d,input.ids,input.base,'样本外IC证据无效');
  const next=scoreReceipt(dailyScore,d,input.ids,input.next,'样本外IC证据无效');
  assertPair(old,next,'新旧研究版本样本覆盖不一致','样本外IC证据无效');
  if(old.days===1){
   deltas.push({date:d.day,delta:next.meanIC-old.meanIC});
  }
 }
 const coverage={requestedDays:input.rows.length,comparableDays:deltas.length,
  missingDays:input.rows.length-deltas.length,coverageComplete:deltas.length===input.rows.length};
 if(deltas.length<5)return {...coverage,
  earlyDeltaIC:null,recentDeltaIC:null,positiveDayFractionPct:null,
  halfPeriodsConsistent:false};
 const split=Math.floor(deltas.length/2);
 const first=mean(deltas.slice(0,split).map(x=>x.delta));
 const second=mean(deltas.slice(split).map(x=>x.delta));
 const plus=deltas.filter(x=>x.delta>0).length/deltas.length;
 return {...coverage,earlyDeltaIC:round(first,7),
  recentDeltaIC:round(second,7),positiveDayFractionPct:round(plus*100,2),
  halfPeriodsConsistent:coverage.coverageComplete&&first>=-0.001&&second>=-0.001&&mean(deltas.map(x=>x.delta))>.002};
}
/**
 * Audit an already-accepted shadow version on later, unseen matured days.
 * Evaluate at most the newest ten observations so stale historic success cannot
 * dilute a sustained recent decline. This is a shadow diagnostic, not a
 * production rollback or proof of live profitability.
 */
function assessShadowDecay(days,ids,baseWeights,acceptedWeights,dailyScore){
 if(!Array.isArray(days)||typeof dailyScore!=='function'||
    !Array.isArray(ids)||ids.length<2)
  throw Error('沙盒效果衰减的样本或因子协议无效');
 const input=comparisonInput(days,ids,baseWeights,acceptedWeights);
 const window=input.rows.slice(-10),pairs=[];
 for(const d of window){
  const base=scoreReceipt(dailyScore,d,input.ids,input.base,'效果衰减IC证据无效');
  const accepted=scoreReceipt(dailyScore,d,input.ids,input.next,'效果衰减IC证据无效');
  assertPair(base,accepted,'效果衰减基准与沙盒样本覆盖不一致','效果衰减IC证据无效');
  if(base.days===1){
   pairs.push({date:d.day,baseIC:base.meanIC,shadowIC:accepted.meanIC,
    delta:accepted.meanIC-base.meanIC});
  }
 }
 const base={status:'insufficient-fresh-evidence',assessedDays:pairs.length,
  windowDays:window.length,missingDays:window.length-pairs.length,
  coverageComplete:pairs.length===window.length,
  baselineMeanIC:null,shadowMeanIC:null,
  deltaIC:null,negativeDeltaPct:null,firstHalfDeltaIC:null,
  recentHalfDeltaIC:null,alert:false,rollbackReviewSuggested:false,
  canTrade:false,productionWeightsChanged:false};
 if(pairs.length<5)return base;
 const mid=Math.floor(pairs.length/2);
 const delta=pairs.map(x=>x.delta);
 const baselineMeanIC=mean(pairs.map(x=>x.baseIC));
 const shadowMeanIC=mean(pairs.map(x=>x.shadowIC));
 const overall=mean(delta),first=mean(delta.slice(0,mid)),
  recent=mean(delta.slice(mid));
 const negativeFraction=delta.filter(x=>x<0).length/pairs.length;
 // Joint criteria intentionally protect against noise or both variants
 // deteriorating together. No automatic production or shadow rollback.
 const alert=shadowMeanIC<-.02&&overall<=-.02&&
  negativeFraction>=.8&&first<=-.01&&recent<=-.01;
 // A real deterioration alert may be raised from at least five valid pairs,
 // but absent pairs cannot be used to declare that no decay was detected.
 return {...base,status:alert?'decay-alert-unverified':!base.coverageComplete?'insufficient-fresh-evidence':'no-decay-detected',
  baselineMeanIC:round(baselineMeanIC,6),
  shadowMeanIC:round(shadowMeanIC,6),deltaIC:round(overall,6),
  negativeDeltaPct:round(negativeFraction*100,2),
  firstHalfDeltaIC:round(first,6),recentHalfDeltaIC:round(recent,6),
  alert,rollbackReviewSuggested:alert};
}
/**
 * A decay alert cannot be cleared on the same observations that triggered it.
 * Two COMPLETE, NEW five-session blocks must each show positive shadow IC,
 * no relative underperformance to the fixed original weights, and broad
 * directional consistency. Recovery is a research state, not an upgrade.
 */
function assessShadowRecovery(days,ids,baseWeights,acceptedWeights,dailyScore){
 if(!Array.isArray(days)||!Array.isArray(ids)||ids.length<2||
    typeof dailyScore!=='function')throw Error('恢复审核输入协议无效');
 const input=comparisonInput(days,ids,baseWeights,acceptedWeights);
 const recent=input.rows.slice(-10),paired=[];
 for(const d of recent){
  const original=scoreReceipt(dailyScore,d,input.ids,input.base,'恢复审核IC证据无效');
  const shadow=scoreReceipt(dailyScore,d,input.ids,input.next,'恢复审核IC证据无效');
  assertPair(original,shadow,'恢复审核基础与沙盒样本覆盖不一致','恢复审核IC证据无效');
  if(original.days===1){
   paired.push({date:d.day,baseline:original.meanIC,shadow:shadow.meanIC,
    delta:shadow.meanIC-original.meanIC});
  }
 }
 const base={status:'cooldown-insufficient-fresh-evidence',
  requiredDays:10,assessedDays:paired.length,windowDays:recent.length,
  missingDays:recent.length-paired.length,coverageComplete:recent.length===10&&paired.length===10,
  firstBlock:null,secondBlock:null,
  recovered:false,canTrade:false,productionWeightsChanged:false};
 if(paired.length<10)return base;
 function block(xs){
  const shadowMeanIC=mean(xs.map(x=>x.shadow));
  const deltaIC=mean(xs.map(x=>x.delta));
  const positiveFraction=xs.filter(x=>x.shadow>0).length/xs.length;
  return {days:xs.length,shadowMeanIC:round(shadowMeanIC,6),
   deltaIC:round(deltaIC,6),positiveDayPct:round(positiveFraction*100,2),
   passed:shadowMeanIC>=.03&&deltaIC>=0&&positiveFraction>=.6};
 }
 const firstBlock=block(paired.slice(0,5));
 const secondBlock=block(paired.slice(5));
 const recovered=firstBlock.passed&&secondBlock.passed;
 return {...base,status:recovered?'recovered-unverified':'cooldown-recovery-unconfirmed',
  firstBlock,secondBlock,recovered};
}
module.exports={assessFactorReliability,pairedStability,assessShadowDecay,assessShadowRecovery};
