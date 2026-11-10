'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPublicMarket}=require('../src/core/public-market');
const {probePublicQuotes,projectProbe}=require('../src/core/public-quote-probe');
const {checkMultiPublicPrices}=require('../src/core/multi-source-price-consensus');
const now=Date.parse('2026-11-10T14:10:00+08:00');
const code='600519';
const fields=Array(33).fill('0');
fields[2]=code;fields[3]='1440.00';fields[4]='1444.99';
fields[6]='120';fields[30]='20261110141000';
const tencent='v_sh600519="'+fields.join('~')+'";';
const sinaFields=Array(33).fill('0');
sinaFields[2]='1444.99';sinaFields[3]='1440.00';sinaFields[8]='12000';
sinaFields[30]='2026-11-10';sinaFields[31]='14:10:00';
const sina='var hq_str_sh600519="'+sinaFields.join(',')+'";';
function fixture({opaque=false}={}){
 const calls=[];
 const fetchImpl=async(url,opts)=>{
  calls.push({url,redirect:opts.redirect});
  assert.equal(opts.redirect,'manual','redirects must never be followed automatically');
  assert.equal(opts.headers?.Authorization,undefined);
  if(url.includes('eastmoney')){
   if(opaque)return {type:'opaqueredirect',status:0,ok:false};
   return new Response(null,{status:302,headers:{
    location:'https://push2delay.eastmoney.com/api/qt/stock/get?token=NEVER_PRINT_THIS'
   }});
  }
  if(url.includes('gtimg'))return new Response(tencent);
  if(url.includes('sinajs'))return new Response(sina);
  throw Error('unrecognized network access');
 };
 return {calls,fetchImpl};
}
test('vendor 302 is explicitly blocked without following or exposing Location',async()=>{
 const {calls,fetchImpl}=fixture();
 const out=await createPublicMarket({code,clock:()=>now,
  providers:['tencent','eastmoney','sina'],fetchImpl}).sync();
 assert.equal(calls.length,3);
 assert.ok(calls.every(x=>!x.url.includes('push2delay')));
 assert.equal(out.sources.find(x=>x.id==='eastmoney').status,'unavailable');
 assert.equal(out.sources.find(x=>x.id==='eastmoney').error,'redirect-blocked');
 assert.equal(out.sources.find(x=>x.id==='tencent').status,'ok');
 assert.equal(out.sources.find(x=>x.id==='sina').status,'ok');
 assert.doesNotMatch(JSON.stringify(out),/NEVER_PRINT_THIS/);
 assert.equal(out.verifiedLive,false);
 assert.equal(out.canTrade,false);
});
test('blocked redirect does not consume an extra public retry',async()=>{
 const {calls,fetchImpl}=fixture();
 const out=await probePublicQuotes({code,clock:()=>now,
  providers:['tencent','eastmoney','sina'],fetchImpl});
 assert.equal(calls.length,3);
 assert.equal(calls.filter(x=>x.url.includes('eastmoney')).length,1);
 assert.equal(out.sources.find(x=>x.id==='eastmoney').error,'redirect-blocked');
 assert.equal(out.attempts.find(x=>x.id==='eastmoney').retried,false);
 assert.equal(projectProbe(out,now).sources.find(x=>x.id==='eastmoney').status,'unavailable');
 assert.equal(out.canTrade,false);
});
test('opaque redirects are blocked without guessing the target',async()=>{
 const {fetchImpl}=fixture({opaque:true});
 const out=await createPublicMarket({code,clock:()=>now,
  providers:['eastmoney'],fetchImpl}).sync();
 assert.equal(out.sources[0].status,'unavailable');
 assert.equal(out.sources[0].error,'redirect-blocked');
});
test('two healthy sources still form research consensus when Eastmoney redirects',async()=>{
 const {calls,fetchImpl}=fixture();
 const probe=opts=>probePublicQuotes({...opts,clock:()=>now,fetchImpl});
 const r=await checkMultiPublicPrices({code,now,probe,
  fetchItick:async()=>({id:'itick',status:'unconfigured'})});
 assert.equal(calls.length,3);
 assert.equal(r.status,'sources-agree-unverified');
 assert.equal(r.referencePrice,1440);
 assert.deepEqual(r.supportingProviders,['sina','tencent']);
 assert.equal(r.sourceStatuses.find(s=>s.provider==='eastmoney').status,'unavailable');
 assert.equal(r.canTrade,false);
 assert.equal(r.canNotify,false);
 assert.equal(r.certifiedLive,false);
});
