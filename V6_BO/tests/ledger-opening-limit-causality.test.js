'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ledgerBacktest}=require('../src/strategy/position-ledger-backtest');

function fixture(){
 const bars=Array.from({length:43},(_,i)=>({
  date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),
  open:10,high:10.1,low:9.9,close:10,volume:1000000}));
 const stock={symbol:'000001',market:'main',bars};
 return {stock,options:{stocks:[stock],start:27,end:33,
  source:'simulated',selectCandidates:()=>['000001'],topN:1}};
}

test('opening limit-down remains nonfillable even if the price recovers intraday',()=>{
 const {stock,options}=fixture();
 // Day 28 has the opening buy, then the next opening sale must not
 // use day 29's *later* high/close to manufacture an opening fill.
 stock.bars[29]={...stock.bars[29],open:9,low:9,high:9.2,close:9.1};
 const r=ledgerBacktest(options);
 assert.ok(r.orders.some(o=>o.day===28&&o.side==='buy'&&o.status==='filled'));
 assert.ok(r.orders.some(o=>o.day===29&&o.side==='sell'&&o.status==='blocked'));
 assert.ok(!r.orders.some(o=>o.day===29&&o.side==='sell'&&o.status==='filled'));
 assert.equal(r.equity.find(x=>x.day===29).openPositions,1);
 assert.ok(r.equity.find(x=>x.day===29).value<100000);
 assert.ok(r.orders.some(o=>o.day===30&&o.side==='sell'&&o.status==='filled'));
});

test('opening limit-up cannot be bought merely because it reopens later',()=>{
 const {stock,options}=fixture();
 stock.bars[28]={...stock.bars[28],open:11,high:11.2,low:10.8,close:10.99};
 const r=ledgerBacktest({...options,end:30});
 assert.ok(r.orders.some(o=>o.day===28&&o.side==='buy'&&o.status==='blocked'));
 assert.ok(!r.orders.some(o=>o.day===28&&o.side==='buy'&&o.status==='filled'));
});

test('opening below limit still accepts an otherwise valid simulated order',()=>{
 const {options}=fixture();
 const r=ledgerBacktest({...options,end:30});
 assert.ok(r.orders.some(o=>o.day===28&&o.side==='buy'&&o.status==='filled'));
});
