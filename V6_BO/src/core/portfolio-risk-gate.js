'use strict';
/** Shared previous-close risk policy for research backtests and offline paper accounts. */
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function validateRiskLimits(config){
 for(const key of ['maxDrawdownPausePct','maxDailyLossPausePct']){
  const value=config[key];
  if(value!==null&&value!==undefined&&(!finite(value)||value<=0||value>100))throw Error(key+' 风控参数无效');
 }
}
function evaluatePreviousCloseRisk({priorEquity,priorPeak,previousEquity,maxDrawdownPausePct=null,maxDailyLossPausePct=null}){
 validateRiskLimits({maxDrawdownPausePct,maxDailyLossPausePct});
 if(![priorEquity,priorPeak,previousEquity].every(finite)||priorEquity<0||priorPeak<=0||previousEquity<=0)throw Error('前日净值风控输入无效');
 const drawdownPct=Math.max(0,(priorPeak-priorEquity)/priorPeak*100);
 const dailyLossPct=Math.max(0,(previousEquity-priorEquity)/previousEquity*100);
 const reasons=[];
 if(maxDrawdownPausePct!==null&&maxDrawdownPausePct!==undefined&&drawdownPct>=maxDrawdownPausePct)reasons.push('前日收盘回撤超限');
 if(maxDailyLossPausePct!==null&&maxDailyLossPausePct!==undefined&&dailyLossPct>=maxDailyLossPausePct)reasons.push('前日收盘单日亏损超限');
 return {paused:reasons.length>0,reasons,drawdownPct,dailyLossPct};
}
module.exports={validateRiskLimits,evaluatePreviousCloseRisk};
