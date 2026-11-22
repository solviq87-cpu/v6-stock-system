'use strict';
const fs=require('node:fs');
const {atomicWrite}=require('../core/market-data-center');
const numeric=Number.isFinite;
const fields=['adv','dec','amount','upLimit','downLimit','breakRate','height','leader','diffusion','premium','firstBoardPremium','trend','sh','cy','allAClose','allAChange','shClose','shChange','cyClose','cyChange','indexChange','theme','volume'];
const essential=['adv','dec','amount','upLimit','downLimit','breakRate','height','leader','diffusion','premium','trend','sh','cy'];
const dayOk=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\d$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const wall=t=>new Date(t+8*36e5).toISOString().slice(0,16).replace('T',' ');
const known=v=>numeric(v)||typeof v==='string'&&!!v.trim()&&!['未判定','缺失','未知'].includes(v);
function valueOk(k,v){
  if(['trend','sh','cy'].includes(k))return ['多头','空头','震荡'].includes(v);
  if(k==='volume'||k==='theme')return typeof v==='string'&&known(v)&&v.length<=80;
  if(!numeric(v))return false;
  if(['adv','dec','upLimit','downLimit','height'].includes(k))return Number.isSafeInteger(v)&&v>=0;
  if(['breakRate','diffusion'].includes(k))return v>=0&&v<=100;
  return k!=='amount'||v>0;
}
function sourceName(value,backup){
  const src=typeof value==='string'?value:value?.source||value?.provider||value?.name;
  return typeof src==='string'&&src.trim()?src.trim().slice(0,100):backup;
}
// Every retained display value carries its own session and receipt clock.
function mergePublicRows(state,rows,day,now){
  const merged=new Map(state.history.filter(r=>r.date<=day).map(r=>[r.date,r]));
  for(const r of rows){
    if(!dayOk(r.date)||r.date>day||!Number.isSafeInteger(r.knownAt)||r.knownAt>now)continue;
    const previous=merged.get(r.date)||{date:r.date,metrics:{}};
    const metrics={...previous.metrics};
    for(const key of fields){
      if(!valueOk(key,r[key]))continue;
      const origin=r.fieldSources?.[key],source=sourceName(origin,sourceName(r.source,'V6 收盘数据'));
      const at=Number.isSafeInteger(origin?.knownAt)?origin.knownAt:r.knownAt;
      if(at>now||at<=0||metrics[key]?.knownAt>at)continue;
      metrics[key]={value:r[key],source,date:r.date,knownAt:at,...(typeof origin?.scope==='string'?{scope:origin.scope.slice(0,120)}:{})};
    }
    if(Object.keys(metrics).length)merged.set(r.date,{date:r.date,previousDay:r.previousDay||previous.previousDay,metrics});
  }
  state.history=[...merged.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-20);
}
function marketValues(history){
  return history.map(r=>({...Object.fromEntries(Object.entries(r.metrics).map(([k,v])=>[k,v.value])),date:r.date,previousDay:r.previousDay,
    knownAt:Math.max(...Object.values(r.metrics).map(v=>v.knownAt))}));
}
function createMarketRecovery({collect,save,getDay,isReplica=()=>false,replicaPublicReads=false,file,clock=Date.now}){
  let state={history:[],sources:[],referenceDay:null,phase:'scheduled',lastAttemptAt:null,lastSuccessAt:null,nextRetryAt:0},busy=null,misses=0;
  let readMtime=0,lastDiskRead=-Infinity;
  function loadPublic(){
    if(!file)return;
    try{
      const stat=fs.lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>=524288||stat.mtimeMs<=readMtime)return;
      const saved=JSON.parse(fs.readFileSync(file,'utf8'));
      if(saved.format===1&&Array.isArray(saved.state.history)&&Array.isArray(saved.state.sources)){
        Object.assign(state,saved.state);
        readMtime=stat.mtimeMs;
      }
    }catch{ /* A fresh host can obtain public market measurements directly. */ }
  }
  loadPublic();
  if(!isReplica())state.nextRetryAt=0;
  let cachedRows=[],cachedDay=null;
  function display(){
    const day=getDay()||state.referenceDay,metrics={};
    for(const r of state.history)if(r.date<=day)Object.assign(metrics,r.metrics);
    const {history,...status}=state;
    const referenceDay=day||status.referenceDay;
    return {...status,referenceDay,phase:referenceDay!==status.referenceDay?'scheduled':status.phase,metrics,
      ...(state.emotion?.date>referenceDay?{emotion:null}:{})};
  }
  async function run(day){
    const attempt=clock();state={...state,referenceDay:day,phase:'searching',lastAttemptAt:attempt};
    try{
      const result=await collect(day);
      if(isReplica()&&!replicaPublicReads)return [];
      const now=clock(),rows=(result.rows||[]).filter(r=>r.date<=day&&Number.isSafeInteger(r.knownAt)&&r.knownAt<=now);
      mergePublicRows(state,rows,day,now);
      state.sources=(result.sources||[]).slice(0,36).map(s=>({name:sourceName(s,'V6 原始数据'),status:s.status==='available'?'available':'retrying'}));
      if(Array.isArray(result.coverage)){
        const retained=new Map();
        const rows=[...(state.coverage||[]),...result.coverage].filter(x=>x&&dayOk(x.day)&&x.day<=day&&Number.isSafeInteger(x.knownAt)&&x.knownAt<=now)
          .sort((a,b)=>a.day.localeCompare(b.day)||a.knownAt-b.knownAt);
        for(const x of rows)retained.set(x.kind+'/'+x.scope,Object.fromEntries(['kind','scope','source','day','observed','total','adv','dec','flat','amountCny','change','meanChange','knownAt','complete']
          .filter(k=>x[k]!=null).map(k=>[k,x[k]])));
        state.coverage=[...retained.values()].sort((a,b)=>b.day.localeCompare(a.day)||b.knownAt-a.knownAt).slice(0,12);
      }
      state.emotion=null;
      const {emotion}=await import('../../public/nova/shortline/market.mjs');
      const available=marketValues(state.history),last=state.history.find(r=>r.date===day);
      for(const row of available.slice().reverse()){
        const mood=emotion(available,row.date,now);
        if(mood.stage!=='未判定'){
          state.emotion={value:mood.stage,confidence:mood.confidence,date:row.date,source:'V6 多日收盘证据',knownAt:now};
          break;
        }
      }
      if(rows.some(r=>r.date===day&&fields.some(k=>valueOk(k,r[k]))))state.lastSuccessAt=now;
      const durable=rows.length&&!isReplica()?await save(rows,day):true;
      cachedDay=day;cachedRows=rows;
      const hasBreadth=last?.metrics.adv&&last.metrics.dec || state.coverage?.some(x=>x.day===day&&numeric(x.adv)&&numeric(x.dec));
      const hasAmount=last?.metrics.amount||state.coverage?.some(x=>x.day===day&&numeric(x.amountCny));
      const complete=hasBreadth&&hasAmount&&last&&essential.filter(k=>!['adv','dec','amount'].includes(k)).every(k=>last.metrics[k])&&available.filter(r=>r.date<=day&&['upLimit','downLimit','breakRate','height','leader','diffusion'].every(k=>numeric(r[k]))).length>=3;
      if(!durable)throw Error('等待研究归档');
      state.phase=complete?'ready':'partial';
      misses=complete?0:misses+1;
      state.nextRetryAt=now+(complete?4*3600000:Math.min(30,2**Math.min(misses,5))*60000);
      if(file&&!isReplica())atomicWrite(file,JSON.stringify({format:1,state}));
      return rows;
    }catch{
      misses++;state.phase='partial';state.nextRetryAt=clock()+Math.min(30,2**Math.min(misses,5))*60000;
      return cachedDay===day?cachedRows:[];
    }
  }
  function tick(){
    const day=getDay();
    if(isReplica()&&clock()-lastDiskRead>=60000){lastDiskRead=clock();loadPublic();}
    if(isReplica()&&!replicaPublicReads||!dayOk(day))return Promise.resolve([]);
    if(busy)return busy;
    if(state.referenceDay===day&&clock()<state.nextRetryAt)return Promise.resolve(cachedDay===day?cachedRows:[]);
    if(state.referenceDay!==day)misses=0;
    busy=run(day).finally(()=>{busy=null;});
    return busy;
  }
  return {display,tick,rows:day=>day===cachedDay?cachedRows:[]};
}
module.exports={createMarketRecovery,mergePublicRows,fields,wall};
