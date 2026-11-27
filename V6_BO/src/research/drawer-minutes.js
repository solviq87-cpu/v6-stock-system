'use strict';

const {createShortlineQuoteFallback}=require('./shortline-quote-fallback');
const {normalizeDay}=require('../core/limit-reason-evidence');
const {assessDailyBarFinality}=require('../core/a-share-calendar');
const {minuteEnd}=require('./shortline-minute-archive');

// Read-only view of the same public minutes used by shortline research. Never
// read a private workbook, start a research capture, or touch holdings on GET.
function createDrawerMinutes({reader=createShortlineQuoteFallback(),clock=Date.now}={}){
 const cache=new Map();let active=0,epoch=0,lastClock=null;
 function sample(){
  let n;try{n=clock();}catch{n=null;}
  const valid=Number.isSafeInteger(n)&&n>0&&Number.isFinite(new Date(n+28800000).getTime());
  if(!valid||lastClock!==null&&n<lastClock){cache.clear();epoch++;}
  lastClock=valid?n:null;return lastClock;
 }
 // Preserve cache identity and receipts without sharing mutable rows with readers.
 const copy=result=>structuredClone(result);
 return async function read(code,day){
  const empty=(status)=>({code,day,status,minuteBars:[]}),now=sample();
  if(now===null||typeof code!=='string'||!/^(?:60|68|00|30|92)\d{4}$/.test(code)||typeof day!=='string'||!day||day!==normalizeDay(day)||
     !assessDailyBarFinality(day,{observedAt:now,now}).usable)return empty('no-closed-session');
  const key=code+'/'+day,previous=cache.get(key);
  if(previous&&(previous.pending||previous.until>now))return previous.job.then(copy);
  if(active>=2)return empty('busy');
  for(const [k,value] of cache)if(!value.pending&&(value.until<=now||cache.size>=64))cache.delete(k);
  const slot={pending:true,until:0,epoch};active++;
  slot.job=Promise.resolve().then(()=>reader.readIntraday({secid:(code.startsWith('6')?'1.':'0.')+code,day}))
   .then(data=>{
    const finished=sample();
    if(finished===null||slot.epoch!==epoch||finished<now)return empty('unavailable');
    const expectedSecid=(code.startsWith('6')?'1.':'0.')+code;
    if(data?.secid!=null&&data.secid!==expectedSecid||data?.period!=null&&!['1m','5m'].includes(data.period)||
       data?.priceBasis!=null&&data.priceBasis!=='unadjusted'||data?.volumeUnit!=null&&data.volumeUnit!=='shares'||
       data?.receivedAt!=null&&(!Number.isSafeInteger(data.receivedAt)||data.receivedAt<Date.parse(day+'T15:00:00+08:00')||data.receivedAt>finished)||
       Array.isArray(data?.bars)&&data.bars.length>1500){
      slot.until=finished+30000;return empty('unavailable');
    }
    const byKey=new Map(),conflicts=new Set();
    for(const row of Array.isArray(data?.bars)?data.bars:[]){
     if(row?.role!=='stock'||row.code!==code||!Number.isSafeInteger(row.knownAt)||row.knownAt>finished||
       row.knownAt<Date.parse(day+'T15:00:00+08:00')||!Number.isFinite(minuteEnd(row.date,day,row.period))||
       !Number.isFinite(row.close)||row.close<=0||typeof row.source!=='string'||!row.source.trim()||
       (data.period!=null&&row.period!==data.period)||(row.priceBasis!=null&&row.priceBasis!=='unadjusted')||
       (row.volumeUnit!=null&&row.volumeUnit!=='shares')||(row.secid!=null&&row.secid!==expectedSecid)||
       (data?.src!=null&&row.source!==data.src)||(data?.receivedAt!=null&&row.knownAt!==data.receivedAt))continue;
     // Legacy close-only display rows stay readable. Explicit OHLC/volume/
     // receipt metadata must be internally consistent, never silently ignored.
     const values=[row.open,row.high,row.low];
     if(values.some(v=>v!==undefined)&&(!values.every(v=>Number.isFinite(v)&&v>0)||
        row.high<Math.max(row.open,row.close)||row.low>Math.min(row.open,row.close)))continue;
     if(row.volume!==undefined&&(!Number.isSafeInteger(row.volume)||row.volume<0)||
        row.amount!=null&&(!Number.isFinite(row.amount)||row.amount<0))continue;
     if(row.availableAt!==undefined){
      const available=typeof row.availableAt==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(row.availableAt)?
       Date.parse(row.availableAt.replace(' ','T')+':00+08:00'):NaN;
      if(!Number.isSafeInteger(available)||available>row.knownAt||row.knownAt-available>=60000||
        new Date(available+28800000).toISOString().slice(0,16).replace('T',' ')!==row.availableAt||
        available<Date.parse(day+'T15:00:00+08:00'))continue;
     }
     const key=JSON.stringify([row.source,row.period,row.date]),previous=byKey.get(key);
     if(previous&&['open','high','low','close','volume','amount','priceBasis','volumeUnit','secid'].some(k=>previous[k]!==row[k])){conflicts.add(key);byKey.delete(key);}
     if(!conflicts.has(key)&&!previous)byKey.set(key,structuredClone(row));
    }
    const minuteBars=[...byKey.values()].sort((a,b)=>a.date.localeCompare(b.date));
    slot.until=finished+(minuteBars.length?900000:30000);
    const status=minuteBars.length?'observed':data?.attempts?.some(a=>a.status==='unavailable')?'unavailable':'empty';
    return {code,day,status,minuteBars};
   }).catch(()=>{const finished=sample();if(finished!==null&&slot.epoch===epoch)slot.until=finished+30000;return empty('unavailable');})
   .finally(()=>{active--;slot.pending=false;});
  cache.set(key,slot);
  return slot.job.then(copy);
 };
}
module.exports={createDrawerMinutes};
