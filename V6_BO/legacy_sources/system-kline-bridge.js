 'use strict';
const num=x=>typeof x==='number'&&Number.isFinite(x);
function toResearchStock(code,rows,{name='',market='main',retrievedAt=Date.now()}={}){
 if(!/^\d{6}$/.test(String(code)))throw Error('股票代码格式错误');
 if(!Array.isArray(rows)||rows.length<27)throw Error('有效K线不足27根');
 const bars=rows.slice(-240).map((r,i)=>{
  const b={date:String(r.date||''),open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),volume:Number(r.volume??r.vol)};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||!Object.values(b).slice(1).every(num)||b.volume<=0||b.low<=0||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close))throw Error('第'+(i+1)+'根K线无效');
  return b;
 });
 for(let i=1;i<bars.length;i++)if(bars[i].date<=bars[i-1].date)throw Error('K线日期重复或倒序');
 const last=bars.at(-1),lastAt=Date.parse(last.date+'T15:00:00+08:00');
 if(!num(lastAt)||lastAt>Date.now()+86400000)throw Error('K线日期超前');
 // Source indicates system Kline adapter, not authenticated provider provenance.
 return {symbol:String(code),code:String(code),name,market,bars,feed:{source:'imported',timestamp:lastAt},
  provenance:{kind:'system-kline',retrievedAt,lastBarDate:last.date,providerVerified:false}};
}
module.exports={toResearchStock};
