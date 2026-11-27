'use strict';
// Separate research backup bank: no accounts, orders, credentials or arbitrary URLs.
const fs = require('node:fs');
const catalog = require('../../config/six-photo-sources.json');
const entries = new Map(catalog.entries.map(e => [e.id, e]));
const finite = x => typeof x === 'number' && Number.isFinite(x);
const number = x => finite(x) ? x : typeof x === 'string' && /^-?\d+(?:\.\d+)?$/.test(x.trim()) ? Number(x) : null;
const clock=x=>Number.isSafeInteger(x)&&x>0&&x<=8e15;
const dayOf=x=>new Date(x+28800000).toISOString().slice(0,10);
function quoteFreshness(stamp,receivedAt,now){
 if(!clock(stamp)||!clock(receivedAt)||!clock(now))return 'unknown';
 if(stamp>receivedAt||receivedAt>now)return 'future';
 return now-stamp>15000||dayOf(stamp)!==dayOf(now)?'stale':'recent-unverified';
}
const negativeQuote=row=>row?.simulated===true||row?.synthetic===true||row?.retracted===true||
 row?.conflict===true||row?.sourceConflict===true||row?.canTrade===true||row?.verifiedLive===true||
 ['simulation','synthetic','fixture','mock','test'].includes(row?.mode);
