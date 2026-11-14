'use strict';
/**
 * ECB daily euro FX reference rates in ECB SDMX-CSV.  One EUR is quoted in
 * units of the requested currency. This is not a real-time executable quote.
 * Date is the statistical observation period, not official publication time.
 */
const ENDPOINT='https://data-api.ecb.europa.eu';
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const isoDay=s=>typeof s==='string'&&DAY.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const currencies=new Set(['USD','JPY','CNY','GBP','CHF','HKD','CAD','AUD','KRW','SGD','SEK','NOK','DKK','NZD','PLN','CZK','HUF','TRY','INR','BRL','MXN','ZAR']);
function validate({currency,start,end,now=Date.now(),timeoutMs=10000}={}){
 if(!currencies.has(currency)||!isoDay(start)||!isoDay(end)||start>end||
   (Date.parse(end)-Date.parse(start))/86400000>366||
   !Number.isSafeInteger(now)||now<=0||
   end>new Date(now+8*3600000).toISOString().slice(0,10)||
   !Number.isSafeInteger(timeoutMs)||timeoutMs<250||timeoutMs>20000)
  throw Error('ECB汇率查询币种、日期范围或超时设置无效');
}
function parseCsv(data){
 if(typeof data!=='string'||data.length===0||Buffer.byteLength(data)>512*1024)
  throw Error('ECB CSV为空或超过上限');
 // RFC4180 fields incl quoted commas/escaped quotes. Reject embedded newlines
 // in quoted values; they are not valid series keys or numeric observations.
 const result=[];let row=[],field='',quoted=false;
 for(let i=0;i<data.length;i++){
  const c=data[i];
  if(c==='"'){
   if(quoted&&data[i+1]==='"'){field+='"';i++;}else if(!quoted&&field==='')quoted=true;
   else if(quoted)quoted=false;
   else throw Error('ECB CSV双引号格式无效');
  }else if(c===','&&!quoted){row.push(field);field='';}
  else if((c==='\n'||c==='\r')&&!quoted){
   row.push(field);field='';if(row.some(x=>x!==''))result.push(row);row=[];
   if(c==='\r'&&data[i+1]==='\n')i++;
  }else if(c==='\n'||c==='\r')throw Error('ECB字段中禁止换行');
  else field+=c;
 }
 if(quoted)throw Error('ECB CSV引号未闭合');
 if(field!==''||row.length){row.push(field);result.push(row);}
 return result;
}
function projectEcbCsv(csv,{currency,start,end,observedAt}){
 if(!Number.isSafeInteger(observedAt)||observedAt<=0)throw Error('ECB接收时钟无效');
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
    get('CURRENCY_DENOM')!=='EUR'||!isoDay(date)||date<start||date>end||
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
async function collectEcbFxRate({currency,start,end,now=Date.now(),timeoutMs=10000,fetchImpl=globalThis.fetch}={}){
 validate({currency,start,end,now,timeoutMs});
 if(typeof fetchImpl!=='function')throw Error('ECB采集器缺少合法fetch');
 const url=new URL('/service/data/EXR/D.'+currency+'.EUR.SP00.A',ENDPOINT);
 url.searchParams.set('startPeriod',start);
 url.searchParams.set('endPeriod',end);
 url.searchParams.set('format','csvdata');
 const response=await fetchImpl(url.href,{method:'GET',redirect:'error',
  signal:AbortSignal.timeout(timeoutMs),
  headers:{Accept:'text/csv, application/vnd.ecb.data+csv'}});
 if(!response?.ok)throw Error('ECB汇率HTTP '+String(response?.status??'no-response'));
 const ct=response.headers?.get?.('content-type');
 if(ct&&!/^(?:text\/csv|application\/vnd\.ecb\.data\+csv)(?:\s*;|\s*$)/i.test(ct))
  throw Error('ECB返回不是CSV');
 let raw;
 if(response.body&&typeof response.body[Symbol.asyncIterator]==='function'){
  let total=0;const chunks=[];
  for await(const part of response.body){
   total+=part.length;if(total>512*1024)throw Error('ECB CSV超过512KiB');chunks.push(part);
  }
  raw=Buffer.concat(chunks).toString('utf8');
 }else{
  raw=await response.text();if(Buffer.byteLength(raw)>512*1024)throw Error('ECB CSV超过512KiB');
 }
 return projectEcbCsv(raw,{currency,start,end,observedAt:now});
}
module.exports={validate,parseCsv,projectEcbCsv,collectEcbFxRate};
