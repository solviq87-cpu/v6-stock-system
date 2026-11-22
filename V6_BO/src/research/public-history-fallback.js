'use strict';
const {createHash}=require('node:crypto');
const {fetchPublicStockHistory}=require('../core/public-stock-history');
const {requestResearchBytes}=require('../core/research-curl-bytes');

async function fetchResearchHistory(input,{primary=fetchPublicStockHistory,request=requestResearchBytes,clock=Date.now}={}){
 const original=await primary(input).catch(()=>({status:'unavailable',stock:null}));
 if(original.stock?.bars?.length||!['auto',undefined].includes(input.provider))return original;
 const {symbol,historyDays=120}=input;
 if(!/^(?:60|68|00|30)\d{4}$/.test(symbol)||!Number.isSafeInteger(historyDays)||historyDays<1||historyDays>500)return original;
 const sid=(symbol.startsWith('6')?'sh':'sz')+symbol;
 const url='https://quotes.sina.cn/cn/api/openapi.php/CN_MarketDataService.getKLineData?'+new URLSearchParams({symbol:sid,scale:'240',ma:'no',datalen:String(historyDays)});
 try{
  const {raw}=await request(url,{timeoutMs:8000,maxBytes:512*1024}),at=clock(),data=JSON.parse(raw.toString('utf8')).result;
  if(data?.status?.code!==0||!Array.isArray(data.data)||data.data.length>historyDays)return original;
  const bars=[];let prior='';
  const number=v=>typeof v==='number'?v:typeof v==='string'&&/^\d+(?:\.\d+)?$/.test(v)?Number(v):NaN;
  for(const r of data.data){
   if(!/^\d{4}-\d\d-\d\d$/.test(r.day)||r.day<=prior||new Date(r.day).toISOString().slice(0,10)!==r.day)return original;
   prior=r.day;if(Date.parse(r.day+'T15:10:00+08:00')>at)continue;
   const [open,high,low,close,volume]=['open','high','low','close','volume'].map(k=>number(r[k]));
   if(![open,high,low,close].every(v=>Number.isFinite(v)&&v>0)||high<Math.max(open,close,low)||low>Math.min(open,close)||!Number.isSafeInteger(volume)||volume<0)return original;
   bars.push({date:r.day,open,high,low,close,volume,knownAt:at});
  }
  if(!bars.length)return original;
  const rawHash=createHash('sha256').update(raw).digest('hex');
  const proof={source:'sina',provider:'sina',requestUrl:url,retrievedAt:at,firstObservedAt:at,sourceTimestamp:null,rawHash,hashBasis:'raw-response-bytes'};
  return {...original,status:'observed-unverified',source:'sina',provider:'sina',priceBasis:'unadjusted',retrievedAt:at,
   stock:{symbol,name:null,source:'sina',provider:'sina',priceBasis:'unadjusted',observedAt:at,bars},
   rawHash,provenance:proof,units:{price:'CNY',volume:'shares',sourceVolume:'shares',volumeMultiplier:1,amount:null},
   rawEvidence:{encoding:'base64',data:raw.toString('base64'),sha256:rawHash,byteLength:raw.length}};
 }catch{return original;}
}
module.exports={fetchResearchHistory};
