'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createFastStockMoves}=require('../src/core/fast-stock-moves');
const at=time=>Date.parse('2026-11-20T'+time+'+08:00');
const row=(quoteAt,price,overrides={})=>({code:'600519',name:'样本股',price,quoteAt,receivedAt:quoteAt+200,
 quoteSource:'tencent',quoteMode:'public-live-unverified',canTrade:true,...overrides});
const base=at('10:00:00');
const codes=['600519','000858'];

test('重点股在完整一分钟之前可显示涨速线索和真实覆盖',()=>{
 const observe=createFastStockMoves();
 const first=observe(codes,[row(base,100)],base+500);
 assert.equal(first.comparable,0);
 const result=observe(codes,[row(base+8000,101.2)],base+8500);
 assert.equal(result.count,1);
 assert.equal(result.requested,2);
 assert.equal(result.observed,1);
 assert.equal(result.items[0].spanMs,8000);
 assert.equal(result.items[0].baseAt,base);
 assert.equal(result.items[0].risePct,1.2);
 assert.equal(result.items[0].canTrade,false);
 assert.equal(result.items[0].canNotify,false);
});

test('来源、竞价阶段、缺行和过期改变时重新开始观察',()=>{
 const observe=createFastStockMoves();
 const run=(time,price,overrides)=>observe(codes,[row(time,price,overrides)],time+500);
 run(base,90);
 assert.equal(run(base+5000,91,{quoteSource:'eastmoney'}).comparable,0);
 observe(codes,[],base+10000);
 assert.equal(run(base+15000,99,{quoteSource:'eastmoney'}).comparable,0);
 assert.equal(observe(codes,[row(base+15000,99)],base+35000).observed,0);
 const auction=createFastStockMoves();
 const first=at('09:19:55'),next=at('09:20:00');
 auction(codes,[row(first,90)],first+500);
 assert.equal(auction(codes,[row(next,95)],next+500).comparable,0);
 assert.equal(auction(codes,[row(next+5000,96)],next+5500).count,1);
});

test('覆盖之外、冲突重复和超过一分钟的基准不会生成异动',()=>{
 const observe=createFastStockMoves();
 observe(codes,[row(base,100)],base+300);
 assert.equal(observe(codes,[row(base+61000,110)],base+61500).comparable,0);
 assert.equal(observe(codes,[row(base+70000,111),row(base+70000,112)],base+70500).observed,0);
 assert.equal(observe(codes,[row(base+75000,110,{code:'600000'})],base+75500).observed,0);
});
