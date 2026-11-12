'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createTradingCalendar}=require('./trading-calendar');
const {aShareCalendarDate}=require('./a-share-calendar');
const BUNDLED_CALENDAR=path.resolve(__dirname,'../../config/research-calendar-2026.json');
const MAX_BYTES=1024*1024;
const FLAGS={sourceAuthenticated:false,verifiedExternal:false,tradeEligible:false,runtimeEligible:false,realTime:false};
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const observedTime=x=>typeof x==='number'&&Number.isSafeInteger(x)&&x>0?x:typeof x==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(x)?Date.parse(x):NaN;
function symbolExchange(symbol){
 if(symbol===undefined||symbol===null||symbol==='')return null;
 if(typeof symbol!=='string')throw Error('股票代码无效');
 const s=symbol.trim().toUpperCase();
 if(/^(BJ|BSE)[.:-]?\d{6}$/.test(s)||/^\d{6}[.:-](BJ|BSE)$/.test(s))return 'BSE';
 if(/^(SH|SSE)[.:-]?\d{6}$/.test(s)||/^\d{6}[.:-](SH|SSE)$/.test(s))return 'SSE';
 if(/^(SZ|SZSE)[.:-]?\d{6}$/.test(s)||/^\d{6}[.:-](SZ|SZSE)$/.test(s))return 'SZSE';
 if(/^\d{6}$/.test(s)){
  if(/^(4|8|92)/.test(s))return 'BSE';
  if(/^[569]/.test(s))return 'SSE';
  if(/^[023]/.test(s))return 'SZSE';
 }
 throw Error('股票所属交易所未知');
}
// This is an operator-only file option. HTTP callers must never forward a client
// path here. No URL fetching, source discovery, or bar-derived calendar fallback.
function readFile(file,isPrivate){
 if(typeof file!=='string'||!file.trim()||/^[a-z][a-z0-9+.-]*:/i.test(file))throw Error('日历必须是本地文件');
 const absolute=path.resolve(file);
 if(isPrivate&&absolute.split(path.sep).some(part=>part.toLowerCase()==='public'))throw Error('日历文件不能位于public目录');
 let current=path.parse(absolute).root;
 for(const part of absolute.slice(current.length).split(path.sep)){
  current=path.join(current,part);
  const stat=fs.lstatSync(current);
  if(stat.isSymbolicLink())throw Error('日历文件不允许符号链接');
  if(current===absolute&&(!stat.isFile()||stat.size>MAX_BYTES))throw Error('日历必须是1MiB以内的普通文件');
 }
 const fd=fs.openSync(absolute,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.size>MAX_BYTES)throw Error('日历必须是1MiB以内的普通文件');
  const raw=fs.readFileSync(fd);
  if(raw.length>MAX_BYTES)throw Error('日历文件超过1MiB');
  return {raw,data:JSON.parse(raw.toString('utf8')),mtime:stat.mtime.toISOString()};
 }finally{fs.closeSync(fd);}
}
function readResearchCalendar({asOf=Date.now(),symbol,calendarFile}={}){
 let metadata={...FLAGS};
 const unavailable=reason=>({status:'unavailable',tradeDates:[],calendar:null,metadata,nextTradeDate:null,reason});
 try{
  const now=asOf instanceof Date?asOf.getTime():typeof asOf==='number'?asOf:Date.parse(asOf);
  if(!Number.isFinite(now))throw Error('日历查询时间无效');
  const today=aShareCalendarDate(now);
  const privateFile=calendarFile!==undefined;
  const {raw,data,mtime}=readFile(privateFile?calendarFile:BUNDLED_CALENDAR,privateFile);
  const requested=symbolExchange(symbol);
  // A custom operator calendar establishes coverage only for its own exchange.
  const supported=privateFile?[data.exchange]:data.supportedExchanges;
  if(!Array.isArray(supported)||!supported.length||supported.some(e=>!['SSE','SZSE','BSE'].includes(e)))throw Error('日历交易所列表无效');
  const exchange=requested||data.exchange;
  if(!supported.includes(exchange))throw Error(exchange==='BSE'?'BSE日历未取得完整原站证据，交易所不受支持':'股票交易所不受此日历支持');
  const calendar={schemaVersion:data.schemaVersion,exchange,source:data.source,from:data.from,to:data.to,sessions:data.sessions};
  const checked=createTradingCalendar(calendar);
  if((Date.parse(data.to)-Date.parse(data.from))/86400000+1>1000)throw Error('研究日历覆盖不能超过1000天');
  const observed=data.firstObservedAt??data.observedAt??data.metadata?.observedAt;
  const observedMs=observedTime(observed);
  if(!Number.isFinite(observedMs))throw Error('日历缺少有效观察时间');
  const evidence=Array.isArray(data.sourceEvidence)?data.sourceEvidence:[];
  metadata={...FLAGS,source:data.source,from:data.from,to:data.to,observedAt:new Date(observedMs).toISOString(),
   sha256:crypto.createHash('sha256').update(raw).digest('hex'),supportedExchanges:[...supported],exchange,
   sourceEvidence:evidence,ruleBasis:data.ruleBasis||[],holidayRanges:data.holidayRanges||[],
   observationBasis:data.firstObservedAt!==undefined?'recorded-first-observation':'operator-declared-observation',
   calendarKind:'explicit-research-sessions',knowledgeAvailableAt:new Date(observedMs).toISOString()};
  if(observedMs>now)throw Error('查询时尚未观察到此日历，不能倒填历史知识');
  for(const item of [data,...evidence]){
   for(const k of ['firstObservedAt','observedAt'])if(item[k]!==undefined&&(!Number.isFinite(observedTime(item[k]))||observedTime(item[k])>now))throw Error('日历证据观察时间位于未来或无效');
   for(const field of ['sourcePublicationDate','originalPublishedDate']){
    if(item[field]!==undefined&&item[field]!==null&&(!validDate(item[field])||item[field]>today))throw Error('日历来源发表日期位于未来或无效');
   }
   for(const field of ['sourcePublishedAt','publishedAt','originalPublishedAt']){
    if(item[field]!==undefined&&(!Number.isFinite(Date.parse(item[field]))||Date.parse(item[field])>now))throw Error('日历来源发表时间位于未来或无效');
   }
  }
  if(today<data.from||today>data.to)throw Error('日期不在交易日历覆盖范围，交易日未知');
  const tradeDates=data.sessions.filter(row=>row.open).map(row=>row.date).sort();
  return {status:'available',tradeDates,calendar,metadata,nextTradeDate:checked.next(today)};
 }catch(error){return unavailable(error.code||error instanceof SyntaxError?'日历文件不可用或格式无效':error.message);}
}
module.exports={readResearchCalendar};
