'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {dayOk}=require('./dabanke-html');
const {parseIndex,origin,dayUrl}=require('./dabanke-index');
const {parsePocket,parseDisclosures,fullUrl}=require('./dabanke-disclosures');
const {fetchDabankePage}=require('./dabanke-requests');
const fingerprint=x=>createHash('sha256').update(JSON.stringify(x,(key,v)=>key==='knownAt'?undefined:v)).digest('hex').slice(0,16);
const completedClose=r=>Boolean(r?.index?.tiers&&r.index.signals&&r.index.ecology&&r.index.themes&&r?.pocket?.dragon&&r?.disclosures);
function stockFacts(report,asOf){
  const facts={};
  const add=(code,fields)=>{if(/^\d{6}$/.test(code))Object.assign(facts[code]??={},fields);};
  const index=report.index,pocket=report.pocket;
  if(index?.day===report.day&&index.knownAt<=asOf){
    for(const tier of index.tiers||[])for(const r of tier.members)add(r.code,{tier:tier.name,status:r.status,performance:r.performance,firstSeal:r.firstSeal,history:r.history,newHigh:r.newHigh,
      ...(r.reasonDay===report.day?{logic:r.reason}:{}),knownAt:index.knownAt});
    for(const g of index.signals?.groups||[])for(const r of g.members){add(r.code,{});(facts[r.code][g.negative?'risks':'patterns']??=[]).push(g.name);}
    for(const theme of index.themes||[])for(const r of theme.members){add(r.code,{});(facts[r.code].themes??=[]).push(theme.name);}
  }
  if(pocket?.day===report.day&&pocket.knownAt<=asOf){
    for(const r of pocket.dragon?.rows||[])add(r.code,{dragon:{rank:r.rank,buy:r.buy,net:r.net,span:r.span}});
    for(const r of pocket.activity?.rows||[])add(r.code,{turnoverRank:r.rank});
    const pop=pocket.popularity;
    if(pop?.observedDay===report.day&&pop.observedAt<=asOf)for(const r of pop.rows)add(r.code,{popularityRank:r.rank});
  }
  return facts;
}
function createDabankeReview({directory,canPersist=()=>true,clock=Date.now,request=fetchDabankePage,onChange=()=>{}}={}){
  const days=new Map(),pending=new Map(),retryAt=new Map(),unsaved=new WeakSet();
  function remember(report){
    const key=report.day+'/'+report.mode;
    if(days.size>=10&&!days.has(key))days.delete(days.keys().next().value);
    days.set(key,report);
  }
  function peek(day,mode='收盘'){
    if(!dayOk(day))return null;
    const cached=days.get(day+'/'+mode);
    if(cached)return cached;
    if(mode!=='收盘'||!directory)return null;
    try{
      const file=path.join(directory,day+'.json'),info=fs.lstatSync(file);
      if(!info.isFile()||info.size>2*1024*1024)return null;
      const r=JSON.parse(fs.readFileSync(file,'utf8'));
      if(r.version!==1||r.day!==day||r.mode!==mode||!Number.isSafeInteger(r.knownAt)||r.knownAt>clock()||!r.revision)return null;
      remember(r);return r;
    }catch{return null;}
  }
  function persist(report){
    if(!directory||!canPersist()||report.mode!=='收盘')return;
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
    const target=path.join(directory,report.day+'.json'),tmp=target+'.'+randomUUID()+'.tmp';
    try{fs.writeFileSync(tmp,JSON.stringify(report),{mode:0o600,flag:'wx'});fs.renameSync(tmp,target);}finally{try{fs.unlinkSync(tmp);}catch{}}
  }
  function saveObserved(report){
    try{persist(report);unsaved.delete(report);}catch{unsaved.add(report);}
  }
  async function collect(day,intraday,old){
    const mode=intraday?'盘中':'收盘',channels=[['index',dayUrl(day),parseIndex]];
    if(!intraday)channels.push(['pocket',origin+'/fpb.html',parsePocket],['disclosures',fullUrl(day),parseDisclosures]);
    const results=await Promise.allSettled(channels.map(async([key,url,parse])=>{
      const response=await request(url),at=response.receivedAt??clock();
      if(!Number.isSafeInteger(at)||at>clock())return null;
      const fresh=parse(response.raw.toString('utf8'),day,at,{intraday});
      if(!fresh)return null;
      const previous=old?.[key];
      if(previous){
        if((fresh.quoteAt||fresh.publishedAt||fresh.market?.quoteAt||0)<(previous.quoteAt||previous.publishedAt||previous.market?.quoteAt||0))return null;
        if(key==='index'||key==='pocket')for(const field of Object.keys(previous))if(fresh[field]==null&&previous[field]!=null)fresh[field]=previous[field];
        if(fingerprint(fresh)===fingerprint(previous))return [key,previous];
      }
      return [key,fresh];
    }));
    const fields=Object.fromEntries(results.filter(r=>r.status==='fulfilled'&&r.value).map(r=>r.value));
    if(!Object.keys(fields).length){
      if(old&&unsaved.has(old))saveObserved(old);
      return old;
    }
    const report={...old,version:1,day,mode,...fields};
    report.knownAt=Math.max(...[report.index,report.pocket,report.disclosures].filter(Boolean).map(x=>x.knownAt));
    report.revision=fingerprint([day,mode,report.index,report.pocket,report.disclosures]);
    if(old?.revision===report.revision){
      if(unsaved.has(old))saveObserved(old);
      return old;
    }
    remember(report);saveObserved(report);onChange(day);return report;
  }
  function refresh(day,{intraday=false}={}){
    const now=clock(),today=new Date(now+8*3600000).toISOString().slice(0,10),mode=intraday?'盘中':'收盘';
    if(!dayOk(day)||day>today||intraday&&day!==today||!intraday&&now<Date.parse(day+'T15:00:00+08:00'))return Promise.resolve(null);
    const key=day+'/'+mode,old=peek(day,mode);
    if(pending.has(key))return pending.get(key);
    if(now<(retryAt.get(key)||0))return Promise.resolve(old);
    if(!intraday&&day<today&&completedClose(old)){
      if(unsaved.has(old)){saveObserved(old);retryAt.set(key,now+120000);}
      return Promise.resolve(old);
    }
    for(const [k,time] of retryAt)if(time<=now&&!pending.has(k))retryAt.delete(k);
    const job=collect(day,intraday,old).then(v=>{
      const complete=completedClose(v);
      retryAt.set(key,clock()+(intraday?30000:complete?4*3600000:2*60000));return v;
    }).catch(()=>{retryAt.set(key,clock()+60000);return old;}).finally(()=>pending.delete(key));
    pending.set(key,job);return job;
  }
  const summaries=new WeakMap();
  function summary(day,mode){
    const r=peek(day,mode);if(!r)return null;
    if(!summaries.has(r))summaries.set(r,{day,mode:r.mode,knownAt:r.knownAt,revision:r.revision,market:r.index?.market,ecology:r.index?.ecology,facts:stockFacts(r,clock())});
    return summaries.get(r);
  }
  return {peek,refresh,summary};
}
module.exports={createDabankeReview,stockFacts};
