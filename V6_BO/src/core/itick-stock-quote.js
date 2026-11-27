'use strict';
/**
 * Optional official iTick REST quote adapter (no scraping).
 * A-share legacy observations and separately opted-in overseas observations
 * share a bounded one-shot transport, never a trading feed or poller.
 */
const {hasQuoteRedirect}=require('./public-quote-redirect-policy');
const ENDPOINT='https://api.itick.org/stock/quote',LIMIT=65536;
const validTime=n=>Number.isSafeInteger(n)&&n>0&&n<=8e15;
const validTimeout=n=>Number.isSafeInteger(n)&&n>=100&&n<=10000;
const presentToken=t=>typeof t==='string'&&t.trim()!=='';
function validateToken(t){
 if(t.length>512||t!==t.trim()||/[\x00-\x1f\x7f-\x9f]/.test(t))throw Error('iTick 凭据格式无效');
}
function issue(reason,httpStatus=null){return Object.assign(Error(reason),{reason,httpStatus});}
async function requestQuote({region,code,exchange,token,fetchImpl,timeoutMs,strictStream=false,sample=()=>{}}){
 const url=new URL(ENDPOINT);url.searchParams.set('region',region);url.searchParams.set('code',code);
 if(exchange)url.searchParams.set('exchange',exchange);
 const target=url.toString(),controller=new AbortController();let timer;
 const work=(async()=>{
  sample();
  const response=await fetchImpl(target,{redirect:'error',signal:controller.signal,headers:{accept:'application/json',token}});
  sample();
  if(hasQuoteRedirect(response,target))throw issue('redirect-refused');
  const status=response?.status;
  if(response?.ok!==true||status!==200)throw issue(status===401||status===403?'access-denied':status===429?'rate-limited':'invalid-http',
    Number.isInteger(status)&&status>=100&&status<=599?status:null);
  const declared=response.headers?.get?.('content-length');
  if(declared!=null&&(typeof declared!=='string'||!/^\d+$/.test(declared)||!Number.isSafeInteger(Number(declared))||Number(declared)>LIMIT))throw issue('invalid-length',200);
  const encoding=response.headers?.get?.('content-encoding'),ct=response.headers?.get?.('content-type');
  if(encoding!=null&&typeof encoding!=='string'||ct!=null&&(typeof ct!=='string'||!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|\s*$)/i.test(ct)))throw issue('invalid-content-type',200);
  let body,byteBasis;
  if(response.body&&typeof response.body[Symbol.asyncIterator]==='function'){
   let bytes=0;const chunks=[];
   for await(const chunk of response.body){
    sample();if(!(chunk instanceof Uint8Array))throw issue('invalid-byte-stream',200);
    bytes+=chunk.byteLength;if(bytes>LIMIT)throw issue('response-too-large',200);
    chunks.push(Buffer.from(chunk));
   }
   const raw=Buffer.concat(chunks);body=raw.toString('utf8');
   if(!Buffer.from(body,'utf8').equals(raw))throw issue('invalid-utf8',200);
   if(declared!=null&&(!encoding||encoding.toLowerCase()==='identity')&&raw.length!==Number(declared))throw issue('invalid-length',200);
   byteBasis='response-body';
  }else{
   // Keep the historical A-share injected text-only transport contract.
   // The new overseas route requires a bounded byte stream.
   if(strictStream||typeof response.text!=='function')throw issue('missing-byte-stream',200);
   body=await response.text();if(typeof body!=='string'||Buffer.byteLength(body)>LIMIT)throw issue('invalid-response',200);
   if(declared!=null&&(!encoding||encoding.toLowerCase()==='identity')&&Buffer.byteLength(body)!==Number(declared))throw issue('invalid-length',200);
   byteBasis='decoded-body-text';
  }
  const receivedAt=sample();
  let parsed;try{parsed=JSON.parse(body);}catch{throw issue('invalid-json',200);}
  if(parsed?.code!==0||!parsed.data||typeof parsed.data!=='object'||Array.isArray(parsed.data))throw issue('vendor-rejected',200);
  return {data:parsed.data,receivedAt,byteBasis};
 })();
 try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(issue('timeout'));},timeoutMs);})]);}
 finally{clearTimeout(timer);controller.abort();}
}
function validQuote(q,code,now){return typeof q.s==='string'&&q.s===code&&Number.isFinite(q.ld)&&q.ld>0&&
 Number.isFinite(q.p)&&q.p>0&&validTime(q.t)&&q.t<=now;}
