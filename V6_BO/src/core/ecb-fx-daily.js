'use strict';
/**
 * ECB daily euro FX reference rates in ECB SDMX-CSV.  One EUR is quoted in
 * units of the requested currency. This is not a real-time executable quote.
 * Date is the statistical observation period, not official publication time.
 */
const ENDPOINT='https://data-api.ecb.europa.eu';
const LIMIT=512*1024,MAX_CHUNKS=4096;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const isoDay=s=>typeof s==='string'&&DAY.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const currencies=new Set(['USD','JPY','CNY','GBP','CHF','HKD','CAD','AUD','KRW','SGD','SEK','NOK','DKK','NZD','PLN','CZK','HUF','TRY','INR','BRL','MXN','ZAR']);
const validClock=n=>Number.isSafeInteger(n)&&n>0&&n<8e15;
function ecbObservationDay(n){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(n);
 const date=Object.fromEntries(parts.map(p=>[p.type,p.value]));
 return date.year+'-'+date.month+'-'+date.day;
}
function validate({currency,start,end,now=Date.now(),timeoutMs=10000}={}){
 if(!currencies.has(currency)||!isoDay(start)||!isoDay(end)||start>end||
   (Date.parse(end)-Date.parse(start))/86400000>366||
   !validClock(now)||
   end>new Date(now+8*3600000).toISOString().slice(0,10)||
   !Number.isSafeInteger(timeoutMs)||timeoutMs<250||timeoutMs>20000)
  throw Error('ECB汇率查询币种、日期范围或超时设置无效');
}
function parseCsv(data){
 if(typeof data!=='string'||data.length===0||Buffer.byteLength(data)>512*1024)
  throw Error('ECB CSV为空或超过上限');
 // RFC4180 fields incl quoted commas/escaped quotes. Reject embedded newlines
 // in quoted values; they are not valid series keys or numeric observations.
 const result=[];let row=[],field='',quoted=false,closed=false;
 for(let i=0;i<data.length;i++){
  const c=data[i];
  if(closed&&c!==','&&c!=='\r'&&c!=='\n')throw Error('ECB CSV闭合引号后存在非法字符');
  if(c==='"'){
   if(quoted&&data[i+1]==='"'){field+='"';i++;}else if(!quoted&&field==='')quoted=true;
   else if(quoted){quoted=false;closed=true;}
   else throw Error('ECB CSV双引号格式无效');
  }else if(c===','&&!quoted){row.push(field);field='';closed=false;}
  else if((c==='\n'||c==='\r')&&!quoted){
   if(row.length||field!==''||closed){row.push(field);result.push(row);}
   field='';row=[];closed=false;
   if(c==='\r'&&data[i+1]==='\n')i++;
  }else if(c==='\n'||c==='\r')throw Error('ECB字段中禁止换行');
  else field+=c;
 }
 if(quoted)throw Error('ECB CSV引号未闭合');
 if(field!==''||row.length||closed){row.push(field);result.push(row);}
 return result;
}
function projectEcbCsv(csv,{currency,start,end,observedAt}){
 if(!validClock(observedAt))throw Error('ECB接收时钟无效');
 validate({currency,start,end,now:observedAt});
 // Query end is a bound, not evidence of publication. Preserve the existing
 // query contract and projection shape; reject an actual future local date.
 const latestObservationDate=ecbObservationDay(observedAt);
 const records=parseCsv(csv);
 if(records.length<2||records.length>370)throw Error('ECB返回的观测行数为空或越界');
 const keys=records.shift();
 if(new Set(keys).size!==keys.length||keys.some(x=>!x))throw Error('ECB CSV列名重复或无效');
 const columns=['KEY','FREQ','CURRENCY','CURRENCY_DENOM','TIME_PERIOD','OBS_VALUE'];
 if(columns.some(x=>!keys.includes(x)))throw Error('ECB缺少明确的序列、货币、日期或数值字段');
 const at=Object.fromEntries(keys.map((x,i)=>[x,i]));
 const expected='EXR.D.'+currency+'.EUR.SP00.A';
 const seen=new Set(),rows=[];
 for(const record of records){
  if(record.length!==keys.length)throw Error('ECB CSV字段数量不一致');
  const get=k=>record[at[k]],date=get('TIME_PERIOD');
  if(get('KEY')!==expected||get('FREQ')!=='D'||get('CURRENCY')!==currency||
    get('CURRENCY_DENOM')!=='EUR'||!isoDay(date)||date<start||date>end||date>latestObservationDate||
    seen.has(date)||(at.EXR_TYPE!==undefined&&get('EXR_TYPE')!=='SP00')||
    (at.EXR_SUFFIX!==undefined&&get('EXR_SUFFIX')!=='A'))
   throw Error('ECB序列标识、日期或币种口径不一致');
  seen.add(date);
  const raw=get('OBS_VALUE'),rate=raw===''?null:Number(raw);
  if(raw!==''&&(!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)||!Number.isFinite(rate)||rate<=0))
   throw Error('ECB汇率无效，禁止推测或数值强制转换');
  rows.push({date,unitsPerEuro:rate,baseCurrency:'EUR',quoteCurrency:currency,
   providerPublishedAt:null,collectorObservedAt:observedAt,
   quoteAt:null,publicationTimeVerified:false});
 }
 rows.sort((a,b)=>a.date.localeCompare(b.date));
 if(!rows.some(x=>x.unitsPerEuro!==null))throw Error('ECB没有有效汇率观测值');
 return {schemaVersion:1,mode:'ecb-euro-daily-fx-research',provider:'ecb',
  upstreamGroup:'ecb',currency,baseCurrency:'EUR',direction:currency+' per 1 EUR',
  start,end,observedAt,rows,calendarVerified:false,
  sourceRevisionKnown:false,publicationTimeVerified:false,
  verifiedExternal:false,verifiedLive:false,canTrade:false,canNotify:false,
  warning:'ECB每日参考汇率并非可成交实时外汇价；观测日不是发布时间，不按15秒内实时报价使用。缺失观测保持null。'};
}
async function collectEcbFxRate({currency,start,end,clock=Date.now,now,timeoutMs=10000,fetchImpl=globalThis.fetch,archiveRoot}={}){
 if(typeof clock!=='function'||typeof fetchImpl!=='function')throw Error('ECB采集器时钟或fetch无效');
 let high=0;
 function sample(){let at;try{at=clock();}catch{throw Error('ECB接收时钟无效');}if(!validClock(at)||at<high)throw Error('ECB接收时钟无效或倒退');high=at;return at;}
 if(now===undefined){now=sample();validate({currency,start,end,now,timeoutMs});}
 else{validate({currency,start,end,now,timeoutMs});high=now;sample();}
 const url=new URL('/service/data/EXR/D.'+currency+'.EUR.SP00.A',ENDPOINT);
 url.searchParams.set('startPeriod',start);
 url.searchParams.set('endPeriod',end);
 url.searchParams.set('format','csvdata');
 // Bound the whole response including uncooperative injected transports.
 // Only the successful outer task can call the archive, never a late worker.
 const controller=new AbortController(),deadline=performance.now()+timeoutMs;
 let timer;
 function ensureActive(){if(controller.signal.aborted||performance.now()>=deadline)throw Error('ECB请求失败或超时');}
 function activeSample(){ensureActive();return sample();}
 async function work(){
  let response;
  try{response=await fetchImpl(url.href,{method:'GET',redirect:'error',signal:controller.signal,headers:{Accept:'text/csv, application/vnd.ecb.data+csv'}});}
  catch{throw Error('ECB请求失败或超时');}
  activeSample();
  if(response?.redirected===true||response?.type==='opaqueredirect'||response?.url&&response.url!==url.href)throw Error('ECB拒绝重定向');
  const status=response?.status;
  if(response?.ok!==true||status!==200)throw Error('ECB汇率HTTP '+(Number.isInteger(status)&&status>=100&&status<=599?status:'invalid'));
  const header=name=>{try{return response.headers?.get?.(name);}catch{throw Error('ECB响应头无效');}};
  const ct=header('content-type');
  if(ct!=null&&(typeof ct!=='string'||!/^(?:text\/csv|application\/vnd\.ecb\.data\+csv)(?:\s*;|\s*$)/i.test(ct)))throw Error('ECB返回不是CSV');
  if(header('content-range')!=null)throw Error('ECB拒绝部分响应');
  const length=header('content-length'),encoding=header('content-encoding');
  if(length!=null&&(typeof length!=='string'||!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>LIMIT))throw Error('ECB响应长度无效或超限');
  if(encoding!=null&&(typeof encoding!=='string'||!/^(?:identity|gzip|deflate|br)$/i.test(encoding)))throw Error('ECB响应编码无效');
  let raw,rawBytes,byteBasis;
  if(response.body&&typeof response.body[Symbol.asyncIterator]==='function'){
   let total=0,count=0;const chunks=[];
   for await(const part of response.body){
    activeSample();if(!(part instanceof Uint8Array))throw Error('ECB字节流无效');
    if(++count>MAX_CHUNKS)throw Error('ECB数据块数超限');
    total+=part.byteLength;if(total>LIMIT)throw Error('ECB CSV超过512KiB');if(part.byteLength)chunks.push(Buffer.from(part));
   }
   rawBytes=Buffer.concat(chunks);raw=rawBytes.toString('utf8');byteBasis='response-body';
   if(!Buffer.from(raw,'utf8').equals(rawBytes))throw Error('ECB响应不是有效UTF-8');
  }else{
   // Preserve the historical decoded-text fixture/transport contract, without
   // treating re-encoded text as original wire bytes.
   if(typeof response.text!=='function')throw Error('ECB缺少响应字节流');
   raw=await response.text();if(typeof raw!=='string'||Buffer.byteLength(raw)>LIMIT)throw Error('ECB CSV超过512KiB或类型无效');
   rawBytes=Buffer.from(raw,'utf8');if(rawBytes.toString('utf8')!==raw)throw Error('ECB文本不是有效UTF-8');byteBasis='decoded-body-text';
  }
  const observedAt=activeSample();
  if(length!=null&&(!encoding||encoding.toLowerCase()==='identity')&&rawBytes.length!==Number(length))throw Error('ECB响应长度不符');
  const result={...projectEcbCsv(raw,{currency,start,end,observedAt}),requestStartedAt:now,observationTimeBasis:'local-body-receipt'};
  activeSample();return {result,rawBytes,byteBasis};
 }
 let completed;
 try{completed=await Promise.race([new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Error('ECB请求失败或超时'));controller.abort();},timeoutMs);}),work()]);ensureActive();}
 finally{clearTimeout(timer);controller.abort();}
 const {result,rawBytes,byteBasis}=completed;
 return archiveRoot===undefined?result:require('./market-data-evidence').archiveBackgroundResult(result,{root:archiveRoot,raw:rawBytes,byteBasis,scope:{currency,start,end}});
}
module.exports={validate,parseCsv,projectEcbCsv,collectEcbFxRate};
