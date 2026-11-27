'use strict';
// Reuse the original private research journal, hash chain and commit guard.
// Only ended-day observations are archived; no execution quote or active episode is restored.
const J=require('./research-workspace-store'),fs=require('node:fs'),path=require('node:path');
const CODES=new Set(['1.000001','0.399001','0.399006','1.000688']),SOURCES=new Set(['tencent-index','sina-index']);
const MODE='index-window-day-v1',ALGORITHM='same-minute-absolute-range-v1';
const validTime=v=>Number.isSafeInteger(v)&&v>0&&v<=8e15;
const dayOf=v=>new Date(v+28800000).toISOString().slice(0,10).replaceAll('-','');
const minuteOf=v=>(Math.floor(v/60000)+480)%1440;
const slot=m=>Number.isInteger(m)&&(m>=570&&m<690||m>=780&&m<897);
const keys=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k));
function validate(data,knownAt){
 if(!keys(data,['mode','algorithm','day','points'])||data.mode!==MODE||data.algorithm!==ALGORITHM||
   typeof data.day!=='string'||!/^\d{8}$/.test(data.day)||!Array.isArray(data.points)||data.points.length<1||data.points.length>948)throw Error('index history schema');
 const date=data.day.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
 const end=Date.parse(date+'T15:00:00+08:00');
 if(!validTime(end)||dayOf(end)!==data.day||end>knownAt)throw Error('index history seal time');
 const seen=new Set();
 for(const p of data.points){
  if(!keys(p,['code','minute','observation'])||!CODES.has(p.code)||!slot(p.minute)||seen.has(p.code+'/'+p.minute))throw Error('index history identity');
  seen.add(p.code+'/'+p.minute);
  const o=p.observation;if(o===null)continue;
  if(!keys(o,['price','quoteAt','receivedAt','quoteSource'])||!SOURCES.has(o.quoteSource)||!Number.isFinite(o.price)||o.price<=0||
    !validTime(o.quoteAt)||!validTime(o.receivedAt)||o.quoteAt>o.receivedAt||o.receivedAt-o.quoteAt>15000||o.receivedAt>knownAt||
    dayOf(o.quoteAt)!==data.day||minuteOf(o.quoteAt)!==p.minute||o.quoteAt%60000>=10000)throw Error('index history observation');
 }
 return data;
}
function createIndexDayHistory({root,clock=Date.now,canPersist=()=>false,onError=()=>{}}){
 let loadedAt=null,status='empty',daysLoaded=0,lastAttempt=null,quarantined=false;const archived=new Map();
 const fail=()=>{status='unavailable';try{onError('index-window-history-unavailable');}catch{}};
 function load(){
  try{
   const now=clock();if(!validTime(now))throw Error('index history clock');loadedAt=now;
   const dir=J.privateRoot(root),days=[];
   const names=fs.existsSync(dir)?fs.readdirSync(dir):[];
   if(names.length>16384||names.some(n=>!/^\d{8}$/.test(n)))throw Error('index history directory');
   // Read a bounded number of day buckets. Old journals remain available for audit.
   for(const name of names.filter(n=>n<=dayOf(now)).sort().slice(-22)){
    const bucket=J.privateRoot(path.join(dir,name)),entries=fs.readdirSync(bucket);
    if(entries.length>32||entries.filter(n=>/^\d+\.json$/.test(n)).some(n=>n!=='000001.json'))throw Error('index history bucket');
    const file=path.join(bucket,'000001.json');
    let stat;try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(!stat.isFile()||stat.size>256*1024)throw Error('index history capacity');
    const events=J.readEvents(bucket,{asOf:now});if(!events.length)continue;
    if(events.length!==1)throw Error('index history day revisions');const e=events[0];
    if(e.data?.day!==name)throw Error('index history day identity');
    if(e.kind!=='diagnostic'||e.requestId!=='index_window_day_'+e.data?.day||archived.has(e.data?.day))throw Error('index history event');
    validate(e.data,e.recordedAt);archived.set(e.data.day,e.hash);days.push({...e.data,journalHash:e.hash});
   }
   days.sort((a,b)=>a.day.localeCompare(b.day));
   daysLoaded=Math.min(21,days.length);status=days.length?'restored':'empty';
   return {loadedAt:days.length?loadedAt:0,days:days.slice(-21)};
  }catch{archived.clear();daysLoaded=0;quarantined=true;fail();return {loadedAt:0,days:[]};}
 }
 function seal(day,readPoints,asOf){
  if(quarantined)return false;
  if(archived.has(day))return archived.get(day);
  try{
   if(canPersist()!==true)return false;
   const now=clock();if(!validTime(now)||!validTime(asOf)||now<asOf)throw Error('index history clock');
   if(lastAttempt!==null&&now-lastAttempt<60000)return false;
   const data=validate({mode:MODE,algorithm:ALGORITHM,day,points:readPoints()},now);
   lastAttempt=now;
   J.privateRoot(root,true);
   const event=J.appendEvent(path.join(root,day),'diagnostic',data,{requestId:'index_window_day_'+day,now,beforeCommit:()=>canPersist()===true});
   archived.set(day,event.hash);status='saved';return event.hash;
  }catch{fail();return false;}
 }
 return {load,seal,invalidate:()=>{daysLoaded=0;status=quarantined?'unavailable':'clock-reset';quarantined=true;},status:()=>({mode:'sealed-index-minute-history-v1',status,daysLoaded,archivedDays:archived.size,currentSession:'fresh-observation-required',researchOnly:true,sourceVerified:false,canTrain:false,canTrade:false,canNotify:false})};
}
module.exports={createIndexDayHistory};
