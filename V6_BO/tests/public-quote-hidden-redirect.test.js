'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {hasQuoteRedirect}=require('../src/core/public-quote-redirect-policy');
const {createPublicMarket}=require('../src/core/public-market');
const {inspectPublicQuoteEndpoints}=require('../src/core/public-quote-endpoint-health');
const now=Date.parse('2026-11-10T14:30:50+08:00'),code='600519';
const request='https://push2.eastmoney.com/api/qt/stock/get?secid=1.600519&fltt=2&fields=f43,f47,f57,f60,f86';
const delayed=request.replace('push2.eastmoney.com','push2delay.eastmoney.com');
const fields=Array(33).fill('');
fields[2]=code;fields[3]='1442.41';fields[4]='1444.99';fields[6]='19701';
fields[30]='20261110143047';
const tencent='v_sh600519="'+fields.join('~')+'";';
function fakeRedirect(kind,url){
 if(!['opaque','flagged','final-url'].includes(kind))throw Error('unknown fixture');
 const response={status:kind==='opaque'?0:200,ok:kind!=='opaque',
  type:kind==='opaque'?'opaqueredirect':'basic',
  redirected:kind==='flagged',
  url:kind==='opaque'?'':kind==='final-url'?delayed:url};
 Object.defineProperty(response,'body',{
  get(){throw Error('redirected body must never be read');}
 });
 return response;
}
test('policy refuses 3xx, opaque, redirected:true and changed final URLs without reading Location',()=>{
 for(const response of [
  {status:302,ok:false,url:request},
  fakeRedirect('opaque',request),
  fakeRedirect('flagged',request),
  fakeRedirect('final-url',request)
 ])assert.equal(hasQuoteRedirect(response,request),true);
 assert.equal(hasQuoteRedirect({status:200,ok:true,redirected:false,url:request},request),false);
 assert.equal(hasQuoteRedirect(new Response('ok'),request),false);
});
test('market reader rejects status-200 replies secretly served from delayed host',async()=>{
 for(const kind of ['flagged','final-url','opaque']){
  const calls=[];
  const result=await createPublicMarket({code,clock:()=>now,
   providers:['eastmoney','tencent'],
   fetchImpl:async (url,opts)=>{
    calls.push({url,opts});
    if(url.includes('eastmoney'))return fakeRedirect(kind,url);
    return new Response(tencent);
   }}).sync();
  assert.equal(calls.length,2);
  assert.ok(calls.every(x=>x.opts.redirect==='manual'));
  const eastmoney=result.sources.find(s=>s.id==='eastmoney');
  assert.equal(eastmoney.status,'unavailable');
  assert.equal(eastmoney.error,'redirect-blocked');
  assert.equal(result.sources.find(s=>s.id==='tencent').status,'ok');
  assert.doesNotMatch(JSON.stringify(result),/push2delay/);
  assert.equal(result.canTrade,false);
  assert.equal(result.verifiedLive,false);
 }
});
test('endpoint health never calls disguised 200 redirect a fresh quote',async()=>{
 for(const kind of ['flagged','final-url','opaque']){
  const calls=[];
  const result=await inspectPublicQuoteEndpoints({code,clock:()=>now,
   providers:['eastmoney','tencent'],
   fetchImpl:async(url,opts)=>{
    calls.push({url,opts});
    return url.includes('eastmoney')?fakeRedirect(kind,url):new Response(tencent);
   }});
  assert.equal(calls.length,2);
  assert.ok(calls.every(c=>c.opts.redirect==='manual'));
  assert.equal(result.providers[0].status,'redirect-refused');
  assert.equal(result.providers[0].httpStatus,null);
  assert.equal(result.providers[0].price,null);
  assert.equal(result.providers[1].status,'fresh-source-unverified');
  assert.doesNotMatch(JSON.stringify(result),/push2delay/);
  assert.equal(result.canTrade,false);
  assert.equal(result.verifiedLive,false);
 }
});
