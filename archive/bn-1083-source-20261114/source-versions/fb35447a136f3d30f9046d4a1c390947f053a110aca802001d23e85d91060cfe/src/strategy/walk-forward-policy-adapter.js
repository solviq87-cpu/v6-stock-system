'use strict';
// Explicit opt-in to the ledger execution model. The legacy scanner is retained;
// selecting dated fees never substitutes a different strategy's candidate rules.
function walkForwardWithPolicy(options){
 const {stocks,start=27,end=null,holdDays=1,initialCash=100000,maxAgeMs=86400000}=options;
 if(!Array.isArray(stocks)||!stocks.length||!Number.isInteger(start)||start<27||!Number.isInteger(holdDays)||holdDays<1)throw Error('非法回测参数');
 const n=Math.min(...stocks.map(s=>s.bars.length)),last=Math.min(end??n-2-holdDays,n-2-holdDays),stride=holdDays+1;
 if(last<start)return {trades:[],equity:[{day:start-1,value:initialCash}],metrics:{trades:0,returnPct:0},warnings:['历史长度不足']};
 const finalSignal=start+Math.floor((last-start)/stride)*stride;
 const {scanUniverse}=require('./universe-scanner');
 const selectCandidates=(input,day)=>!input.length||day>finalSignal||(day-start)%stride?[]:scanUniverse({stocks:input,now:input[0].feed.timestamp,maxAgeMs}).items.filter(x=>x.tradable).map(x=>x.symbol);
 const result=require('./position-ledger-backtest').ledgerBacktest({...options,start,end:finalSignal+stride,selectCandidates});
 return {...result,trades:result.trades.map(t=>({...t,signalDay:t.buyDay-1,netReturnPct:+(t.netPnl/t.costBasis*100).toFixed(4)})),skipped:result.orders.filter(o=>o.status==='blocked'||o.status==='risk-paused'),metrics:{...result.metrics,trades:result.trades.length},executionModel:'ledger-with-explicit-policy'};
}
module.exports={walkForwardWithPolicy};