function priceAliases(row,keys,{required=false}={}){
 const values=keys.filter(k=>row[k]!=null&&row[k]!=='').map(k=>number(row[k]));
 if(!values.length)return null;
 if(values.some(v=>!finite(v)||v<=0)){
  if(required||values.length>1)throw Error('price');
  return null;
 }
 if(values.some(v=>v!==values[0]))throw Error('quote-price-conflict');
 return values[0];
}
// Re-evaluate at use time, never trust the cached freshness string. One
// newest observation per symbol; simultaneous conflicting prices are rejected.
function newestQuote(source,code,now){
 if(!clock(source.observedAt)||source.observedAt>now||!Array.isArray(source.records)||
    !source.records.length||source.records.length>200||negativeQuote(source))return null;
 const dated=source.records.filter(r=>r&&r.code===code&&clock(r.timestamp));
 if(dated.some(r=>r.timestamp>source.observedAt))return null;
 if(!dated.length)return null;
 const latest=Math.max(...dated.map(r=>r.timestamp)),rows=dated.filter(r=>r.timestamp===latest);
 const r=rows[0];
 if(rows.some(x=>negativeQuote(x)||!finite(x.price)||x.price<=0||x.price!==r.price||
   x.previousClose!==r.previousClose))return null;
 const freshness=quoteFreshness(latest,source.observedAt,now);
 return freshness==='recent-unverified'?{...r,freshness}:null;
}
function date(value) {
  const d = typeof value === 'string' ? value.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d+'T00:00:00Z')) || new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d) throw Error('date');
  return d;
}
function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(value)) return null;
  const ms=Date.parse(value.replace(' ','T')+'+08:00');
  return finite(ms) && new Date(ms+28800000).toISOString().slice(0,19)===value.replace(' ','T') ? ms : null;
}
function normalize(e, source, report, now) {
  const rows=source.data?.records;
  if (!Array.isArray(rows)||!rows.length||rows.length>200) throw Error('records');
  const out=[];let previous='';
  for (const r of rows) {
    if (!r||typeof r!=='object') throw Error('record');
    if (r['股票代码']!==undefined && String(r['股票代码'])!==report.code) throw Error('symbol');
    if (r.code!==undefined && ['daily','minute','quote'].includes(e.kind) && ![report.code,(report.code.startsWith('6')?'sh.':'sz.')+report.code].includes(r.code)) throw Error('symbol');
    if (e.kind==='daily'||e.kind==='minute') {
      const raw=r['日期']??r['时间']??r.date??r.day;
      const d=date(raw);
      if (d>report.end || d<report.start) continue;
      const key=String(raw);if(key<=previous)throw Error('order');previous=key;
      const open=number(r['开盘']??r.open),close=number(r['收盘']??r.close),high=number(r['最高']??r.high),low=number(r['最低']??r.low),volume=number(r['成交量']??r.volume),amount=number(r['成交额']??r.amount);
      if (![open,close,high,low,volume].every(finite)||Math.min(open,close,high,low)<=0||volume<0||low>Math.min(open,close)||high<Math.max(open,close)||low>high) throw Error('bar');
      if (e.kind==='daily'&&Date.parse(d+'T16:00:00+08:00')>source.observedAt) continue;
      const timestamp=e.kind==='minute'?time(key.replace(/\.000Z$/,'')):null;
      if (e.kind==='minute' && (!timestamp||timestamp>source.observedAt)) continue;
      out.push({date:d,...(timestamp?{timestamp}:{}),open,high,low,close,volume,amount:finite(amount)?amount:null});
    } else if (e.kind==='quote') {
      if(negativeQuote(r)||negativeQuote(source)||negativeQuote(report))throw Error('unverified-quote');
      const price=priceAliases(r,['now','最新价'],{required:true});
      if(!finite(price)||price<=0)throw Error('price');
      const stamp=time((r.date||'')+' '+(r.time||''));
      if(stamp&&stamp>source.observedAt)throw Error('future');
      // An explicitly supplied alternative clock/identity may not contradict
      // the supported source clock. Do not use it to fill an absent clock.
      for(const k of ['quoteAt','timestamp','sourceTimestamp']){
        if(r[k]!=null&&(!clock(r[k])||r[k]!==stamp))throw Error('quote-time-conflict');
      }
      if(r.tradeDate!=null&&(!stamp||r.tradeDate!==dayOf(stamp)))throw Error('quote-date-conflict');
      if(r.symbol!=null&&r.symbol!==report.code)throw Error('symbol');
      if(r.upstream!=null&&r.upstream!==e.upstream||r.provider!=null&&r.provider!==e.provider)throw Error('quote-source-conflict');
      out.push({code:report.code,price,previousClose:priceAliases(r,['close','昨日收盘']),timestamp:stamp,
        freshness:quoteFreshness(stamp,source.observedAt,now),volume:null});
    } else if(e.kind==='fund-nav') {
      const d=date(r['日期']);if(d>new Date(source.observedAt+28800000).toISOString().slice(0,10))throw Error('future');
      const nav=number(r['单位净值']);if(!finite(nav)||nav<=0)throw Error('nav');out.push({date:d,nav,cumulativeNav:number(r['累计净值'])});
    } else if(e.kind==='announcements') {
      if(r.secCode!==report.code||typeof r.announcementId!=='string'||!/^\d+$/.test(r.announcementId)||!finite(r.announcementTime)||r.announcementTime<=0||r.announcementTime>source.observedAt||typeof r.announcementTitle!=='string'||!/^finalpage\/\d{4}-\d{2}-\d{2}\/\d+\.pdf$/i.test(r.adjunctUrl))throw Error('announcement');
      out.push({code:report.code,id:r.announcementId,title:r.announcementTitle.replace(/<[^>]*>/g,'').slice(0,240),publishedAt:r.announcementTime,url:'https://static.cninfo.com.cn/'+r.adjunctUrl});
    } else throw Error('no-validated-adapter');
  }
  if(!out.length)throw Error('no-valid-rows');
  if(e.kind==='quote'){
    const byTime=new Map();
    for(const row of out){
      if(row.timestamp===null)continue;
      const prior=byTime.get(row.timestamp);
      if(prior&&(prior.price!==row.price||prior.previousClose!==row.previousClose))throw Error('quote-time-conflict');
      byTime.set(row.timestamp,row);
    }
  }
  return out;
}
function buildBank(report, now=Date.now()) {
  if(!clock(now)||!report||report.schemaVersion!==1||report.mode!=='six-photo-source-backups'||report.scope!==catalog.scope||report.canTrade!==false||report.verifiedLive!==false||report.paidServicesUsed!==false||!clock(report.generatedAt)||report.generatedAt>now||!Array.isArray(report.sources)||report.sources.length!==entries.size||new Set(report.sources.map(x=>x?.id)).size!==entries.size||!/^(?:60|68|00|30)\d{4}$/.test(report.code))throw Error('bank');
  date(report.start);date(report.end);if(report.start>report.end||report.end>new Date(report.generatedAt+28800000).toISOString().slice(0,10))throw Error('range');
  const sources=report.sources.map(s=>{
    const e=entries.get(s.id),interfaces=e?[e.interface,...(e.legacyInterfaces||[])]:[];
    if(!e||s.provider!==e.provider||s.kind!==e.kind||s.upstream!==e.upstream||!interfaces.includes(s.interface)||s.interfaceUsed!==undefined&&!interfaces.includes(s.interfaceUsed)||!clock(s.observedAt)||s.observedAt>report.generatedAt||!['returned','unavailable','timeout','credentials-required','client-required','dependency-missing'].includes(s.status))throw Error('source');
    const basic={id:e.id,photo:e.photo,provider:e.provider,kind:e.kind,upstream:e.upstream,interface:e.interface,reportedInterface:s.interface,interfaceUsed:s.interfaceUsed??null,
      sdkVersion:typeof s.sdkVersion==='string'&&/^[0-9][A-Za-z0-9.+-]{0,63}$/.test(s.sdkVersion)?s.sdkVersion:null,
      status:s.status,observedAt:s.observedAt,records:[],canTrade:false,verifiedLive:false};
    if(s.status!=='returned')return basic;
    try {
      if(e.requires!=='public')throw Error('unverified-adapter');
      const instrument=s.instrument;if(!instrument||instrument.kind!==(e.kind==='fund-nav'?'fund':'stock')||!/^\d{6}$/.test(instrument.code)||e.kind!=='fund-nav'&&instrument.code!==report.code)throw Error('instrument');
      const records=normalize(e,s,report,now);
      let dataContract=null;
      if(s.dataContract!==undefined){
        const c=s.dataContract,frequency=e.kind==='daily'?'1d':'5min',kind=e.kind==='daily'?'bar-date':'bar-time';
        if(e.provider!=='akshare'||!c||c.schemaVersion!==1||c.purpose!=='research-only'||c.upstream!==e.upstream||c.frequencyRequested!==frequency||c.adjustmentRequested!=='none'||c.sourceTimeKind!==kind||c.canTrade!==false||!['adjustmentVerified','volumeUnit','amountUnit','delayed','delayMs','sourceTimeVerified','originalQuoteAt'].every(k=>c[k]===null)||c.sourceTimeField!==null&&(!['日期','时间','date','day'].includes(c.sourceTimeField)||!s.data.columns?.includes(c.sourceTimeField)))throw Error('unverified-contract');
        dataContract={schemaVersion:1,purpose:'research-only',upstream:e.upstream,frequencyRequested:frequency,adjustmentRequested:'none',adjustmentVerified:null,volumeUnit:null,amountUnit:null,delayed:null,delayMs:null,sourceTimeField:c.sourceTimeField,sourceTimeKind:kind,sourceTimeVerified:null,originalQuoteAt:null,canTrade:false};
      }
      return {...basic,status:'research-backup',instrument,records,dataContract,adjustment:['daily','minute'].includes(e.kind)?'unadjusted-requested':null,unitStatus:'provider-native-unverified',frequency:e.kind==='minute'?'5min':e.kind==='daily'?'1d':null,retainedRows:records.length,truncated:s.data.truncated===true};
    }catch{return {...basic,status:'data-invalid'};}
  });
  return {status:now-report.generatedAt>86400000?'expired':'research-bank',code:report.code,generatedAt:report.generatedAt,canTrade:false,verifiedLive:false,paidServicesUsed:false,sources,availableCount:sources.filter(s=>s.status==='research-backup').length};
}
function readSixPhotoBank(file,now=Date.now()) {
  const empty={status:'unconfigured',canTrade:false,verifiedLive:false,sources:[],availableCount:0};if(!file)return empty;
  try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw Error('file');return buildBank(JSON.parse(fs.readFileSync(file,'utf8')),now);}catch{return {...empty,status:'invalid'};}
}
function selectBackup(bank,{kind,code,adjustment='unadjusted-requested',frequency,excludeUpstreams=[],now=Date.now()}={}) {
  if(bank?.status!=='research-bank'||!Array.isArray(bank.sources)||!Array.isArray(excludeUpstreams)||
     !['daily','minute','quote','fund-nav','announcements'].includes(kind))return null;
  // Historical research remains anchored to its imported bank. Quotes alone
  // are time-sensitive at every read, including an already-normalized bank.
  if(kind==='quote'&&(!clock(now)||!clock(bank.generatedAt)||bank.generatedAt>now||
     now-bank.generatedAt>86400000||bank.code!==code||negativeQuote(bank)))return null;
  for(const s of bank.sources){
    if(!s||s.status!=='research-backup'||s.kind!==kind||s.instrument?.code!==code||
       frequency&&s.frequency!==frequency||excludeUpstreams.includes(s.upstream)||
       ['daily','minute'].includes(kind)&&s.adjustment!==adjustment||!Array.isArray(s.records))continue;
    if(kind!=='quote')return {...s,records:s.records.slice()};
    const e=entries.get(s.id);
    if(!e||e.kind!=='quote'||e.requires!=='public'||s.provider!==e.provider||s.upstream!==e.upstream||
       s.observedAt>bank.generatedAt)continue;
    const q=newestQuote(s,code,now);
    if(q)return {...s,records:[q],canTrade:false,verifiedLive:false};
  }
  return null;
}
function photoQuoteFallback(codes,file=process.env.V6_SIX_PHOTO_FILE,now=Date.now()) {
  const bank=readSixPhotoBank(file,now),rows=[];
  for(const code of new Set(codes||[])) {
    const source=selectBackup(bank,{kind:'quote',code,now});if(!source)continue;
    for(const q of source.records){
      const delta=finite(q.previousClose)&&q.previousClose>0?(q.price/q.previousClose-1)*100:null;
      rows.push({code,price:q.price,preClose:finite(q.previousClose)&&q.previousClose>0?q.previousClose:null,
        pct:finite(delta)?delta:null,mainInflow:null,mainPct:null,volume:null,quoteAt:q.timestamp,
        receivedAt:source.observedAt,quoteSource:source.id,tradeDate:dayOf(q.timestamp),
        quoteFreshness:'recent-unverified',quoteMode:'research-backup',canTrade:false,canNotify:false,verifiedLive:false,canTrain:false});
    }
  }
  return rows;
}
module.exports={buildBank,readSixPhotoBank,selectBackup,photoQuoteFallback};
