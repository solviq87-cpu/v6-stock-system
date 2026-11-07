'use strict';
const assert=require('node:assert/strict');
const {ledgerBacktest}=require('../src/strategy/position-ledger-backtest');
const mk=(code)=>({symbol:code,market:'main',bars:Array.from({length:45},(_,i)=>{
 const c=+(10+i*.05).toFixed(3);return {open:c,high:c+.1,low:c-.1,close:c,volume:1000000};
})});
const a=mk('000001');const selectCandidates=()=>['000001'];let n=0;const check=x=>{assert.ok(x);n++};
let r=ledgerBacktest({stocks:[a],start:27,end:39,topN:1,holdDays:1,selectCandidates});
check(r.equity.length===13);check(r.equity.every(e=>e.value>0));check(r.orders.some(o=>o.side==='buy'&&o.status==='filled'));
check(r.trades.length>0);check(r.trades.every(t=>t.sellDay>t.buyDay));
check(r.equity.every(e=>e.cash>=0));check(r.metrics.finalEquity===r.equity.at(-1).value);
const b=mk('000002');
b.bars[29]={open:10.26,high:10.26,low:10.26,close:10.26,volume:1000000};
b.bars[30]={open:10.35,high:10.45,low:10.25,close:10.35,volume:1000000};
const r2=ledgerBacktest({stocks:[b],start:27,end:33,topN:1,holdDays:1,selectCandidates:()=>['000002']});
check(r2.orders.some(o=>o.side==='sell'&&o.status==='blocked'));
check(r2.equity.find(e=>e.day===29).openPositions===1);
check(r2.equity.every(e=>e.openPositions>=0));
const future=mk('000001');future.bars[44].close=999;
check(JSON.stringify(ledgerBacktest({stocks:[a],start:27,end:35,selectCandidates}).equity)===
 JSON.stringify(ledgerBacktest({stocks:[future],start:27,end:35,selectCandidates}).equity));
const expensive=ledgerBacktest({stocks:[a],start:27,end:39,feeBps:100,slippageBps:100,sellTaxBps:100,selectCandidates});
check(expensive.metrics.finalEquity<r.metrics.finalEquity);
check(r.assumptions.some(x=>x.includes('继续持仓')));
console.log('PASS '+n+' ledger assertions');
