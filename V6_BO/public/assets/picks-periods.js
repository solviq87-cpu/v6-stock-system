/* V6 read-only historical period aggregation. No quote fetching or trade logic. */
(function(root){
'use strict';
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 !Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const value=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
function normalize(rows){
 if(!Array.isArray(rows))return [];
 const out=[];
 for(const r of rows){
  if(!r||!validDate(r.date))continue;
  const open=value(r.open),high=value(r.high),low=value(r.low),close=value(r.close);
  if(open===null||high===null||low===null||close===null||low<=0||
     low>Math.min(open,close)||high<Math.max(open,close)||high<low)continue;
  const volume=value(r.volume);
  out.push({date:r.date,open,high,low,close,volume:volume!==null&&volume>=0?volume:null});
 }
 out.sort((a,b)=>a.date.localeCompare(b.date));
 // Same-day duplicates are not equivalent to additional trading sessions.
 return out.filter((r,i)=>i===0||out[i-1].date!==r.date);
}
function aggregate(rows,period){
 if(!['day','month','year'].includes(period))throw Error('unsupported K-line period');
 const daily=normalize(rows);
 if(period==='day')return daily;
 const result=[];
 for(const r of daily){
  const bucket=period==='month'?r.date.slice(0,7):r.date.slice(0,4);
  const last=result[result.length-1];
  if(last&&last.period===bucket){
   last.date=r.date;
   last.high=Math.max(last.high,r.high);
   last.low=Math.min(last.low,r.low);
   last.close=r.close;
   last.sessions++;
   last.volume=last.volume===null||r.volume===null?null:last.volume+r.volume;
  }else result.push({period:bucket,date:r.date,open:r.open,high:r.high,low:r.low,
   close:r.close,volume:r.volume,sessions:1});
 }
 return result;
}
const api=Object.freeze({normalize,aggregate});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.V6PicksPeriods=api;
})(typeof globalThis==='object'?globalThis:this);
