'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {analyzeMarketBreadth}=require('../src/core/market-breadth');
const base={date:'2026-11-05',source:'test-observed-feed',universeSize:5,stocks:[
 {code:'000001',pctChange:2,amount:100,limitUp:true},
 {code:'000002',pctChange:-1,amount:200},
 {code:'000003',pctChange:0,amount:300},
 {code:'000004',pctChange:1,amount:400},
 {code:'000005',pctChange:-2,amount:500,limitDown:true}]};
const opts={asOf:'2026-11-05T12:00:00Z'};
test('counts observed market breadth without fabricated values',()=>{
 const r=analyzeMarketBreadth(base,opts);assert.equal(r.usable,true);assert.equal(r.breadthScore,40);assert.equal(r.up,2);assert.equal(r.down,2);assert.equal(r.flat,1);assert.equal(r.limitUp,1);assert.equal(r.observedAmount,1500);
});
test('rejects low coverage instead of reporting misleading market regime',()=>{
 const r=analyzeMarketBreadth({...base,universeSize:10},opts);assert.equal(r.usable,false);assert.match(r.reason,/覆盖率/);
});
test('does not double count duplicates or suspended quotes',()=>{
 const r=analyzeMarketBreadth({...base,stocks:[...base.stocks,{code:'000001',pctChange:99},{code:'000006',pctChange:3,suspended:true}]},opts);
 assert.equal(r.usable,true);assert.equal(r.invalid,2);assert.equal(r.observed,5);
});
test('rejects future snapshot and missing provenance',()=>{
 assert.equal(analyzeMarketBreadth({...base,date:'2026-11-06'},opts).usable,false);
 assert.equal(analyzeMarketBreadth({...base,source:''},opts).usable,false);
});
test('never guesses daily price limits from percent change alone',()=>{
 const r=analyzeMarketBreadth({...base,stocks:base.stocks.map(s=>({...s,limitUp:undefined,limitDown:undefined}))},opts);
 assert.equal(r.limitUp,0);assert.equal(r.limitDown,0);
});
