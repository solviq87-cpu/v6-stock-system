'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPublicMarket}=require('../src/core/public-market');
const {probePublicQuotes,projectProbe}=require('../src/core/public-quote-probe');
const {inspectPublicQuoteEndpoints}=require('../src/core/public-quote-endpoint-health');
const now=Date.parse('2026-11-27T10:00:00+08:00'),code='600519';
const base={code,clock:()=>now,providers:['eastmoney']};
const raw=JSON.stringify({rc:0,data:{f57:code,f43:10,f60:9,f47:123,f86:now/1000}});
test('complete HTTP 200 remains observable and never grants execution',async()=>{
 const r=await createPublicMarket({...base,fetchImpl:async()=>new Response(raw)}).sync();
 assert.equal(r.sources[0].status,'ok');assert.equal(r.sources[0].snapshot.quotes[0].price,10);
 assert.equal(r.canTrade,false);assert.equal(r.verifiedLive,false);
});
test('partial or alternative 2xx responses cannot certify a complete quote or trigger a retry',async()=>{
 for(const status of [201,206]){
  let calls=0;
  const r=await probePublicQuotes({...base,fetchImpl:async()=>{calls++;return new Response(raw,{status});}});
  const view=projectProbe(r,now).sources[0];
  assert.equal(calls,1);assert.equal(view.status,'unavailable');assert.equal(view.quote,null);
  assert.equal(view.failureKind,'invalid-response');assert.equal(view.httpStatus,status);
 }
});
test('native transport error categories survive read-only projection without exposing exception text',async()=>{
 for(const [transport,kind] of [['ENOTFOUND','dns-failed'],['EAI_AGAIN','dns-failed'],
  ['UND_ERR_CONNECT_TIMEOUT','timeout'],['ECONNRESET','connection-failed'],
  ['CERT_HAS_EXPIRED','tls-failed'],['UNRECOGNIZED_SECRET','transport-error']]){
  let calls=0;
  const fetchImpl=async()=>{calls++;throw Object.assign(Error('PRIVATE_EXCEPTION_SENTINEL'),{cause:{code:transport,message:'PRIVATE_URL_SENTINEL'}});};
  const r=await probePublicQuotes({...base,fetchImpl});
  assert.equal(calls,2);
  const v=projectProbe(r,now).sources[0];
  assert.equal(v.status,'unavailable');assert.equal(v.failureKind,kind);
  assert.equal(v.httpStatus,null);assert.equal(v.quote,null);
  assert.doesNotMatch(JSON.stringify({r,v}),/PRIVATE_|UNRECOGNIZED_SECRET/);
 }
});
test('the existing one-shot health check preserves redacted DNS detail without extra requests',async()=>{
 let calls=0;
 const r=await inspectPublicQuoteEndpoints({...base,fetchImpl:async()=>{
  calls++;throw Object.assign(Error('PRIVATE_TOKEN'),{cause:{code:'ENOTFOUND'}});
 }});
 assert.equal(calls,1);assert.equal(r.providers[0].status,'transport-error');
 assert.equal(r.providers[0].failureKind,'dns-failed');assert.equal(r.providers[0].httpStatus,null);
 assert.equal(r.canTrade,false);assert.equal(r.canNotify,false);
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE_TOKEN/);
});
test('denials, rate limits and redirects remain un-retried and their safe categories remain visible',async()=>{
 for(const [status,kind] of [[401,'access-denied'],[403,'access-denied'],[429,'rate-limited'],
  [302,'redirect-refused'],[503,'http-error']]){
  let calls=0;
  const r=await probePublicQuotes({...base,fetchImpl:async(url,opts)=>{
   calls++;assert.equal(opts.redirect,'manual');
   return new Response(null,{status,headers:{location:'https://private.invalid/TOKEN_SENTINEL'}});
  }});
  const v=projectProbe(r,now).sources[0];
  assert.equal(calls,1);assert.equal(v.failureKind,kind);assert.equal(v.httpStatus,status);
  assert.equal(v.quote,null);assert.doesNotMatch(JSON.stringify({r,v}),/TOKEN_SENTINEL|private.invalid/);
 }
});
test('a parse error or oversize body is not mistaken for a DNS failure',async()=>{
 for(const [body,kind] of [['not-json','invalid-quote'],['X'.repeat(262145),'response-too-large']]){
  const r=await probePublicQuotes({...base,fetchImpl:async()=>new Response(body)});
  const v=projectProbe(r,now).sources[0];
  assert.equal(v.failureKind,kind);assert.equal(v.httpStatus,200);assert.equal(v.quote,null);
 }
});
test('legacy and unrecognized saved error data project only allowlisted diagnostic fields',()=>{
 const old={schemaVersion:1,mode:'public-quote-probe',code,generatedAt:now,
  probeOnly:true,canTrade:false,verifiedLive:false,paidServicesUsed:false,
  sources:[{id:'eastmoney',status:'unavailable',error:'HTTP 403'}]};
 let v=projectProbe(old,now).sources[0];
 assert.equal(v.failureKind,'access-denied');assert.equal(v.httpStatus,403);
 old.sources[0]={id:'eastmoney',status:'unavailable',error:'SECRET_SENTINEL',
  failureKind:'SECRET_SENTINEL',httpStatus:'SECRET_SENTINEL'};
 v=projectProbe(old,now).sources[0];
 assert.equal(v.failureKind,'unclassified-failure');assert.equal(v.httpStatus,null);
 assert.doesNotMatch(JSON.stringify(v),/SECRET_SENTINEL/);
});
