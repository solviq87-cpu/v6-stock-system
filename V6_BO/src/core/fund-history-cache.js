'use strict';

// Daily funds retain their provider dates and receipt times. Refreshing this
// cache never turns a daily estimate into a live executable quote.
const REFRESH_MS=15*60*1000;
const WINDOW=12;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const validTime=value=>Number.isSafeInteger(value)&&value>0&&value<8e15;
function dayOf(value){
 if(typeof value!=='string')return null;
 const day=value.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),time=Date.parse(day+'T00:00:00Z');
 return /^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===day?day:null;
}
function verifiedRows(input,{day,now}){
 if(!Array.isArray(input)||!input.length||input.length>32)return null;
 const seen=new Set(),rows=[];
 for(const value of input){
  const date=dayOf(value?.date),source=value?.source||value?.upstream,receivedAt=value?.retrievedAt;
  if(!date||date>day||seen.has(date)||typeof source!=='string'||!source.trim()||/mock|fixture|synthetic|simulated|demo/i.test(source)||
   ['mock','fixture','synthetic','simulated'].some(key=>value[key]===true)||
   value.fundsMethod!=='vendor-order-size-estimate'||(value.fundsUnit||value.unit)!=='CNY'||
   !validTime(receivedAt)||receivedAt>now||receivedAt<Date.parse(date+'T00:00:00+08:00')||
   value.main!==null&&!finite(value.main)||value.tradeDate&&dayOf(value.tradeDate)!==date||
   value.sourceTimestamp!=null&&(!validTime(value.sourceTimestamp)||value.sourceTimestamp>receivedAt||
    new Date(value.sourceTimestamp+28800000).toISOString().slice(0,10)!==date))return null;
  seen.add(date);rows.push({...value});
 }
 if(new Set(rows.map(row=>row.source||row.upstream)).size!==1)return null;
 return rows.sort((a,b)=>dayOf(a.date).localeCompare(dayOf(b.date))).slice(-WINDOW);
}

function createFundHistoryCache({cache,fetchHistory,clock=Date.now,refreshMs=REFRESH_MS}={}){
 if(!(cache instanceof Map)||typeof fetchHistory!=='function'||!Number.isSafeInteger(refreshMs)||refreshMs<REFRESH_MS)
  throw Error('资金历史缓存需要原 Map、供应商读取器及至少15分钟刷新间隔');
 const attempts=new Map(),pending=new Map();
 function status(code){return attempts.has(code)?{...attempts.get(code)}:null;}
 async function read(code,{day,days=10}={}){
  day=dayOf(day);const now=clock();
  if(!/^\d{6}$/.test(code||'')||!day||!Number.isSafeInteger(days)||days<1||days>10||!validTime(now)||
   day>new Date(now+28800000).toISOString().slice(0,10))throw Error('资金历史的代码、日期或窗口无效');
  if(pending.has(code)){await pending.get(code);return read(code,{day,days});}
  const previous=cache.get(code),valid=verifiedRows(previous,{day,now}),attempt=attempts.get(code);
  const knownAt=valid?.length?Math.max(...valid.map(row=>row.retrievedAt)):null;
  const complete=valid?.length>=days&&dayOf(valid.at(-1).date)===day&&valid.slice(-days).every(row=>finite(row.main));
  if(complete&&knownAt<=now&&now-knownAt<refreshMs)return previous;
  // Failed/partial responses use the same retry budget. A new trade day must
  // not inherit yesterday's successful cache, but cannot bypass live backoff.
  if(attempt&&now>=attempt.at&&now-attempt.at<refreshMs)return previous||null;
  attempts.set(code,{at:now,day,requestedDays:WINDOW,status:'loading',missing:[]});
  const request=(async()=>{
   try{
    const result=await Promise.resolve().then(()=>fetchHistory(code,WINDOW)),receivedNow=clock();
    const rows=verifiedRows(result,{day,now:receivedNow});
    if(!rows){attempts.set(code,{at:now,day,requestedDays:WINDOW,status:'unavailable',missing:['供应商逐日资金回执缺失或日期、来源、单位未通过核验']});return cache.get(code)||null;}
    // Keep the provider's complete receipt as a group. Never fill missing days
    // by mixing values from an older snapshot or by substituting zero.
    cache.set(code,rows);
    const completeWindow=rows.length>=days&&dayOf(rows.at(-1).date)===day&&rows.slice(-days).every(row=>finite(row.main));
    attempts.set(code,{at:now,day,requestedDays:WINDOW,status:completeWindow?'observed':'partial',
     latestDay:dayOf(rows.at(-1).date),receivedAt:Math.max(...rows.map(row=>row.retrievedAt)),
     missing:completeWindow?[]:['所需连续交易日或主力净额尚未齐备，保留供应商原日期']});
    return rows;
   }catch{
    attempts.set(code,{at:now,day,requestedDays:WINDOW,status:'unavailable',missing:['原资金来源暂不可用；保留已有记录并按原限频退避']});
    return cache.get(code)||null;
   }finally{pending.delete(code);}
  })();
  pending.set(code,request);return request;
 }
 return {read,status};
}
module.exports={createFundHistoryCache,verifiedRows,REFRESH_MS,WINDOW};
