'use strict';
// Daily observations, zero risk-free rate; these are descriptive research statistics.
function performanceStatistics(equity,{initialCash,trades=[],periodsPerYear=252}={}){
  if(!Number.isFinite(initialCash)||initialCash<=0||!Array.isArray(equity)||!equity.length||!Number.isSafeInteger(periodsPerYear)||periodsPerYear<1)throw Error('绩效输入无效');
  const values=Array.from(equity,e=>e?.value??e?.equity);
  if(values.some(v=>!Number.isFinite(v)||v<0))throw Error('净值无效');
  let prev=initialCash,peak=initialCash,drawdown=0;const returns=[];
  for(const v of values){if(prev<=0)throw Error('净值归零后不能继续计算收益率');returns.push(v/prev-1);peak=Math.max(peak,v);drawdown=Math.max(drawdown,1-v/peak);prev=v;}
  const n=returns.length,mean=returns.reduce((s,v)=>s+v,0)/n;
  const variance=n>1?returns.reduce((s,v)=>s+(v-mean)**2,0)/(n-1):null;
  const sd=variance===null?null:Math.sqrt(variance);
  if(!Array.isArray(trades))throw Error('平仓绩效证据必须为数组');
  const pnl=Array.from(trades,t=>t?.netPnl);
  // Missing P&L cannot vanish from the win-rate denominator.
  if(pnl.some(p=>!Number.isFinite(p)))throw Error('平仓绩效缺少有效净盈亏证据');
  const wins=pnl.filter(p=>p>0).length,m=pnl.length;
  const z=1.959963984540054,phat=m?wins/m:0,den=1+z*z/(m||1);
  const center=m?(phat+z*z/(2*m))/den:null;
  const half=m?z*Math.sqrt(phat*(1-phat)/m+z*z/(4*m*m))/den:null;
  const total=values.at(-1)/initialCash;
  const annual=n>=periodsPerYear?Math.pow(total,periodsPerYear/n)-1:null;
  const result={observations:n,returnPct:(total-1)*100,maxDrawdownPct:drawdown*100,
    annualizedReturnPct:annual===null?null:annual*100,annualizedVolatilityPct:sd===null?null:sd*Math.sqrt(periodsPerYear)*100,
    sharpe:sd>0?mean/sd*Math.sqrt(periodsPerYear):null,closedTrades:m,winRatePct:m?phat*100:null,
    winRate95Pct:m?[(center-half)*100,(center+half)*100]:null,
    assumptions:['收益为每日净值变化，年化交易日数可配置，默认252','夏普无风险收益率设为0；胜率区间使用Wilson方法','短于一年不报告年化收益；统计区间不证明策略有效性']};
  // Reject non-representable arithmetic instead of serializing Infinity/NaN as null.
  if(returns.some(r=>!Number.isFinite(r))||!Number.isFinite(mean)||
    (variance!==null&&!Number.isFinite(variance))||
    Object.values(result).some(v=>typeof v==='number'&&!Number.isFinite(v)))throw Error('绩效数值超出可计算范围');
  return result;
}
module.exports={performanceStatistics};
