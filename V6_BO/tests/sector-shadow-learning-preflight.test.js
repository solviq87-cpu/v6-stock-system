'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inspectSectorShadowEligibility:inspect}=require('../src/core/sector-shadow-learning-preflight');
const now=Date.parse('2026-11-10T10:30:00+08:00');
function sample(){
 const stocks=Array.from({length:15},(_,i)=>({code:String(600001+i),
  pctChange:i<5?3:i<10?0:-2,vendorQuoteAt:now-10000}));
 return {snapshot:{date:'2026-11-10',source:'eastmoney-clist-unverified-live',
  startedAt:new Date(now-60000).toISOString(),retrievedAt:new Date(now).toISOString(),
  universeSize:15,stocks},
 membership:{schemaVersion:1,source:'imported',provider:'baostock:query_stock_industry',
  classificationVersion:'baostock-csrc-2026-11-09-abc',tradeDate:'2026-11-10',
  observedAt:now-120000,sectors:[0,1,2].map((g)=>({
   category:'industry',code:'BS_'+g,name:'sector'+g,memberCount:5,
   members:stocks.slice(g*5,g*5+5).map(s=>s.code)}))}};
}
test('valid inputs only create a non-training shadow candidate',()=>{
 const x=sample(),copy=structuredClone(x),r=inspect(x.snapshot,x.membership);
 assert.equal(r.status,'shadow-input-preview-unverified');
 assert.equal(r.shadowSample.sectors.length,3);
 assert.equal(r.shadowSample.labelsAvailable,false);
 assert.equal(r.shadowSample.canTrain,false);
 assert.equal(r.canTrain,false);assert.equal(r.canTrade,false);
 assert.deepEqual(x,copy);
});
test('stale original quote evidence blocks preview',()=>{
 const x=sample();x.snapshot.stocks.slice(0,4).forEach(s=>s.vendorQuoteAt=now-900000);
 const r=inspect(x.snapshot,x.membership);
 assert.equal(r.status,'blocked');assert.equal(r.shadowSample,null);
 assert.match(r.reason,/quality-gate/);
});
test('incomplete industry membership blocks preview even with fresh prices',()=>{
 const x=sample();x.membership.sectors[0].members=[];
 const r=inspect(x.snapshot,x.membership);
 assert.equal(r.status,'blocked');assert.equal(r.shadowSample,null);
});
test('changed trade date or missing classification version blocks',()=>{
 const x=sample();x.membership.tradeDate='2026-11-09';
 assert.equal(inspect(x.snapshot,x.membership).status,'blocked');
 x.membership.tradeDate='2026-11-10';delete x.membership.classificationVersion;
 assert.equal(inspect(x.snapshot,x.membership).status,'blocked');
});
test('mixed source is never shadow training evidence',()=>{
 const x=sample();x.snapshot.stocks[0].source='other';
 const r=inspect(x.snapshot,x.membership);
 assert.equal(r.status,'blocked');assert.equal(r.canTrain,false);
});
