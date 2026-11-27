'use strict';
const {validateSnapshot,analyze}=require('./parallel-market');
const {hasQuoteRedirect}=require('./public-quote-redirect-policy');
const IDS=['tencent','eastmoney','sina'];
function security(code){if(typeof code!=='string'||!/^(?:60|68|00|30)\d{4}$/.test(code))throw Error('仅支持沪深A股代码');return {code,exchange:code.startsWith('6')?'SH':'SZ',prefix:code.startsWith('6')?'sh':'sz'};}
function timestamp(s){if(!/^\d{14}$/.test(s))throw Error('报价时间无效');const iso=s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8)+'T'+s.slice(8,10)+':'+s.slice(10,12)+':'+s.slice(12,14)+'+08:00',n=Date.parse(iso);if(!Number.isFinite(n)||new Date(n+28800000).toISOString().replace(/[-:T]/g,'').slice(0,14)!==s)throw Error('报价日期无效');return n;}
function parse(id,raw,code){if(!IDS.includes(id))throw Error('未知公开报价来源');const s=security(code);let price,previousClose,volume,time;
 if(id==='eastmoney'){const x=JSON.parse(raw);if(x.rc!==0||x.data?.f57!==code)throw Error('证券不匹配');const d=x.data;price=d.f43;previousClose=d.f60;volume=typeof d.f47==='number'?d.f47*100:NaN;time=typeof d.f86==='number'?d.f86*1000:NaN;}
 else {const pattern=id==='tencent'?new RegExp('^\\s*v_'+s.prefix+code+'="([^"\\r\\n]*)";?\\s*$'):new RegExp('^\\s*var hq_str_'+s.prefix+code+'="([^"\\r\\n]*)";?\\s*$');const m=raw.match(pattern);if(!m)throw Error('报价文本或证券不匹配');const a=m[1].split(id==='tencent'?'~':',');const n=i=>a[i]!==undefined&&a[i].trim()!==''?Number(a[i]):NaN;if(id==='tencent'){if(a[2]!==code)throw Error('证券不匹配');price=n(3);previousClose=n(4);volume=n(6)*100;time=timestamp(a[30]||'');}else{price=n(3);previousClose=n(2);volume=n(8);time=timestamp((a[30]||'').replace(/-/g,'')+(a[31]||'').replace(/:/g,''));}}
 if(![price,previousClose,volume,time].every(Number.isFinite)||price<=0||previousClose<=0||volume<0||!Number.isSafeInteger(time)||time<=0)throw Error('无效报价，停牌/空字段不补零');
 return {exchange:s.exchange,code,currency:'CNY',adjustment:'unadjusted',volumeUnit:'share',status:'normal',timestamp:time,price,previousClose,volume};
}
function address(id,code){if(!IDS.includes(id))throw Error('未知公开报价来源');const s=security(code);if(id==='tencent')return 'https://qt.gtimg.cn/q='+s.prefix+code;if(id==='sina')return 'https://hq.sinajs.cn/list='+s.prefix+code;return 'https://push2.eastmoney.com/api/qt/stock/get?secid='+(s.exchange==='SH'?'1.':'0.')+code+'&fltt=2&fields=f43,f47,f57,f60,f86';}
// Keep public diagnostics bounded and redacted. An exception's free text,
// URL, response body or credential must never enter the diagnostic report.
const TRANSPORT_FAILURES=Object.freeze({
 ENOTFOUND:'dns-failed',EAI_AGAIN:'dns-failed',EAI_FAIL:'dns-failed',
 ETIMEDOUT:'timeout',UND_ERR_CONNECT_TIMEOUT:'timeout',UND_ERR_HEADERS_TIMEOUT:'timeout',
 UND_ERR_BODY_TIMEOUT:'timeout',ERR_TLS_HANDSHAKE_TIMEOUT:'timeout',
 ECONNREFUSED:'connection-failed',ECONNRESET:'connection-failed',EPIPE:'connection-failed',
 ENETUNREACH:'connection-failed',EHOSTUNREACH:'connection-failed',UND_ERR_SOCKET:'connection-failed',
 CERT_HAS_EXPIRED:'tls-failed',DEPTH_ZERO_SELF_SIGNED_CERT:'tls-failed',
 UNABLE_TO_VERIFY_LEAF_SIGNATURE:'tls-failed',UNABLE_TO_GET_ISSUER_CERT_LOCALLY:'tls-failed',
 ERR_TLS_CERT_ALTNAME_INVALID:'tls-failed',ERR_SSL_WRONG_VERSION_NUMBER:'tls-failed',
 ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION:'tls-failed'
});
function quoteTransportFailureKind(error){
 for(const code of [error?.code,error?.cause?.code])
  if(typeof code==='string'&&Object.hasOwn(TRANSPORT_FAILURES,code))return TRANSPORT_FAILURES[code];
 return 'transport-error';
}
const validHttpStatus=status=>Number.isInteger(status)&&status>=100&&status<=599;
const httpFailureKind=status=>status===401||status===403?'access-denied':status===429?'rate-limited':
 status>=300&&status<400?'redirect-refused':status>=400?'http-error':'invalid-response';
