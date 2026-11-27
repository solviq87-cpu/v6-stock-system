'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fetchItickGlobalStockQuote:read}=require('../src/core/itick-stock-quote');
const at=Date.parse('2026-11-26T14:00:00+08:00'),key='fixture-token-not-real';
const params=(region='HK',code='700',currency='HKD',exchange=null)=>({region,code,currency,exchange,clock:()=>at,token:key,
 displayScope:{displayAuthorized:true,region,code,currency,exchange}});
const payload=(s='700',fields={})=>({code:0,data:{s,ld:100,p:99,t:at-1000,ts:0,...fields}});
const response=(x=payload(),opts={})=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'},...opts});
const flags=x=>{for(const k of ['canTrade','canNotify','canTrain','verifiedLive','currencyVerified','exchangeVerified','marketIdentityVerified','displayAuthorizationIndependentlyVerified','providerLicensed','marketSessionVerified'])assert.equal(x[k],false);};
test('HK canonical vendor symbol and original time are preserved without certifying HKD or live access',async()=>{
 let calls=0;const x=await read({...params(),fetchImpl:async(url,opts)=>{calls++;const u=new URL(url);assert.equal(u.origin,'https://api.itick.org');assert.equal(u.pathname,'/stock/quote');assert.equal(u.searchParams.get('region'),'HK');assert.equal(u.searchParams.get('code'),'700');assert.equal(opts.headers.token,key);assert.equal(opts.redirect,'error');return response();}});
 assert.equal(calls,1);assert.equal(x.status,'recent-reference-unverified');assert.equal(x.quote.code,'700');assert.equal(x.quote.quoteAt,at-1000);assert.equal(x.quote.currency,null);assert.equal(x.declaredCurrency,'HKD');assert.equal(x.quoteAgeMs,1000);flags(x);
});
test('US ticker and explicitly requested exchange stay separate from unverified returned market identity',async()=>{
 const p=params('US','AAPL','USD','NASDAQ');const r=await read({...p,fetchImpl:async url=>{const u=new URL(url);assert.equal(u.searchParams.get('region'),'US');assert.equal(u.searchParams.get('exchange'),'NASDAQ');return response(payload('AAPL'));}});
 assert.equal(r.requestedExchange,'NASDAQ');assert.equal(r.quote.reportedExchange,null);assert.equal(r.quote.region,'US');assert.equal(r.quote.currency,null);flags(r);
});
test('JP numeric symbols are accepted only in explicit Japanese scope and do not overlap the A-share contract',async()=>{
 const r=await read({...params('JP','7203','JPY'),fetchImpl:async url=>{assert.equal(new URL(url).searchParams.get('region'),'JP');return response(payload('7203'));}});
 assert.equal(r.quote.code,'7203');assert.equal(r.mode,'global-stock-reference-observation');assert.equal(r.quote.adjustment,null);assert.equal(r.quote.volumeUnit,null);flags(r);
 for(const p of [params('SH','600000','CNY'),params('JP','600000','JPY'),params('HK','00700','HKD'),params('US','aapl','USD'),params('US','AAPL','CNY')])await assert.rejects(()=>read({...p,fetchImpl:async()=>{throw Error('no network');}}),/参数无效/);
});
test('missing or mismatched explicit display scope and credentials never dispatch',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return response();};const p=params();
 for(const displayScope of [undefined,{...p.displayScope,displayAuthorized:false},{...p.displayScope,code:'9988'},{...p.displayScope,region:'US'},{...p.displayScope,currency:'USD'},{...p.displayScope,exchange:'OTHER'}]){
  const r=await read({...p,displayScope,fetchImpl});assert.equal(r.status,'authorization-unconfirmed');assert.equal(r.quote,null);flags(r);
 }
 assert.equal((await read({...p,token:undefined,fetchImpl})).status,'unconfigured');await assert.rejects(()=>read({...p,token:'x\ny',fetchImpl}),/凭据/);assert.equal(calls,0);
});
test('HTTP restrictions, redirects and partial status fail closed once and never leak token or response URL',async()=>{
 let calls=0;for(const [status,reason] of [[401,'access-denied'],[403,'access-denied'],[429,'rate-limited'],[206,'invalid-http']]){
  const r=await read({...params(),fetchImpl:async()=>{calls++;return response(payload(),{status});}});
  assert.equal(r.status,'unavailable');assert.equal(r.reason,reason);assert.equal(r.httpStatus,status);assert.equal(r.quote,null);assert.ok(!JSON.stringify(r).includes(key));
 }
 const redirected=await read({...params(),fetchImpl:async()=>{calls++;return {ok:true,status:200,redirected:true,url:'https://bad.invalid/'+key};}});
 assert.equal(redirected.reason,'redirect-refused');assert.equal(calls,5);assert.ok(!JSON.stringify(redirected).includes(key));
 const fail=await read({...params(),fetchImpl:async()=>{throw Error(key);}});assert.equal(fail.reason,'transport-error');assert.ok(!JSON.stringify(fail).includes(key));
});
test('known nontrading states and stale trades remain historical observations; unknown status is rejected',async()=>{
 for(const [ts,state] of [[1,'halted'],[2,'delisted'],[3,'circuit-breaker']]){
  const r=await read({...params(),fetchImpl:async()=>response(payload('700',{ts}))});assert.equal(r.status,'nontrading-reference-only');assert.equal(r.quote.status,state);flags(r);
 }
 const old=await read({...params(),fetchImpl:async()=>response(payload('700',{t:at-15001}))});assert.equal(old.status,'dated-reference-only');
 for(const ts of ['0',4,null,undefined])assert.equal((await read({...params(),fetchImpl:async()=>response(payload('700',{ts}))})).quote,null);
});
test('actual complete body receipt and publication clocks control age; rollback or future trade is not renewed',async()=>{
 let clockAt=at;const p={...params(),clock:()=>clockAt};
 const r=await read({...p,fetchImpl:async()=>({ok:true,status:200,body:(async function*(){clockAt=at+16000;yield Buffer.from(JSON.stringify(payload('700',{t:at})));})()})});
 assert.equal(r.requestStartedAt,at);assert.equal(r.receivedAt,at+16000);assert.equal(r.quoteAgeMs,16000);assert.equal(r.status,'dated-reference-only');
 let i=0;const clock=()=>[at,at,at+2000,at+1000,at+3000][Math.min(i++,4)];const rollback=await read({...params(),clock,fetchImpl:async()=>response()});assert.equal(rollback.reason,'invalid-clock');assert.equal(rollback.quote,null);
 const future=await read({...params(),fetchImpl:async()=>response(payload('700',{t:at+1}))});assert.equal(future.quote,null);
});
test('wrong scope, malformed byte streams, length and unknown price metadata cannot produce a global quote',async()=>{
 for(const fields of [{s:700},{s:'9988'},{r:'US'},{currency:'JPY'},{ld:0},{p:null},{t:'1795690000000'}]){
  const r=await read({...params(),fetchImpl:async()=>response(payload('700',fields))});assert.equal(r.quote,null);assert.equal(r.reason,'invalid-quote');
 }
 const ex=params('US','AAPL','USD','NASDAQ');assert.equal((await read({...ex,fetchImpl:async()=>response(payload('AAPL',{e:'NYSE'}))})).quote,null);
 const bad=[()=>response(payload(),{headers:{'content-type':'application/json','content-length':'1'}}),()=>new Response(Buffer.from([0xff,0x7b])),()=>({ok:true,status:200,text:async()=>JSON.stringify(payload())}),()=>({ok:true,status:200,body:(async function*(){yield Buffer.alloc(65537,65);})()})];
 for(const fetchImpl of bad){const r=await read({...params(),fetchImpl:async()=>fetchImpl()});assert.equal(r.status,'unavailable');assert.equal(r.quote,null);}
});
