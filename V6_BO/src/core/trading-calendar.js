'use strict';
const crypto=require('node:crypto');
const valid=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
function createTradingCalendar(data){
  if(!data||data.schemaVersion!==1||!['SSE','SZSE','BSE'].includes(data.exchange)||typeof data.source!=='string'||!data.source.trim()||!valid(data.from)||!valid(data.to)||data.from>data.to||!Array.isArray(data.sessions)||data.sessions.length>40000)throw Error('交易日历格式无效');
  const days=new Map();
  for(const row of data.sessions){if(!row||!valid(row.date)||typeof row.open!=='boolean'||row.date<data.from||row.date>data.to||days.has(row.date))throw Error('交易日历日期重复或无效');days.set(row.date,row.open);}
  const count=(Date.parse(data.to)-Date.parse(data.from))/86400000+1;
  if(days.size!==count)throw Error('交易日历必须明确覆盖范围内的每一天');
  const openDays=[...days].filter(([,open])=>open).map(([d])=>d).sort();
  const metadata={exchange:data.exchange,source:data.source,from:data.from,to:data.to,verifiedExternal:false,sha256:crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex')};
  function isOpen(date){if(!valid(date)||!days.has(date))throw Error('日期不在交易日历覆盖范围');return days.get(date);}
  return {metadata,isOpen,next(date){isOpen(date);return openDays.find(d=>d>date)||null;},assertDates(dates){
    if(!Array.isArray(dates)||!dates.length)throw Error('交易日期为空');
    for(let i=0;i<dates.length;i++)if(!isOpen(dates[i])||(i&&dates[i]<=dates[i-1]))throw Error('行情含休市日或非递增日期');
    const expected=openDays.filter(d=>d>=dates[0]&&d<=dates.at(-1));
    if(JSON.stringify(expected)!==JSON.stringify(dates))throw Error('行情缺少交易日，停牌须提供状态占位');
    return {valid:true,sessions:dates.length,...metadata};
  }};
}
module.exports={createTradingCalendar};
