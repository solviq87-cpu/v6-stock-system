'use strict';
// Strict historical cursor: end is an EXCLUSIVE China trading-date cutoff.
// Date cursor is not a provider quote timestamp. No market requests or orders.
function dateKey(x){
 const s=typeof x==='string'?x.replace(/-/g,''):'';
 return /^\d{8}$/.test(s)?s:'';
}
function validCursor(s){
 if(!/^\d{8}$/.test(s))return false;
 const y=+s.slice(0,4),m=+s.slice(4,6),d=+s.slice(6,8);
 const ms=Date.UTC(y,m-1,d);
 return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===
  s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8);
}
function paginateKlineRows(rows,{n=60,end=''}={}){
 if(!Array.isArray(rows))throw Error('历史K线必须是数组');
 const limit=Math.max(20,Math.min(240,Number(n)||60));
 const cutoff=end==null||end===''?'':dateKey(end);
 if(end!=null&&end!==''&&!validCursor(cutoff))throw Error('K线结束日期必须是有效YYYYMMDD');
 // klineRows returns chronological rows. Refuse malformed ordering rather than
 // leaking future bars into earlier pages or silently duplicating sessions.
 let prev='';
 for(const r of rows){
  const key=dateKey(r?.date);
  if(!validCursor(key)||prev&&key<=prev)
   throw Error('历史K线日期无效、重叠或非升序');
  prev=key;
 }
 let upper=rows.length;
 if(cutoff){
  let lo=0,hi=rows.length;
  while(lo<hi){
   const mid=(lo+hi)>>1;
   if(dateKey(rows[mid].date)>=cutoff)hi=mid;
   else lo=mid+1;
  }
  upper=lo;
 }
 const start=Math.max(0,upper-limit);
 const page=rows.slice(start,upper);
 const hasMore=start>0&&page.length>0;
 return {rows:page,n:page.length,asOf:page.at(-1)?.date||null,
  hasMore,nextEnd:hasMore?dateKey(page[0].date):null};
}
module.exports={paginateKlineRows};
