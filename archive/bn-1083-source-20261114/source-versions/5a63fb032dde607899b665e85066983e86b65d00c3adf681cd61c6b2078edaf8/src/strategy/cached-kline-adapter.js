 'use strict';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function validTradingDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const t=Date.parse(value+'T00:00:00Z');
 return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===value;
}
function adaptCachedKline(code,k,{cachedAt=0,now=Date.now()}={}){
 if(!/^\d{6}$/.test(String(code))||!k||!Array.isArray(k.rows))return {stock:null,error:'缓存代码或结构无效'};
 const bars=k.rows.slice(-500).map(r=>({date:String(r.date||''),open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),volume:Number(r.volume??r.vol)}));
 if(bars.length<27||bars.some(b=>![b.open,b.high,b.low,b.close,b.volume].every(finite)||b.open<=0||b.close<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.high<b.low||b.low<=0||b.volume<0))return {stock:null,error:'缓存K线不足或OHLCV无效'};
 if(bars.some(b=>!validTradingDate(b.date)))return {stock:null,error:'K线日期格式无效或日历日期不存在'};
 for(let i=1;i<bars.length;i++)if(bars[i].date<=bars[i-1].date)return {stock:null,error:'缓存K线日期重复或倒序'};
 const last=bars.at(-1),age=now-cachedAt;
 if(!Number.isFinite(cachedAt)||cachedAt<=0||age<0||age>86400000)return {stock:null,error:'缓存无可信采集时间或超过24小时，拒绝研究扫描'};
 const lastDate=Date.parse(last.date);
 if(!Number.isFinite(lastDate))return {stock:null,error:'末根K线日期不可解析'};
 // Date-only bars are exchange-calendar dates, not timestamps. Compare in UTC
 // calendar days so a future bar cannot enter research scans prematurely.
 const todayUTC=new Date(now).toISOString().slice(0,10);
 if(last.date>todayUTC)return {stock:null,error:'K线日期位于未来'};
 return {stock:{symbol:String(code),name:String(k.name||'').slice(0,50),market:/^(30)/.test(code)?'chinext':/^(68)/.test(code)?'star':/^(8|4)/.test(code)?'bse':'main',bars,
  feed:{source:'imported',timestamp:cachedAt},dataAudit:{origin:'existing-server-memory-cache',lastBarDate:last.date,cachedAt,cacheAgeMs:age,verifiedLive:false,barAgeDays:Math.floor((now-lastDate)/86400000)}},error:null};
}
module.exports={adaptCachedKline,validTradingDate};
