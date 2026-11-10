'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inspectPublicQuoteEndpoints}=require('../src/core/public-quote-endpoint-health');
const now=Date.parse('2026-11-10T13:58:00+08:00');
const raw=(id)=>{
 if(id==='eastmoney')return JSON.stringify({rc:0,data:{
  f57:'600519',f43:1440.03,f60:1444.99,f47:16477,f86:now/1000}});
 const fields=Array(33).fill('');
 fields[2]='600519';fields[3]='1440.41';fields[4]='1444.99';
 fields[6]='16476';
 fields[30]='20261110135800';
 return 'v_sh600519="'+fields.join('~')+'";';
};
const fetchImpl=async url=>new Response(raw(url.includes('eastmoney')?'eastmoney':'tencent'));
function clockSequence(times){
 let reads=0;
 return ()=>{
  assert.ok(reads<times.length,'unexpected extra clock reading');
  return times[reads++];
 };
}
const run=(publishAt)=>inspectPublicQuoteEndpoints({
 code:'600519',providers:['tencent','eastmoney'],fetchImpl,
 // One start reading, one at each response, then report publication.
 clock:clockSequence([now,now,now,publishAt])
});
test('a report published after 16 seconds downgrades all initially fresh sources',async()=>{
 const out=await run(now+16000);
 assert.equal(out.status,'completed-unverified');
 assert.deepEqual(out.providers.map(x=>x.status),['dated-snapshot','dated-snapshot']);
 assert.deepEqual(out.providers.map(x=>x.quoteAgeMs),[16000,16000]);
 assert.deepEqual(out.providers.map(x=>x.quoteAt),[now,now]);
 assert.deepEqual(out.providers.map(x=>x.price),[1440.41,1440.03]);
 assert.equal(out.canTrade,false);
 assert.equal(out.verifiedLive,false);
});
test('at the exact freshness boundary both sources remain research-only fresh',async()=>{
 const out=await run(now+15000);
 assert.deepEqual(out.providers.map(x=>x.status),[
  'fresh-source-unverified','fresh-source-unverified']);
 assert.deepEqual(out.providers.map(x=>x.quoteAgeMs),[15000,15000]);
 assert.equal(out.canNotify,false);
 assert.equal(out.canTrade,false);
});
test('a regressed publication clock cannot preserve fresh statuses',async()=>{
 const out=await run(now-1000);
 assert.equal(out.status,'clock-regressed');
 assert.deepEqual(out.providers.map(x=>x.status),[
  'invalid-quote-time','invalid-quote-time']);
 assert.deepEqual(out.providers.map(x=>x.quoteAgeMs),[-1000,-1000]);
 assert.equal(out.providerLicensed,false);
 assert.equal(out.canTrade,false);
});
