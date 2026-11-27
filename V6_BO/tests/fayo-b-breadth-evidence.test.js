'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {analyzeMarketBreadth}=require('../src/core/market-breadth');
const {classifyObservedMarket}=require('../src/core/observed-market-regime');
const snapshot={date:'2026-11-05',source:'fixture-only',universeSize:4,stocks:[
 {code:'000001',pctChange:2},{code:'000002',pctChange:1},{code:'000003',pctChange:-1},{code:'000004',pctChange:0}]};
const opts={asOf:'2026-11-05T12:00:00Z',scoreDate:snapshot.date,scoreSource:'fixture-index',
 scores:{indexTrendScore:65,marketVolumeScore:60,riskScore:20,volatilityScore:30,sentimentScore:70}};
const breadth=stocks=>analyzeMarketBreadth({...snapshot,stocks},opts);
const classify=stocks=>classifyObservedMarket({...snapshot,stocks},opts);
test('missing amount is null, not zero',()=>{
 const r=breadth(snapshot.stocks);assert.equal(r.observedAmount,null);assert.equal(r.amountObservedCount,0);
});
test('real zero amount remains zero with known-count evidence',()=>{
 const r=breadth(snapshot.stocks.map(s=>({...s,amount:0})));assert.equal(r.observedAmount,0);assert.equal(r.amountObservedCount,4);
});
test('partial amount coverage preserves valid values, rejects coercion and negative amount',()=>{
 const r=breadth(snapshot.stocks.map((s,i)=>({...s,amount:[0,25,'99',-1][i]})));
 assert.equal(r.observedAmount,25);assert.equal(r.amountObservedCount,2);assert.equal(r.amountCoverage,0.5);
});
test('amount coverage is measured against frozen market denominator, not observed-only count',()=>{
 const r=analyzeMarketBreadth({...snapshot,universeSize:5,stocks:snapshot.stocks.map(s=>({...s,amount:0}))},opts);
 assert.equal(r.usable,true);assert.equal(r.amountCoverage,0.8);assert.equal(r.observedAmount,0);
});
test('overflowing monetary aggregate is unavailable',()=>{
 const r=breadth(snapshot.stocks.map(s=>({...s,amount:Number.MAX_VALUE})));assert.equal(r.observedAmount,null);
});
test('missing limit flags are distinguishable from explicit false',()=>{
 const r=breadth(snapshot.stocks.map((s,i)=>({...s,limitUp:i===0?false:undefined,limitDown:i===1?true:undefined})));
 assert.equal(r.limitUp,0);assert.equal(r.limitUpKnownCount,1);assert.equal(r.limitDown,1);assert.equal(r.limitDownKnownCount,1);
});
test('legacy breadth remains descriptive but identical duplicates block regime',()=>{
 const rows=[...snapshot.stocks,snapshot.stocks[0]];const b=breadth(rows),r=classify(rows);
 assert.equal(b.usable,true);assert.equal(b.observed,4);assert.equal(b.duplicateCount,1);assert.equal(r.usable,false);assert.equal(r.regime,null);assert.equal(r.weights,null);
});
test('conflicting duplicate quotes are blocked in either input order',()=>{
 const conflict={...snapshot.stocks[0],pctChange:-9};
 for(const rows of [[...snapshot.stocks,conflict],[conflict,...snapshot.stocks]]){
  const r=classify(rows);assert.equal(r.usable,false);assert.match(r.reason,/重复/);assert.equal(r.weights,null);
 }
});
test('invalid or suspended duplicate cannot be hidden by row order',()=>{
 for(const conflict of [{code:'000001',pctChange:null},{code:'000001',pctChange:1,suspended:true}]){
  for(const rows of [[...snapshot.stocks,conflict],[conflict,...snapshot.stocks]])assert.equal(classify(rows).usable,false);
 }
});
test('clean legacy input preserves old classification and weights',()=>{
 const r=classify(snapshot.stocks);assert.equal(r.usable,true);assert.equal(r.breadth.duplicateCount,0);assert.equal(r.regime,'neutral');assert.equal(r.weights.trend,1);
});
