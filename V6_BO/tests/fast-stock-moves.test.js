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

test('回落后再快涨可用窗口内低位作比较，并保留同源简称',()=>{
 const observe=createFastStockMoves();
 observe(codes,[row(base,100)],base+500);
 observe(codes,[row(base+5000,98)],base+5500);
 observe(codes,[row(base+8000,97,{name:''})],base+8500);
 const result=observe(codes,[row(base+10000,99.1,{name:'600519'})],base+10500);
 assert.equal(result.count,1);
 assert.equal(result.items[0].basePrice,98,'相距不足五秒的最低价不参比');
 assert.equal(result.items[0].spanMs,5000);
 assert.equal(result.items[0].risePct,1.122);
 assert.equal(result.items[0].name,'样本股');
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

test('近期异动留存三分钟并保留事件时点，采集诊断区分失败与有效覆盖',()=>{
 const observe=createFastStockMoves();
 observe(codes,[row(base,100)],base+500);
 const caught=observe(codes,[row(base+5000,102)],base+5500,{startedAt:base+5200});
 assert.deepEqual(caught.sources,[{source:'tencent',observed:1,medianAgeMs:500,p95AgeMs:500}]);
 assert.equal(caught.fetchMs,300);
 observe(codes,[row(base+5000,102)],base+6500); // same source time cannot extend the event
 const after=observe(codes,[],base+10500,{failed:true});
 assert.equal(after.items.length,0);
 assert.equal(after.recentItems[0].detectedAt,base+5500);
 assert.equal(after.recentItems[0].quoteAt,base+5000);
 assert.equal(after.sessionTotals[0].failedRounds,1);
 assert.equal(after.sessionTotals[0].requested,8);
 assert.equal(after.sessionTotals[0].observed,3);
 assert.equal(observe(codes,[],base+185500).recentItems.length,0);
 const afternoon=observe(codes,[],at('13:00:05'));
 assert.deepEqual(afternoon.sessionTotals.map(row=>row.phase),['morning','afternoon']);
 const nextOpen=Date.parse('2026-11-23T09:15:05+08:00');
 assert.deepEqual(observe(codes,[],nextOpen).sessionTotals.map(row=>row.phase),['auction-revocable']);
});

test('同源更正异动终点或比较基准时撤销旧线索并重建观察窗口',()=>{
 for(const correctedAt of [base,base+5000]){
  const observe=createFastStockMoves();
  observe(codes,[row(base,100)],base+500);
  assert.equal(observe(codes,[row(base+5000,102)],base+5500).count,1);
  const corrected=observe(codes,[row(correctedAt,101)],base+6500);
  assert.equal(corrected.count,0);
  assert.equal(corrected.recentItems.length,0);
  assert.equal(corrected.comparable,0);
  assert.equal(observe(codes,[row(base+12000,103)],base+12500).count,1);
 }
});

test('同源明确冲突和重复批次中的更正不能留下被推翻的异动',()=>{
 for(const rows of [[row(base+5000,102,{sourceConflict:true})],
                    [row(base+5000,102),row(base+5000,101)]]){
  const observe=createFastStockMoves();
  observe(codes,[row(base,100)],base+500);
  assert.equal(observe(codes,[row(base+5000,102)],base+5500).count,1);
  const result=observe(codes,rows,base+6500);
  assert.equal(result.observed,0);
  assert.equal(result.recentItems.length,0);
  assert.equal(observe(codes,[row(base+12000,104)],base+12500).comparable,0);
 }
});

test('独立来源变化和普通失败不撤销有效的历史线索',()=>{
 const observe=createFastStockMoves();
 observe(codes,[row(base,100)],base+500);
 observe(codes,[row(base+5000,102)],base+5500);
 const switched=observe(codes,[row(base+5000,101,{quoteSource:'eastmoney'})],base+6500);
 assert.equal(switched.recentItems[0].price,102);
 assert.equal(observe(codes,[],base+8500,{failed:true}).recentItems[0].detectedAt,base+5500);
});

test('本地时钟回拨不展示未来异动或继承未来比较和计数',()=>{
 const observe=createFastStockMoves();
 observe(codes,[row(base,100)],base+500);
 assert.equal(observe(codes,[row(base+5000,102)],base+5500).count,1);
 const result=observe(codes,[row(base,100)],base+700);
 assert.equal(result.count,0);
 assert.equal(result.recentItems.length,0);
 assert.equal(result.comparable,0);
 assert.equal(result.sessionTotals[0].rounds,1);
 const resumed=observe(codes,[row(base+5000,101.2)],base+5700);
 assert.equal(resumed.count,1);
 assert.equal(resumed.items[0].baseAt,base);
});

test('缺少来源的行不能形成异动，也不撤销已留存的同源线索',()=>{
 const observe=createFastStockMoves();
 assert.equal(observe(codes,[row(base,100,{quoteSource:undefined})],base+500).observed,0);
 observe(codes,[row(base,100)],base+1000);
 assert.equal(observe(codes,[row(base+5000,102)],base+5500).count,1);
 const result=observe(codes,[row(base+5000,99,{quoteSource:undefined})],base+6500);
 assert.equal(result.observed,0);
 assert.equal(result.recentItems[0].price,102);
});
