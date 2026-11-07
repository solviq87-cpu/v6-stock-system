'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {quoteObservationView:view}=require('../src/core/quote-observation-view');
const {dashboardView}=require('../src/core/dashboard-view');
const {riskEvidenceView}=require('../src/core/risk-evidence-view');
const now=Date.parse('2026-11-06T02:00:00Z');
const row={code:'600519',price:10,quoteAt:now-1000,quoteSource:'tencent'};
test('display reports provider time with strict 15-second bounds and never grants trade certification',()=>{
 for(const [at,status] of [[now,'recent-unverified'],[now-15000,'recent-unverified'],[now-15001,'stale'],[now+1,'future']]){
  const r=view({...row,quoteAt:at},now);assert.equal(r.quoteAt,at);assert.equal(r.quoteStatus,status);assert.equal(r.canTrade,false);assert.equal(r.verifiedLive,false);
 }
});
test('missing or malformed original evidence stays unknown despite recent receive times',()=>{
 for(const patch of [{quoteAt:undefined},{quoteAt:0},{quoteAt:now-.5},{quoteAt:String(now)},{quoteSource:' '},{quoteSource:{}},{price:Infinity},{price:0}]){
  assert.equal(view({...row,receivedAt:now,...patch},now).quoteStatus,'unknown');
 }
 assert.throws(()=>view(row,NaN),/时钟/);
});
test('candidate snapshot never borrows timestamp or source from a different full-A or cached price',()=>{
 const state={stocksAt:now,stocks:[row],lastPx:new Map([['600519',{p:10,quoteAt:now,quoteSource:'tencent'}]]),candidatePool:[{code:'600519',price:8,score:90}]};
 const before=structuredClone(state),d=dashboardView(state,null,now);
 assert.equal(d.rows[0].price,8);assert.equal(d.rows[0].quoteAt,null);assert.equal(d.rows[0].quoteStatus,'unknown');assert.equal(d.rows[0].score,90);assert.deepEqual(state,before);
});
test('fresh list receipt does not mask unknown, old or future per-stock observations in risk view',()=>{
 const stocks=[row,{...row,code:'000001',quoteAt:now-16000},{...row,code:'000002',quoteAt:now+1},{code:'000003',price:1},null,{code:'bad',price:1}];
 const r=riskEvidenceView({stocks,stocksAt:now},now);
 assert.deepEqual(r.marketQuotes,{total:4,recent:1,stale:1,future:1,unknown:1,verifiedLive:false});
 assert.equal(r.marketReceivedAt,now);assert.ok(r.reasons.some(x=>x.includes('逐票原时点')));assert.equal(r.canTrade,false);
});
test('snapshot regeneration expires original rows without changing their price or strategy ordering',()=>{
 const state={stocksAt:now,stocks:[row],candidatePool:[row,{...row,code:'000001',price:9}]};
 const a=dashboardView(state,null,now),b=dashboardView(state,null,now+15001);
 assert.equal(a.rows[0].quoteStatus,'recent-unverified');assert.equal(b.rows[0].quoteStatus,'stale');assert.equal(b.riskEvidence.marketQuotes.recent,0);
 assert.deepEqual(b.rows.map(r=>[r.code,r.price]),[['600519',10],['000001',9]]);
});
