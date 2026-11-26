'use strict';

const {createShortlineQuoteFallback}=require('./shortline-quote-fallback');
const {normalizeDay}=require('../core/limit-reason-evidence');
const {assessDailyBarFinality}=require('../core/a-share-calendar');
const {minuteEnd}=require('./shortline-minute-archive');

// Read-only view of the same public minutes used by shortline research. Never
// read a private workbook, start a research capture, or touch holdings on GET.
function createDrawerMinutes({reader=createShortlineQuoteFallback(),clock=Date.now}={}){
 const cache=new Map();let active=0,epoch=0,lastClock=null;
 function sample(){const n=clock();if(!Number.isSafeInteger(n)||n<=0||lastClock!==null&&n<lastClock){cache.clear();epoch++;}lastClock=Number.isSafeInteger(n)&&n>0?n:null;return lastClock;}
 return async function read(code,day){
  const empty=(status)=>({code,day,status,minuteBars:[]}),now=sample();
  if(now===null||!/^(?:60|68|00|30|92)\d{4}$/.test(code)||!day||day!==normalizeDay(day)||
     !assessDailyBarFinality(day,{observedAt:now,now}).usable)return empty('no-closed-session');
  const key=code+'/'+day,previous=cache.get(key);
  if(previous&&(previous.pending||previous.until>now))return previous.job;
  if(active>=2)return empty('busy');
  for(const [k,value] of cache)if(!value.pending&&(value.until<=now||cache.size>=64))cache.delete(k);
  const slot={pending:true,until:0,epoch};active++;
  slot.job=Promise.resolve().then(()=>reader.readIntraday({secid:(code.startsWith('6')?'1.':'0.')+code,day}))
   .then(data=>{
    const finished=sample();
    if(finished===null||slot.epoch!==epoch||finished<now)return empty('unavailable');
    const byKey=new Map(),conflicts=new Set();
    for(const row of Array.isArray(data?.bars)?data.bars:[]){
     if(row?.role!=='stock'||row.code!==code||!Number.isSafeInteger(row.knownAt)||row.knownAt>finished||
       row.knownAt<Date.parse(day+'T15:00:00+08:00')||!Number.isFinite(minuteEnd(row.date,day,row.period))||
       !Number.isFinite(row.close)||row.close<=0||typeof row.source!=='string'||!row.source.trim()||
       (data.period!=null&&row.period!==data.period)||(row.priceBasis!=null&&row.priceBasis!=='unadjusted')||
       (row.volumeUnit!=null&&row.volumeUnit!=='shares')||(row.secid!=null&&row.secid!==(code.startsWith('6')?'1.':'0.')+code))continue;
     const key=JSON.stringify([row.source,row.period,row.date]),previous=byKey.get(key);
     if(previous&&['open','high','low','close','volume','amount','priceBasis','volumeUnit','secid'].some(k=>previous[k]!==row[k])){conflicts.add(key);byKey.delete(key);}
     if(!conflicts.has(key)&&!previous)byKey.set(key,row);
    }
    const minuteBars=[...byKey.values()].sort((a,b)=>a.date.localeCompare(b.date));
    slot.until=finished+(minuteBars.length?900000:30000);
    const status=minuteBars.length?'observed':data?.attempts?.some(a=>a.status==='unavailable')?'unavailable':'empty';
    return {code,day,status,minuteBars};
   }).catch(()=>{const finished=sample();if(finished!==null&&slot.epoch===epoch)slot.until=finished+30000;return empty('unavailable');})
   .finally(()=>{active--;slot.pending=false;});
  cache.set(key,slot);
  return slot.job;
 };
}
module.exports={createDrawerMinutes};
