'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fuseMultiSourcePrices,checkMultiPublicPrices}=
 require('../src/core/multi-source-price-consensus');
const now=Date.parse('2026-11-10T10:02:00+08:00');
const q=(price,t=now-1000)=>({code:'600519',exchange:'SH',
 currency:'CNY',adjustment:'unadjusted',status:'normal',price,
 previousClose:10,quoteAt:t});
const src=(id,price,t=now-1000)=>({id,status:'fresh-unverified',quote:q(price,t)});
const fuse=sources=>fuseMultiSourcePrices({code:'600519',now,sources});
test('three close sources yield a real vendor price, not an invented mean or a trade permission',()=>{
 const r=fuse([src('tencent',10.00,now-1000),src('eastmoney',10.01,now-2000),
  src('sina',10.01,now-3000),{id:'itick',status:'unconfigured'}]);
 assert.equal(r.status,'sources-agree-unverified');
 assert.equal(r.referencePrice,10);
 assert.equal(r.representativeProvider,'tencent');
 assert.deepEqual(r.supportingProviders,['eastmoney','sina','tencent']);
 assert.equal(r.providerLicensed,false);
 assert.equal(r.exchangeCalendarVerified,false);
 assert.equal(r.certifiedLive,false);assert.equal(r.canTrade,false);
});
test('one outlier is excluded rather than averaged into the final reference price',()=>{
 const r=fuse([src('tencent',10.00),src('eastmoney',10.01),src('sina',10.60)]);
 assert.equal(r.status,'partial-source-agreement-unverified');
 assert.equal(r.referencePrice,10.01);
 assert.deepEqual(r.disagreeingProviders,['sina']);
 assert.equal(r.matchedCount,2);
 assert.deepEqual(r.sourceStatuses.map(x=>x.inConsensus),
  [true,true,false]);
 assert.equal(r.sourceStatuses[2].observedPrice,10.60);
});
test('overlapping possible pairs are ambiguous, so no arbitrary reference price',()=>{
 const r=fuse([src('tencent',10.00),src('eastmoney',10.02),src('sina',10.04)]);
 assert.equal(r.status,'ambiguous-price-groups');
 assert.equal(r.referencePrice,null);
});
test('two incompatible pairs among four fresh sources are not enough for a majority',()=>{
 const r=fuse([src('tencent',10.00),src('eastmoney',10.01),
  src('sina',10.90),src('itick',10.91)]);
 assert.equal(r.status,'source-price-or-time-conflict');
 assert.equal(r.referencePrice,null);
});
test('time mismatch fails closed even if prices coincide',()=>{
 const r=fuse([src('tencent',10.00,now-1000),src('eastmoney',10.00,now-13000)]);
 assert.equal(r.status,'source-price-or-time-conflict');
 assert.equal(r.referencePrice,null);
});
test('stale, future, wrong stock and provider mismatch cannot help consensus',()=>{
 const r=fuse([src('tencent',10,now-20000),src('eastmoney',10,now+1000),
  {...src('sina',10),quote:{...q(10),code:'000001'}},
  {id:'itick',status:'dated-snapshot',quote:q(10,now-20000)}]);
 assert.equal(r.status,'insufficient-comparable-sources');
 assert.deepEqual(r.sourceStatuses.map(x=>x.status),
  ['stale-quote','future-quote','invalid-quote','dated-snapshot']);
 assert.equal(r.referencePrice,null);
});
test('same-stock quotes from different market days cannot combine at midnight',()=>{
 const t=Date.parse('2026-11-10T00:00:02+08:00');
 const r=fuseMultiSourcePrices({code:'600519',now:t,sources:[
  src('tencent',10,t-1000),src('eastmoney',10,t-3000)]});
 assert.equal(r.status,'outside-weekday-session-window');
 assert.equal(r.sourceStatuses[1].status,'different-market-day');
});
test('duplicate sources and invalid inputs are rejected deterministically',()=>{
 assert.throws(()=>fuse([src('tencent',10),src('tencent',10)]),/重复/);
 assert.throws(()=>fuseMultiSourcePrices({code:'x',now,sources:[src('sina',10)]}),/无效/);
 assert.throws(()=>fuseMultiSourcePrices({code:'600519',now,sources:[src('sina',10)],priceToleranceBps:101}),/阈值/);
});
test('outside weekday continuous session never probes public or token sources',async()=>{
 let calls=0;
 const r=await checkMultiPublicPrices({code:'600519',
  now:Date.parse('2026-11-10T12:10:00+08:00'),
  probe:async()=>{calls++;throw Error('no network');},
  fetchItick:async()=>{calls++;throw Error('no network');}});
 assert.equal(calls,0);
 assert.equal(r.status,'outside-weekday-session-window');
 assert.equal(r.referencePrice,null);
});
test('public Tencent, Eastmoney and Sina are all queried, optional fourth source stays unconfigured',async()=>{
 const now=Date.parse('2026-11-10T10:02:00+08:00');
 const probe=async ({code,providers})=>{
  assert.equal(code,'600519');
  assert.deepEqual(providers,['tencent','eastmoney','sina']);
  return {schemaVersion:1,mode:'public-quote-probe',code,generatedAt:now,
   probeOnly:true,canTrade:false,verifiedLive:false,paidServicesUsed:false,
   sources:providers.map((id,i)=>({id,status:'ok',
    snapshot:{schemaVersion:1,provider:id,observedAt:now,
     quotes:[{exchange:'SH',code,currency:'CNY',adjustment:'unadjusted',
      volumeUnit:'share',status:'normal',timestamp:now-2000,
      price:10+(i%2)*.01,previousClose:10,volume:10000}]}}))};
 };
 const r=await checkMultiPublicPrices({code:'600519',now,probe,
  fetchItick:async()=>({id:'itick',status:'unconfigured'})});
 assert.equal(r.status,'sources-agree-unverified');
 assert.equal(r.referencePrice,10.01);
 assert.equal(r.sourceCount,4);
 assert.equal(r.eligibleCount,3);
 assert.equal(r.canTrade,false);
 assert.deepEqual(r.sourceStatuses.map(x=>x.provider),
  ['tencent','eastmoney','sina','itick']);
 assert.deepEqual(r.sourceStatuses.map(x=>x.observedPrice),
  [10,10.01,10,null]);
 assert.deepEqual(r.sourceStatuses.map(x=>x.quoteAgeMs),
  [2000,2000,2000,null]);
 assert.deepEqual(r.sourceStatuses.map(x=>x.inConsensus),
  [true,true,true,false]);
});

