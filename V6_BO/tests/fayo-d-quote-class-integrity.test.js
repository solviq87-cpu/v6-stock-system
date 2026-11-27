'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fuseMultiSourcePrices}=require('../src/core/multi-source-price-consensus');
const now=Date.parse('2026-11-10T10:02:00+08:00'),code='600519';
const src=(id,price=10)=>({id,status:'fresh-unverified',quote:{code,exchange:'SH',
 currency:'CNY',adjustment:'unadjusted',status:'normal',price,previousClose:10,quoteAt:now-1000}});
const fuse=(...sources)=>fuseMultiSourcePrices({code,now,sources});

test('registered nonquote routes cannot turn one stock quote into a two-source consensus',()=>{
 for(const id of ['baostock','efinance','akshare-sina-minute','cninfo','sec-edgar',
  'fred','worldbank','ecb','efinance-fund','sse-calendar','sw-industry','shfe','hkex','nbs']){
  // Tencent has a separate canonical publisher from each of these routes.
  const r=fuse(src('tencent'),src(id));
  assert.equal(r.status,'insufficient-comparable-sources',id);
  assert.equal(r.referencePrice,null,id);assert.equal(r.cataloguedPublisherCandidates,1,id);
  const observed=r.sourceStatuses[1];
  assert.equal(observed.status,'incompatible-quote-source-class',id);
  assert.equal(observed.publisherCandidate,false,id);
  assert.equal(observed.inConsensus,false,id);assert.equal(observed.observedPrice,10,id);
  assert.equal(r.incompatibleQuoteSourceCount,1,id);assert.equal(r.canTrade,false,id);
 }
});
test('nonquote routes cannot supply a decisive majority when two valid quotes conflict',()=>{
 const r=fuse(src('tencent',10),src('eastmoney',11),src('fred',10));
 assert.equal(r.status,'source-price-or-time-conflict');
 assert.equal(r.referencePrice,null);assert.equal(r.cataloguedPublisherCandidates,2);
 assert.equal(r.sourceStatuses[2].inConsensus,false);
});
test('caller-supplied class and market labels cannot promote a registry-incompatible source',()=>{
 const r=fuse(src('tencent'),{...src('worldbank'),dataClass:'a-share-quote',market:'CN',
  sourceDataClass:'a-share-quote',sourceMarket:'CN',publisherCandidate:true});
 assert.equal(r.status,'insufficient-comparable-sources');assert.equal(r.referencePrice,null);
 assert.equal(r.sourceStatuses[1].sourceDataClass,'macro-series');
 assert.equal(r.sourceStatuses[1].sourceMarket,'GLOBAL');
 assert.equal(r.sourceStatuses[1].publisherCandidate,false);
});
test('generic global quote or tick registration without reviewed A-share route cannot vote',()=>{
 for(const id of ['yfinance','finnhub','databento']){
  const r=fuse(src('tencent'),src(id));
  assert.equal(r.status,'insufficient-comparable-sources',id);
  assert.equal(r.sourceStatuses[1].status,'incompatible-quote-source-class',id);
  assert.equal(r.referencePrice,null,id);
 }
});
test('existing CN quote-capable classes and explicit iTick route keep research-only comparison',()=>{
 for(const id of ['eastmoney','sina','easyquotation-sina','itick','ifind','miniqmt']){
  const r=fuse(src('tencent'),src(id));
  assert.equal(r.status,'sources-agree-unverified',id);
  assert.equal(r.cataloguedPublisherCandidates,2,id);
  assert.equal(r.sourceStatuses[1].publisherCandidate,true,id);
  assert.equal(r.incompatibleQuoteSourceCount,0,id);
  assert.equal(r.providerLicensed,false,id);assert.equal(r.certifiedLive,false,id);
  assert.equal(r.canTrade,false,id);assert.equal(r.canNotify,false,id);
 }
});
test('same canonical upstream remains a conservative duplicate veto even for bar wrappers',()=>{
 const r=fuse(src('eastmoney'),src('efinance'),src('tencent'));
 assert.equal(r.status,'duplicate-upstream-evidence');
 assert.equal(r.referencePrice,null);assert.equal(r.cataloguedPublisherCandidates,2);
 assert.equal(r.sourceStatuses[1].status,'incompatible-quote-source-class');
 assert.ok(r.duplicateUpstreamGroups.some(x=>x.upstreamGroup==='eastmoney'));
});
test('nonquote observation cannot contaminate a healthy pair from separate publishers',()=>{
 const r=fuse(src('eastmoney'),src('tencent'),src('cninfo',50));
 assert.equal(r.status,'sources-agree-unverified');
 assert.deepEqual(r.supportingProviders,['eastmoney','tencent']);
 assert.equal(r.referencePrice,10);assert.equal(r.sourceStatuses[2].inConsensus,false);
 assert.equal(r.sourceStatuses[2].observedPrice,50);
});
