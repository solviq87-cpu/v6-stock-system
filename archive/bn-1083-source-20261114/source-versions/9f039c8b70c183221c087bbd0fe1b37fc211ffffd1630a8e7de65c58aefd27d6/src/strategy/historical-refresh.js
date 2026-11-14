'use strict';
// Bounded historical data refresh; upstream timeouts are cooperative unless the provider supports AbortSignal.
const CODE=/^\d{6}$/;
function validate(codes, concurrency, timeoutMs){
 if(!Array.isArray(codes)||codes.length<1||codes.length>20||codes.some(x=>typeof x!=='string'||!CODE.test(x)))throw Error('仅允许1至20个六位股票代码字符串');
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>5)throw Error('并发数必须为1至5');
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000)throw Error('超时时间必须为100至60000毫秒');
}
async function boundedFetch(fetchKline,code,timeoutMs){
 const controller=new AbortController();let timer;
 try{
  return await Promise.race([
   Promise.resolve().then(()=>fetchKline(code,120,{signal:controller.signal})),
   new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('行情请求超时'));},timeoutMs);})
  ]);
 }finally{clearTimeout(timer);}
}
async function refreshHistorical({codes,fetchKline,adapt,now=Date.now(),concurrency=3,timeoutMs=12000,retries=0,authorizedFallbacks=[]}){
 validate(codes,concurrency,timeoutMs);
 if(!Number.isInteger(retries)||retries<0||retries>2)throw Error('重试次数必须为0至2');
 if(typeof fetchKline!=='function'||typeof adapt!=='function')throw Error('行情适配器不可用');
 if(!Array.isArray(authorizedFallbacks)||authorizedFallbacks.length>2||
  authorizedFallbacks.some(p=>!p||p.authorized!==true||typeof p.name!=='string'||!p.name.trim()||typeof p.fetchKline!=='function'))throw Error('回退源须由调用方明确授权');
 const providers=[{name:'primary',fetchKline},...authorizedFallbacks];
 const unique=[...new Set(codes)],out=new Array(unique.length);let cursor=0;
 const workers=Array.from({length:Math.min(concurrency,unique.length)},async()=>{
  while(cursor<unique.length){
   const idx=cursor++,code=unique[idx];
   const attempts=[];
   try{
    let lastError;
    for(const provider of providers){
     for(let attempt=0;attempt<=retries;attempt++){
      try{
       const started=Date.now();
       const k=await boundedFetch(provider.fetchKline,code,timeoutMs);
       if(!k?.rows?.length)throw Error('供应商未返回K线');
       const item=adapt(code,k,{cachedAt:Date.now(),now:Date.now()});
       if(!item?.stock)throw Error(item?.error||'历史数据校验失败');
       attempts.push({provider:provider.name,ok:true,durationMs:Date.now()-started});
       out[idx]={code,ok:true,kline:k,stock:item.stock,provider:provider.name,attempts};
       break;
      }catch(error){
       lastError=error;
       attempts.push({provider:provider.name,ok:false,error:String(error?.message||error).slice(0,120)});
       if(/超时|abort/i.test(String(error)))break;
      }
     }
     if(out[idx])break;
    }
    if(!out[idx])throw lastError;
   }catch(e){out[idx]={code,ok:false,error:String(e?.message||e).slice(0,180),attempts};}
  }
 });
 await Promise.all(workers);
 return {requested:unique.length,success:out.filter(x=>x.ok).length,items:out,
  verifiedLive:false,source:'external-history-fetch-unverified',retrievedAt:now,
  warning:'联网历史K线可能延迟或复权不一致；未验证供应商真实性，不是交易所认证实时行情'};
}
module.exports={refreshHistorical,boundedFetch};
