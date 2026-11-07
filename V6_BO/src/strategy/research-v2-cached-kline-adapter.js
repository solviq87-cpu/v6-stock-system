 'use strict';
const {aShareCalendarDate,aShareCalendarAgeDays,assessDailyBarFinality}=require('../core/a-share-calendar');
const {completeOHLCV}=require('./kline-bar-validation');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function adaptCachedKline(code,k,{cachedAt=0,now=Date.now()}={}){
 if(!/^\d{6}$/.test(String(code))||!k||!Array.isArray(k.rows))return {stock:null,error:'缓存代码或结构无效'};
 if(k.rows.slice(-500).some(r=>!completeOHLCV(r)))return {stock:null,error:"缓存K线字段缺失"};
 const rows=k.rows.slice(-500);
 const flags=['isST','suspended','tradable'],limits=['upperLimit','lowerLimit','limitPct'];
 for(const row of rows){
  if(flags.some(key=>row[key]!==undefined&&typeof row[key]!=='boolean')||
     limits.some(key=>row[key]!==undefined&&(!finite(row[key])||row[key]<=0))||
     row.lowerLimit>row.upperLimit||row.limitPct>100)return {stock:null,error:'逐日限价或交易状态无效'};
 }
 const bars=rows.map(r=>({date:String(r.date||''),open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),volume:Number(r.volume??r.vol),
  ...Object.fromEntries([...flags,...limits].filter(key=>r[key]!==undefined).map(key=>[key,r[key]]))}));
 if(bars.length<27||bars.some(b=>![b.open,b.high,b.low,b.close,b.volume].every(finite)||b.open<=0||b.close<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.low<=0||b.volume<0))return {stock:null,error:'缓存K线不足或OHLCV无效'};
 if(bars.some(b=>!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||!Number.isFinite(Date.parse(b.date))||new Date(b.date).toISOString().slice(0,10)!==b.date))return {stock:null,error:'K线不是有效交易日期'};
 for(let i=1;i<bars.length;i++)if(!bars[i].date||bars[i].date<=bars[i-1].date)return {stock:null,error:'缓存K线日期重复或倒序'};
 const last=bars.at(-1),age=now-cachedAt;
 if(!Number.isFinite(cachedAt)||cachedAt<=0||age<0||age>86400000)return {stock:null,error:'缓存无可信采集时间或超过24小时，拒绝研究扫描'};
 const lastDate=Date.parse(last.date);
 if(!Number.isFinite(lastDate))return {stock:null,error:'末根K线日期不可解析'};
 if(last.date>aShareCalendarDate(now))return {stock:null,error:'K线日期位于未来'};
 const finality=assessDailyBarFinality(last.date,{observedAt:cachedAt,now});
 if(!finality.usable)return {stock:null,error:finality.reason};
 return {stock:{symbol:String(code),name:String(k.name||'').slice(0,50),market:/^(30)/.test(code)?'chinext':/^(68)/.test(code)?'star':/^(8|4|920)/.test(code)?'bse':'main',bars,
  feed:{source:'imported',timestamp:cachedAt},dataAudit:{origin:'existing-server-memory-cache',lastBarDate:last.date,cachedAt,cacheAgeMs:age,verifiedLive:false,barAgeDays:aShareCalendarAgeDays(last.date,now),dailyBarFinality:finality.status,dailyBarProviderConfirmed:false}},error:null};
}
module.exports={adaptCachedKline};
