'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildDepthResearch}=require('../src/core/deep-research-evidence');
const {createFillEvidence,validateFillEvidence,fillEvidenceOf}=require('../src/core/paper-fill-evidence');
const now=Date.parse('2026-11-04T10:00:00+08:00'),symbol='600000',tradeDate='2026-11-04';
function book(source='supplied-provider'){
 return {id:'book-1',source,evidenceId:'operator-evidence',revision:1,publishedAt:now,firstKnownAt:now,recordedAt:now,
  symbol,granularity:'depth-snapshot',quoteAt:now,receivedAt:now,price:10,volumeUnit:'shares',
  bids:[{price:9.9,quantity:200},{price:9.8,quantity:100}],asks:[{price:10.1,quantity:100},{price:10.2,quantity:100}],
  authorization:{provider:source,status:'granted',scope:['depth-snapshot'],evidenceId:'authorization-document',knownAt:now-86400000,validFrom:now-86400000,validUntil:now+86400000}};
}
const depth=(row,asOf=now)=>buildDepthResearch({depth:[row]},{asOf});
test('D67 registered macro/reference/announcement routes cannot impersonate authorized depth',()=>{
 for(const source of ['worldbank','ecb','cninfo','sse-calendar']){
  const r=depth(book(source));assert.equal(r.rows[0].status,'authorization-unavailable',source);assert.equal(r.rows[0].metrics,null);assert.equal(r.riskObservations.length,0);
 }
});
test('D67 expiration at query time suppresses current risk without relabeling original receipt',()=>{
 const row=book();row.authorization.validUntil=now+1000;
 assert.equal(depth(row,now+999).rows[0].current,true);
 const r=depth(row,now+1000);assert.equal(r.rows[0].status,'historical-only');assert.equal(r.rows[0].current,false);
 assert.equal(r.rows[0].metrics.bestBid,9.9);assert.equal(r.riskObservations.length,0);assert.equal(r.canTrade,false);
});
test('D67 revocation after receipt cannot be hidden behind a still fresh original clock',()=>{
 const row=book();row.authorization.revokedAt=now+1000;
 const r=depth(row,now+1000);assert.equal(r.rows[0].current,false);assert.equal(r.rows[0].status,'historical-only');assert.equal(r.riskObservations.length,0);
});
test('D67 declared authorized miniQMT research keeps the original freshness boundary, not execution rights',()=>{
 const row=book('miniqmt');const r=depth(row,now+15000);assert.equal(r.rows[0].current,true);assert.equal(r.rows[0].authorizationIndependentlyVerified,false);
 assert.equal(r.rows[0].metrics.completeOrderBook,false);assert.equal(r.canTrade,false);assert.equal(depth(row,now+15001).rows[0].current,false);
});
const q=(patch={})=>({symbol,tradeDate,timestamp:now-1000,quoteAt:now-1000,receivedAt:now-500,
 quoteSource:'supplied-provider',price:10,volumeUnit:'shares',volume:10000,suspended:false,tradable:true,lowerLimit:9,upperLimit:11,...patch});
const context={executionAt:now,executionKind:'automatic-paper',symbol,tradeDate,price:10.01};
test('D68 new fill evidence cannot bind another security to the order',()=>{
 for(const patch of [{symbol:'000001'},{code:'000001'},{symbol:'600000',code:'000001'}])
  assert.throws(()=>createFillEvidence(q(patch),context),/证券或交易日/);
});
test('D68 declared quote trading day cannot be overwritten by the order day',()=>{
 assert.throws(()=>createFillEvidence(q({tradeDate:'2026-11-03'}),context),/证券或交易日/);
});
test('D68 consistent aliases and slippage preserve exact original quote/receipt/execution evidence',()=>{
 const input=q({code:symbol}),e=createFillEvidence(input,context);
 assert.equal(e.symbol,symbol);assert.equal(e.quotePrice,10);assert.equal(e.price,10.01);assert.equal(e.quoteAt,now-1000);assert.equal(e.receivedAt,now-500);assert.equal(e.executionAt,now);
 assert.equal(e.canTrade,false);assert.equal(e.verifiedLive,false);
 assert.equal(validateFillEvidence(e,context),e);
 assert.equal(fillEvidenceOf({symbol,tradeDate,price:10.01,timestamp:now,fillEvidence:e}),e);
});
test('D68 legacy optional aliases and absent receipt remain readable, never fabricated',()=>{
 const input=q();delete input.symbol;delete input.tradeDate;delete input.receivedAt;
 const e=createFillEvidence(input,context);assert.equal(e.receivedAt,null);assert.equal(e.symbol,symbol);assert.equal(e.canTrade,false);
 assert.equal(validateFillEvidence(e,context),e);
});
