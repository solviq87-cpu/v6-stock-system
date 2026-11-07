'use strict';
const {historicalStock,assertAligned}=require('./historical-session');
const {scanUniverse}=require('./research-v2-universe-scanner');

// targetDate must be a session explicitly present in the supplied calendar.
function preopenWatch({stocks,tradingDates,targetDate,source='imported'}){
 if(!['simulated','imported'].includes(source)||!Array.isArray(stocks)||!stocks.length||
    !Array.isArray(tradingDates))throw Error('需要历史股票池和交易日历');
 const day=tradingDates.indexOf(targetDate)-1;
 if(day<26||!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)||!Number.isFinite(Date.parse(targetDate))||
    new Date(targetDate).toISOString().slice(0,10)!==targetDate||targetDate<=tradingDates[day])
  throw Error('目标交易日无效或缺少27根已收盘日线');
 assertAligned(stocks,day,tradingDates);
 const asOf=tradingDates[day],now=Date.parse(asOf+'T15:00:00+08:00');
 const inputs=stocks.map(s=>historicalStock(s,day,source,now));
 const scanned=scanUniverse({stocks:inputs,now});
 const candidates=[];
 for(const item of scanned.items){
  if(!item.tradable||item.ladder?.stage!=='未涨停')continue;
  const signal=item.strategy.playbookAnalysis.playbooks.find(p=>p.id==='platform_breakout');
  if(signal?.status==='candidate')candidates.push({symbol:item.symbol,score:item.score,reason:signal.reason});
 }
 return {asOf,targetDate,source,autoTrade:false,universeSize:stocks.length,candidates,
  rule:'前收盘未封板、非断板观察，满足原平台突破放量条件并通过原研究风险筛选。仅产生下一交易日观察名单。'};
}
module.exports={preopenWatch};
