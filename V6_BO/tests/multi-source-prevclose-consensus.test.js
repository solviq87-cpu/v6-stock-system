'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fuseMultiSourcePrices}=require('../src/core/multi-source-price-consensus');
const now=Date.parse('2026-11-10T10:02:00+08:00');
const code='600519';
const source=(id,price,previousClose)=>({
 id,status:'fresh-unverified',
 quote:{code,exchange:'SH',currency:'CNY',adjustment:'unadjusted',
  status:'normal',price,previousClose,quoteAt:now-1000}
});
const fuse=sources=>fuseMultiSourcePrices({code,now,sources});

test('identical last prices but different previous closes must not create consensus',()=>{
 const r=fuse([source('tencent',10,9.9),source('eastmoney',10,9)]);
 assert.equal(r.status,'source-price-or-time-conflict');
 assert.equal(r.referencePrice,null);
 assert.equal(r.eligibleCount,2);
 assert.deepEqual(r.supportingProviders,[]);
 assert.deepEqual(r.sourceStatuses.map(s=>s.observedPreviousClose),[9.9,9]);
 assert.deepEqual(r.sourceStatuses.map(s=>s.inConsensus),[false,false]);
 assert.equal(r.canTrade,false);
 assert.equal(r.certifiedLive,false);
});

test('a provider with mismatched previous close is rejected from the coherent pair',()=>{
 const r=fuse([source('tencent',10,9.9),
  source('eastmoney',10.01,9.9),source('sina',10,9)]);
 assert.equal(r.status,'partial-source-agreement-unverified');
 assert.equal(r.referencePrice,10.01);
 assert.equal(r.representativeProvider,'eastmoney');
 assert.deepEqual(r.supportingProviders,['eastmoney','tencent']);
 assert.deepEqual(r.disagreeingProviders,['sina']);
 assert.equal(r.sourceStatuses[2].observedPreviousClose,9);
 assert.equal(r.sourceStatuses[2].inConsensus,false);
 assert.equal(r.maxMatchedPreviousCloseGapBps,0);
 assert.equal(r.canTrade,false);
});

test('small previous close rounding differences within tolerance remain comparable',()=>{
 const r=fuse([source('tencent',10,9.99),
  source('eastmoney',10.01,9.991)]);
 assert.equal(r.status,'sources-agree-unverified');
 assert.equal(r.eligibleCount,2);
 assert.equal(r.matchedCount,2);
 assert.ok(r.maxMatchedPreviousCloseGapBps>0);
 assert.ok(r.maxMatchedPreviousCloseGapBps<30);
 assert.equal(r.canTrade,false);
});

test('overlapping prior-close consensus groups cannot silently choose one pair',()=>{
 const r=fuse([source('tencent',10,10),
  source('eastmoney',10,10.02),source('sina',10,10.04)]);
 assert.equal(r.status,'ambiguous-price-groups');
 assert.equal(r.referencePrice,null);
 assert.deepEqual(r.supportingProviders,[]);
});

test('unavailable provider still records no synthetic previous close',()=>{
 const r=fuse([source('tencent',10,9.9),source('eastmoney',10,9.9),
  {id:'itick',status:'unconfigured'}]);
 assert.equal(r.status,'sources-agree-unverified');
 assert.equal(r.sourceStatuses[2].observedPreviousClose,null);
 assert.equal(r.sourceStatuses[2].observedPrice,null);
 assert.equal(r.providerLicensed,false);
 assert.equal(r.canTrade,false);
});
