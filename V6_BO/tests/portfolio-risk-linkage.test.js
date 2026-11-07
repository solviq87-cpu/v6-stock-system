'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluatePreviousCloseRisk}=require('../src/core/portfolio-risk-gate');
const {ledgerBacktest}=require('../src/strategy/position-ledger-backtest');
const stocks=[{symbol:'000001',market:'main',bars:Array.from({length:45},(_,i)=>{const c=i>=29?8:10;return {open:c,high:c+0.1,low:c-0.1,close:c,volume:100000};})}];
test('shared gate reads previous close and independently reports drawdown and daily loss',()=>{
 const x=evaluatePreviousCloseRisk({priorEquity:900,priorPeak:1000,previousEquity:1000,maxDrawdownPausePct:5,maxDailyLossPausePct:5});
 assert.equal(x.paused,true);assert.equal(x.reasons.length,2);
 assert.equal(evaluatePreviousCloseRisk({priorEquity:1000,priorPeak:1000,previousEquity:1000,maxDrawdownPausePct:5}).paused,false);
});
test('ledger and paper share invalid-limit rejection',()=>{
 assert.throws(()=>ledgerBacktest({stocks,maxDrawdownPausePct:NaN}),/风控参数无效/);
 assert.throws(()=>ledgerBacktest({stocks,maxDailyLossPausePct:-1}),/风控参数无效/);
});
test('ledger risk pause uses prior close, never same-day price',()=>{
 const opts={stocks,start:27,end:38,topN:1,holdDays:20,selectCandidates:()=>['000001'],maxDrawdownPausePct:5};
 const r=ledgerBacktest(opts);
 assert.ok(r.orders.some(o=>o.status==='risk-paused'));
 assert.ok(r.metrics.riskPauseDays>0);
 const future=structuredClone(stocks);future[0].bars[44].close=10000;
 assert.deepEqual(r.orders,ledgerBacktest({...opts,stocks:future}).orders);
});
test('disabled gate preserves original ledger trading and equity',()=>{
 const base={stocks,start:27,end:38,topN:1,holdDays:20,selectCandidates:()=>['000001']};
 const a=ledgerBacktest(base),b=ledgerBacktest({...base,maxDrawdownPausePct:null,maxDailyLossPausePct:null});
 assert.deepEqual(a.orders,b.orders);assert.deepEqual(a.equity,b.equity);
});
