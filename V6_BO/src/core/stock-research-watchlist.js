'use strict';
// Explicit observation intent, independent of push delivery and frozen-target
// followups. A watch revisits each newly eligible closing session at most once.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {readResearchCalendar}=require('./research-calendar-source');
const FLAGS={researchOnly:true,canTrade:false,canNotify:false,verifiedLive:false,
 productionWeightsChanged:false,exactlyOnce:false};
const MAX_SYMBOLS=100,MAX_HISTORY=1000,MAX_BYTES=16*1024*1024;
const active=new Set(),hex=/^[a-f0-9]{64}$/;
const instant=x=>Number.isSafeInteger(x)&&x>0;
const day=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\d$/.test(x)&&
 Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const at=(d,t)=>Date.parse(d+'T'+t+':00+08:00');
function canonical(x){return Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?
 Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;}
const encode=x=>JSON.stringify(canonical(x));
const hash=x=>crypto.createHash('sha256').update(encode(x)).digest('hex');
const clock=now=>{const n=typeof now==='function'?now():now;
 if(!instant(n)||n>Date.now())throw Error('invalid clock');return n;};
const stamp=x=>instant(x)?x:typeof x==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(x)&&
 day(x.slice(0,10))&&instant(Date.parse(x))?Date.parse(x):NaN;
