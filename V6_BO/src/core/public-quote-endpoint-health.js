'use strict';
/**
 * One-shot public A-share endpoint health evidence, not a feed switch.
 * Redirects are observed but NEVER followed. No URL from an upstream response
 * is ever used to construct a second request.
 */
const {performance}=require('node:perf_hooks');
const {address,parse}=require('./public-market');
const {hasQuoteRedirect}=require('./public-quote-redirect-policy');
const {session}=require('./quote-dual-source-diagnostic');
const IDS=Object.freeze(['tencent','eastmoney','sina']);
const SIZE_LIMIT=65536;
const safeNow=n=>Number.isSafeInteger(n)&&n>0;
const elapsed=start=>Math.max(0,Math.round(performance.now()-start));
function reason(status,code=null){return {status,httpStatus:code,quoteAt:null,
 quoteAgeMs:null,price:null,previousClose:null};}
async function boundedBody(response){
 const header=response.headers?.get?.('content-length');
 if(header!==null&&header!==undefined&&/^\d+$/.test(header)&&Number(header)>SIZE_LIMIT)
  throw Error('body-too-large');
 if(!response.body||typeof response.body[Symbol.asyncIterator]!=='function')
  throw Error('invalid-response');
 const chunks=[];let n=0;
 for await(const chunk of response.body){
  const buf=Buffer.from(chunk);n+=buf.length;
  if(n>SIZE_LIMIT)throw Error('body-too-large');
  chunks.push(buf);
 }
 return Buffer.concat(chunks);
}
async function inspectOne({id,code,clock,fetchImpl,timeoutMs}){
 const started=performance.now();
 const controller=new AbortController();
 let timer;
 const work=(async()=>{
  try{
   const requestUrl=address(id,code);
   const response=await fetchImpl(requestUrl,{
    method:'GET',redirect:'manual',signal:controller.signal
   });
   if(hasQuoteRedirect(response,requestUrl))
    return reason('redirect-refused',Number.isInteger(response?.status)&&response.status>=300&&response.status<400?response.status:null);
   if(!response||!Number.isInteger(response.status))
    return reason('transport-error');
   const httpStatus=response.status;
   if(httpStatus===401||httpStatus===403)
    return reason('access-denied',httpStatus);
   if(httpStatus===429)
    return reason('rate-limited',httpStatus);
   if(!response.ok)return reason('http-error',httpStatus);
   let raw;
   try{raw=await boundedBody(response);}
   catch(e){return reason(e.message==='body-too-large'?'response-too-large':'invalid-response',httpStatus);}
   let q;
   try{
    const text=id==='eastmoney'?raw.toString('utf8'):new TextDecoder('gb18030').decode(raw);
    q=parse(id,text,code);
   }catch{return reason('invalid-quote',httpStatus);}
   const observedAt=clock();
   if(!safeNow(observedAt)||q.timestamp>observedAt)
    return reason('invalid-quote-time',httpStatus);
   const age=observedAt-q.timestamp;
   const fresh=age<=15000&&session(observedAt);
   return {status:fresh?'fresh-source-unverified':'dated-snapshot',
    httpStatus,quoteAt:q.timestamp,quoteAgeMs:age,
    price:q.price,previousClose:q.previousClose};
  }catch{return reason(controller.signal.aborted?'timeout':'transport-error');}
 })();
 try{
  const timed=new Promise(resolve=>{
   timer=setTimeout(()=>{controller.abort();resolve(reason('timeout'));},timeoutMs);
  });
  const result=await Promise.race([work,timed]);
  return {provider:id,...result,elapsedMs:elapsed(started)};
 }finally{
  clearTimeout(timer);
  controller.abort();
 }
}
async function inspectPublicQuoteEndpoints({
 code,clock=Date.now,fetchImpl=globalThis.fetch,timeoutMs=5000,providers=IDS
}={}){
 address('tencent',code); // upfront symbol validation, no network
 if(typeof clock!=='function'||typeof fetchImpl!=='function'||
  !Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000||
  !Array.isArray(providers)||providers.length===0||providers.length>IDS.length||
  new Set(providers).size!==providers.length||providers.some(x=>!IDS.includes(x)))
  throw Error('公开报价健康检查参数无效');
 const startedAt=clock();
 if(!safeNow(startedAt))throw Error('检查时钟无效');
 const base={schemaVersion:1,mode:'one-shot-public-quote-endpoint-health',
  code,startedAt:new Date(startedAt).toISOString(),
  providerLicensed:false,verifiedLive:false,exchangeCalendarVerified:false,
  canTrade:false,canNotify:false,
  note:'仅限低频只读接口健康诊断：3xx拒绝跟随、不绕过401/403/429；带供应商时间的最近报价不代表授权实时行情。'};
 if(!session(startedAt)){
  return {...base,status:'outside-weekday-session-window',
   providers:providers.map(id=>({provider:id,...reason('not-requested'),elapsedMs:0}))};
 }
 const results=await Promise.all(providers.map(id=>
  inspectOne({id,code,clock,fetchImpl,timeoutMs})));
 const finishedAt=clock();
 if(!safeNow(finishedAt))throw Error('结束时钟无效');
 // A fast peer may have been fresh when its response arrived but expired
 // while awaiting slower peers. Recompute every reported age at publication;
 // do not let response-completion time masquerade as report time.
 for(const r of results){
  if(Number.isSafeInteger(r.quoteAt)&&r.quoteAt>0)
   r.quoteAgeMs=finishedAt-r.quoteAt;
  if(r.status!=='fresh-source-unverified')continue;
  if(r.quoteAt===null||r.quoteAt>finishedAt){
   r.status='invalid-quote-time';
  }else if(finishedAt<startedAt||!session(finishedAt)||
           r.quoteAgeMs>15000){
   r.status='dated-snapshot';
  }
 }
 return {...base,status:finishedAt<startedAt?'clock-regressed':'completed-unverified',
  finishedAt:new Date(finishedAt).toISOString(),providers:results};
}
module.exports={inspectPublicQuoteEndpoints};
