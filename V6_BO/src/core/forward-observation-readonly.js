'use strict';
// Opt-in read-only bridge for existing forward-signals.js "evaluate" output.
// This does not freeze, evaluate, learn, buy/sell or certify third-party data.
const fs=require('node:fs');
const path=require('node:path');
const PERIODS=[1,5,20,60];
const STATES=new Set(['observed','pending','calendar-incomplete','corporate-action-unresolved','missing-or-suspended']);
const SYSTEMS=new Set(['fourteen','bazi','gpt','python','manual']);
const text=x=>typeof x==='string'&&x.trim().length>0&&x.length<=200;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 !Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const fingerprint=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const cutoff=d=>Date.parse(d+'T16:00:00+08:00');

function validReport(r,now=Date.now()){
 if(!r||typeof r!=='object'||Array.isArray(r)||r.schemaVersion!==1||
   r.mode!=='forward-signal-price-observation'||r.returnBasis!=='signal-day-close-to-future-session-close-unadjusted-gross'||
   r.canTrade!==false||r.verifiedLive!==false||r.prospectiveCertified!==false||
   r.executionSimulated!==false||!date(r.asOf)||!finite(r.observedAt)||
   !finite(now)||r.observedAt>now||r.observedAt<cutoff(r.asOf)||
   !fingerprint(r.cohortFingerprint)||!fingerprint(r.marketFingerprint)||
   !r.feed||r.feed.source!=='imported'||r.feed.priceBasis!=='unadjusted'||
   !text(r.feed.provider)||!text(r.feed.datasetId)||
   !Array.isArray(r.records)||r.records.length<1||r.records.length>500)return false;
 const ids=new Set();
 for(const s of r.records){
  if(!s||typeof s!=='object'||!text(s.signalId)||ids.has(s.signalId)||
    !/^\d{6}$/.test(s.symbol)||!SYSTEMS.has(s.system)||!text(s.cohort)||
    !date(s.signalDate)||s.signalDate>r.asOf||!finite(s.signalAt)||
    s.signalAt<cutoff(s.signalDate)||s.signalAt>r.observedAt||
    !finite(s.baselineClose)||s.baselineClose<=0||
    !Array.isArray(s.windows)||s.windows.length!==4)return false;
  ids.add(s.signalId);
  for(let i=0;i<PERIODS.length;i++){
   const w=s.windows[i];
   if(!w||w.tradingDays!==PERIODS[i]||!STATES.has(w.status)||
     !(w.targetDate===null||date(w.targetDate))||
     (w.targetDate!==null&&w.targetDate<=s.signalDate))return false;
   if(w.status==='observed'){
    if(w.targetDate===null||w.targetDate>r.asOf||!finite(w.priceReturnPct)||
       w.priceReturnPct<=-100)return false;
   }else if(w.priceReturnPct!==null)return false;
   if(w.status==='calendar-incomplete'&&w.targetDate!==null)return false;
   if(w.status==='pending'&&w.targetDate!==null&&w.targetDate<=r.asOf)return false;
   if((w.status==='corporate-action-unresolved'||w.status==='missing-or-suspended')&&
      (w.targetDate===null||w.targetDate>r.asOf))return false;
  }
 }
 return true;
}
// No request-controlled file paths. Explicit operator-provided absolute path,
// no symbolic links in *any* component, no files served from the public tree.
function safeFile(file,staticRoot){
 if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0'))return false;
 const resolved=path.resolve(file),publicRoot=path.resolve(staticRoot);
 if(resolved===publicRoot||resolved.startsWith(publicRoot+path.sep))return false;
 let part=path.parse(resolved).root;
 for(const component of resolved.slice(part.length).split(path.sep).filter(Boolean)){
  part=path.join(part,component);
  if(fs.lstatSync(part).isSymbolicLink())return false;
 }
 return true;
}
function readForwardObservation({file,staticRoot=path.resolve(__dirname,'../../public'),now=Date.now()}={}){
 if(!file)return null;
 let fd;
 try{
  if(!safeFile(file,staticRoot))return null;
  fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.size<1||stat.size>1024*1024)return null;
  const raw=fs.readFileSync(fd,'utf8');
  const report=JSON.parse(raw);
  return validReport(report,now)?report:null;
 }catch{return null;}finally{if(fd!==undefined)fs.closeSync(fd);}
}
module.exports={validReport,readForwardObservation};