async function fetchItickStockQuote({code,token,now=Date.now(),fetchImpl=globalThis.fetch,timeoutMs=6000}={}){
 if(typeof code!=='string'||!/^(?:60|68|00|30)\d{4}$/.test(code)||!validTime(now)||!validTimeout(timeoutMs)||typeof fetchImpl!=='function')
  throw Error('iTick 股票诊断参数无效');
 const empty=status=>({id:'itick',status,quote:null,verifiedLive:false,canTrade:false});
 if(!presentToken(token))return empty('unconfigured');validateToken(token);
 const exchange=code.startsWith('6')?'SH':'SZ';
 try{
  const {data:q}=await requestQuote({region:exchange,code,token,fetchImpl,timeoutMs});
  if(!validQuote(q,code,now)||q.ts!==0)return empty('unavailable');
  return {id:'itick',status:now-q.t<=15000?'fresh-unverified':'dated-snapshot',
   quote:{exchange,code,currency:'CNY',adjustment:'unadjusted',status:'normal',price:q.ld,previousClose:q.p,quoteAt:q.t},verifiedLive:false,canTrade:false};
 }catch{return empty('unavailable');}
}
// The REST response documents the symbol but does not establish all market,
// exchange or currency metadata. Keep operator declarations separate from
// returned fields; never infer an exchange or currency from the symbol alone.
const MARKETS=Object.freeze({HK:{code:/^[1-9]\d{0,4}$/,currencies:['HKD','USD','CNY']},US:{code:/^[A-Z][A-Z0-9]{0,7}(?:[.-][A-Z0-9]{1,3})?$/,currencies:['USD']},JP:{code:/^\d{4}$/,currencies:['JPY']}});
const STATES=Object.freeze({0:'normal',1:'halted',2:'delisted',3:'circuit-breaker'});
async function fetchItickGlobalStockQuote({region,code,exchange=null,currency,displayScope,token,clock=Date.now,fetchImpl=globalThis.fetch,timeoutMs=6000}={}){
 const market=typeof region==='string'&&Object.hasOwn(MARKETS,region)?MARKETS[region]:null;
 if(!market||typeof code!=='string'||!market.code.test(code)||!market.currencies.includes(currency)||
    exchange!==null&&(typeof exchange!=='string'||!/^[A-Z][A-Z0-9_-]{0,23}$/.test(exchange))||
    !validTimeout(timeoutMs)||typeof clock!=='function'||typeof fetchImpl!=='function')throw Error('iTick 海外证券或时钟参数无效');
 const base={schemaVersion:1,id:'itick',mode:'global-stock-reference-observation',region,code,requestedExchange:exchange,
  declaredCurrency:currency,currencyVerified:false,exchangeVerified:false,marketIdentityVerified:false,
  displayAuthorizationIndependentlyVerified:false,providerLicensed:false,marketSessionVerified:false,
  canTrade:false,canNotify:false,canTrain:false,verifiedLive:false,quote:null,requestStartedAt:null,receivedAt:null,quoteAgeMs:null};
 const scoped=displayScope&&typeof displayScope==='object'&&!Array.isArray(displayScope)&&displayScope.displayAuthorized===true&&
  displayScope.region===region&&displayScope.code===code&&displayScope.currency===currency&&(displayScope.exchange??null)===exchange;
 if(!scoped)return {...base,status:'authorization-unconfirmed'};
 if(!presentToken(token))return {...base,status:'unconfigured'};validateToken(token);
 let high=0,started=null;
 const sample=()=>{let at;try{at=clock();}catch{throw issue('invalid-clock');}if(!validTime(at)||at<high)throw issue('invalid-clock');high=at;return at;};
 try{
  started=sample();
  const {data:q,receivedAt,byteBasis}=await requestQuote({region,code,exchange,token,fetchImpl,timeoutMs,strictStream:true,sample});
  const publishedAt=sample();
  if(!validQuote(q,code,receivedAt)||!Number.isSafeInteger(q.ts)||!Object.hasOwn(STATES,q.ts)||
     q.r!==undefined&&q.r!==region||q.region!==undefined&&q.region!==region||
     exchange!==null&&(q.e!==undefined&&q.e!==exchange||q.exchange!==undefined&&q.exchange!==exchange)||
     q.currency!==undefined&&q.currency!==currency)throw issue('invalid-quote',200);
  // This is age of the last original trade, not evidence that the exchange
  // is open or the provider supplies an authorized real-time feed.
  const quoteAgeMs=publishedAt-q.t;
  const state=STATES[q.ts];
  return {...base,status:state==='normal'?(quoteAgeMs<=15000?'recent-reference-unverified':'dated-reference-only'):'nontrading-reference-only',
   requestStartedAt:started,receivedAt,publishedAt,quoteAgeMs,byteBasis,
   quote:{region,code,requestedExchange:exchange,reportedExchange:typeof q.e==='string'&&/^[A-Z][A-Z0-9_-]{0,23}$/.test(q.e)?q.e:null,
    currency:null,declaredCurrency:currency,adjustment:null,volumeUnit:null,status:state,price:q.ld,previousClose:q.p,quoteAt:q.t,receivedAt}};
 }catch(error){
  const known=['redirect-refused','access-denied','rate-limited','invalid-http','invalid-length','invalid-content-type','invalid-byte-stream','response-too-large','invalid-utf8','missing-byte-stream','invalid-response','invalid-json','vendor-rejected','timeout','invalid-clock','invalid-quote'];
  return {...base,status:'unavailable',requestStartedAt:started,reason:known.includes(error?.reason)?error.reason:'transport-error',httpStatus:Number.isInteger(error?.httpStatus)&&error.httpStatus>=100&&error.httpStatus<=599?error.httpStatus:null};
 }
}
module.exports={fetchItickStockQuote,fetchItickGlobalStockQuote};
