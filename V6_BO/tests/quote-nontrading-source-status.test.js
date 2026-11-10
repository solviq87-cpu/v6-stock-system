'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {projectProbe}=require('../src/core/public-quote-probe');
const {fuseMultiSourcePrices,checkMultiPublicPrices}=
 require('../src/core/multi-source-price-consensus');
const now=Date.parse('2026-11-10T10:02:00+08:00');
const code='600519';
const quote=status=>({exchange:'SH',code,currency:'CNY',
 adjustment:'unadjusted',volumeUnit:'share',status,
 timestamp:now-1000,price:10,previousClose:9.9,volume:1000});
const rawProbe=()=>({
 schemaVersion:1,mode:'public-quote-probe',code,generatedAt:now,
 probeOnly:true,canTrade:false,verifiedLive:false,paidServicesUsed:false,
 sources:['tencent','eastmoney','sina'].map((id,i)=>({
  id,status:'ok',snapshot:{schemaVersion:1,provider:id,observedAt:now,
   quotes:[quote(i===1?'halted':'normal')]}
 }))
});
test('projection preserves an observed halt and never calls it fresh',()=>{
 const projected=projectProbe(rawProbe(),now);
 assert.equal(projected.sources[0].status,'fresh-unverified');
 assert.equal(projected.sources[0].quote.status,'market-state-unverified');
 assert.equal(projected.sources[1].status,'dated-snapshot');
 assert.equal(projected.sources[1].quote.status,'halted');
 assert.equal(projected.sources[1].quote.freshness,'not-realtime');
 assert.equal(projected.sources[2].status,'fresh-unverified');
});
test('halted middle provider is excluded from full multi-source price workflow',async()=>{
 const result=await checkMultiPublicPrices({code,now,
  probe:async()=>rawProbe(),
  fetchItick:async()=>({id:'itick',status:'unconfigured'})});
 assert.equal(result.status,'sources-agree-unverified');
 assert.equal(result.referencePrice,10);
 assert.equal(result.eligibleCount,2);
 assert.deepEqual(result.supportingProviders,['sina','tencent']);
 assert.equal(result.sourceStatuses[1].status,'dated-snapshot');
 assert.equal(result.sourceStatuses[1].inConsensus,false);
 assert.equal(result.canTrade,false);
 assert.equal(result.certifiedLive,false);
});
test('unexpected or halted trading states cannot create consensus despite matching prices',()=>{
 for(const badStatus of ['halted','delisted','auction','unknown',null]){
  const r=fuseMultiSourcePrices({code,now,sources:[
   {id:'tencent',status:'fresh-unverified',
    quote:{...quote('normal'),quoteAt:now-1000}},
   {id:'eastmoney',status:'fresh-unverified',
    quote:{...quote(badStatus),quoteAt:now-1000}}
  ]});
  assert.equal(r.status,'insufficient-comparable-sources');
  assert.equal(r.referencePrice,null);
  assert.equal(r.eligibleCount,1);
  assert.equal(r.sourceStatuses[1].status,'invalid-quote');
  assert.equal(r.canTrade,false);
 }
});
