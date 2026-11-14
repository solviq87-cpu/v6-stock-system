'use strict';
/**
 * Explicit one-shot SEC EDGAR companyfacts research. CIK is NOT a ticker.
 * 'filed' is a calendar DATE, not the acceptance timestamp; the full feed
 * may include corrections, so this never certifies point-in-time knowledge.
 */
const crypto=require('node:crypto');
const ENDPOINT='https://data.sec.gov';
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const TAG=/^[A-Za-z][A-Za-z0-9]{1,63}$/;
const ACCN=/^\d{10}-\d{2}-\d{6}$/;
const FORMS=new Set(['10-K','10-K/A','10-Q','10-Q/A','20-F','20-F/A','40-F','40-F/A','8-K','8-K/A','6-K','6-K/A']);
const UNITS=new Set(['USD','shares','USD/shares']);
const isoDay=x=>typeof x==='string'&&DAY.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
 new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
function validate(args={}){
 const {cik,tag,unit='USD',asOf,now=Date.now(),userAgent}=args;
 const raw=String(cik??'');
 if(!/^\d{1,10}$/.test(raw)||Number(raw)===0||
    !TAG.test(tag||'')||!UNITS.has(unit)||
    !isoDay(asOf)||asOf<'1994-01-01'||
    !Number.isSafeInteger(now)||now<=0||asOf>new Date(now).toISOString().slice(0,10))
  throw Error('SEC研究CIK、XBRL标签、单位、截至日或采集时钟无效');
 // SEC requires honest identification. Never hardcode or log the contact.
 if(typeof userAgent!=='string'||userAgent.length<12||userAgent.length>130||
    /[\x00-\x1f\x7f]/.test(userAgent)||!/^[-\w. ()/]{2,85}\s+[^\s@]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(userAgent))
  throw Error('SEC访问必须显式提供真实机构/应用名称和联系人邮箱的User-Agent');
 return {cik:Number(raw),padded:String(Number(raw)).padStart(10,'0'),tag,unit,asOf,now,userAgent};
}
function projectCompanyFact(payload,{cik,tag,unit,asOf,now}){
 if(!payload||typeof payload!=='object'||payload.cik!==cik||
    !payload.facts||typeof payload.facts!=='object')
  throw Error('SEC Companyfacts的CIK或返回结构与请求不一致');
 const concept=payload.facts['us-gaap']?.[tag];
 const records=concept?.units?.[unit];
 if(!Array.isArray(records)||records.length<1||records.length>4000)
  throw Error('SEC缺少指定us-gaap标签/单位或超过单次记录上限');
 const seen=new Set(),rows=[];
 for(const x of records){
  if(!x||typeof x!=='object'||!isoDay(x.end)||!isoDay(x.filed)||
     x.end>x.filed||x.filed>new Date(now).toISOString().slice(0,10)||
     (x.start!==undefined&&(!isoDay(x.start)||x.start>x.end))||
     !ACCN.test(x.accn||'')||!FORMS.has(x.form)||
     typeof x.val!=='number'||!Number.isFinite(x.val)||
     (unit==='shares'&&(!Number.isSafeInteger(x.val)||x.val<0)))
   throw Error('SEC历史事实包含不完整的申报日、报告期、数值或来源凭据');
  const key=JSON.stringify([x.accn,x.form,x.start||null,x.end,x.filed]);
  if(seen.has(key))throw Error('SEC重复事实记录，不能默默累计或替换');
  seen.add(key);
  if(x.filed<=asOf)rows.push({
   accession:x.accn,form:x.form,reportedStart:x.start??null,reportedEnd:x.end,
   filedDate:x.filed,reportedValue:x.val,unit,fy:Number.isSafeInteger(x.fy)?x.fy:null,
   fp:typeof x.fp==='string'&&x.fp.length<=8?x.fp:null,
   frame:typeof x.frame==='string'&&x.frame.length<=32?x.frame:null,
   acceptedAt:null,firstPublicAvailableAt:null,
   pointInTimeAuthenticated:false
  });
 }
 rows.sort((a,b)=>a.filedDate.localeCompare(b.filedDate)||a.accession.localeCompare(b.accession)||a.reportedEnd.localeCompare(b.reportedEnd));
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify({cik,tag,unit,asOf,rows})).digest('hex');
 return {schemaVersion:1,mode:'official-us-financial-facts-research',
  provider:'sec-edgar',upstreamGroup:'sec-edgar',cik,tag,namespace:'us-gaap',
  unit,asOf,observedAt:now,records:rows,matchedRows:rows.length,
  sourceFingerprint:fingerprint,sourceUrl:ENDPOINT+'/api/xbrl/companyfacts/CIK'+String(cik).padStart(10,'0')+'.json',
  declaredFilingDatesOnly:true,publicationTimestampVerified:false,
  pointInTimeBacktestReady:false,sourceIndependenceVerified:false,
  verifiedLive:false,verifiedExternal:false,canTrade:false,canNotify:false,
  warning:'SEC申报日不是EDGAR实际受理/公开的精确时间；修订/重报保留多记录，不得使用未来申报的信息回测。非A股实时行情或交易数据。'};
}
async function boundedJson(response,maxBytes=12*1024*1024){
 if(!response?.ok)throw Error('SEC EDGAR HTTP '+String(response?.status??'no-response'));
 const contentType=response.headers?.get?.('content-type');
 if(contentType&&!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|\s*$)/i.test(contentType))
  throw Error('SEC响应的Content-Type不是JSON');
 const size=Number(response.headers?.get?.('content-length'));
 if(Number.isFinite(size)&&size>maxBytes)throw Error('SEC返回内容超过限制');
 let raw;
 if(response.body&&typeof response.body[Symbol.asyncIterator]==='function'){
  let total=0;const chunks=[];
  for await(const chunk of response.body){total+=chunk.length;if(total>maxBytes)throw Error('SEC响应超过限制');chunks.push(chunk);}
  raw=Buffer.concat(chunks).toString('utf8');
 }else{
  raw=await response.text();if(Buffer.byteLength(raw)>maxBytes)throw Error('SEC响应超过限制');
 }
 try{return JSON.parse(raw);}catch{throw Error('SEC返回无效JSON');}
}
async function collectSecCompanyFact(args={}){
 const opt=validate(args);
 const fetchImpl=args.fetchImpl??globalThis.fetch;
 const timeoutMs=args.timeoutMs??12000;
 if(typeof fetchImpl!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<250||timeoutMs>20000)
  throw Error('SEC采集超时或网络参数无效');
 const url=ENDPOINT+'/api/xbrl/companyfacts/CIK'+opt.padded+'.json';
 const response=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(timeoutMs),
  headers:{Accept:'application/json','User-Agent':opt.userAgent}});
 const data=await boundedJson(response);
 return projectCompanyFact(data,opt);
}
module.exports={validate,projectCompanyFact,boundedJson,collectSecCompanyFact};
