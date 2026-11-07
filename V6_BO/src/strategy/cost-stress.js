'use strict';
const {ledgerBacktest}=require('./research-v2-position-ledger-backtest');
const {scanUniverse}=require('./research-v2-universe-scanner');
const {playbooks}=require('../../strategies/research-playbooks.json');
function costStress(options){
 const {stocks,splitDay,source='imported',feeBps=8,sellTaxBps=5,slippageBps=10}=options;
 if(!Array.isArray(stocks)||!stocks.length||stocks.some(s=>!Array.isArray(s.bars))||
    !['imported','simulated'].includes(source))throw Error('需要导入或模拟的历史股票池');
 const strategyId=options.strategyId??null;
 if(strategyId!==null&&!playbooks.some(p=>p.id===strategyId))throw Error('未知研究策略');
 function selectCandidates(input){
  const ranked=scanUniverse({stocks:input,now:input[0].feed.timestamp});
  return ranked.items.filter(item=>item.tradable&&item.strategy.playbookAnalysis.playbooks.some(
   p=>p.id===strategyId&&p.status==='candidate')).map(item=>item.symbol);
 }
 const end=options.end??Math.min(...stocks.map(s=>s.bars.length))-1;
 if(!Number.isInteger(splitDay)||splitDay<27||!Number.isInteger(end)||end<splitDay+2||
    stocks.some(s=>s.bars.length<=end))throw Error('样本外区间无效');
 const tradingDates=options.tradingDates??stocks[0].bars.slice(0,end+1).map(b=>b?.date);
 if(options.priceBasis!==undefined&&options.priceBasis!=='unadjusted')throw Error('成交与限价需要未复权价格');
 for(const s of stocks)for(const b of s.bars.slice(0,end+1)){
  if(b?.priceBasis!==undefined&&b.priceBasis!=='unadjusted')throw Error('成交与限价需要未复权价格');
  if(b?.corporateAction)throw Error('区间含公司行为，需先对账现金或股数变动');
  if(!b||![b.open,b.low,b.high,b.close,b.volume].every(Number.isFinite)||b.low<=0||
     b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close)||b.volume<0)throw Error('历史OHLCV无效');
 }
 const scenarios=[];
 for(const [name,fee,slip] of [['baseline',feeBps,slippageBps],['doubleFee',feeBps*2,slippageBps],['doubleSlip',feeBps,slippageBps*2],['combined',feeBps*2,slippageBps*2]]){
  const r=ledgerBacktest({...options,start:splitDay,end,source,selectCandidates:strategyId?selectCandidates:null,tradingDates,strictMarks:true,feeBps:fee,slippageBps:slip,sellTaxBps});
  const pnl=r.trades.map(t=>t.netPnl);
  scenarios.push({name,feeBps:fee,slippageBps:slip,sellTaxBps,metrics:r.metrics,
   winners:pnl.filter(v=>v>0).length,losers:pnl.filter(v=>v<0).length,flat:pnl.filter(v=>v===0).length,
   realizedNetPnl:+pnl.reduce((a,b)=>a+b,0).toFixed(2),openPositions:r.openPositions.length,
   blockedSells:r.orders.filter(o=>o.side==='sell'&&o.status==='blocked').length,
   changeVsBasePctPoints:+(r.metrics.returnPct-(scenarios[0]?.metrics.returnPct??r.metrics.returnPct)).toFixed(4)});
 }
 return {source,strategyId,verifiedLive:false,autoTrade:false,startDate:tradingDates[splitDay],endDate:tradingDates[end],
  scenarios,method:'同一留出区间、策略与初始现金独立重放。收益含未平仓估值；胜率分母仅含平仓交易。'};
}
module.exports={costStress};
