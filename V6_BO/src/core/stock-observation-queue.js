'use strict';
// Durable research intake. Cross-process capture is at-least-once, never delivery proof.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const MAX_INTENTS=1000,MAX_INTENT_BYTES=8192,MAX_ATTEMPT_BYTES=2048,MAX_TOTAL_BYTES=16*1024*1024;
const flags={researchOnly:true,verifiedLive:false,canTrade:false,canNotify:false,triggerStatus:'unverified',exactlyOnce:false};
const active=new Set(),hex=/^[a-f0-9]{64}$/;
const validTime=n=>Number.isSafeInteger(n)&&n>0;
function canonical(x,depth=0){
 if(depth>12)throw Error('invalid JSON');
 if(x===null||typeof x==='string'||typeof x==='boolean'||typeof x==='number'&&Number.isFinite(x))return x;
 if(Array.isArray(x))return x.map(v=>canonical(v,depth+1));
 if(x&&typeof x==='object'&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)){
  const out={};for(const k of Object.keys(x).sort()){if(['__proto__','constructor','prototype'].includes(k))throw Error('invalid key');if(x[k]!==undefined)out[k]=canonical(x[k],depth+1);}return out;
 }
 throw Error('invalid JSON');
}
const encode=x=>JSON.stringify(canonical(x));
const hash=x=>crypto.createHash('sha256').update(encode(x)).digest('hex');
const clock=value=>{const n=typeof value==='function'?value():value;if(!validTime(n))throw Error('invalid clock');return n;};
function privateDir(input,create=false){
 if(typeof input!=='string'||!path.isAbsolute(input)||input.includes('\0'))throw Error('invalid private root');
 const full=path.resolve(input);if(full===path.parse(full).root||full.split(path.sep).some(p=>p.toLowerCase()==='public'))throw Error('invalid private root');
 let cursor=path.parse(full).root;
 for(const part of full.slice(cursor.length).split(path.sep).filter(Boolean)){
  cursor=path.join(cursor,part);try{const st=fs.lstatSync(cursor);if(st.isSymbolicLink()||!st.isDirectory())throw Error('invalid directory');}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 if(create)fs.mkdirSync(full,{recursive:true,mode:0o700});
 if(fs.existsSync(full)&&(fs.statSync(full).mode&0o777)!==0o700)throw Error('invalid permissions');
 return full;
}
function readFile(file,max){
 const st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile()||(st.mode&0o777)!==0o600||st.size>max)throw Error('invalid file');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{const current=fs.fstatSync(fd);if(!current.isFile()||current.size>max)throw Error('invalid file');return {record:JSON.parse(fs.readFileSync(fd,'utf8')),bytes:current.size};}finally{fs.closeSync(fd);}
}
function names(dir){
 const out=[];out.temporaryBytes=0;if(!fs.existsSync(dir))return out;
 const entries=fs.readdirSync(dir);if(entries.length>MAX_INTENTS*4)throw Error('too many temporary entries');
 for(const name of entries){
  const file=path.join(dir,name),temporary=/^\d{6}\.json\.[a-f0-9]{16}\.tmp$/.test(name);let st;
  // Publishers unlink their stage after atomic linking. Only that exact name
  // may disappear between enumeration and stat; committed/unknown names fail.
  try{st=fs.lstatSync(file);}catch(e){if(temporary&&e.code==='ENOENT')continue;throw e;}
  if(st.isSymbolicLink()||!st.isFile())throw Error('invalid queue entry');
  if(temporary){if((st.mode&0o777)!==0o600||st.size>MAX_INTENT_BYTES)throw Error('invalid temporary file');out.temporaryBytes+=st.size;continue;}
  if(!/^\d{6}\.json$/.test(name))throw Error('invalid queue name');out.push(name);
 }
 return out.sort();
}
function cleanIntent(input){
 if(!input||!/^\d{6}$/.test(input.symbol||'')||!validTime(input.decisionAt)||input.trigger!=='push-attempt')throw Error('invalid intent');
 const refs=input.signalRefs===undefined?[]:input.signalRefs;if(!Array.isArray(refs)||refs.length>100)throw Error('invalid refs');
 const signalRefs=refs.map(ref=>{
  if(!ref||typeof ref!=='object'||Array.isArray(ref)||Object.keys(ref).some(k=>!['code','type','ts','id'].includes(k))||!/^\d{6}$/.test(ref.code||'')||typeof ref.type!=='string'||!ref.type.trim()||ref.type.length>80||ref.ts!==undefined&&(!validTime(ref.ts)||ref.ts>input.decisionAt)||ref.id!==undefined&&(typeof ref.id!=='string'||!ref.id||ref.id.length>160))throw Error('invalid ref');
  return canonical(ref);
 }).sort((a,b)=>encode(a).localeCompare(encode(b)));
 const out={symbol:input.symbol,decisionAt:input.decisionAt,trigger:'push-attempt',signalRefs:[...new Map(signalRefs.map(r=>[encode(r),r])).values()]};
 if(input.messageHash!==undefined){if(!hex.test(input.messageHash))throw Error('invalid message hash');out.messageHash=input.messageHash;}
 if(input.quote!==undefined){
  const quote=input.quote;if(!quote||typeof quote!=='object'||Array.isArray(quote)||Object.keys(quote).some(k=>!['source','quoteSource','quoteAt','receivedAt','sourceTimestamp','firstObservedAt','retrievedAt','price','quoteFreshness','quoteStatus'].includes(k)))throw Error('invalid quote');
  for(const [k,v]of Object.entries(quote)){
   if(v===null||v===undefined)continue;
   if(k==='price'){if(typeof v!=='number'||!Number.isFinite(v)||v<=0)throw Error('invalid quote price');}
   else if(['source','quoteSource','quoteFreshness','quoteStatus'].includes(k)){if(typeof v!=='string'||v.length>100)throw Error('invalid quote source');}
   else if(!validTime(v)&&!(typeof v==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v))&&Date.parse(v)>0))throw Error('invalid quote timestamp');
  }
  out.quote=canonical(quote);
 }
 return out;
}
function safeSuccess(result,asOf){
 if(result?.status!=='captured')return null;
 const o=result.observation,h=result.history;
 if(!Number.isSafeInteger(o?.revision)||o.revision<1||o.revision>500||!hex.test(o.observationHash||'')||!hex.test(h?.rawHash||'')||typeof h.provider!=='string'||!h.provider.trim()||h.provider.length>160)return null;
 const history={rawHash:h.rawHash,provider:h.provider};
 if(h.observedAt!==undefined){if(!validTime(h.observedAt)||asOf!==undefined&&h.observedAt>asOf)return null;history.observedAt=h.observedAt;}
 return {status:'captured',observation:{revision:o.revision,observationHash:o.observationHash},history};
}
function readState(root,appendRefreshes=3){
 const base=privateDir(root),intentDir=privateDir(path.join(base,'intents')),attemptRoot=privateDir(path.join(base,'attempts'));
 if(fs.existsSync(base)&&fs.readdirSync(base).some(n=>!['intents','attempts'].includes(n)))throw Error('invalid root entry');
 const intentNames=names(intentDir);if(intentNames.length>MAX_INTENTS)throw Error('too many intents');
 let bytes=intentNames.temporaryBytes,previous=null;const entries=[],ids=new Set();
 for(const [i,name]of intentNames.entries()){
  if(name!==String(i+1).padStart(6,'0')+'.json')throw Error('missing intent');
  const loaded=readFile(path.join(intentDir,name),MAX_INTENT_BYTES),event=loaded.record,{recordHash,...payload}=event;bytes+=loaded.bytes;
  if(event.schemaVersion!==1||event.queueRevision!==i+1||event.previousHash!==(previous?.recordHash||null)||hash(payload)!==recordHash||!hex.test(event.id||'')||!validTime(event.queuedAt)||event.intent?.decisionAt>event.queuedAt||encode(cleanIntent(event.intent))!==encode(event.intent)||hash(event.intent)!==event.id||ids.has(event.id)||Object.keys(flags).some(k=>event[k]!==flags[k]))throw Error('invalid intent chain');
  ids.add(event.id);const dir=privateDir(path.join(attemptRoot,event.id)),attemptNames=names(dir);bytes+=attemptNames.temporaryBytes;if(attemptNames.length>3)throw Error('too many attempts');let prior=null;const attempts=[];
  for(const [j,attemptName]of attemptNames.entries()){
   if(attemptName!==String(j+1).padStart(6,'0')+'.json')throw Error('missing attempt');
   const loadedAttempt=readFile(path.join(dir,attemptName),MAX_ATTEMPT_BYTES),attempt=loadedAttempt.record,{resultHash,...attemptPayload}=attempt;bytes+=loadedAttempt.bytes;
   if(attempt.schemaVersion!==1||attempt.id!==event.id||attempt.attempt!==j+1||attempt.previousHash!==(prior?.resultHash||null)||hash(attemptPayload)!==resultHash||!validTime(attempt.startedAt)||attempt.startedAt<event.queuedAt||!validTime(attempt.completedAt)||attempt.completedAt<attempt.startedAt||prior&&(prior.status==='captured'||attempt.startedAt<prior.nextAttemptAt)||Object.keys(flags).some(k=>attempt[k]!==flags[k]))throw Error('invalid attempt chain');
   if(attempt.status==='captured'){if(encode(safeSuccess(attempt.result,attempt.completedAt))!==encode(attempt.result)||attempt.nextAttemptAt!==null||attempt.error!==undefined)throw Error('invalid success');}
   else if(attempt.status!=='unavailable'||!['CAPTURE_UNAVAILABLE','CAPTURE_ERROR','CAPTURE_RESULT_INVALID'].includes(attempt.error)||attempt.result!==undefined||attempt.nextAttemptAt!==(j<2?attempt.completedAt+60000*2**j:null))throw Error('invalid failure');
   attempts.push(attempt);prior=attempt;
  }
  entries.push({event,attempts});previous=event;
 }
 if(fs.existsSync(attemptRoot))for(const name of fs.readdirSync(attemptRoot)){
  if(!hex.test(name))throw Error('orphan attempt');
  if(!ids.has(name)){
   // A writer publishes its intent before creating the attempt directory. A
   // newly visible child can therefore follow our earlier parent snapshot.
   // Retry only after observing an appended parent prefix, then revalidate the
   // entire chain. Unexplained orphans and continuously moving queues fail.
   const latest=names(intentDir);
   if(appendRefreshes>0&&latest.length>intentNames.length&&intentNames.every((n,i)=>latest[i]===n))return readState(root,appendRefreshes-1);
   throw Error('orphan attempt');
  }
  privateDir(path.join(attemptRoot,name));
 }
 if(bytes>MAX_TOTAL_BYTES)throw Error('queue size exceeded');return {base,intentDir,attemptRoot,entries,bytes};
}
function atomicPublish(dir,name,record,max){
 const serialized=encode(record);if(Buffer.byteLength(serialized)>max)throw Error('record size exceeded');
 const file=path.join(dir,name),temp=file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';let fd;
 try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,serialized);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.linkSync(temp,file);}
 catch(e){if(e.code==='EEXIST')return false;throw e;}
 finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
 const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}return true;
}
function summaryEntry({event,attempts}){
 const last=attempts.at(-1),status=last?.status==='captured'?'completed':attempts.length===3?'failed':'pending';
 return {id:event.id,symbol:event.intent.symbol,decisionAt:event.intent.decisionAt,queuedAt:event.queuedAt,trigger:'push-attempt',triggerStatus:'unverified',status,attempts:attempts.length,nextAttemptAt:status==='pending'?(last?.nextAttemptAt||event.queuedAt):null,...(last?{completedAt:last.completedAt,...(last.error?{error:last.error}:{}),...(last.result?{result:last.result}:{})}:{})};
}
function summarize(state,now){
 const rows=state.entries.map(summaryEntry),pending=rows.filter(r=>r.status==='pending'),completed=rows.filter(r=>r.status==='completed'),failed=rows.filter(r=>r.status==='failed');
 const all=state.entries.flatMap(({event,attempts})=>attempts.map(a=>({id:event.id,symbol:event.intent.symbol,attempt:a.attempt,completedAt:a.completedAt,status:a.status,...(a.error?{error:a.error}:{}),...(a.result?{result:a.result}:{})}))).sort((a,b)=>a.completedAt-b.completedAt||a.id.localeCompare(b.id)||a.attempt-b.attempt);
 return {pending,completed,failed,lastSuccess:all.filter(a=>a.status==='captured').at(-1)||null,lastFailure:all.filter(a=>a.status==='unavailable').at(-1)||null,counts:{total:rows.length,pending:pending.length,completed:completed.length,failed:failed.length,due:pending.filter(r=>r.nextAttemptAt<=now).length,attempts:all.length},bytes:state.bytes,...flags};
}
function enqueueStockObservation(root,input){
 try{
  const intent=cleanIntent(input),queuedAt=Date.now();if(intent.decisionAt>queuedAt)throw Error('future decision');const id=hash(intent),blocked=reason=>({queued:false,reused:false,blocked:true,reason,id,...flags});
  const base=privateDir(root,true);privateDir(path.join(base,'intents'),true);privateDir(path.join(base,'attempts'),true);
  for(let retry=0;retry<5;retry++){
   const state=readState(root),same=state.entries.find(e=>e.event.id===id);if(same)return {queued:true,id,reused:true,blocked:false,...flags};
   if(state.entries.length>=MAX_INTENTS)return blocked('QUEUE_CAPACITY');
   const payload={schemaVersion:1,...flags,id,queueRevision:state.entries.length+1,previousHash:state.entries.at(-1)?.event.recordHash||null,queuedAt,intent},event={...payload,recordHash:hash(payload)},size=Buffer.byteLength(encode(event));
   if(size>MAX_INTENT_BYTES)return blocked('INTENT_TOO_LARGE');if(state.bytes+size>MAX_TOTAL_BYTES)return blocked('QUEUE_BYTES_CAPACITY');
   if(atomicPublish(state.intentDir,String(payload.queueRevision).padStart(6,'0')+'.json',event,MAX_INTENT_BYTES))return {queued:true,id,reused:false,blocked:false,...flags};
  }
  return blocked('QUEUE_PUBLICATION_CONFLICT');
 }catch{throw Error('采集队列参数、私有存储或完整性校验失败');}
}
function readStockObservationQueue(root,{now=Date.now()}={}){
 try{return summarize(readState(root),clock(now));}catch{throw Error('采集队列私有存储或完整性校验失败');}
}
async function processStockObservationQueue(root,{capture,now=Date.now,maxJobs=1}={}){
 let key;try{key=privateDir(root);if(typeof capture!=='function'||!Number.isSafeInteger(maxJobs)||maxJobs<1||maxJobs>20)throw Error('invalid processor');clock(now);}catch{throw Error('采集队列处理参数或私有存储无效');}
 if(active.has(key))return {processed:0,results:[],running:true,...flags};active.add(key);
 try{
  const state=readState(root),due=state.entries.map(summaryEntry).filter(r=>r.status==='pending'&&r.nextAttemptAt<=clock(now)).sort((a,b)=>a.nextAttemptAt-b.nextAttemptAt||a.id.localeCompare(b.id)).slice(0,maxJobs),results=[];
  for(const job of due){
   const current=readState(root),entry=current.entries.find(e=>e.event.id===job.id),view=summaryEntry(entry),startedAt=clock(now);if(view.status!=='pending'||view.nextAttemptAt>startedAt)continue;
   let result,error;try{const returned=await capture({...entry.event.intent,id:job.id,...flags});result=safeSuccess(returned,clock(now));if(!result)error=returned?.status==='unavailable'?'CAPTURE_UNAVAILABLE':'CAPTURE_RESULT_INVALID';}catch{error='CAPTURE_ERROR';}
   const completedAt=Math.max(startedAt,clock(now)),attempt=entry.attempts.length+1,payload={schemaVersion:1,...flags,id:job.id,attempt,previousHash:entry.attempts.at(-1)?.resultHash||null,startedAt,completedAt,status:result?'captured':'unavailable',nextAttemptAt:result||attempt===3?null:completedAt+60000*2**(attempt-1),...(result?{result}:{error})};
   const dir=privateDir(path.join(current.attemptRoot,job.id),true),published=atomicPublish(dir,String(attempt).padStart(6,'0')+'.json',{...payload,resultHash:hash(payload)},MAX_ATTEMPT_BYTES);
   const latest=readState(root).entries.find(e=>e.event.id===job.id);results.push({...summaryEntry(latest),published,reused:!published});
  }
  return {processed:results.length,results,running:false,...flags};
 }catch{throw Error('采集队列处理或完整性校验失败');}finally{active.delete(key);}
}
module.exports={enqueueStockObservation,readStockObservationQueue,processStockObservationQueue};
