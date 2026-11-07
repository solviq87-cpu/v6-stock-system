 'use strict';
// Cache-only adapter: never makes network requests or asserts provider authenticity.
const n=v=>typeof v==='number'&&Number.isFinite(v);
function adaptCacheEntries(entries,{now=Date.now(),maxRows=240}={}){
 const stocks=[],skipped=[];
 for(const [code,entry] of entries){
  const symbol=String(code||'');const rows=Array.isArray(entry?.rows)?entry.rows:Array.isArray(entry)?entry:[];
  if(!/^\d{6}$/.test(symbol)||rows.length<27){skipped.push({code:symbol,reason:'代码无效或历史不足27根'});continue;}
  const bars=rows.slice(-maxRows).map(r=>({date:r.date,open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),volume:Number(r.volume??r.vol)}));
  if(bars.some(r=>![r.open,r.high,r.low,r.close,r.volume].every(n)||r.close<=0||r.volume<0)){
   skipped.push({code:symbol,reason:'历史价格或成交量字段无效'});continue;
  }
  // Cache observation time is NOT market quotation time. Use original cache timestamp if known.
  const observedAt=n(entry?.fetchedAt)?entry.fetchedAt:n(entry?.timestamp)?entry.timestamp:null;
  const timestamp=observedAt??0;
  stocks.push({symbol,name:String(entry?.name||''),market:/^(30)/.test(symbol)?'chinext':/^(68)/.test(symbol)?'star':/^(8|4)/.test(symbol)?'bse':'main',
   bars,feed:{source:'imported',timestamp},cacheMeta:{lastBarDate:bars.at(-1).date||null,observedAt,unverified:true}});
 }
 return {stocks,skipped,source:'local-server-kline-cache',verifiedLive:false,asOf:now};
}
module.exports={adaptCacheEntries};
