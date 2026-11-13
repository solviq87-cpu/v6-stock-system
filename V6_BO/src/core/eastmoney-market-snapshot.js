'use strict';
const {analyzeMarketBreadth}=require('./market-breadth');
const {aShareCalendarDate}=require('./a-share-calendar');
const {sourceQuoteTimeSeconds}=require('./market-snapshot-quote-time');
const {marketRequests,createMarketRequestGovernor}=require('./market-request-governor');
const ENDPOINT='https://push2.eastmoney.com/api/qt/clist/get';
// Each row is one provider quote. f5 is provider-native lots (手), NOT shares.
const FIELDS='f12,f14,f3,f6,f13,f2,f124,f5,f8,f20,f62,f184';
function sourceNumber(value,{min=-Infinity,max=Infinity}={}){
 if(typeof value!=='number'&&
    !(typeof value==='string'&&/^-?(?:\d+)(?:\.\d+)?$/.test(value)))
  return undefined;
 const n=Number(value);
 return Number.isFinite(n)&&n>=min&&n<=max?n:undefined;
}
const textValue=value=>typeof value==='string'&&value.length>0&&
 value.length<=64&&!/[\u0000-\u001f<>]/.test(value)?value:undefined;
function parsePage(payload){
 const d=payload?.data;
 if(!d||!Number.isInteger(d.total)||d.total<1||!Array.isArray(d.diff))throw Error('东方财富响应缺少有效总数或行情列表');
 return {total:d.total,items:d.diff};
}
function toStock(item){
 const code=String(item?.f12??'');const market=Number(item?.f13);
 const pct=sourceNumber(item?.f3,{min:-100,max:100});
 if(!/^\d{6}$/.test(code)||item?.f13===null||item?.f13===undefined||
    String(item.f13).trim()===''||![0,1].includes(market)||pct===undefined)
  return null;
 // Optional fields are never silently filled with 0 when the remote
 // service returns '-', null or a malformed numeric value.
 const extra={
  name:textValue(item?.f14),
  latestPrice:sourceNumber(item?.f2,{min:0.000001}),
  amount:sourceNumber(item?.f6,{min:0}),
  volumeLots:sourceNumber(item?.f5,{min:0}),
  turnoverPct:sourceNumber(item?.f8,{min:0,max:100}),
  totalMarketValue:sourceNumber(item?.f20,{min:0}),
  mainNetInflow:sourceNumber(item?.f62),
  mainNetInflowPct:sourceNumber(item?.f184,{min:-100,max:100})
 };
 return {code,pctChange:pct,
  ...Object.fromEntries(Object.entries(extra).filter(([,v])=>v!==undefined)),
  vendorQuoteAt:sourceQuoteTimeSeconds(item?.f124)};
}
async function fetchEastmoneySnapshot(options={}){
 const {fetchImpl=globalThis.fetch,now=Date.now(),pageSize=500,maxPages=15,timeoutMs=7000,maxSamplingMs=120000}=options;
 // A supplied `now` is a deliberate frozen test/replay clock unless `clock`
 // is also supplied. Live requests use a real clock to detect session rollover.
 const clock=options.clock ?? (Object.hasOwn(options,'now')?()=>now:Date.now);
 if(typeof clock!=='function')throw Error('行情时钟无效');
 if(typeof fetchImpl!=='function')throw Error('缺少网络请求实现');
 if(!Number.isInteger(pageSize)||pageSize<1||pageSize>1000||!Number.isInteger(maxPages)||maxPages<1||maxPages>30)throw Error('分页参数无效');
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000)throw Error('行情请求超时时间无效');
 if(!Number.isInteger(maxSamplingMs)||maxSamplingMs<100||maxSamplingMs>120000)throw Error('行情快照跨度上限无效');
 const physicalFetch=options.fetchImpl===undefined||fetchImpl===globalThis.fetch;
 const governor=options.requestGovernor??(physicalFetch?marketRequests:createMarketRequestGovernor());
 const date=aShareCalendarDate(now),seen=new Set(),stocks=[];
 const verifyClock=()=>{
  const instant=new Date(clock()).getTime();
  if(!Number.isFinite(instant)||instant<now)throw Error('行情采样时间无效或倒退');
  if(instant-now>maxSamplingMs)throw Error('行情分页采样跨度超过限制，拒绝混合快照');
  if(aShareCalendarDate(instant)!==date)throw Error('行情分页跨越A股市场日期，拒绝混合快照');
  return instant;
 };
 verifyClock();
 let total=null,pages=0;
 for(let pn=1;pn<=maxPages;pn++){
  const url=new URL(ENDPOINT);url.searchParams.set('pn',String(pn));url.searchParams.set('pz',String(pageSize));
  url.searchParams.set('po','1');url.searchParams.set('np','1');url.searchParams.set('fltt','2');
  url.searchParams.set('fid','f3');url.searchParams.set('fs','m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23');url.searchParams.set('fields',FIELDS);
  const target=url.toString(),request=async()=>{
   // Queue time counts toward the sampling span, but never consumes a wire
   // timeout. Recheck after waiting so an expired snapshot sends no new page.
   verifyClock();
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
   try{
    const response=await fetchImpl(target,{signal:controller.signal,headers:{'Accept':'application/json'}});
    governor.checkResponse(target,response?.status,response?.headers);
    if(!response?.ok)throw Error('行情网关HTTP '+(response?.status??'未知'));
    return parsePage(await response.json());
   }finally{clearTimeout(timer);controller.abort();}
  };
  const data=await (physicalFetch||options.requestGovernor?governor.run(target,request):request());
  if(total===null)total=data.total;
  if(data.total!==total)throw Error('行情分页期间股票总数变化，拒绝混合快照');
  const expected=Math.min(pageSize,total-(pn-1)*pageSize);
  if(data.items.length!==expected)throw Error('行情分页记录数异常，拒绝不完整或重叠分页');
  for(const item of data.items){
   const stock=toStock(item);
   if(!stock)continue;
   if(seen.has(stock.code))throw Error('行情跨页股票代码重复，拒绝可能错位的快照');
   seen.add(stock.code);stocks.push(stock);
  }
  pages++;
  verifyClock();
  if(pn*pageSize>=total)break;
 }
 if(pages*pageSize<total)throw Error('行情分页未完整抓取');
 const completedAt=verifyClock();
 const quoteTimes=stocks.map(s=>s.vendorQuoteAt).filter(Number.isSafeInteger);
 const quotedDays=new Set(quoteTimes.map(t=>aShareCalendarDate(t)));
 const sourceCoverage={
  present:quoteTimes.length,missing:stocks.length-quoteTimes.length,
  minVendorQuoteAt:quoteTimes.length?Math.min(...quoteTimes):null,
  maxVendorQuoteAt:quoteTimes.length?Math.max(...quoteTimes):null,
  // Request clock and per-stock quote timestamps are independent. A group
  // covering multiple quote dates is usable only as explicitly marked data,
  // never as one unified live quote time.
  supplierQuoteDates:[...quotedDays].sort(),
  vendorTimeCertified:false,volumeUnit:'provider-lots-not-shares',
  monetaryUnit:'provider-CNY-unverified'
 };
 return {date,source:'eastmoney-clist-unverified-live',universeSize:total,stocks,pages,verifiedLive:false,
  sourceCoverage,
  startedAt:new Date(now).toISOString(),retrievedAt:new Date(completedAt).toISOString(),samplingDurationMs:completedAt-now,warning:'来源为东方财富公开接口，未认证交易所实时性；行情日期为请求日，非逐笔交易日期；不推断涨跌停'};
}
async function fetchEastmoneyBreadth(options={}){
 const snapshot=await fetchEastmoneySnapshot(options);
 return {snapshotMetadata:{date:snapshot.date,source:snapshot.source,universeSize:snapshot.universeSize,pages:snapshot.pages,
  verifiedLive:snapshot.verifiedLive,startedAt:snapshot.startedAt,retrievedAt:snapshot.retrievedAt,samplingDurationMs:snapshot.samplingDurationMs,sourceCoverage:snapshot.sourceCoverage,warning:snapshot.warning},
  breadth:analyzeMarketBreadth(snapshot,{asOf:options.now??Date.now(),minCoverage:options.minCoverage??0.8})};
}
module.exports={parsePage,toStock,fetchEastmoneySnapshot,fetchEastmoneyBreadth};
