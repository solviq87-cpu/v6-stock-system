'use strict';
const {scanUniverse}=require('./research-v2-universe-scanner');
const {ledgerBacktest}=require('./research-v2-position-ledger-backtest');
const {atLockedLimit,limitPct}=require('./historical-session');

function walkForward({stocks=[],start=27,end=null,topN=3,feeBps=8,slippageBps=10,initialCash=100000,
 maxAgeMs=86400000,source='imported',holdDays=1}={}){
 if(!Array.isArray(stocks)||!stocks.length)throw Error('回测需要历史股票数据');
 if(!Number.isInteger(holdDays)||holdDays<1||!Number.isInteger(start)||start<27||
    !Number.isInteger(topN)||topN<1||![feeBps,slippageBps].every(x=>Number.isFinite(x)&&x>=0&&x<10000)||
    !Number.isFinite(initialCash)||initialCash<=0||(end!==null&&!Number.isInteger(end)))throw Error('非法回测参数');
 const length=Math.min(...stocks.map(s=>Array.isArray(s.bars)?s.bars.length:0));
 const last=Math.min(end??length,length-2-holdDays);
 if(last<start)return {trades:[],skipped:[],equity:[{day:start-1,value:initialCash}],metrics:{trades:0,returnPct:0},warnings:['历史长度不足']};
 const stride=holdDays+1;
 const lastSignal=start+Math.floor((last-start)/stride)*stride;
 const scores=new Map();
 function selectCandidates(input,day){
  if(day>lastSignal||(day-start)%stride!==0)return [];
  const ranked=scanUniverse({stocks:input,now:input[0].feed.timestamp,maxAgeMs}).items.filter(x=>x.tradable);
  for(const item of ranked)scores.set(day+'/'+item.symbol,item.score);
  return ranked.map(item=>item.symbol);
 }
 const result=ledgerBacktest({stocks,start,end:lastSignal+stride,holdDays,topN,feeBps,slippageBps,
  initialCash,maxAgeMs,source,selectCandidates,sellTaxBps:0,lotSize:1});
 const trades=result.trades.map(t=>({...t,signalDay:t.buyDay-1,score:scores.get((t.buyDay-1)+'/'+t.symbol),
  netReturnPct:+((t.exit*(1-feeBps/10000)/(t.entry*(1+feeBps/10000))-1)*100).toFixed(4)}));
 return {...result,dataProvenance:{...result.dataProvenance,mode:'strategy-scanner'},trades,
  skipped:result.orders.filter(o=>o.status==='blocked').map(o=>({...o,signalDay:o.side==='buy'?o.day-1:undefined})),
  equity:[{day:start-1,value:initialCash},...result.equity.filter(e=>e.day>start&&(e.day-start)%stride===0)],
  dailyEquity:result.equity,metrics:{...result.metrics,trades:trades.length},
  assumptions:[...result.assumptions,'跟踪卖出受阻持仓以减少幸存者偏差；旧接口按周期展示净值，回撤按逐日净值计算。']};
}
module.exports={walkForward,atLockedLimit,limitPct};
