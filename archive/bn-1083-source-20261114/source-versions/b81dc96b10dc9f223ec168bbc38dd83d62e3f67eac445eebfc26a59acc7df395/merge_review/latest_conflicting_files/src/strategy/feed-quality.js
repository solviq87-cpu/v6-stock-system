 'use strict';
const {barsToIndicators}=require('./historical-indicators');
const SOURCES=new Set(['eastmoney','tonghuashun','akshare','simulated','imported']);
const num=x=>typeof x==='number'&&Number.isFinite(x);
function validateHistoricalBars(bars,{requireDates=false}={}){
 const errors=[];
 if(!Array.isArray(bars)||bars.length<2)return {usable:false,errors:['历史K线数量不足']};
 let dated=0,previous=null;
 for(let i=0;i<bars.length;i++){
  const b=bars[i];
  if(!b||![b.open,b.high,b.low,b.close].every(num)||[b.open,b.high,b.low,b.close].some(x=>x<=0)||
   b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close)||
   !Number.isSafeInteger(b.volume)||b.volume<0||(b.amount!==undefined&&(!num(b.amount)||b.amount<0))){
   errors.push(`第${i}根K线OHLCV无效`);continue;
  }
  if(b.date!==undefined&&b.date!==null&&b.date!==''){
   dated++;const d=String(b.date);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d+'T00:00:00Z'))||new Date(Date.parse(d+'T00:00:00Z')).toISOString().slice(0,10)!==d)errors.push(`第${i}根K线日期无效`);
   else if(previous!==null&&d<=previous)errors.push(`第${i}根K线日期重复或倒序`);
   else previous=d;
  }
 }
 if(requireDates&&dated!==bars.length)errors.push('历史K线日期不完整');
 if(dated!==0&&dated!==bars.length)errors.push('历史K线日期字段不一致');
 return {usable:errors.length===0,errors};
}
function validateFeed(stock,{now=Date.now(),maxAgeMs=900000,requireReal=false}={}){
 const errors=[],warnings=[],feed=stock.feed||{},bars=stock.bars;
 if(!SOURCES.has(feed.source))errors.push('缺少受支持的行情来源');
 if(requireReal&&['simulated','imported'].includes(feed.source))errors.push('不允许将模拟或导入行情标为真实行情');
 if(!num(feed.timestamp))errors.push('缺少有效毫秒时间戳');
 else {if(feed.timestamp>now+60000)errors.push('行情时间戳超前');if(now-feed.timestamp>maxAgeMs)warnings.push('行情超过允许延迟');}
 if(!Array.isArray(bars)||bars.length<27)errors.push('历史K线少于27根');
 const ind=barsToIndicators(bars);
 if(!ind.valid)errors.push(ind.reason);
 if(ind.valid&&bars.length>=2){
  const last=bars.at(-1),prior=bars.at(-2);
  if(stock.close!==undefined&&Math.abs(Number(stock.close)-Number(last.close))>Math.max(.02,Number(last.close)*.001))errors.push('快照价格与最后K线不一致');
  if(last.date&&prior.date&&String(last.date)<=String(prior.date))errors.push('K线日期未严格递增');
  if(bars.every(b=>b.date!==undefined))for(let i=1;i<bars.length;i++){
   if(String(bars[i].date)<=String(bars[i-1].date)){errors.push('历史K线日期重复或倒序');break;}
  }
 }
 if(stock.isST||stock.suspended||stock.tradable===false)warnings.push('风险或不可交易标的');
 if(feed.source==='simulated')warnings.push('模拟行情，禁止作为实盘信号');
 if(feed.source==='imported')warnings.push('导入历史数据，非实时行情');
 return {usable:errors.length===0,fresh:!warnings.includes('行情超过允许延迟'),source:feed.source||null,
  timestamp:num(feed.timestamp)?feed.timestamp:null,simulated:feed.source==='simulated',errors,warnings,indicatorReady:ind.valid&&ind.ready};
}
module.exports={validateFeed,validateHistoricalBars,SOURCES};