const FAILURE_KINDS=new Set([...Object.values(TRANSPORT_FAILURES),'transport-error',
 'invalid-response','invalid-quote','invalid-quote-evidence','response-too-large','unclassified-failure']);
function summarizePublicQuoteFailure(row){
 const legacy=typeof row?.error==='string'?/^HTTP ([1-5][0-9]{2})$/.exec(row.error):null;
 const httpStatus=legacy?Number(legacy[1]):validHttpStatus(row?.httpStatus)?row.httpStatus:null;
 if(row?.error==='redirect-blocked')return {failureKind:'redirect-refused',
  httpStatus:httpStatus>=300&&httpStatus<400?httpStatus:null};
 if(httpStatus!==null&&httpStatus!==200)return {failureKind:httpFailureKind(httpStatus),httpStatus};
 return {failureKind:FAILURE_KINDS.has(row?.failureKind)?row.failureKind:'unclassified-failure',httpStatus};
}
function createPublicMarket({code,fetchImpl=globalThis.fetch,clock=Date.now,timeoutMs=8000,providers=IDS}={}){
 security(code);
 if(!Array.isArray(providers)||!providers.length||providers.length>3||new Set(providers).size!==providers.length||
    providers.some(id=>!IDS.includes(id)))throw Error('公开报价来源列表无效');
 providers=[...providers];
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000)throw Error('超时无效');
 let busy=false;
 return {async sync(){
  if(busy)return {busy:true};
  busy=true;
  try{
   const sources=await Promise.all(providers.map(async id=>{
    let timer,httpStatus=null,stage='transport',failureKind=null,legacyError=null;
    const c=new AbortController(),generic='网络、超时或格式校验失败';
    function reject(kind,error=generic){failureKind=kind;legacyError=error;throw Error(error);}
    try{
     const work=(async()=>{
      const requestUrl=address(id,code);
      const r=await fetchImpl(requestUrl,{signal:c.signal,redirect:'manual'});
      stage='response';
      httpStatus=validHttpStatus(r?.status)?r.status:null;
      if(hasQuoteRedirect(r,requestUrl)){
       if(httpStatus===null||httpStatus<300||httpStatus>=400)httpStatus=null;
       reject('redirect-refused','redirect-blocked');
      }
      // An HTTP 206/201/204 or contradictory success flag is not a full quote.
      if(httpStatus===null)reject('invalid-response');
      if(httpStatus!==200)reject(httpFailureKind(httpStatus),'HTTP '+httpStatus);
      if(r.ok!==true||!r.body||typeof r.body[Symbol.asyncIterator]!=='function')reject('invalid-response');
      stage='body';
      let size=0,chunks=[];
      for await(const part of r.body){
       const chunk=Buffer.from(part);size+=chunk.length;
       if(size>262144)reject('response-too-large');
       chunks.push(chunk);
      }
      stage='quote';
      const raw=Buffer.concat(chunks);
      return parse(id,id==='eastmoney'?raw.toString('utf8'):new TextDecoder('gb18030').decode(raw),code);
     })();
     const q=await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{c.abort();reject(Error('timeout'));},timeoutMs);})]);
     const observedAt=clock(),snapshot={schemaVersion:1,provider:id,observedAt,quotes:[q]};
     try{validateSnapshot(snapshot,id,observedAt);return {id,status:'ok',snapshot};}
     catch{return {id,status:'stale-or-invalid',lastQuote:q};}
    }catch(e){
     const transport=quoteTransportFailureKind(e);
     const kind=c.signal.aborted?'timeout':failureKind||
      (stage==='quote'?'invalid-quote':transport!=='transport-error'?transport:
       stage==='transport'?'transport-error':'invalid-response');
     return {id,status:'unavailable',error:legacyError||generic,failureKind:kind,httpStatus};
    }finally{clearTimeout(timer);c.abort();}
   }));
   const now=clock();
   for(const s of sources)if(s.snapshot){try{validateSnapshot(s.snapshot,s.id,now);}
    catch{s.lastQuote=s.snapshot.quotes[0];delete s.snapshot;s.status='stale-or-invalid';}}
   return {schemaVersion:1,mode:'parallel-public-quotes',generatedAt:now,validUntil:now+15000,
    canTrade:false,verifiedLive:false,sources,analysis:analyze(sources,now),
    warning:'公开网页报价，非授权稳定API；无商业转发权限声明。停牌状态未独立核验，不用于下单'};
  }finally{busy=false;}
 }};
}
module.exports={createPublicMarket,parse,address,timestamp,quoteTransportFailureKind,summarizePublicQuoteFailure};