const delay=n=>Math.min(60,20*n)*60000;
function privateDir(root,create=false){
 if(typeof root!=='string'||!path.isAbsolute(root)||root.includes('\0'))throw Error('invalid root');
 const full=path.resolve(root);
 if(full===path.parse(full).root||full.split(path.sep).some(p=>p.toLowerCase()==='public'))throw Error('invalid root');
 let current=path.parse(full).root;
 for(const part of full.slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);try{const st=fs.lstatSync(current);
   if(st.isSymbolicLink()||!st.isDirectory())throw Error('invalid directory');
  }catch(e){if(e.code!=='ENOENT')throw e;}
 }
 if(create)fs.mkdirSync(full,{recursive:true,mode:0o700});
 if(fs.existsSync(full)&&(fs.statSync(full).mode&0o777)!==0o700)throw Error('invalid permissions');
 return full;
}
function identity(input){
 if(!input||Object.keys(input).some(k=>!['symbol','provider','registeredAt'].includes(k))||
    !/^\d{6}$/.test(input.symbol||'')||!['eastmoney','tencent'].includes(input.provider)||
    !instant(input.registeredAt)||input.registeredAt>Date.now())throw Error('invalid watch');
 return {symbol:input.symbol,provider:input.provider,registeredAt:input.registeredAt};
}
function listing(dir,maxSize){
 if(!fs.existsSync(dir))return {files:[],bytes:0};
 const files=[],all=fs.readdirSync(dir);let bytes=0;
 if(all.length>MAX_HISTORY*3)throw Error('entry capacity');
 for(const name of all){const file=path.join(dir,name),st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o777)!==0o600||st.size>maxSize)throw Error('invalid record');
  bytes+=st.size;
  if(/^\d{6}\.json\.[a-f0-9]{16}\.tmp$/.test(name))continue;
  if(!/^\d{6}\.json$/.test(name))throw Error('invalid record name');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try{if(fs.fstatSync(fd).size>maxSize)throw Error('oversize');files.push({name,value:JSON.parse(fs.readFileSync(fd,'utf8'))});}
  finally{fs.closeSync(fd);}
 }
 files.sort((a,b)=>a.name.localeCompare(b.name));return {files,bytes};
}
function resultProof(result,job,startedAt,now){
 if(result?.status!=='captured')return {reason:'SOURCE_UNAVAILABLE'};
 const s=result.stock,h=result.history,o=result.observation,r=result.priceEventResearch;
 if(s?.symbol!==job.symbol||s.provider!==job.provider||s.source!==job.provider||
    h?.provider!==job.provider||h.source!==undefined&&h.source!==job.provider||
    result.source!==undefined&&result.source!==job.provider)return {reason:'PROVIDER_MISMATCH'};
 if(s.priceBasis!=='unadjusted'||h.priceBasis!==undefined&&h.priceBasis!=='unadjusted'||
    !Array.isArray(s.bars)||s.bars.length>500||!hex.test(h.rawHash||'')||
    !hex.test(o?.observationHash||'')||!Number.isSafeInteger(o.revision)||o.revision<1||o.revision>500)
  return {reason:'INVALID_TARGET_EVIDENCE'};
 const targets=s.bars.filter(b=>b?.date===job.targetDate);
 if(!targets.length)return {reason:'TARGET_MISSING'};
 if(targets.length!==1||s.bars.at(-1)?.date!==job.targetDate)return {reason:'INVALID_TARGET_EVIDENCE'};
 const b=targets[0],knownAt=stamp(b.knownAt),observedAt=stamp(s.observedAt),retrievedAt=stamp(h.retrievedAt);
 if(![knownAt,observedAt,retrievedAt].every(instant)||knownAt<at(job.targetDate,'15:10')||
    knownAt>observedAt||observedAt>retrievedAt||retrievedAt<startedAt||retrievedAt>now||
    now<job.dueAt||now>=job.nextSessionOpenAt||b.closed===false||b.isClosed===false||
    ['source','provider'].some(k=>b[k]!==undefined&&b[k]!==job.provider)||
    b.priceBasis!==undefined&&b.priceBasis!=='unadjusted'||
    !['open','high','low','close','volume'].every(k=>typeof b[k]==='number'&&Number.isFinite(b[k]))||
    Math.min(b.open,b.low,b.close)<=0||b.high<Math.max(b.open,b.close)||
    b.low>Math.min(b.open,b.close)||b.high<b.low||!Number.isSafeInteger(b.volume)||b.volume<0)
  return {reason:'INVALID_TARGET_EVIDENCE'};
 const recorded=r?.status==='research-observation-recorded',empty=r?.status==='no-eligible-prospective-hypothesis',
  existing=r?.status==='unchanged'&&r.currentHypothesis?.signalDate===job.targetDate&&
   r.currentHypothesis?.targetDate===job.nextSessionDate&&hex.test(r.currentHypothesis?.hypothesisHash||'');
 if(!recorded&&!empty&&!existing)return {reason:'RESEARCH_NOT_SEALED'};
 if(['symbol','provider','source'].some(k=>r[k]!==undefined&&r[k]!==
    (k==='symbol'?job.symbol:job.provider)))return {reason:'RESEARCH_NOT_SEALED'};
 if(!empty&&(!Number.isSafeInteger(r.revision)||r.revision<1))return {reason:'RESEARCH_NOT_SEALED'};
 return {proof:{symbol:job.symbol,provider:job.provider,source:job.provider,priceBasis:'unadjusted',
  targetDate:job.targetDate,rawHash:h.rawHash,observationHash:o.observationHash,revision:o.revision,
  observedAt,retrievedAt,researchStatus:r.status,researchRevision:r.revision||0,
  ...(existing?{hypothesis:{signalDate:r.currentHypothesis.signalDate,targetDate:r.currentHypothesis.targetDate,
   hypothesisHash:r.currentHypothesis.hypothesisHash}}:{}),
  bar:{date:b.date,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,knownAt}}};
}
function validProof(proof,job,startedAt,completedAt){
 if(!proof)return false;
 const result=resultProof({status:'captured',history:{provider:proof.provider,source:proof.source,
  rawHash:proof.rawHash,retrievedAt:proof.retrievedAt},stock:{symbol:proof.symbol,
  provider:proof.provider,source:proof.source,priceBasis:proof.priceBasis,
  observedAt:proof.observedAt,bars:[proof.bar]},observation:{revision:proof.revision,
  observationHash:proof.observationHash},priceEventResearch:{status:proof.researchStatus,
  revision:proof.researchRevision,currentHypothesis:proof.hypothesis}},job,startedAt,completedAt);
 return !!result.proof&&encode(result.proof)===encode(proof);
}
function readState(root){
 const base=privateDir(root),wdir=privateDir(path.join(base,'watches')),hdir=privateDir(path.join(base,'history'));
 if(fs.existsSync(base)&&fs.readdirSync(base).some(n=>!['watches','history'].includes(n)))throw Error('invalid root entry');
 const wl=listing(wdir,2048),hl=listing(hdir,8192),watches=[],history=[],ids=new Map(),latest=new Map();
 if(wl.files.length>MAX_SYMBOLS*2||hl.files.length>MAX_HISTORY||wl.bytes+hl.bytes>MAX_BYTES)throw Error('capacity');
 let previous=null;
 for(const [i,{name,value:e}]of wl.files.entries()){
  const {recordHash,...body}=e,w=identity(e.watch);
  if(name!==String(i+1).padStart(6,'0')+'.json'||e.sequence!==i+1||e.schemaVersion!==1||
     e.mode!=='stock-research-watch-v1'||e.previousHash!==previous||hash(body)!==recordHash||
     e.id!==hash([w.symbol,w.provider])||ids.has(e.id)||!instant(e.recordedAt)||
     e.watch.registeredAt>e.recordedAt||Object.keys(FLAGS).some(k=>e[k]!==FLAGS[k]))throw Error('invalid watch chain');
  watches.push(e);ids.set(e.id,e);previous=recordHash;
 }
 if(new Set(watches.map(e=>e.watch.symbol)).size>MAX_SYMBOLS)throw Error('symbol capacity');
 previous=null;
 for(const [i,{name,value:e}]of hl.files.entries()){
  const {recordHash,...body}=e,w=ids.get(e.watchId),prior=latest.get(e.id),job=e.job;
  if(!w||name!==String(i+1).padStart(6,'0')+'.json'||e.sequence!==i+1||e.schemaVersion!==1||
     e.mode!=='stock-research-watch-attempt-v1'||e.previousHash!==previous||hash(body)!==recordHash||
     !job||job.symbol!==w.watch.symbol||job.provider!==w.watch.provider||
     job.registeredAt!==w.watch.registeredAt||!day(job.targetDate)||!day(job.nextSessionDate)||
     job.nextSessionDate<=job.targetDate||job.dueAt!==at(job.targetDate,'16:10')||
     job.nextSessionOpenAt!==at(job.nextSessionDate,'09:30')||!hex.test(job.calendarHash||'')||
     job.registeredAt>=job.nextSessionOpenAt||e.id!==hash([e.watchId,job.targetDate])||
     e.attempt!==(prior?.attempt||0)+1||e.attempt>5||prior&&prior.status!=='pending'||
     prior&&encode(prior.job)!==encode(job)||
     !instant(e.startedAt)||!instant(e.completedAt)||e.completedAt<e.startedAt||
     e.startedAt<Math.max(job.dueAt,job.registeredAt,prior?.nextAttemptAt||0)||
     e.startedAt>=job.nextSessionOpenAt||
     Object.keys(FLAGS).some(k=>e[k]!==FLAGS[k]))throw Error('invalid attempt chain');
  if(e.status==='completed'){
   if(e.nextAttemptAt!==null||e.reason!==undefined||!validProof(e.proof,job,e.startedAt,e.completedAt))throw Error('invalid completion');
  }else if(e.status!==(e.attempt===5?'unknown':'pending')||e.proof!==undefined||
     !['SOURCE_UNAVAILABLE','PROVIDER_MISMATCH','INVALID_TARGET_EVIDENCE','TARGET_MISSING','RESEARCH_NOT_SEALED','CAPTURE_ERROR'].includes(e.reason)||
     e.nextAttemptAt!==(e.attempt===5?null:e.completedAt+delay(e.attempt)))throw Error('invalid retry');
  history.push(e);latest.set(e.id,e);previous=e.recordHash;
 }
 return {base,wdir,hdir,watches,history,latest,bytes:wl.bytes+hl.bytes};
}
function publish(dir,sequence,event,max){
 const raw=encode(event);if(Buffer.byteLength(raw)>max)throw Error('record capacity');
 const file=path.join(dir,String(sequence).padStart(6,'0')+'.json'),temp=file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';let fd;
 try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,raw);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  fs.linkSync(temp,file);
 }catch(e){if(e.code==='EEXIST')return false;throw e;}
 finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
 const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}return true;
}
function registerResearchWatch(root,input){
 try{
  const watch=identity(input),recordedAt=Date.now(),id=hash([watch.symbol,watch.provider]);
  const base=privateDir(root,true);privateDir(path.join(base,'watches'),true);privateDir(path.join(base,'history'),true);
  for(let retry=0;retry<5;retry++){
   const state=readState(root),same=state.watches.find(e=>e.id===id);
   if(same)return {registered:true,reused:true,id,...same.watch,...FLAGS};
   if(new Set([...state.watches.map(e=>e.watch.symbol),watch.symbol]).size>MAX_SYMBOLS)
    return {registered:false,blocked:true,reason:'WATCH_SYMBOL_CAPACITY',...FLAGS};
   const body={schemaVersion:1,mode:'stock-research-watch-v1',sequence:state.watches.length+1,
    previousHash:state.watches.at(-1)?.recordHash||null,id,watch,recordedAt,...FLAGS},event={...body,recordHash:hash(body)};
   if(state.bytes+Buffer.byteLength(encode(event))>MAX_BYTES)return {registered:false,blocked:true,reason:'WATCH_BYTES_CAPACITY',...FLAGS};
   if(publish(state.wdir,body.sequence,event,2048))return {registered:true,reused:false,id,...watch,...FLAGS};
  }
  return {registered:false,blocked:true,reason:'WATCH_PUBLICATION_CONFLICT',...FLAGS};
 }catch{throw Error('股票研究关注参数、私有存储或完整性校验失败');}
}
function readResearchWatchlist(root){
 try{const state=readState(root),rows=[...state.latest.values()],completed=rows.filter(e=>e.status==='completed'),
  pending=rows.filter(e=>e.status==='pending'),unknown=rows.filter(e=>e.status==='unknown');
  return {watches:state.watches.map(e=>({id:e.id,...e.watch})),completed,pending,unknown,
   lastSuccess:completed.at(-1)||null,lastFailure:state.history.filter(e=>e.reason).at(-1)||null,
   counts:{symbols:new Set(state.watches.map(e=>e.watch.symbol)).size,watches:state.watches.length,
    sessions:rows.length,completed:completed.length,pending:pending.length,unknown:unknown.length,
    attempts:state.history.length},bytes:state.bytes,...FLAGS};
 }catch{throw Error('股票研究关注私有存储或完整性校验失败');}
}
async function processResearchWatchlist(root,{capture,now=Date.now,calendarFile,readCalendar=readResearchCalendar,maxJobs=1}={}){
 let key;
 try{key=privateDir(root);clock(now);if(typeof capture!=='function'||typeof readCalendar!=='function'||maxJobs!==1)throw Error('invalid processor');}
 catch{throw Error('股票研究关注处理参数或私有存储无效');}
 if(active.has(key))return {processed:0,results:[],running:true,...FLAGS};
 active.add(key);
 try{
  const state=readState(root),time=clock(now),due=[];let calendars=0;
  if(state.history.length>=MAX_HISTORY)return {processed:0,results:[],status:'watch-history-capacity',...FLAGS};
  for(const watch of state.watches){
   if(watch.watch.registeredAt>time)continue;
   let cal;try{cal=await readCalendar({asOf:time,symbol:watch.watch.symbol,calendarFile});}catch{continue;}
   const dates=cal?.tradeDates;
   if(cal?.status!=='available'||!Array.isArray(dates)||dates.length<2||dates.length>1000||
      dates.some((d,i)=>!day(d)||(i&&dates[i-1]>=d)))continue;
   calendars++;
   const index=dates.findLastIndex(d=>at(d,'16:10')<=time);
   if(index<0||index>=dates.length-1)continue;
   const targetDate=dates[index],nextSessionDate=dates[index+1],nextSessionOpenAt=at(nextSessionDate,'09:30');
   if(time>=nextSessionOpenAt||watch.watch.registeredAt>=nextSessionOpenAt)continue;
   const id=hash([watch.id,targetDate]),prior=state.latest.get(id);
   if(prior&&(prior.status!=='pending'||prior.nextAttemptAt>time))continue;
   if(prior&&(prior.job.nextSessionDate!==nextSessionDate||prior.job.nextSessionOpenAt!==nextSessionOpenAt))continue;
   const job=prior?.job||{...watch.watch,targetDate,nextSessionDate,nextSessionOpenAt,dueAt:at(targetDate,'16:10'),
    calendarHash:hex.test(cal.metadata?.sha256||'')?cal.metadata.sha256:hash(dates)};
   due.push({watchId:watch.id,id,job,prior});
  }
  due.sort((a,b)=>(a.prior?.nextAttemptAt||a.job.dueAt)-(b.prior?.nextAttemptAt||b.job.dueAt)||a.id.localeCompare(b.id));
  if(!due.length)return {processed:0,results:[],status:calendars?'waiting-eligible-session-close':'waiting-explicit-calendar',...FLAGS};
  const candidate=due[0],startedAt=clock(now);let outcome;
  if(startedAt>=candidate.job.nextSessionOpenAt||startedAt<candidate.job.dueAt)
   return {processed:0,results:[],status:'waiting-eligible-session-close',...FLAGS};
  try{outcome=resultProof(await capture({id:candidate.id,...candidate.job,source:candidate.job.provider,...FLAGS}),candidate.job,startedAt,clock(now));}
  catch{outcome={reason:'CAPTURE_ERROR'};}
  const completedAt=clock(now);if(completedAt<startedAt)throw Error('clock regression');
  for(let retry=0;retry<5;retry++){
   const current=readState(root),prior=current.latest.get(candidate.id);
   if(prior&&(prior.status!=='pending'||prior.nextAttemptAt>startedAt))
    return {processed:1,results:[{...prior,published:false,reused:true}],...FLAGS};
   if(current.history.length>=MAX_HISTORY)return {processed:1,results:[],status:'watch-history-capacity',...FLAGS};
   const attempt=(prior?.attempt||0)+1,status=outcome.proof?'completed':attempt===5?'unknown':'pending';
   const body={schemaVersion:1,mode:'stock-research-watch-attempt-v1',sequence:current.history.length+1,
    previousHash:current.history.at(-1)?.recordHash||null,watchId:candidate.watchId,id:candidate.id,
    job:candidate.job,attempt,startedAt,completedAt,status,
    nextAttemptAt:status==='pending'?completedAt+delay(attempt):null,...outcome,...FLAGS},event={...body,recordHash:hash(body)};
   if(current.bytes+Buffer.byteLength(encode(event))>MAX_BYTES)
    return {processed:1,results:[],status:'watch-bytes-capacity',...FLAGS};
   if(publish(current.hdir,body.sequence,event,8192))
    return {processed:1,results:[{...event,published:true,reused:false}],...FLAGS};
  }
  return {processed:1,results:[],status:'watch-publication-conflict',...FLAGS};
 }catch{throw Error('股票研究关注处理或完整性校验失败');}
 finally{active.delete(key);}
}
module.exports={registerResearchWatch,processResearchWatchlist,readResearchWatchlist};
