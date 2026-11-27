'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fetchItickGlobalStockQuote:read}=require('../src/core/itick-stock-quote');
const at=Date.parse('2026-11-26T14:00:00+08:00');
const params=()=>({region:'US',code:'AAPL',currency:'USD',clock:()=>at,token:'fixture-token',displayScope:{displayAuthorized:true,region:'US',code:'AAPL',currency:'USD'}});
const body=(fields={})=>JSON.stringify({code:0,data:{s:'AAPL',ld:100,p:99,t:at-1000,ts:0,...fields}});
const response=(fields={},headers={'content-type':'application/json'})=>new Response(body(fields),{headers});
const safe=x=>{assert.equal(x.quote,null);for(const k of ['canTrade','canNotify','canTrain','verifiedLive','marketIdentityVerified','exchangeVerified'])assert.equal(x[k],false);};
test('D36-01 inherited display authorization never dispatches',async()=>{
 const p=params();let calls=0;
 const x=await read({...p,displayScope:Object.create(p.displayScope),fetchImpl:async()=>{calls++;return response();}});
 safe(x);assert.equal(x.status,'authorization-unconfirmed');assert.equal(calls,0);
});
test('D36-02 accessors cannot supply authorization or execute before dispatch',async()=>{
 const p=params();let accessed=0,calls=0;
 Object.defineProperty(p.displayScope,'displayAuthorized',{get(){accessed++;return true;}});
 const x=await read({...p,fetchImpl:async()=>{calls++;return response();}});
 safe(x);assert.equal(x.status,'authorization-unconfirmed');assert.equal(calls,0);assert.equal(accessed,0);
});
test('D36-03 local display scope withdrawn or changed during fetch never publishes a quote',async()=>{
 for(const patch of [{displayAuthorized:false},{code:'MSFT'},{exchange:'NYSE'}]){
  const p=params();const x=await read({...p,fetchImpl:async()=>{Object.assign(p.displayScope,patch);return response();}});
  safe(x);assert.equal(x.reason,'authorization-changed');
 }
});
test('D36-04 conflicting returned exchange aliases rejected even without requested exchange',async()=>{
 const x=await read({...params(),fetchImpl:async()=>response({e:'NASDAQ',exchange:'NYSE'})});safe(x);assert.equal(x.reason,'invalid-quote');
});
test('D36-05 malformed explicit exchange metadata cannot be silently discarded',async()=>{
 for(const fields of [{e:123},{e:null},{exchange:'bad exchange'},{exchange:null}]){
  const x=await read({...params(),fetchImpl:async()=>response(fields)});safe(x);assert.equal(x.reason,'invalid-quote');
 }
});
test('D36-06 single valid long exchange alias retained without certifying identity',async()=>{
 for(const fields of [{exchange:'NASDAQ'},{e:'NASDAQ',exchange:'NASDAQ'}]){
  const x=await read({...params(),fetchImpl:async()=>response(fields)});assert.equal(x.quote.reportedExchange,'NASDAQ');assert.equal(x.exchangeVerified,false);assert.equal(x.marketIdentityVerified,false);assert.equal(x.canTrade,false);
 }
});
test('D36-07 invalid or ambiguous encoding cannot bypass declared length validation',async()=>{
 for(const encoding of ['unknown','identity, gzip','']){
  const x=await read({...params(),fetchImpl:async()=>response({}, {'content-type':'application/json','content-encoding':encoding,'content-length':'1'})});safe(x);assert.equal(x.reason,'invalid-content-encoding');
 }
 const p=params();const x=await read({...p,fetchImpl:async()=>response({}, {'content-type':'application/json','content-encoding':'gzip','content-length':'12'})});assert.ok(x.quote);assert.equal(x.verifiedLive,false);
});
test('D36-08 bounded stream counts chunks including empty chunks and stops reading on exhaustion',async()=>{
 let count=0;const x=await read({...params(),fetchImpl:async()=>({ok:true,status:200,body:(async function*(){for(let i=0;i<4100;i++){count++;yield Buffer.alloc(0);}yield Buffer.from(body());})()})});safe(x);assert.equal(x.reason,'too-many-chunks');assert.equal(count,4097);
 const ok=await read({...params(),fetchImpl:async()=>({ok:true,status:200,body:(async function*(){yield Buffer.alloc(0);yield Buffer.from(body());})()})});assert.ok(ok.quote);
});
