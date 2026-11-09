'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {checkTwoPublicSources,session}=require('../src/core/quote-dual-source-diagnostic');
const now=Date.parse('2026-11-09T10:00:00+08:00');
function probeFactory({second=10.02,stale=false,missing=false}={}){
 let count=0;
 const probe=async opts=>{
  count++;
  assert.equal(opts.code,'600001');
  assert.deepEqual(opts.providers,['tencent','eastmoney']);
  const q=(price,age)=>({exchange:'SH',code:'600001',currency:'CNY',
   adjustment:'unadjusted',volumeUnit:'share',status:'normal',
   timestamp:now-age,price,previousClose:10,volume:10000});
  const sources=[{id:'tencent',status:'ok',snapshot:{
   schemaVersion:1,provider:'tencent',observedAt:now,quotes:[q(10,2000)]}}];
  if(missing)sources.push({id:'eastmoney',status:'unavailable'});
  else sources.push({id:'eastmoney',status:'ok',snapshot:{
   schemaVersion:1,provider:'eastmoney',observedAt:now,quotes:[q(second,stale?18000:2500)]}});
  return {schemaVersion:1,mode:'public-quote-probe',code:'600001',generatedAt:now,
   probeOnly:true,canTrade:false,verifiedLive:false,paidServicesUsed:false,sources};
 };
 return {probe,getCount:()=>count};
}
test('Shanghai time session gate never uses Japan/local computer timezone',()=>{
 assert.equal(session(now),true);
 assert.equal(session(Date.parse('2026-11-09T12:00:00+08:00')),false);
 assert.equal(session(Date.parse('2026-11-09T09:29:59+08:00')),false);
 assert.equal(session(Date.parse('2026-11-09T15:00:00+08:00')),false);
 assert.equal(session(Date.parse('2026-11-08T10:00:00+08:00')),false);
});
test('two timestamped public sources agree but NEVER become exchange-certified live',async()=>{
 const p=probeFactory();
 const r=await checkTwoPublicSources({code:'600001',now,probe:p.probe});
 assert.equal(r.status,'sources-agree-unverified');
 assert.equal(r.providerLicensed,false);assert.equal(r.exchangeVerified,false);
 assert.equal(r.certifiedLive,false);assert.equal(r.canTrade,false);
 assert.equal(r.quoteAt,now-2500);
 assert.equal(p.getCount(),1);
});
test('cross-source conflict, missing and stale quote fail closed',async()=>{
 for(const [config,expected] of [
  [{second:10.20},'source-conflict'],
  [{missing:true},'insufficient-fresh-sources'],
  [{stale:true},'insufficient-fresh-sources']]){
  const p=probeFactory(config);
  const r=await checkTwoPublicSources({code:'600001',now,probe:p.probe});
  assert.equal(r.status,expected);
  assert.equal(r.canNotify,false);
 }
});
test('weekend and out-of-session times never hit external networks',async()=>{
 let used=false;
 const r=await checkTwoPublicSources({code:'600001',
  now:Date.parse('2026-11-09T18:00:00+08:00'),
  probe:async()=>{used=true;throw Error('network forbidden')}});
 assert.equal(used,false);
 assert.equal(r.status,'outside-weekday-session-window');
 await assert.rejects(()=>checkTwoPublicSources({code:'__bad__',now}),/代码/);
});
