'use strict';

/**
 * 市场环境识别：把“什么时候适合趋势/突破/反转”统一成一个可解释输出。
 * 输入为已归一化的市场快照；缺失字段采用保守中性值。
 */
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));

function classifyMarket(snapshot={}) {
  const breadth=clamp(n(snapshot.breadthScore,50));
  const trend=clamp(n(snapshot.indexTrendScore,50));
  const volume=clamp(n(snapshot.marketVolumeScore,50));
  const risk=clamp(n(snapshot.riskScore,50));
  const volatility=clamp(n(snapshot.volatilityScore,50));
  const sentiment=clamp(n(snapshot.sentimentScore,50));

  const attack=0.28*breadth+0.28*trend+0.16*volume+0.16*sentiment-0.12*risk;
  const defensive=0.45*risk+0.30*volatility+0.25*(100-breadth);
  let regime='neutral';
  if (attack>=66 && defensive<48) regime='risk_on';
  else if (defensive>=60) regime='risk_off';
  else if (trend>=60 && breadth>=52) regime='trend';
  else if (volatility>=65 && trend<50) regime='mean_reversion';

  const weights={
    trend: regime==='risk_off'?0.65:regime==='risk_on'?1.2:1,
    breakout: regime==='risk_off'?0.45:regime==='risk_on'?1.3:1,
    momentum: regime==='risk_off'?0.55:regime==='risk_on'?1.2:1,
    reversal: regime==='mean_reversion'?1.3:regime==='trend'?0.75:1,
    quality: regime==='risk_on'?0.9:1.15,
    risk: regime==='risk_on'?0.9:1.35
  };
  return {
    regime,
    attackScore:+clamp(attack).toFixed(2),
    defensiveScore:+clamp(defensive).toFixed(2),
    weights,
    inputs:{breadth,trend,volume,risk,volatility,sentiment}
  };
}
module.exports={classifyMarket};
