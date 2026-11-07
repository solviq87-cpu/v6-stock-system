'use strict';
// Separate research backup bank: no accounts, orders, credentials or arbitrary URLs.
const fs = require('node:fs');
const catalog = require('../../config/six-photo-sources.json');
const entries = new Map(catalog.entries.map(e => [e.id, e]));
const finite = x => typeof x === 'number' && Number.isFinite(x);
const number = x => finite(x) ? x : typeof x === 'string' && /^-?\d+(?:\.\d+)?$/.test(x.trim()) ? Number(x) : null;
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
      const price=number(r.now??r['最新价']);if(!finite(price)||price<=0)throw Error('price');
      const stamp=time((r.date||'')+' '+(r.time||''));
      if (stamp && stamp>source.observedAt) throw Error('future');
      out.push({code:report.code,price,previousClose:number(r.close??r['昨日收盘']),timestamp:stamp,freshness:stamp===null?'unknown':now-stamp>15000?'stale':'recent-unverified',volume:null});
    } else if(e.kind==='fund-nav') {
      const d=date(r['日期']);if(d>new Date(source.observedAt+28800000).toISOString().slice(0,10))throw Error('future');
      const nav=number(r['单位净值']);if(!finite(nav)||nav<=0)throw Error('nav');out.push({date:d,nav,cumulativeNav:number(r['累计净值'])});
    } else if(e.kind==='announcements') {
      if(r.secCode!==report.code||typeof r.announcementId!=='string'||!/^\d+$/.test(r.announcementId)||!finite(r.announcementTime)||r.announcementTime<=0||r.announcementTime>source.observedAt||typeof r.announcementTitle!=='string'||!/^finalpage\/\d{4}-\d{2}-\d{2}\/\d+\.pdf$/i.test(r.adjunctUrl))throw Error('announcement');
      out.push({code:report.code,id:r.announcementId,title:r.announcementTitle.replace(/<[^>]*>/g,'').slice(0,240),publishedAt:r.announcementTime,url:'https://static.cninfo.com.cn/'+r.adjunctUrl});
    } else throw Error('no-validated-adapter');
  }
  if(!out.length)throw Error('no-valid-rows');return out;
}
function buildBank(report, now=Date.now()) {
  if(!finite(now)||!report||report.schemaVersion!==1||report.mode!=='six-photo-source-backups'||report.scope!==catalog.scope||report.canTrade!==false||report.verifiedLive!==false||report.paidServicesUsed!==false||!finite(report.generatedAt)||report.generatedAt>now||report.generatedAt<=0||!Array.isArray(report.sources)||report.sources.length!==entries.size||new Set(report.sources.map(x=>x?.id)).size!==entries.size||!/^(?:60|68|00|30)\d{4}$/.test(report.code))throw Error('bank');
  date(report.start);date(report.end);if(report.start>report.end||report.end>new Date(report.generatedAt+28800000).toISOString().slice(0,10))throw Error('range');
  const sources=report.sources.map(s=>{
    const e=entries.get(s.id);if(!e||s.provider!==e.provider||s.kind!==e.kind||s.upstream!==e.upstream||s.interface!==e.interface||!finite(s.observedAt)||s.observedAt>report.generatedAt||s.observedAt<=0||!['returned','unavailable','timeout','credentials-required','client-required','dependency-missing'].includes(s.status))throw Error('source');
    const basic={id:e.id,photo:e.photo,provider:e.provider,kind:e.kind,upstream:e.upstream,interface:e.interface,status:s.status,observedAt:s.observedAt,records:[],canTrade:false,verifiedLive:false};
    if(s.status!=='returned')return basic;
    try {
      if(e.requires!=='public')throw Error('unverified-adapter');
      const instrument=s.instrument;if(!instrument||instrument.kind!==(e.kind==='fund-nav'?'fund':'stock')||!/^\d{6}$/.test(instrument.code)||e.kind!=='fund-nav'&&instrument.code!==report.code)throw Error('instrument');
      const records=normalize(e,s,report,now);
      return {...basic,status:'research-backup',instrument,records,adjustment:['daily','minute'].includes(e.kind)?'unadjusted-requested':null,unitStatus:'provider-native-unverified',frequency:e.kind==='minute'?'5min':e.kind==='daily'?'1d':null,retainedRows:records.length,truncated:s.data.truncated===true};
    }catch{return {...basic,status:'data-invalid'};}
  });
  return {status:now-report.generatedAt>86400000?'expired':'research-bank',code:report.code,generatedAt:report.generatedAt,canTrade:false,verifiedLive:false,paidServicesUsed:false,sources,availableCount:sources.filter(s=>s.status==='research-backup').length};
}
function readSixPhotoBank(file,now=Date.now()) {
  const empty={status:'unconfigured',canTrade:false,verifiedLive:false,sources:[],availableCount:0};if(!file)return empty;
  try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw Error('file');return buildBank(JSON.parse(fs.readFileSync(file,'utf8')),now);}catch{return {...empty,status:'invalid'};}
}
function selectBackup(bank,{kind,code,adjustment='unadjusted-requested',frequency,excludeUpstreams=[]}={}) {
  if(bank?.status!=='research-bank'||!['daily','minute','quote','fund-nav','announcements'].includes(kind))return null;
  const s=bank.sources.find(s=>s.status==='research-backup'&&s.kind===kind&&s.instrument?.code===code&&(!frequency||s.frequency===frequency)&&!excludeUpstreams.includes(s.upstream)&&(!['daily','minute'].includes(kind)||s.adjustment===adjustment)&&(kind!=='quote'||s.records.some(r=>r.freshness==='recent-unverified')));
  return s?{...s,records:s.records.filter(r=>kind!=='quote'||r.freshness==='recent-unverified')}:null;
}
function photoQuoteFallback(codes,file=process.env.V6_SIX_PHOTO_FILE,now=Date.now()) {
  const bank=readSixPhotoBank(file,now),rows=[];
  for(const code of new Set(codes||[])) {
    const source=selectBackup(bank,{kind:'quote',code});if(!source)continue;
    for(const q of source.records)rows.push({code,price:q.price,preClose:q.previousClose,pct:finite(q.previousClose)&&q.previousClose>0?(q.price/q.previousClose-1)*100:null,mainInflow:null,mainPct:null,volume:null,quoteAt:q.timestamp,receivedAt:source.observedAt,quoteSource:source.id,quoteFreshness:'recent-unverified',canTrade:false});
  }
  return rows;
}
module.exports={buildBank,readSixPhotoBank,selectBackup,photoQuoteFallback};
