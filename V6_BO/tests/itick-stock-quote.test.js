'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fetchItickStockQuote}=require('../src/core/itick-stock-quote');
const now=Date.parse('2026-11-10T10:02:00+08:00');
const response=o=>({ok:true,text:async()=>JSON.stringify(o)});
const data=(x={})=>({code:0,msg:null,data:{s:'600519',ld:1444.99,p:1453,
 t:now-2000,v:2000000,tu:100000000,ts:0,...x}});
test('unconfigured token never makes an external request',async()=>{
 let fetched=false;
 const r=await fetchItickStockQuote({code:'600519',now,
  fetchImpl:async()=>{fetched=true;throw Error('should not call');}});
 assert.equal(fetched,false);
 assert.equal(r.status,'unconfigured');
 assert.equal(r.verifiedLive,false);
 assert.equal(r.canTrade,false);
});
test('documented iTick stock/quote fields map to unadjusted CNY observation without certification',async()=>{
 const r=await fetchItickStockQuote({code:'600519',now,token:'fake-for-test',
  fetchImpl:async(url,opts)=>{
   const u=new URL(url);
   assert.equal(u.hostname,'api.itick.org');
   assert.equal(u.pathname,'/stock/quote');
   assert.equal(u.searchParams.get('region'),'SH');
   assert.equal(u.searchParams.get('code'),'600519');
   assert.equal(opts.headers.token,'fake-for-test');
   return response(data());
  }});
 assert.equal(r.status,'fresh-unverified');
 assert.equal(r.quote.exchange,'SH');
 assert.equal(r.quote.price,1444.99);
 assert.equal(r.quote.previousClose,1453);
 assert.equal(r.quote.quoteAt,now-2000);
 assert.equal(r.verifiedLive,false);
 assert.equal(r.canTrade,false);
});
test('iTick stale, halted, wrong-symbol and invalid upstream prices never enter consensus',async()=>{
 for(const [payload,expected] of [
  [data({t:now-60000}),'dated-snapshot'],
  [data({ts:1}),'unavailable'],
  [data({s:'000001'}),'unavailable'],
  [data({ld:0}),'unavailable'],
  [{code:429,msg:'rate limit',data:null},'unavailable']
 ]){
  const r=await fetchItickStockQuote({code:'600519',now,token:'fake',
   fetchImpl:async()=>response(payload)});
  assert.equal(r.status,expected);
 }
});
test('authorization failure and malformed token return fail closed without leaking credentials',async()=>{
 const r=await fetchItickStockQuote({code:'600519',now,token:'fake-secret',
  fetchImpl:async()=>({ok:false,status:403})});
 assert.equal(r.status,'unavailable');
 assert.doesNotMatch(JSON.stringify(r),/fake-secret/);
 await assert.rejects(()=>fetchItickStockQuote({code:'600519',now,token:'x\r\ny'}),/凭据/);
});
