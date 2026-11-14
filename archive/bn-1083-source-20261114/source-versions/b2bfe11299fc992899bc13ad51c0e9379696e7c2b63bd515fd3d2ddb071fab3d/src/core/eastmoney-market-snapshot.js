'use strict';
const {analyzeMarketBreadth}=require('./market-breadth');
const ENDPOINT='https://push2.eastmoney.com/api/qt/clist/get';
const FIELDS='f12,f14,f3,f6,f13,f2';
function parsePage(payload){
 const d=payload?.data;
 if(!d||!Number.isInteger(d.total)||d.total<1||!Array.isArray(d.diff))throw Error('东方财富响应缺少有效总数或行情列表');
 return {total:d.total,items:d.diff};
}
function toStock(item){
 const code=String(item?.f12??'');const market=Number(item?.f13);
 const pct=Number(item?.f3),amount=Number(item?.f6);
 if(!/^\d{6}$/.test(code)||![0,1].includes(market)||!Number.isFinite(pct)||pct < -100||pct>100||item.f3==='-'||item.f3===null)
  return null;
 return {code,pctChange:pct,amount:Number.isFinite(amount)&&amount>=0?amount:undefined};
}
async function fetchEastmoneySnapshot({fetchImpl=globalThis.fetch,now=Date.now(),pageSize=500,maxPages=15,timeoutMs=7000}={}){
 if(typeof fetchImpl!=='function')throw Error('缺少网络请求实现');
 if(!Number.isInteger(pageSize)||pageSize<1||pageSize>1000||!Number.isInteger(maxPages)||maxPages<1||maxPages>30)throw Error('分页参数无效');
 const date=new Date(now).toISOString().slice(0,10),seen=new Set(),stocks=[];
 let total=null,pages=0;
 for(let pn=1;pn<=maxPages;pn++){
  const url=new URL(ENDPOINT);url.searchParams.set('pn',String(pn));url.searchParams.set('pz',String(pageSize));
  url.searchParams.set('po','1');url.searchParams.set('np','1');url.searchParams.set('fltt','2');
  url.searchParams.set('fid','f3');url.searchParams.set('fs','m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23');url.searchParams.set('fields',FIELDS);
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  let data;
  try{
   const response=await fetchImpl(url.toString(),{signal:controller.signal,headers:{'Accept':'application/json'}});
   if(!response?.ok)throw Error('行情网关HTTP '+(response?.status??'未知'));
   data=parsePage(await response.json());
  }finally{clearTimeout(timer);}
  if(total===null)total=data.total;
  if(data.total!==total)throw Error('行情分页期间股票总数变化，拒绝混合快照');
  if(!data.items.length)throw Error('行情分页提前结束');
  for(const item of data.items){const stock=toStock(item);if(stock&&!seen.has(stock.code)){seen.add(stock.code);stocks.push(stock);}}
  pages++;
  if(pn*pageSize>=total)break;
 }
 if(pages*pageSize<total)throw Error('行情分页未完整抓取');
 return {date,source:'eastmoney-clist-unverified-live',universeSize:total,stocks,pages,
  retrievedAt:new Date(now).toISOString(),warning:'来源为东方财富公开接口，未认证交易所实时性；行情日期为请求日，非逐笔交易日期；不推断涨跌停'};
}
async function fetchEastmoneyBreadth(options={}){
 const snapshot=await fetchEastmoneySnapshot(options);
 return {snapshotMetadata:{date:snapshot.date,source:snapshot.source,universeSize:snapshot.universeSize,pages:snapshot.pages,retrievedAt:snapshot.retrievedAt,warning:snapshot.warning},
  breadth:analyzeMarketBreadth(snapshot,{asOf:options.now??Date.now(),minCoverage:options.minCoverage??0.8})};
}
module.exports={parsePage,toStock,fetchEastmoneySnapshot,fetchEastmoneyBreadth};
