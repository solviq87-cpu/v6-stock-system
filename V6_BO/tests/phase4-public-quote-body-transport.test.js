'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inspectPublicQuoteEndpoints:inspect}=require('../src/core/public-quote-endpoint-health');
const now=Date.parse('2026-11-27T10:00:00+08:00'),code='600519';
const base={code,clock:()=>now,providers:['eastmoney']};
const raw=JSON.stringify({rc:0,data:{f57:code,f43:10,f60:9,f47:123,f86:now/1000}});
function brokenBody(error){
 return new Response(new ReadableStream({pull(controller){controller.error(error);}}));
}
function noQuote(row){
 for(const key of ['price','previousClose','quoteAt','quoteAgeMs'])assert.equal(row[key],null);
}
test('HTTP 200 with a broken body preserves the safe transport category and the observed HTTP code',async()=>{
 for(const [code,kind] of [['ECONNRESET','connection-failed'],['UND_ERR_BODY_TIMEOUT','timeout'],['CERT_HAS_EXPIRED','tls-failed']]){
  let calls=0;
  const report=await inspect({...base,fetchImpl:async()=>{calls++;return brokenBody(Object.assign(Error('PRIVATE_BODY'),{cause:{code,message:'PRIVATE_URL'}}));}});
  const row=report.providers[0];
  assert.equal(calls,1);assert.equal(row.status,'invalid-response');assert.equal(row.httpStatus,200);assert.equal(row.failureKind,kind);
  noQuote(row);assert.equal(report.canTrade,false);assert.equal(report.canNotify,false);
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE_/);
 }
});
test('body error text cannot impersonate a local size-limit rejection',async()=>{
 const report=await inspect({...base,fetchImpl:async()=>brokenBody(Error('body-too-large'))});
 const row=report.providers[0];assert.equal(row.status,'invalid-response');assert.equal(row.httpStatus,200);
 assert.equal(row.failureKind,'invalid-response');noQuote(row);
});
test('non-Error body rejections remain failed HTTP 200 receipts rather than losing the HTTP evidence',async()=>{
 for(const failure of [null,undefined,'PRIVATE_STRING',Object.assign(Error('PRIVATE_BODY'),{code:'UNKNOWN_PRIVATE_CODE'})]){
  const report=await inspect({...base,fetchImpl:async()=>brokenBody(failure)});
  const row=report.providers[0];assert.equal(row.status,'invalid-response');assert.equal(row.httpStatus,200);
  assert.equal(row.failureKind,'invalid-response');noQuote(row);assert.doesNotMatch(JSON.stringify(report),/PRIVATE_/);
 }
});
test('actual declared and streamed size limits remain distinguishable from arbitrary body errors',async()=>{
 for(const response of [new Response(raw,{headers:{'content-length':'65537'}}),new Response('X'.repeat(65537))]){
  const report=await inspect({...base,fetchImpl:async()=>response});const row=report.providers[0];
  assert.equal(row.status,'response-too-large');assert.equal(row.httpStatus,200);
  assert.equal(row.failureKind,'response-too-large');noQuote(row);
 }
});
test('the existing one-shot timeout still bounds an aborted body and does not create a quote',async()=>{
 let calls=0;
 const report=await inspect({...base,timeoutMs:100,fetchImpl:async(_url,{signal})=>{
  calls++;return new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(Error('PRIVATE_ABORT')),{once:true});}}));
 }});
 const row=report.providers[0];assert.equal(calls,1);assert.equal(row.status,'timeout');assert.equal(row.httpStatus,null);
 assert.equal(row.failureKind,'timeout');noQuote(row);assert.doesNotMatch(JSON.stringify(report),/PRIVATE_/);
});
test('complete responses and denials keep their original status and no trading permission',async()=>{
 const good=await inspect({...base,fetchImpl:async()=>new Response(raw)});
 assert.equal(good.providers[0].status,'fresh-source-unverified');assert.equal(good.providers[0].price,10);assert.equal(good.providers[0].failureKind,undefined);
 assert.equal(good.canTrade,false);assert.equal(good.verifiedLive,false);
 const denied=await inspect({...base,fetchImpl:async()=>new Response(null,{status:429})});
 assert.equal(denied.providers[0].status,'rate-limited');assert.equal(denied.providers[0].httpStatus,429);noQuote(denied.providers[0]);
});
