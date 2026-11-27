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
function verifiedRows(input,{day,now,code}={}){
 if(!dayOf(day)||!validTime(now)||!Array.isArray(input)||!input.length||input.length>32)return null;
 const seen=new Set(),rows=[];
 for(const value of input){
  const date=dayOf(value?.date),source=value?.source||value?.upstream,receivedAt=value?.retrievedAt;
  const sources=[value?.source,value?.upstream,value?.fundsSource].filter(v=>v!=null);
  const units=[value?.fundsUnit,value?.unit].filter(v=>v!=null);
  const aliases=[value?.mainInflow,value?.mainInflowYuan,value?.netInflowYuan].filter(v=>v!=null);
  if(!value||typeof value!=='object'||Array.isArray(value)||
   ['code','symbol'].some(k=>value[k]!=null&&(typeof value[k]!=='string'||!/^\d{6}$/.test(value[k])||code!==undefined&&value[k]!==code))||
   value.code!=null&&value.symbol!=null&&value.code!==value.symbol||
   ['super','big','mid','small'].some(k=>value[k]!=null&&!finite(value[k]))||
   sources.some(v=>typeof v!=='string'||v!==source)||units.some(v=>v!=='CNY')||
   aliases.some(v=>!finite(v)||v!==value?.main)||
   value?.fundsRetrievedAt!=null&&value.fundsRetrievedAt!==receivedAt||
   value?.fundsSourceTimestamp!=null&&value.fundsSourceTimestamp!==value.sourceTimestamp||
   value?.fundsTradeDate!=null&&dayOf(value.fundsTradeDate)!==date||
   value?.fundsConflict===true||value?.fundsSourceConflict===true)return null;
  if(!date||date>day||seen.has(date)||typeof source!=='string'||!source.trim()||/mock|fixture|synthetic|simulated|demo/i.test(source)||
   ['mock','fixture','synthetic','simulated','imported'].some(key=>value[key]===true)||
   value.fundsMethod!=='vendor-order-size-estimate'||(value.fundsUnit||value.unit)!=='CNY'||
   !validTime(receivedAt)||receivedAt>now||receivedAt<Date.parse(date+'T00:00:00+08:00')||
   value.main!==null&&!finite(value.main)||value.tradeDate!=null&&dayOf(value.tradeDate)!==date||
   value.sourceTimestamp!=null&&(!validTime(value.sourceTimestamp)||value.sourceTimestamp>receivedAt||
    new Date(value.sourceTimestamp+28800000).toISOString().slice(0,10)!==date))return null;
  seen.add(date);rows.push({...value});
 }
 if(new Set(rows.map(row=>row.source||row.upstream)).size!==1)return null;
 return rows.sort((a,b)=>dayOf(a.date).localeCompare(dayOf(b.date))).slice(-WINDOW);
}

function currentDay(now){return validTime(now)?new Date(now+28800000).toISOString().slice(0,10):null;}
function newerReceipt(rows,previous){
 if(!previous?.length)return true;
 if(dayOf(rows.at(-1).date)<dayOf(previous.at(-1).date)||
    Math.max(...rows.map(r=>r.retrievedAt))<Math.max(...previous.map(r=>r.retrievedAt)))return false;
 const prior=new Map(previous.map(row=>[dayOf(row.date),row]));
 return rows.every(row=>{
  const old=prior.get(dayOf(row.date));if(!old)return true;
  if(row.retrievedAt<old.retrievedAt)return false;
  const sameSource=(row.source||row.upstream)===(old.source||old.upstream);
  if(sameSource&&old.sourceTimestamp!=null&&
     (row.sourceTimestamp==null||row.sourceTimestamp<old.sourceTimestamp))return false;
  if(row.retrievedAt!==old.retrievedAt&&!(sameSource&&row.sourceTimestamp!=null&&row.sourceTimestamp===old.sourceTimestamp))return true;
  return ['main','super','big','mid','small','sourceTimestamp','fundsMethod'].every(key=>(row[key]??null)===(old[key]??null))&&
   (row.source||row.upstream)===(old.source||old.upstream);
 });
}

