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
 // Peak covers both earlier closing values. Some existing research paths
 // retain an unrounded peak while publishing a 2- or 4-decimal close.
 // Accept only those exact rounding representations, never a materially
 // contradictory peak, and do not understate drawdown in the rounded case.
 const compatible=value=>value<=priorPeak||value===Math.round(priorPeak*100)/100||
  value===Number(priorPeak.toFixed(2))||value===Math.round((priorPeak+Number.EPSILON)*1e4)/1e4;
 if(!compatible(priorEquity)||!compatible(previousEquity))throw Error('前日净值风控输入无效：历史峰值低于已知收盘净值');
 const peak=Math.max(priorPeak,priorEquity,previousEquity);
 const drawdownPct=Math.max(0,(peak-priorEquity)/peak*100);
 const dailyLossPct=Math.max(0,(previousEquity-priorEquity)/previousEquity*100);
 const reasons=[];
 if(maxDrawdownPausePct!==null&&maxDrawdownPausePct!==undefined&&drawdownPct>=maxDrawdownPausePct)reasons.push('前日收盘回撤超限');
 if(maxDailyLossPausePct!==null&&maxDailyLossPausePct!==undefined&&dailyLossPct>=maxDailyLossPausePct)reasons.push('前日收盘单日亏损超限');
 return {paused:reasons.length>0,reasons,drawdownPct,dailyLossPct};
}
module.exports={validateRiskLimits,evaluatePreviousCloseRisk};
