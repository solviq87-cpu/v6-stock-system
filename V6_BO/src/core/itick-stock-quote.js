'use strict';
/**
 * Optional official iTick REST quote adapter (no scraping).
 * Requires an operator-provisioned token and explicitly permitted A-share scope.
 * Never logs tokens, guesses endpoints or certifies a tradable live feed.
 */
const ENDPOINT='https://api.itick.org/stock/quote';
async function fetchItickStockQuote({code,token,now=Date.now(),fetchImpl=globalThis.fetch,timeoutMs=6000}={}){
 if(typeof code!=='string'||!/^(?:60|68|00|30)\d{4}$/.test(code)||
    !Number.isSafeInteger(now)||now<=0||!Number.isSafeInteger(timeoutMs)||
    timeoutMs<100||timeoutMs>10000||typeof fetchImpl!=='function')
  throw Error('iTick 股票诊断参数无效');
 const empty=(status)=>({id:'itick',status,quote:null,verifiedLive:false,canTrade:false});
 if(typeof token!=='string'||!token.trim())return empty('unconfigured');
 if(token.length>512||/[\r\n]/.test(token))throw Error('iTick 凭据格式无效');
 const exchange=code.startsWith('6')?'SH':'SZ',url=new URL(ENDPOINT);
 url.searchParams.set('region',exchange);url.searchParams.set('code',code);
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const response=await fetchImpl(url.toString(),{redirect:'error',signal:controller.signal,
   headers:{accept:'application/json',token}});
  if(!response?.ok)return empty('unavailable');
  const body=await response.text();
  if(body.length>65536)return empty('unavailable');
  const r=JSON.parse(body),q=r?.data;
  if(r.code!==0||!q||String(q.s)!==code||
     !Number.isFinite(q.ld)||q.ld<=0||
     !Number.isFinite(q.p)||q.p<=0||
     !Number.isSafeInteger(q.t)||q.t<=0||q.t>now||
     q.ts!==0)return empty('unavailable');
  return {id:'itick',status:now-q.t<=15000?'fresh-unverified':'dated-snapshot',
   quote:{exchange,code,currency:'CNY',adjustment:'unadjusted',
    status:'normal',price:q.ld,previousClose:q.p,quoteAt:q.t},
   verifiedLive:false,canTrade:false};
 }catch{return empty('unavailable');}
 finally{clearTimeout(timeout);controller.abort();}
}
module.exports={fetchItickStockQuote};
