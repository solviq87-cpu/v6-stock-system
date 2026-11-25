'use strict';

const {createShortlineQuoteFallback}=require('./shortline-quote-fallback');
const {normalizeDay}=require('../core/limit-reason-evidence');
const {assessDailyBarFinality}=require('../core/a-share-calendar');

// Read-only view of the same public minutes used by shortline research. Never
// read a private workbook, start a research capture, or touch holdings on GET.
function createDrawerMinutes({reader=createShortlineQuoteFallback(),clock=Date.now}={}){
 const cache=new Map();let active=0;
 return async function read(code,day){
  const empty=(status)=>({code,day,status,minuteBars:[]}),now=clock();
  if(!/^(?:60|68|00|30|92)\d{4}$/.test(code)||!day||day!==normalizeDay(day)||
     !assessDailyBarFinality(day,{observedAt:now,now}).usable)return empty('no-closed-session');
  const key=code+'/'+day,previous=cache.get(key);
  if(previous&&(previous.pending||previous.until>now))return previous.job;
  if(active>=2)return empty('busy');
  for(const [k,value] of cache)if(!value.pending&&(value.until<=now||cache.size>=64))cache.delete(k);
  const slot={pending:true,until:0};active++;
  slot.job=Promise.resolve().then(()=>reader.readIntraday({secid:(code.startsWith('6')?'1.':'0.')+code,day}))
   .then(data=>{
    const minuteBars=(data?.bars||[]).filter(row=>row?.role==='stock'&&row.code===code&&typeof row.date==='string'&&row.date.startsWith(day+' ')&&
     Number.isSafeInteger(row.knownAt)&&row.knownAt<=clock());
    slot.until=clock()+(minuteBars.length?900000:30000);
    const status=minuteBars.length?'observed':data?.attempts?.some(a=>a.status==='unavailable')?'unavailable':'empty';
    return {code,day,status,minuteBars};
   }).catch(()=>{slot.until=clock()+30000;return empty('unavailable');})
   .finally(()=>{active--;slot.pending=false;});
  cache.set(key,slot);
  return slot.job;
 };
}
module.exports={createDrawerMinutes};
