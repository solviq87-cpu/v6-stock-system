'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evolutionHttp,parseQuery}=require('../src/server/evolution-http');
const now=Date.parse('2026-11-20T16:00:00+08:00');
async function call({method='GET',query='',body='',headers={},role='edit',replica=false,job,authenticate,readQuote}={}){
 const calls=[];let status,result,responseHeaders;
 const req={method,headers:{host:'fayo.test',authorization:'Bearer fixture-token',...headers},socket:{}};
 const res={writeHead:(s,h)=>{status=s;responseHeaders=h;},end:raw=>{result=JSON.parse(raw);}};
 await evolutionHttp(req,res,{body:typeof body==='string'?body:JSON.stringify(body),url:new URL('http://fayo.test/api/research/evolution'+query),
  root:'/private/shortline',workspaceRoot:'/private/workspace',paths:{evidenceRoot:'/private/evidence'},
  authenticate:authenticate||(()=>role),isReplica:()=>replica,clock:()=>now,calendarFor:at=>({knownAt:at,source:'fixture'}),
  readQuote,
  job:async(p,options)=>{calls.push(p);return job?job(p,options):{ok:true,result:{fixture:true}};}});
 return {status,result,headers:responseHeaders,calls};
}
test('evolution query allows only explicit symbols, past instants and bounded horizons',()=>{
 assert.deepEqual(parseQuery(new URL('http://fayo.test?symbol=600001&asOf='+now+'&horizon=20&export=1'),now),{code:'600001',asOf:now,horizon:20,export:true});
 for(const q of ['?symbol=600001&symbol=600002','?asOf='+String(now+1),'?symbol=../ledger','?horizon=2','?file=/etc/passwd','?export=yes','?asOf=2026-11-20'])assert.throws(()=>parseQuery(new URL('http://fayo.test'+q),now),undefined,q);
});
test('private evolution report denies viewer, missing role, foreign origin and unsupported verbs before queuing',async()=>{
 for(const args of [{role:'view'},{role:null},{headers:{origin:'https://foreign.invalid'}},{headers:{'sec-fetch-site':'cross-site'}},{method:'DELETE'},{body:'{}'}]){
  const r=await call(args);assert.ok([400,403,405].includes(r.status));assert.equal(r.calls.length,0);
 }
});
test('read/export carries private no-store and rechecks revocation after the worker',async()=>{
 const r=await call({query:'?export=1&symbol=600001'});assert.equal(r.status,200);assert.match(r.headers['Cache-Control'],/private, no-store/);assert.equal(r.calls[0].action,'evolution');assert.equal(r.calls[0].query.export,true);
 let allowed=true;const revoked=await call({authenticate:()=>allowed?'edit':null,job:async()=>{allowed=false;return {ok:true,result:{private:'must not return'}};}});
 assert.equal(revoked.status,403);assert.equal(JSON.stringify(revoked.result).includes('must not return'),false);
});
test('preference writes require idempotency, revision and whitelist without accepting paths or execution',async()=>{
 const base={action:'preferences',requestId:'valid_request_123',expectedRevision:0,value:{selectedCode:'600001'}};
 const valid=await call({method:'POST',body:base,job:async(p,gate)=>{assert.equal(gate.authorize(),true);assert.deepEqual(p.input,base);return {ok:true};}});
 assert.equal(valid.status,200);assert.equal(valid.calls[0].action,'evolution-preferences');
 for(const body of [{...base,root:'/public'}, {...base,canTrade:true},{...base,action:'execute'}, {...base,expectedRevision:-1},{...base,requestId:'x'},[],null]){
  const r=await call({method:'POST',body:JSON.stringify(body)});assert.equal(r.status,400);assert.equal(r.calls.length,0);
 }
 assert.equal((await call({method:'POST',query:'?symbol=600001',body:base})).status,400);
 assert.equal((await call({method:'POST',body:'x'.repeat(65537)})).status,413);
});
test('diagnostics use bounded server inputs and primary authorization',async()=>{
 const body={action:'diagnostics',requestId:'diagnostic_123',symbol:'600001',asOf:String(now),horizon:'5'};
 const r=await call({method:'POST',body});assert.equal(r.status,200);assert.equal(r.calls[0].action,'evolution-diagnostics');assert.equal(r.calls[0].query.asOf,now);
 assert.equal((await call({method:'POST',body:{...body,history:{stocks:[]}}})).status,400);
 assert.equal((await call({method:'POST',body:{...body,asOf:now}})).status,400);
 assert.equal((await call({method:'POST',body,replica:true})).status,409);
 assert.equal((await call({replica:true})).status,200);
});
test('worker failures never reveal private filesystem details',async()=>{
 const r=await call({job:async()=>{throw Error('/private/credentials/secret-value');}});assert.equal(r.status,503);assert.doesNotMatch(JSON.stringify(r.result),/credentials|secret-value/);
});
test('original quotes are read only after authorization and validated symbol selection',async()=>{
 const quote={code:'600001',price:10,quoteAt:now-5000,receivedAt:now-4000,quoteSource:'tencent',quoteMode:'public-live-unverified'},reads=[];
 const readQuote=(code,asOf)=>{reads.push({code,asOf});return quote;};
 const valid=await call({query:'?symbol=600001',readQuote});
 assert.equal(valid.status,200);assert.deepEqual(valid.calls[0].latestQuote,quote);assert.deepEqual(reads,[{code:'600001',asOf:now}]);
 for(const args of [{role:'view',query:'?symbol=600001'},{query:'?symbol=../secret'},{query:'?symbol=600001&price=1'},{query:''},
  {method:'POST',body:{action:'diagnostics',requestId:'diagnostic_quote_1',symbol:'600001'}}])await call({...args,readQuote});
 assert.equal(reads.length,1,'no anonymous, client-supplied quote, unselected symbol or write can invoke a quote read');
 const historical=await call({query:'?symbol=600001&asOf='+String(now-6000),readQuote});
 assert.equal(historical.calls[0].latestQuote,null,'a current wire quote cannot replace historical plan observations');
});
