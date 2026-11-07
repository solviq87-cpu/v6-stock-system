'use strict';
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));

function normalizeStock(raw={}) {
  const pick=(...keys)=>{ for(const k of keys) if(raw[k]!==undefined&&raw[k]!==null&&raw[k]!=='') return raw[k]; };
  const pct=n(pick('pctChange','changePct','涨幅','change'),0);
  const volumeRatio=n(pick('volumeRatio','量比'),1);
  const turnover=n(pick('turnoverRate','换手率'),0);
  const amount=n(pick('amount','成交额'),0);
  const trendScore=clamp(n(pick('trendScore','趋势评分'),50));
  const rsScore=clamp(n(pick('relativeStrength','relativeStrengthScore','相对强度'),50));
  const capitalScore=clamp(n(pick('capitalScore','资金评分','moneyFlowScore'),50));
  const positionScore=clamp(n(pick('positionScore','位置评分'),50));
  // Missing risk evidence is not a verified zero-risk observation.
  // Preserve genuine 0; otherwise fall back to neutral risk (50).
  const riskInput=pick('riskScore','风险评分');
  const riskScore=clamp((typeof riskInput==='number'||
    (typeof riskInput==='string'&&riskInput.trim()!==''))?n(riskInput,50):50);
  const volumeScore=clamp(n(pick('volumeScore','量能评分'), Math.min(100, Math.max(0, volumeRatio*40))));
  const momentumScore=clamp(n(pick('momentumScore','动量评分'), 50+pct*6));
  const closeStrengthScore=clamp(n(pick('closeStrengthScore','收盘强度'), 50+pct*5));
  const turnoverQualityScore=clamp(n(pick('turnoverQualityScore','换手质量'), turnover>=2&&turnover<=20?70:45));
  const breakoutScore=clamp(n(pick('breakoutScore','突破评分'), (trendScore+rsScore+volumeScore)/3));
  const maAlignmentScore=clamp(n(pick('maAlignmentScore','均线评分'), trendScore));
  const fundFlowScore=clamp(n(pick('fundFlowScore','资金强度'), capitalScore));
  const liquidityScore=clamp(n(pick('liquidityScore','流动性评分'), amount>=5e7?80:amount>=1e7?60:30));
  const oversoldScore=clamp(n(pick('oversoldScore','超跌评分'),50));
  const reversalScore=clamp(n(pick('reversalScore','反转评分'),50));
  return {
    ...raw, pctChange:pct, volumeRatio, turnoverRate:turnover, amount,
    trendScore, relativeStrength:rsScore, relativeStrengthScore:rsScore,
    capitalScore, positionScore, riskScore, volumeScore, momentumScore,
    closeStrengthScore, turnoverQualityScore, breakoutScore, maAlignmentScore,
    fundFlowScore, liquidityScore, oversoldScore, reversalScore,
    isST: !!pick('isST','st'), suspended: !!pick('suspended','isSuspended'),
    tradable: pick('tradable')!==false
  };
}
module.exports={normalizeStock};
