'use strict';
// Durable data revisits for frozen hypotheses; this is not prediction promotion.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const PROTOCOL='stock-research-followup-v1',MAX_JOBS=1000,MAX_FILE=4096,MAX_ATTEMPT=2048,MAX_BYTES=16*1024*1024;
const flags={researchOnly:true,canTrade:false,canNotify:false,verifiedLive:false,weightsChanged:false,exactlyOnce:false};
const active=new Set(),hex=/^[a-f0-9]{64}$/,providers=new Set(['eastmoney','tencent']);
const instant=n=>Number.isSafeInteger(n)&&n>0;
const day=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\d$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const at=(d,t)=>Date.parse(d+'T'+t+':00+08:00');
const clock=n=>{const value=typeof n==='function'?n():n;if(!instant(value))throw Error('invalid clock');return value;};
function canonical(x){if(Array.isArray(x))return x.map(canonical);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));return x;}
const encode=x=>JSON.stringify(canonical(x)),hash=x=>crypto.createHash('sha256').update(encode(x)).digest('hex');
function privateDir(input,create=false){
 if(typeof input!=='string'||!path.isAbsolute(input)||input.includes('\0'))throw Error('invalid root');
 const full=path.resolve(input);if(full===path.parse(full).root||full.split(path.sep).some(p=>p.toLowerCase()==='public'))throw Error('invalid root');
 let current=path.parse(full).root;for(const part of full.slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);try{const st=fs.lstatSync(current);if(st.isSymbolicLink()||!st.isDirectory())throw Error('invalid directory');}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 if(create)fs.mkdirSync(full,{recursive:true,mode:0o700});if(fs.existsSync(full)&&(fs.statSync(full).mode&0o777)!==0o700)throw Error('invalid permissions');return full;
}
function cleanJob(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['symbol','source','provider','priceBasis','targetDate','dueAt','hypothesisHash','calendarHash','createdAt'].includes(k))||!/^\d{6}$/.test(input.symbol||'')||!providers.has(input.provider)||input.source!==undefined&&input.source!==input.provider||input.priceBasis!=='unadjusted'||!day(input.targetDate)||input.dueAt!==at(input.targetDate,'16:10')||!hex.test(input.hypothesisHash||'')||!hex.test(input.calendarHash||'')||!instant(input.createdAt)||input.createdAt>=at(input.targetDate,'09:30'))throw Error('invalid job');
 return {protocol:PROTOCOL,symbol:input.symbol,source:input.provider,provider:input.provider,priceBasis:'unadjusted',targetDate:input.targetDate,dueAt:input.dueAt,hypothesisHash:input.hypothesisHash,calendarHash:input.calendarHash,createdAt:input.createdAt};
}
function identity(job){const {createdAt,...id}=job;return id;}
const delay=attempt=>Math.min(3600000,1200000*2**(attempt-1));
function numericStamp(value){if(instant(value))return value;if(typeof value==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value)&&day(value.slice(0,10))&&instant(Date.parse(value)))return Date.parse(value);return NaN;}
function captureProof(result,job,now){
 if(result?.status!=='captured')return {reason:'SOURCE_UNAVAILABLE'};
 const h=result.history,s=result.stock,o=result.observation;
 if(h?.provider!==job.provider||h.source!==undefined&&h.source!==job.provider||s?.provider!==job.provider||s?.source!==job.provider||result.source!==undefined&&result.source!==job.provider)return {reason:'PROVIDER_MISMATCH'};
 if(s.symbol!==job.symbol||s.priceBasis!=='unadjusted'||h.priceBasis!==undefined&&h.priceBasis!=='unadjusted'||!Array.isArray(s.bars)||s.bars.length>500||!hex.test(h.rawHash||'')||!hex.test(o?.observationHash||'')||!Number.isSafeInteger(o.revision)||o.revision<1||o.revision>500)return {reason:'INVALID_TARGET_EVIDENCE'};
 const targets=s.bars.filter(b=>b?.date===job.targetDate);if(!targets.length)return {reason:'TARGET_MISSING'};if(targets.length!==1)return {reason:'INVALID_TARGET_EVIDENCE'};
 const b=targets[0],knownAt=numericStamp(b.knownAt),observedAt=numericStamp(s.observedAt),retrievedAt=numericStamp(h.retrievedAt);
 if(![knownAt,observedAt,retrievedAt].every(instant)||knownAt<=job.createdAt||knownAt<at(job.targetDate,'15:10')||knownAt>observedAt||observedAt>retrievedAt||retrievedAt>now||now<job.dueAt||b.closed===false||b.isClosed===false||b.source!==undefined&&b.source!==job.provider||b.provider!==undefined&&b.provider!==job.provider||b.priceBasis!==undefined&&b.priceBasis!=='unadjusted'||!['open','high','low','close','volume'].every(k=>typeof b[k]==='number'&&Number.isFinite(b[k]))||Math.min(b.open,b.low,b.close)<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.high<b.low||!Number.isSafeInteger(b.volume)||b.volume<0)return {reason:'INVALID_TARGET_EVIDENCE'};
 return {proof:{symbol:job.symbol,source:job.provider,provider:job.provider,priceBasis:'unadjusted',targetDate:job.targetDate,hypothesisHash:job.hypothesisHash,calendarHash:job.calendarHash,rawHash:h.rawHash,observationHash:o.observationHash,revision:o.revision,observedAt,retrievedAt,bar:{date:b.date,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,knownAt}}};
}
function validateProof(proof,job,now){
 if(!proof)return false;const result=captureProof({status:'captured',history:{provider:proof.provider,source:proof.source,priceBasis:proof.priceBasis,retrievedAt:proof.retrievedAt,rawHash:proof.rawHash},stock:{symbol:proof.symbol,source:proof.source,provider:proof.provider,priceBasis:proof.priceBasis,observedAt:proof.observedAt,bars:[proof.bar]},observation:{revision:proof.revision,observationHash:proof.observationHash}},job,now);
 return !!result.proof&&encode(result.proof)===encode(proof);
}
function recordFile(file,max){
 const st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile()||(st.mode&0o777)!==0o600||st.size>max)throw Error('invalid record');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));try{const size=fs.fstatSync(fd).size;if(size>max)throw Error('oversize');return {value:JSON.parse(fs.readFileSync(fd,'utf8')),bytes:size};}finally{fs.closeSync(fd);}
}
function entries(dir,max){
 const names=[],state={names,temporaryBytes:0};if(!fs.existsSync(dir))return state;
 const all=fs.readdirSync(dir);if(all.length>MAX_JOBS*4)throw Error('too many entries');
 for(const name of all){const st=fs.lstatSync(path.join(dir,name));if(st.isSymbolicLink()||!st.isFile())throw Error('invalid entry');if(/^\d{6}\.json\.[a-f0-9]{16}\.tmp$/.test(name)){if((st.mode&0o777)!==0o600||st.size>max)throw Error('invalid temporary');state.temporaryBytes+=st.size;continue;}if(!/^\d{6}\.json$/.test(name))throw Error('invalid entry');names.push(name);}names.sort();return state;
}
function readState(root){
 const base=privateDir(root),intents=privateDir(path.join(base,'intents')),attemptRoot=privateDir(path.join(base,'attempts'));
 if(fs.existsSync(base)&&fs.readdirSync(base).some(n=>!['intents','attempts'].includes(n)))throw Error('invalid root entry');
 const listing=entries(intents,MAX_FILE);if(listing.names.length>MAX_JOBS)throw Error('capacity');const jobs=[],ids=new Set();let bytes=listing.temporaryBytes,previous=null;
 for(const [i,name]of listing.names.entries()){
  if(name!==String(i+1).padStart(6,'0')+'.json')throw Error('missing intent');const loaded=recordFile(path.join(intents,name),MAX_FILE),event=loaded.value,{recordHash,...payload}=event;bytes+=loaded.bytes;
  const {protocol,...parameters}=event.job||{};
  if(event.schemaVersion!==1||event.queueRevision!==i+1||event.previousHash!==(previous?.recordHash||null)||hash(payload)!==recordHash||protocol!==PROTOCOL||encode(cleanJob(parameters))!==encode(event.job)||hash(identity(event.job))!==event.id||ids.has(event.id)||!instant(event.enqueuedAt)||event.job.createdAt>event.enqueuedAt||Object.keys(flags).some(k=>event[k]!==flags[k]))throw Error('invalid intent');
  ids.add(event.id);const dir=privateDir(path.join(attemptRoot,event.id)),attemptListing=entries(dir,MAX_ATTEMPT);bytes+=attemptListing.temporaryBytes;if(attemptListing.names.length>5)throw Error('attempt capacity');const attempts=[];let prior=null;
  for(const [j,n]of attemptListing.names.entries()){
   if(n!==String(j+1).padStart(6,'0')+'.json')throw Error('missing attempt');const loaded=recordFile(path.join(dir,n),MAX_ATTEMPT),a=loaded.value,{resultHash,...body}=a;bytes+=loaded.bytes;
   if(hash(body)!==resultHash||a.schemaVersion!==1||a.id!==event.id||a.attempt!==j+1||a.previousHash!==(prior?.resultHash||null)||!instant(a.startedAt)||!instant(a.completedAt)||a.completedAt<a.startedAt||a.startedAt<Math.max(event.job.dueAt,event.enqueuedAt,prior?.nextAttemptAt||0)||prior&&prior.status!=='pending'||Object.keys(flags).some(k=>a[k]!==flags[k]))throw Error('invalid attempt');
   if(a.status==='completed'){if(a.nextAttemptAt!==null||a.reason!==undefined||!validateProof(a.proof,event.job,a.completedAt))throw Error('invalid proof');}
   else if(a.status!==(j===4?'unknown':'pending')||a.proof!==undefined||!['SOURCE_UNAVAILABLE','TARGET_MISSING','PROVIDER_MISMATCH','INVALID_TARGET_EVIDENCE','CAPTURE_ERROR'].includes(a.reason)||a.nextAttemptAt!==(j===4?null:a.completedAt+delay(j+1)))throw Error('invalid retry');
   attempts.push(a);prior=a;
  }
  jobs.push({event,attempts});previous=event;
 }
 if(fs.existsSync(attemptRoot))for(const name of fs.readdirSync(attemptRoot)){if(!hex.test(name)||!ids.has(name))throw Error('orphan attempt');privateDir(path.join(attemptRoot,name));}
 if(bytes>MAX_BYTES)throw Error('byte capacity');return {base,intents,attemptRoot,jobs,bytes};
}
function publish(dir,name,record,max){
 const serialized=encode(record);if(Buffer.byteLength(serialized)>max)throw Error('record size');const file=path.join(dir,name),temp=file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';let fd;
 try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,serialized);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.linkSync(temp,file);}catch(e){if(e.code==='EEXIST')return false;throw e;}finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
 const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}return true;
}
function view({event,attempts}){const last=attempts.at(-1),status=last?.status||'pending';return {id:event.id,...event.job,enqueuedAt:event.enqueuedAt,status,attempts:attempts.length,nextAttemptAt:status==='pending'?(last?.nextAttemptAt||Math.max(event.job.dueAt,event.enqueuedAt)):null,...(last?{completedAt:last.completedAt,...(last.reason?{reason:last.reason}:{}),...(last.proof?{proof:last.proof}:{})}:{}),...flags};}
function scheduleStockResearchFollowup(root,input){
 try{
  const job=cleanJob(input),enqueuedAt=Date.now();if(job.createdAt>enqueuedAt)throw Error('future hypothesis');const id=hash(identity(job)),blocked=reason=>({scheduled:false,queued:false,id,reused:false,blocked:true,reason,...flags});
  const base=privateDir(root,true);privateDir(path.join(base,'intents'),true);privateDir(path.join(base,'attempts'),true);
  for(let retry=0;retry<5;retry++){
   const state=readState(root),same=state.jobs.find(j=>j.event.id===id);if(same){if(same.event.job.createdAt!==job.createdAt)throw Error('hypothesis timestamp conflict');return {scheduled:true,queued:true,id,reused:true,blocked:false,...flags};}
   if(state.jobs.length>=MAX_JOBS)return blocked('FOLLOWUP_CAPACITY');const payload={schemaVersion:1,...flags,id,queueRevision:state.jobs.length+1,previousHash:state.jobs.at(-1)?.event.recordHash||null,enqueuedAt,job},event={...payload,recordHash:hash(payload)},size=Buffer.byteLength(encode(event));
   if(size>MAX_FILE||state.bytes+size>MAX_BYTES)return blocked('FOLLOWUP_BYTES_CAPACITY');if(publish(state.intents,String(payload.queueRevision).padStart(6,'0')+'.json',event,MAX_FILE))return {scheduled:true,queued:true,id,reused:false,blocked:false,...flags};
  }return blocked('FOLLOWUP_PUBLICATION_CONFLICT');
 }catch{throw Error('研究复访参数、私有存储或完整性校验失败');}
}
function readStockResearchFollowups(root,{now=Date.now()}={}){
 try{const state=readState(root),time=clock(now),rows=state.jobs.map(view),pending=rows.filter(r=>r.status==='pending'),completed=rows.filter(r=>r.status==='completed'),unknown=rows.filter(r=>r.status==='unknown');return {pending,completed,unknown,lastSuccess:completed.sort((a,b)=>a.completedAt-b.completedAt).at(-1)||null,lastFailure:rows.filter(r=>r.reason).sort((a,b)=>a.completedAt-b.completedAt).at(-1)||null,counts:{total:rows.length,pending:pending.length,completed:completed.length,unknown:unknown.length,due:pending.filter(r=>r.nextAttemptAt<=time).length,attempts:rows.reduce((n,r)=>n+r.attempts,0)},bytes:state.bytes,...flags};}catch{throw Error('研究复访私有存储或完整性校验失败');}
}
async function processStockResearchFollowups(root,{capture,now=Date.now,maxJobs=1}={}){
 let key;try{key=privateDir(root);if(typeof capture!=='function'||!Number.isSafeInteger(maxJobs)||maxJobs<1||maxJobs>20)throw Error('invalid processor');clock(now);}catch{throw Error('研究复访处理参数或私有存储无效');}
 if(active.has(key))return {processed:0,results:[],running:true,...flags};active.add(key);
 try{const due=readState(root).jobs.map(view).filter(r=>r.status==='pending'&&r.nextAttemptAt<=clock(now)).sort((a,b)=>a.nextAttemptAt-b.nextAttemptAt||a.id.localeCompare(b.id)).slice(0,maxJobs),results=[];
  for(const candidate of due){const state=readState(root),entry=state.jobs.find(j=>j.event.id===candidate.id),current=view(entry),startedAt=clock(now);if(current.status!=='pending'||current.nextAttemptAt>startedAt)continue;let outcome;try{outcome=captureProof(await capture({id:entry.event.id,...entry.event.job,...flags}),entry.event.job,clock(now));}catch{outcome={reason:'CAPTURE_ERROR'};}
   const completedAt=clock(now);if(completedAt<startedAt)throw Error('clock moved backwards');const attempt=entry.attempts.length+1,status=outcome.proof?'completed':attempt===5?'unknown':'pending',payload={schemaVersion:1,...flags,id:entry.event.id,attempt,previousHash:entry.attempts.at(-1)?.resultHash||null,startedAt,completedAt,status,nextAttemptAt:status==='pending'?completedAt+delay(attempt):null,...outcome};
   const dir=privateDir(path.join(state.attemptRoot,entry.event.id),true),published=publish(dir,String(attempt).padStart(6,'0')+'.json',{...payload,resultHash:hash(payload)},MAX_ATTEMPT);results.push({...view(readState(root).jobs.find(j=>j.event.id===entry.event.id)),published,reused:!published});
  }return {processed:results.length,results,running:false,...flags};
 }catch{throw Error('研究复访处理或完整性校验失败');}finally{active.delete(key);}
}
module.exports={scheduleStockResearchFollowup,processStockResearchFollowups,readStockResearchFollowups};
