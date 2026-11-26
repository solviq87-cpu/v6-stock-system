'use strict';
const {inspectStrategyScore}=require('./strategy-input-provenance');
const numeric=v=>(typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v));
const n=(v,d=0)=>numeric(v)?Number(v):d;
const flag=v=>v===true||v===1||typeof v==='string'&&/^(true|1)$/i.test(v.trim())?true:
 v===false||v===0||typeof v==='string'&&/^(false|0)$/i.test(v.trim())?false:null;
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));

function normalizeStock(raw={}) {
  raw=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  const own=k=>Object.prototype.hasOwnProperty.call(raw,k);
  const present=k=>own(k)&&raw[k]!=null&&!(typeof raw[k]==='string'&&raw[k].trim()==='');
  const pick=(...keys)=>{for(const k of keys)if(present(k))return raw[k];};
  const invalidScoreFields=[];
  const score=(field,fallback)=>{
    const observed=inspectStrategyScore(raw,field);
    if(observed.status==='raw_observed')return observed.value;
    if(observed.reason!=='missing'){invalidScoreFields.push(field);return field==='riskScore'?50:null;}
    return fallback;
  };
  // An explicit blocked or malformed flag must not be erased by a positive alias.
  const danger=(...keys)=>keys.filter(present).some(k=>flag(raw[k])!==false);
  const tradable=!present('tradable')||flag(raw.tradable)===true;
  const pct=n(pick('pctChange','changePct','涨幅','change'),0);
  const volumeRatio=n(pick('volumeRatio','量比'),1);
  const turnover=n(pick('turnoverRate','换手率'),0);
  const amount=n(pick('amount','成交额'),0);
  const trendScore=score('trendScore',50);
  const rsScore=score('relativeStrengthScore',50);
  const capitalScore=score('capitalScore',50);
  const positionScore=score('positionScore',50);
  const riskScore=score('riskScore',50);
  const volumeScore=score('volumeScore',clamp(volumeRatio*40));
  const momentumScore=score('momentumScore',clamp(50+pct*6));
  const closeStrengthScore=score('closeStrengthScore',clamp(50+pct*5));
  const turnoverQualityScore=score('turnoverQualityScore',turnover>=2&&turnover<=20?70:45);
  const breakoutScore=score('breakoutScore',[trendScore,rsScore,volumeScore].every(numeric)?(trendScore+rsScore+volumeScore)/3:null);
  const maAlignmentScore=score('maAlignmentScore',trendScore);
  const fundFlowScore=score('fundFlowScore',capitalScore);
  const liquidityScore=score('liquidityScore',amount>=5e7?80:amount>=1e7?60:30);
  const oversoldScore=score('oversoldScore',50);
  const reversalScore=score('reversalScore',50);
  return {
    ...raw, pctChange:pct, volumeRatio, turnoverRate:turnover, amount,
    trendScore, relativeStrength:rsScore, relativeStrengthScore:rsScore,
    capitalScore, positionScore, riskScore, volumeScore, momentumScore,
    closeStrengthScore, turnoverQualityScore, breakoutScore, maAlignmentScore,
    fundFlowScore, liquidityScore, oversoldScore, reversalScore,
    invalidScoreFields,
    isST: danger('isST','st'), suspended: danger('suspended','isSuspended'),
    tradable
  };
}
module.exports={normalizeStock};
