'use strict';
// Explicit, bounded historical K-line fetch. Never claims exchange-certified real-time data.
const CODE=/^\d{6}$/;
async function refreshHistorical({codes,fetchKline,adapt,now=Date.now(),concurrency=3,timeoutMs=12000}){
 if(!Array.isArray(codes)||codes.length<1||codes.length>20||codes.some(x=>!CODE.test(String(x))))throw Error('仅允许1至20个六位股票代码');
 if(typeof fetchKline!=='function'||typeof adapt!=='function')throw Error('行情适配器不可用');
 const unique=[...new Set(codes.map(String))],out=new Array(unique.length);let cursor=0;
 const workers=Array.from({length:Math.min(concurrency,unique.length)},async()=>{
  while(cursor<unique.length){
   const idx=cursor++,code=unique[idx];
   try{
    const k=await Promise.race([Promise.resolve().then(()=>fetchKline(code,120)),
      new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('行情请求超时')),timeoutMs);t.unref?.();})]);
    if(!k||!Array.isArray(k.rows))throw Error('供应商未返回K线');
    const item=adapt(code,k,{cachedAt:Date.now(),now:Date.now()});
    if(!item.stock)throw Error(item.error||'历史数据校验失败');
    out[idx]={code,ok:true,kline:k,stock:item.stock};
   }catch(e){out[idx]={code,ok:false,error:String(e.message||e).slice(0,180)};}
  }
 });
 await Promise.all(workers);
 return {requested:unique.length,success:out.filter(x=>x.ok).length,items:out,
  verifiedLive:false,source:'external-history-fetch-unverified',retrievedAt:now,
  warning:'联网历史K线可能延迟或复权不一致；未验证供应商真实性，不是交易所认证实时行情'};
}
module.exports={refreshHistorical};
