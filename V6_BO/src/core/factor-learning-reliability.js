'use strict';
/**
 * Independent research-only IC stability and market-regime reliability gate.
 * A big average is not evidence of durable usefulness when its sign flips.
 * No access to production strategy weights or order execution.
 */
const MIN_DAYS=15,MIN_REGIME_DAYS=8;
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
function assessFactorReliability(daily){
 if(!Array.isArray(daily)||daily.length>400)
  throw Error('单因子每日IC证据协议无效');
 const rows=daily.filter(r=>r&&finite(r.ic)&&r.ic>=-1&&r.ic<=1);
 if(rows.length!==daily.length)throw Error('单因子IC范围或证据无效');
 const ics=rows.map(r=>r.ic),n=ics.length;
 const overall=mean(ics),mid=Math.floor(n/2);
 const early=mean(ics.slice(0,mid)),recent=mean(ics.slice(mid));
 const direction=Math.sign(overall||0);
 const agreed=n?ics.filter(x=>x*direction>0).length/n:0;
 const med=median(ics);
 const byRegime=Object.fromEntries(REGIMES.map(key=>{
  const xs=rows.filter(r=>r.regime===key).map(r=>r.ic);
  return [key,{days:xs.length,meanIC:round(mean(xs))}];
 }));
 const a=byRegime[REGIMES[0]],b=byRegime[REGIMES[1]];
 const contradictory=a.days>=MIN_REGIME_DAYS&&b.days>=MIN_REGIME_DAYS&&
  Math.abs(a.meanIC)>=.08&&Math.abs(b.meanIC)>=.08&&a.meanIC*b.meanIC<0;
 const reasons=[];
 if(n<MIN_DAYS)reasons.push('insufficient-independent-days');
 if(n>=MIN_DAYS&&Math.abs(overall)<.03)reasons.push('weak-average-information');
 if(n>=MIN_DAYS&&agreed<.6)reasons.push('unstable-daily-sign');
 if(n>=MIN_DAYS&&(!finite(early)||!finite(recent)||
   early*recent<=0||recent*direction<.05))
  reasons.push('recent-factor-decay-or-sign-reversal');
 if(contradictory)reasons.push('opposing-market-regime-effects');
 const reliable=reasons.length===0;
 // Shrink toward zero when the number of observed days, directional
 // consistency or recent performance are weak. Never increase a factor
 // just because one extreme observation swamps the mean.
 const confidence=reliable?
  clamp(n/30,0,1)*clamp(agreed/.85,0,1)*
  clamp(Math.abs(recent)/Math.max(Math.abs(overall),.01),0,1):0;
 const multiplier=reliable?clamp(overall*.2*confidence,-.08,.08):0;
 return {
  days:n,meanIC:round(overall),medianIC:round(med),
  earlyMeanIC:round(early),recentMeanIC:round(recent),
  directionConsistencyPct:round(agreed*100,2),
  assessedRegimes:byRegime,
  regimeCoverageDays:rows.filter(r=>REGIMES.includes(r.regime)).length,
  opposingRegimeEffects:contradictory,
  confidence:round(confidence,6),reliable,
  reasons,suggestedWeightMultiplier:round(multiplier,8),
  canTrade:false,productionWeightsChanged:false
 };
}
function pairedStability(days,ids,baseline,proposed,dailyScore){
 if(!Array.isArray(days)||days.length<5)throw Error('样本外稳定性比较缺少足够交易日');
 const deltas=[];
 for(const d of days){
  const old=dailyScore([d],ids,baseline),next=dailyScore([d],ids,proposed);
  if(old.days!==next.days)throw Error('新旧研究版本样本覆盖不一致');
  if(old.days===1){
   if(!finite(old.meanIC)||!finite(next.meanIC))throw Error('样本外IC非有限值');
   deltas.push({date:d.day,delta:next.meanIC-old.meanIC});
  }
 }
 if(deltas.length<5)return {comparableDays:deltas.length,
  earlyDeltaIC:null,recentDeltaIC:null,positiveDayFractionPct:null,
  halfPeriodsConsistent:false};
 const split=Math.floor(deltas.length/2);
 const first=mean(deltas.slice(0,split).map(x=>x.delta));
 const second=mean(deltas.slice(split).map(x=>x.delta));
 const plus=deltas.filter(x=>x.delta>0).length/deltas.length;
 return {comparableDays:deltas.length,earlyDeltaIC:round(first,7),
  recentDeltaIC:round(second,7),positiveDayFractionPct:round(plus*100,2),
  halfPeriodsConsistent:first>=-0.001&&second>=-0.001&&mean(deltas.map(x=>x.delta))>.002};
}
module.exports={assessFactorReliability,pairedStability};
