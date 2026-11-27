'use strict';
// Manual EIA daily oil spot observations; never a futures or executable quote.
const SERIES=Object.freeze({RWTC:'WTI Cushing',RBRTE:'Brent Europe'});
const ENDPOINT='https://api.eia.gov/v2/petroleum/pri/spt/data/';
const LIMIT=512*1024, DAY=86400000;
const validTime=x=>Number.isSafeInteger(x)&&x>0&&x<8e15;
const validDay=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
function localDay(at){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at);
 const d=Object.fromEntries(parts.map(p=>[p.type,p.value]));return d.year+'-'+d.month+'-'+d.day;
}
function validate({series,start,end,now=Date.now(),timeoutMs=10000}={}){
 if(typeof series!=='string'||!Object.hasOwn(SERIES,series)||!validDay(start)||!validDay(end)||start>end||
    Date.parse(end)-Date.parse(start)>366*DAY||!validTime(now)||end>localDay(now)||
    !Number.isSafeInteger(timeoutMs)||timeoutMs<250||timeoutMs>20000)throw Error('EIA原油查询序列、日期、时钟或超时无效');
}
// Reject credential-bearing metadata before any immutable raw archival, even
// when the public response is submitted directly to the archive API.
function checkPrivateMetadata(value,secret){
 const stack=[[value,0]];let count=0;
 while(stack.length){const [v,depth]=stack.pop();if(++count>30000||depth>32)throw Error('EIA响应结构超限');
  if(typeof v==='string'){
   if(secret&&v.includes(secret)||/(?:api[_-]?key|access[_-]?token|authorization)\s*=/i.test(v))throw Error('EIA响应包含凭据字段，拒绝保存');
  }else if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){
   if(/^(?:api[_-]?key|access[_-]?token|authorization|password|secret|token)$/i.test(k)||secret&&k.includes(secret))throw Error('EIA响应包含凭据字段，拒绝保存');
   stack.push([x,depth+1]);
  }
 }
}
function projectEiaJson(text,{series,start,end,observedAt}={}){
 validate({series,start,end,now:observedAt});if(!validTime(observedAt)||typeof text!=='string'||!text.length||Buffer.byteLength(text)>LIMIT)throw Error('EIA响应字节或接收时钟无效');
 let input;try{input=JSON.parse(text);}catch{throw Error('EIA JSON无效');}
 checkPrivateMetadata(input);
 const r=input?.response, count=r?.total;
 if(!input||Array.isArray(input)||input.error!=null||input.warning!=null||input.warnings!=null||
    !r||Array.isArray(r)||r.warning!=null||r.warnings!=null||r.frequency!=='daily'||r.dateFormat!=='YYYY-MM-DD'||
    !(Number.isSafeInteger(count)&&count>=0||typeof count==='string'&&/^(?:0|[1-9]\d*)$/.test(count)&&Number.isSafeInteger(Number(count)))||
    !Array.isArray(r.data)||r.data.length!==Number(count)||r.data.length>367)
  throw Error('EIA响应频率、分页总数或完整性无效');
 const seen=new Set(),rows=[];
 for(const row of r.data){
  if(!row||Array.isArray(row)||row.series!==series||!['$/BBL','USD/BBL'].includes(row.units)||!validDay(row.period)||row.period<start||row.period>end||seen.has(row.period))
   throw Error('EIA原始序列、单位、日期或重复记录不一致');
  seen.add(row.period);const raw=row.value;
  if(raw!==null&&!(typeof raw==='number'&&Number.isFinite(raw)||typeof raw==='string'&&/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)&&Number.isFinite(Number(raw))))throw Error('EIA价格数值无效');
  const value=raw===null?null:Number(raw);
  // Do not floor negative oil prices, substitute zero, or invent missing days.
  rows.push({date:row.period,value,unit:'USD/barrel',providerPublishedAt:null,collectorObservedAt:observedAt,quoteAt:null,publicationTimeVerified:false});
 }
 rows.sort((a,b)=>a.date.localeCompare(b.date));
 return {schemaVersion:1,mode:'eia-daily-oil-spot-research',provider:'us-eia',upstreamGroup:'us-eia',series,commodity:SERIES[series],start,end,observedAt,rows,
  coverage:{returnedDates:rows.length,knownValues:rows.filter(r=>r.value!==null).length,explicitMissing:rows.filter(r=>r.value===null).length,completeTradingCalendar:false},
  researchOnly:true,verifiedExternal:false,verifiedLive:false,sourceRevisionKnown:false,publicationTimeVerified:false,canTrade:false,canNotify:false,
  warning:'EIA日频原油现货统计，不是期货、可成交报价或原始发布时间；缺失不补值。'};
}
async function collectEiaSpotDaily({series,start,end,apiKey,clock=Date.now,timeoutMs=10000,fetchImpl=globalThis.fetch,archiveRoot}={}){
 if(typeof clock!=='function'||typeof fetchImpl!=='function'||typeof apiKey!=='string'||!/^[A-Za-z0-9_-]{10,128}$/.test(apiKey))throw Error('EIA需要显式合法密钥及采集器');
 let high=0;function sample(){let at;try{at=clock();}catch{throw Error('EIA采集时钟无效');}if(!validTime(at)||at<high)throw Error('EIA采集时钟无效或倒退');high=at;return at;}
 const requestStartedAt=sample();validate({series,start,end,now:requestStartedAt,timeoutMs});
 const url=new URL(ENDPOINT);for(const [k,v] of Object.entries({'api_key':apiKey,'frequency':'daily','data[0]':'value','facets[series][]':series,start,end,'sort[0][column]':'period','sort[0][direction]':'asc',offset:'0',length:'367'}))url.searchParams.set(k,v);
 let response;
 try{response=await fetchImpl(url.href,{method:'GET',redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{Accept:'application/json'}});}catch{throw Error('EIA请求失败或超时');}
 sample();
 if(!response||response.ok!==true||response.status!==200)throw Error('EIA HTTP '+(Number.isInteger(response?.status)&&response.status>=100&&response.status<=599?response.status:'invalid'));
 if(response.redirected===true||response.type==='opaqueredirect'||response.url&&response.url!==url.href)throw Error('EIA拒绝重定向');
 const ct=response.headers?.get?.('content-type');if(ct&&!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|\s*$)/i.test(ct))throw Error('EIA响应不是JSON');
 const length=response.headers?.get?.('content-length'),encoding=response.headers?.get?.('content-encoding');
 if(length!=null&&(typeof length!=='string'||!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>LIMIT))throw Error('EIA响应长度无效或超限');
 if(encoding!=null&&typeof encoding!=='string')throw Error('EIA响应编码无效');
 if(!response.body||typeof response.body[Symbol.asyncIterator]!=='function')throw Error('EIA缺少原始字节流');
 const chunks=[];let size=0;
 try{for await(const part of response.body){sample();if(!(part instanceof Uint8Array))throw Error('invalid byte stream');size+=part.byteLength;if(size>LIMIT)throw Error('oversize');chunks.push(Buffer.from(part));}}catch{throw Error('EIA字节流超限、损坏或采集时钟异常');}
 const observedAt=sample();if(length!=null&&(!encoding||encoding.toLowerCase()==='identity')&&size!==Number(length))throw Error('EIA响应长度不符');
 const raw=Buffer.concat(chunks),text=raw.toString('utf8');if(!Buffer.from(text,'utf8').equals(raw))throw Error('EIA响应不是有效UTF-8');
 if(text.includes(apiKey))throw Error('EIA响应包含凭据字段，拒绝保存');
 let parsed;try{parsed=JSON.parse(text);}catch{throw Error('EIA JSON无效');}checkPrivateMetadata(parsed,apiKey);
 const result={...projectEiaJson(text,{series,start,end,observedAt}),requestStartedAt,observationTimeBasis:'local-body-receipt'};
 return archiveRoot===undefined?result:require('./market-data-evidence').archiveBackgroundResult(result,{root:archiveRoot,raw,byteBasis:'response-body',scope:{series,start,end}});
}
module.exports={validate,projectEiaJson,collectEiaSpotDaily};
