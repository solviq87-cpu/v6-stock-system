'use strict';
/**
 * One-shot public A-share endpoint health evidence, not a feed switch.
 * Redirects are observed but NEVER followed. No URL from an upstream response
 * is ever used to construct a second request.
 */
const {performance}=require('node:perf_hooks');
const {address,parse}=require('./public-market');
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
   const response=await fetchImpl(address(id,code),{
    method:'GET',redirect:'manual',signal:controller.signal
   });
   if(!response||!Number.isInteger(response.status))
    return reason('transport-error');
   const httpStatus=response.status;
   if(httpStatus>=300&&httpStatus<=399)
    return reason('redirect-refused',httpStatus);
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
 // A query can cross the lunch or close boundary. Preserve evidence,
 // but never describe that quote as a fresh trading-session observation.
 if(!session(finishedAt)){
  for(const r of results)if(r.status==='fresh-source-unverified')
   r.status='dated-snapshot';
 }
 return {...base,status:'completed-unverified',
  finishedAt:new Date(finishedAt).toISOString(),providers:results};
}
module.exports={inspectPublicQuoteEndpoints};