// Never derive exchange sessions from the very history being audited. The
// original research calendar is available only after its recorded observation.
function defaultCalendarReader(options){return require('./research-calendar-source').readResearchCalendar(options);}
function validCalendar(calendar){
 const from=calendar?.calendar?.from,to=calendar?.calendar?.to,dates=calendar?.tradeDates;
 return calendar?.status==='available'&&dayOf(from)===from&&dayOf(to)===to&&typeof from==='string'&&typeof to==='string'&&from<=to&&
  Array.isArray(dates)&&dates.length<=4000&&dates.every((d,i)=>dayOf(d)===d&&typeof d==='string'&&d>=from&&d<=to&&(!i||d>dates[i-1]));
}
function coverageOf(rows,{day,days,calendar}){
 const unknown={complete:false,calendarCoverage:'unknown',coverageStatus:'calendar-unavailable',expectedSessions:null,missingSessions:null,closedDayRows:null};
 if(!validCalendar(calendar)||day<calendar.calendar.from||day>calendar.calendar.to)return unknown;
 const expected=calendar.tradeDates.filter(d=>d<=day).slice(-days);
 if(expected.length!==days||expected.at(-1)!==day)return {...unknown,coverageStatus:'calendar-window-unavailable'};
 const observed=new Map((rows||[]).map(r=>[dayOf(r.date),r])),open=new Set(calendar.tradeDates);
 const missing=expected.filter(d=>!finite(observed.get(d)?.main));
 const closed=[...observed.keys()].filter(d=>d>=calendar.calendar.from&&d<=calendar.calendar.to&&!open.has(d));
 return {complete:missing.length===0&&closed.length===0,calendarCoverage:'explicit-research-calendar-unverified',
  coverageStatus:closed.length?'calendar-conflict':missing.length?'gaps':'complete-by-declared-calendar',
  expectedSessions:expected,missingSessions:missing,closedDayRows:closed};
}