test('100x provider-price anomaly is displayed, not guessed back into CNY units',()=>{
 const r=fuse([src('tencent',1444.99),src('sina',1445.01),
  src('eastmoney',144499)]);
 assert.equal(r.status,'partial-source-agreement-unverified');
 assert.equal(r.referencePrice,1445.01);
 assert.equal(r.representativeProvider,'sina');
 assert.deepEqual(r.disagreeingProviders,['eastmoney']);
 assert.equal(r.sourceStatuses[2].observedPrice,144499);
 assert.equal(r.sourceStatuses[2].inConsensus,false);
 assert.equal(r.providerLicensed,false);
 assert.equal(r.canTrade,false);
});
test('invalid or future provider quote reports age and reason without entering consensus',()=>{
 const r=fuse([src('tencent',10,now-1000),
  {...src('eastmoney',10,now+2000)},
  {...src('sina',10),quote:{...q(10),status:'halted'}}]);
 assert.equal(r.status,'insufficient-comparable-sources');
 assert.equal(r.referencePrice,null);
 assert.deepEqual(r.sourceStatuses.map(x=>x.status),
  ['eligible-for-comparison','future-quote','invalid-quote']);
 assert.equal(r.sourceStatuses[1].quoteAgeMs,-2000);
 assert.equal(r.sourceStatuses[1].inConsensus,false);
 assert.equal(r.sourceStatuses[2].observedPrice,10);
});