function createFundHistoryCache({cache,fetchHistory,clock=Date.now,refreshMs=REFRESH_MS,calendarReader=defaultCalendarReader}={}){
 if(!(cache instanceof Map)||typeof fetchHistory!=='function'||typeof clock!=='function'||typeof calendarReader!=='function'||!Number.isSafeInteger(refreshMs)||refreshMs<REFRESH_MS)
  throw Error('资金历史缓存需要原 Map、供应商读取器及至少15分钟刷新间隔');
 const attempts=new Map(),pending=new Map();
 let highWater=null,epoch=0;
 function sample(){
  let at;try{at=clock();}catch{at=null;}
  const valid=validTime(at),trusted=valid&&(highWater===null||at>=highWater);
  if(!trusted)epoch++;else highWater=at;
  return {at:valid?at:null,trusted,epoch};
 }
 function calendarFor(code,now){try{const cal=calendarReader({symbol:code,asOf:now});return validCalendar(cal)&&currentDay(now)>=cal.calendar.from&&currentDay(now)<=cal.calendar.to?cal:null;}catch{return null;}}
 function verified(code,day,now,input){return verifiedRows(input,{code,day,now});}
 function retained(code,day,now){
  const value=cache.get(code),rows=verified(code,day,now,value);
  if(!rows)return null;
  // Keep the existing Map/array identity contract for a canonical window.
  return value.length===rows.length&&value.every((r,i)=>dayOf(r.date)===dayOf(rows[i].date))?value:rows;
 }
 function status(code){return attempts.has(code)?structuredClone(attempts.get(code)):null;}
 function setStatus(code,at,day,days,rows,calendar){
  const coverage=coverageOf(rows,{day,days,calendar});
  attempts.set(code,{at,day,requestedDays:WINDOW,status:coverage.complete?'observed':'partial',
   latestDay:dayOf(rows.at(-1).date),receivedAt:Math.max(...rows.map(r=>r.retrievedAt)),
   ...coverage,calendarExternallyVerified:false,canTrade:false,
   missing:coverage.complete?[]:[coverage.calendarCoverage==='unknown'?'交易日历证据不足，不能认定窗口连续':'所需交易日或主力净额尚未齐备，保留供应商原日期']});
 }
 async function read(code,{day,days=10}={}){
  day=dayOf(day);const first=sample(),now=first.at;
  if(typeof code!=='string'||!/^\d{6}$/.test(code)||!day||!Number.isSafeInteger(days)||days<1||days>10||!validTime(now)||
   day>currentDay(now))throw Error('资金历史的代码、日期或窗口无效');
  if(!first.trusted)return retained(code,day,now);
  const calendar=calendarFor(code,now);
  // A current provider window cannot answer a historical cutoff before its
  // last session. The original endpoint fetches the latest fixed window, not
  // a historical page. Do not start work which cannot answer that request.
  const previous=cache.get(code),valid=verified(code,day,now,previous),attempt=attempts.get(code);
  const latest=valid||verified(code,currentDay(now),now,previous);
  if(latest?.length&&dayOf(latest.at(-1).date)>day)return null;
  const latestSession=calendar?.status==='available'&&Array.isArray(calendar.tradeDates)?
   calendar.tradeDates.filter(d=>d<=currentDay(now)).at(-1):null;
  if(latestSession&&day<latestSession)return retained(code,day,now);
  // Share one in-flight retrieval. Revalidate the stored receipt against each
  // waiter's own day and clock, but never recursively start a second request
  // just because the first has consumed the refresh interval.
  if(pending.has(code)){await pending.get(code);return retained(code,day,sample().at);}
  const knownAt=valid?.length?Math.max(...valid.map(row=>row.retrievedAt)):null;
  const complete=valid?.length>=days&&dayOf(valid.at(-1).date)===day&&valid.slice(-days).every(row=>finite(row.main));
  if(complete&&knownAt<=now&&now-knownAt<refreshMs){
   if(!attempt||attempt.status==='observed'||attempt.status==='partial')setStatus(code,attempt?.at??knownAt,day,days,valid,calendar);
   return retained(code,day,now);
  }
  // Failed/partial responses use the same retry budget. A new trade day must
  // not inherit yesterday's successful cache, but cannot bypass live backoff.
  if(attempt&&(now<attempt.at||now-attempt.at<refreshMs))return retained(code,day,now);
  attempts.set(code,{at:now,day,requestedDays:WINDOW,status:'loading',missing:[]});
  const request=(async()=>{
   try{
    let dispatchedAt=null;
    const result=await Promise.resolve().then(()=>{
     const dispatch=sample();
     if(!dispatch.trusted||dispatch.epoch!==first.epoch||currentDay(dispatch.at)!==currentDay(now))throw Error('资金采集会话已失效');
     dispatchedAt=dispatch.at;return fetchHistory(code,WINDOW);
    }),receipt=sample(),receivedNow=receipt.at;
    const rows=receipt.trusted&&receipt.epoch===first.epoch&&currentDay(receivedNow)===currentDay(now)?
     verified(code,day,receivedNow,result):null;
    // A newly fetched batch must carry actual receipt times from this request.
    if(rows?.some(row=>row.retrievedAt<dispatchedAt)){
     attempts.set(code,{at:now,day,requestedDays:WINDOW,status:'unavailable',missing:['旧接收回执不能冒充本次恢复取数']});
     return retained(code,day,receivedNow);
    }
    if(!rows){attempts.set(code,{at:now,day,requestedDays:WINDOW,status:'unavailable',missing:['供应商逐日资金回执缺失或日期、来源、单位未通过核验']});return retained(code,day,receivedNow);}
    // Keep the provider's complete receipt as a group. Never fill missing days
    // by mixing values from an older snapshot or by substituting zero.
    const latest=verified(code,currentDay(receivedNow),receivedNow,cache.get(code));
    if(!newerReceipt(rows,latest)){
     attempts.set(code,{at:now,day,requestedDays:WINDOW,status:'unavailable',missing:['迟到、时间倒退或同回执金额冲突；保留已有原始记录']});
     return retained(code,day,receivedNow);
    }
    cache.set(code,rows);
    setStatus(code,now,day,days,rows,calendar);
    return rows;
   }catch{
    attempts.set(code,{at:now,day,requestedDays:WINDOW,status:'unavailable',missing:['原资金来源暂不可用；保留已有记录并按原限频退避']});
    return retained(code,day,sample().at);
   }finally{pending.delete(code);}
  })();
  pending.set(code,request);return request;
 }
 return {read,status};
}
module.exports={createFundHistoryCache,verifiedRows,REFRESH_MS,WINDOW};
