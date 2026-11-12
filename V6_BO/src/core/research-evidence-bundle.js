'use strict';
// Freeze parsed evidence and archive references; no source fetching or raw-byte ingestion.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const MAX_EVENTS=500,MAX_OBJECT=1024*1024,MAX_TOTAL=128*1024*1024,MAX_RECEIPT=2048;
const flags={researchOnly:true,verifiedLive:false,canTrade:false,canNotify:false,weightsChanged:false};
const hex=/^[a-f0-9]{64}$/,instant=x=>Number.isSafeInteger(x)&&x>0;
const plannedTimes=new Set(['dueAt','targetAt','plannedAt','scheduledAt','nextAttemptAt','expiresAt']);
const timestampKey=key=>!plannedTimes.has(key)&&(/(?:At|Timestamp)$/.test(key)||['timestamp','asOf'].includes(key));
function canonical(x,depth=0){
 if(depth>24)throw Error('evidence nesting limit');
 if(x===null||typeof x==='string'||typeof x==='boolean'||typeof x==='number'&&Number.isFinite(x))return x;
 if(Array.isArray(x)){if(x.length>10000)throw Error('evidence array limit');return x.map(v=>canonical(v,depth+1));}
 if(x&&typeof x==='object'&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)){
  const keys=Object.keys(x);if(keys.length>1000)throw Error('evidence object limit');const out={};for(const key of keys.sort()){if(['__proto__','constructor','prototype'].includes(key))throw Error('invalid key');if(x[key]!==undefined)out[key]=canonical(x[key],depth+1);}return out;
 }
 throw Error('evidence must be bounded JSON');
}
const encode=x=>JSON.stringify(canonical(x)),sha=x=>crypto.createHash('sha256').update(encode(x)).digest('hex');
function identity(symbol,provider){if(!/^\d{6}$/.test(symbol||'')||typeof provider!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(provider))throw Error('invalid identity');return {symbol,provider};}
function validateTimes(value,decisionAt){
 if(!value||typeof value!=='object')return;
 for(const [key,item]of Object.entries(value)){
  if(timestampKey(key)&&item!==null&&item!==undefined){
   const time=typeof item==='number'?item:typeof item==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(item)?Date.parse(item):NaN;
   // A date-only asOf labels a dataset/calendar date, not its availability.
   if(key==='asOf'&&typeof item==='string'&&/^\d{4}-\d\d-\d\d$/.test(item))continue;
   if(!instant(time)||time>decisionAt)throw Error('future or invalid evidence timestamp');
  }
  validateTimes(item,decisionAt);
 }
}
function cleanTrigger(value,decisionAt){
 const kind=v=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=160&&/^[\p{L}\p{N}_.: -]+$/u.test(v);
 if(typeof value==='string'){if(!kind(value))throw Error('invalid trigger');return value;}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['kind','intentId','pushDecisionAt','signalRefs','messageHash'].includes(k))||!kind(value.kind))throw Error('invalid trigger metadata');
 const out=canonical(value);for(const key of ['intentId','messageHash'])if(out[key]!==undefined&&out[key]!==null&&!hex.test(out[key]))throw Error('invalid trigger hash');
 if(out.pushDecisionAt!==undefined&&out.pushDecisionAt!==null&&(!instant(out.pushDecisionAt)||out.pushDecisionAt>decisionAt))throw Error('future push decision');
 if(out.signalRefs!==undefined){if(!Array.isArray(out.signalRefs)||out.signalRefs.length>100)throw Error('trigger reference limit');for(const ref of out.signalRefs)if(!ref||Object.keys(ref).some(k=>!['code','type','ts'].includes(k))||!/^\d{6}$/.test(ref.code||'')||!kind(ref.type)||ref.ts!==undefined&&(!instant(ref.ts)||ref.ts>decisionAt))throw Error('invalid trigger reference');}
 if(Buffer.byteLength(encode(out))>8192)throw Error('trigger size limit');return out;
}
function cleanInput(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['symbol','provider','priceBasis','decisionAt','observationHash','history','marketContext','stockStatus','sectorContext','sourceRefs','trigger'].includes(k)))throw Error('invalid evidence input');
 const id=identity(input.symbol,input.provider);if(input.priceBasis!=='unadjusted'||!instant(input.decisionAt)||!hex.test(input.observationHash||''))throw Error('invalid evidence identity/time');
 const trigger=cleanTrigger(input.trigger,input.decisionAt);
 const contexts={};for(const key of ['history','marketContext','stockStatus','sectorContext']){
  const value=input[key]===undefined?null:canonical(input[key]);if(value!==null&&(typeof value!=='object'||Array.isArray(value)))throw Error('evidence contexts must be objects');
  if(Buffer.byteLength(encode(value))>(key==='history'?32768:512*1024))throw Error('evidence context size limit');validateTimes(value,input.decisionAt);contexts[key]=value;
 }
 function noRawHistory(value){if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){if(['bars','raw','rawbytes','rawevidence','base64'].includes(key.toLowerCase()))throw Error('history must be a summary');noRawHistory(item);}}
 noRawHistory(contexts.history);
 if(!Array.isArray(input.sourceRefs)||input.sourceRefs.length>200)throw Error('source reference limit');
 const refs=input.sourceRefs.map(ref=>{
  if(!ref||Object.keys(ref).some(k=>!['byteLength','receivedAt','sha256','source','url','reused'].includes(k))||!hex.test(ref.sha256||'')||!Number.isSafeInteger(ref.byteLength)||ref.byteLength<0||ref.byteLength>32*1024*1024||typeof ref.source!=='string'||!ref.source.trim()||ref.source.length>160||ref.url!==null&&(typeof ref.url!=='string'||ref.url.length>2048)||ref.reused!==undefined&&typeof ref.reused!=='boolean'||!instant(ref.receivedAt)||ref.receivedAt>input.decisionAt)throw Error('invalid source reference');
  if(ref.url!==null){const u=new URL(ref.url);if(!['http:','https:'].includes(u.protocol)||!u.hostname||u.username||u.password||u.hash)throw Error('invalid source URL reference');}
  return canonical({sha256:ref.sha256,byteLength:ref.byteLength,source:ref.source,url:ref.url,receivedAt:ref.receivedAt});
 }).sort((a,b)=>encode(a).localeCompare(encode(b)));
 return {...id,priceBasis:'unadjusted',decisionAt:input.decisionAt,observationHash:input.observationHash,...contexts,sourceRefs:[...new Map(refs.map(r=>[encode(r),r])).values()],trigger};
}
function privateDir(value,create=false){
 if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0'))throw Error('invalid private root');const full=path.resolve(value);
 if(full===path.parse(full).root||full.split(path.sep).some(p=>p.toLowerCase()==='public'))throw Error('invalid private root');
 let current=path.parse(full).root;for(const part of full.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);try{const st=fs.lstatSync(current);if(st.isSymbolicLink()||!st.isDirectory())throw Error('invalid directory');}catch(e){if(e.code!=='ENOENT')throw e;}}
 if(create)fs.mkdirSync(full,{recursive:true,mode:0o700});if(fs.existsSync(full)&&(fs.statSync(full).mode&0o777)!==0o700)throw Error('invalid directory permissions');return full;
}
function directories(root,id,create=false){const base=privateDir(root,create),symbol=privateDir(path.join(base,id.symbol),create),dir=privateDir(path.join(symbol,sha(id.provider)),create);return {dir,receipts:privateDir(path.join(dir,'receipts'),create),objects:privateDir(path.join(dir,'objects'),create)};}
function readJson(file,max){const st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile()||(st.mode&0o777)!==0o600||st.size>max)throw Error('invalid evidence file');const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));try{const current=fs.fstatSync(fd);if(current.size>max)throw Error('evidence file too large');return {value:JSON.parse(fs.readFileSync(fd,'utf8')),bytes:current.size};}finally{fs.closeSync(fd);}}
function listing(dir,type,max){const committed=[],temporary=[];if(!fs.existsSync(dir))return {committed,temporary,bytes:0};const names=fs.readdirSync(dir);if(names.length>2000)throw Error('evidence entry limit');let bytes=0;
 const staging=type==='receipts'?/^\d{6}\.json\.[a-f0-9]{16}\.tmp$/:/^[a-f0-9]{64}\.json\.[a-f0-9]{16}\.tmp$/;
 for(const name of names){let st;try{st=fs.lstatSync(path.join(dir,name));}catch(error){
   // Another publisher can unlink its own staging file after our readdir.
   // A missing committed record (or any other error) remains corruption.
   if(error.code==='ENOENT'&&staging.test(name))continue;throw error;
  }if(st.isSymbolicLink()||!st.isFile()||(st.mode&0o777)!==0o600||st.size>max)throw Error('invalid evidence entry');bytes+=st.size;
  if(staging.test(name)){temporary.push(name);continue;}
  if(!(type==='receipts'?/^\d{6}\.json$/:/^[a-f0-9]{64}\.json$/).test(name))throw Error('invalid evidence filename');committed.push(name);
 }return {committed:committed.sort(),temporary,bytes};
}
function loadObject(dir,name,id){const loaded=readJson(path.join(dir,name+'.json'),MAX_OBJECT),object=loaded.value,{hash,...body}=object;
 if(hash!==name||sha(body)!==hash||body.schemaVersion!==1||body.mode!=='research-evidence-bundle'||Object.keys(flags).some(k=>body[k]!==flags[k])||!instant(body.recordedAt)||body.recordedAt<body.decisionAt||body.recordedAt>body.decisionAt+60000)throw Error('invalid evidence object');
 const {schemaVersion,mode,recordedAt,...rest}=body;for(const key of Object.keys(flags))delete rest[key];const clean=cleanInput(rest);
 if(clean.symbol!==id.symbol||clean.provider!==id.provider||encode(clean)!==encode(rest))throw Error('invalid evidence projection');return object;
}
function readState(root,id,{asOf,hash:wantedHash}={}){
 const dirs=directories(root,id),receipts=listing(dirs.receipts,'receipts',MAX_RECEIPT),objects=listing(dirs.objects,'objects',MAX_OBJECT),totalBytes=receipts.bytes+objects.bytes;
 if(fs.existsSync(dirs.dir)&&fs.readdirSync(dirs.dir).some(n=>!['objects','receipts'].includes(n)))throw Error('invalid evidence identity directory');
 if(receipts.committed.length>MAX_EVENTS||objects.committed.length>1000||totalBytes>MAX_TOTAL)throw Error('evidence archive capacity');
 const objectNames=new Set(objects.committed.map(n=>n.slice(0,-5))),referenced=new Set(),metadata=[];let previous=null,latest=null;
 for(const [i,name]of receipts.committed.entries()){
  if(name!==String(i+1).padStart(6,'0')+'.json')throw Error('missing evidence receipt');const {value:r}=readJson(path.join(dirs.receipts,name),MAX_RECEIPT),{receiptHash,...payload}=r;
  if(r.schemaVersion!==1||r.revision!==i+1||sha(payload)!==receiptHash||r.previousHash!==(previous?.receiptHash||null)||!hex.test(r.hash||'')||!hex.test(r.intakeHash||'')||!objectNames.has(r.hash))throw Error('invalid evidence receipt');
  const object=loadObject(dirs.objects,r.hash,id),{hash,schemaVersion,mode,recordedAt,...input}=object;for(const key of Object.keys(flags))delete input[key];
  if(sha(input)!==r.intakeHash||r.decisionAt!==object.decisionAt||r.recordedAt!==object.recordedAt||previous&&r.recordedAt<previous.recordedAt)throw Error('invalid evidence receipt linkage');
  referenced.add(r.hash);metadata.push(r);previous=r;
  if(asOf!==undefined&&r.decisionAt<=asOf&&r.recordedAt<=asOf&&(!wantedHash||r.hash===wantedHash)&&(!latest||r.decisionAt>latest.decisionAt||r.decisionAt===latest.decisionAt&&r.recordedAt>=latest.recordedAt))latest={...object,revision:r.revision};
 }
 // Crash/concurrency can leave a valid unreferenced object. It is not published
 // evidence, but still consumes quota and must not conceal corrupt/symlink data.
 for(const name of objectNames)if(!referenced.has(name))loadObject(dirs.objects,name,id);
 return {...dirs,count:metadata.length,objectCount:objects.committed.length,totalBytes,lastReceipt:previous,metadata,latest};
}
function publish(dir,name,object,max){const serialized=encode(object);if(Buffer.byteLength(serialized)>max)throw Error('evidence object size limit');const file=path.join(dir,name),temp=file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';let fd;
 try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,serialized);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.linkSync(temp,file);}catch(e){if(e.code==='EEXIST')return false;throw e;}finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
 const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}return true;
}
function freezeResearchEvidenceBundle(root,input){
 try{const clean=cleanInput(input),id=identity(clean.symbol,clean.provider),intakeHash=sha(clean);if(clean.decisionAt>Date.now())throw Error('future decision');directories(root,id,true);
  for(let retry=0;retry<5;retry++){
   const state=readState(root,id),same=state.metadata.find(r=>r.intakeHash===intakeHash);if(same)return {...loadObject(state.objects,same.hash,id),revision:same.revision,reused:true};
   const recordedAt=Date.now();if(!instant(recordedAt)||recordedAt<clean.decisionAt||recordedAt>clean.decisionAt+60000||state.lastReceipt&&recordedAt<state.lastReceipt.recordedAt)throw Error('evidence must be frozen at the real decision time');
   if(state.count>=MAX_EVENTS)throw Error('evidence revision capacity');const body={schemaVersion:1,mode:'research-evidence-bundle',...flags,...clean,recordedAt},hash=sha(body),object={...body,hash};
   const receipt={schemaVersion:1,revision:state.count+1,previousHash:state.lastReceipt?.receiptHash||null,hash,intakeHash,decisionAt:clean.decisionAt,recordedAt},record={...receipt,receiptHash:sha(receipt)};
   if(state.objectCount>=1000&&!fs.existsSync(path.join(state.objects,hash+'.json'))||Buffer.byteLength(encode(object))>MAX_OBJECT||state.totalBytes+Buffer.byteLength(encode(object))+Buffer.byteLength(encode(record))>MAX_TOTAL)throw Error('evidence byte capacity');
   if(!publish(state.objects,hash+'.json',object,MAX_OBJECT)&&encode(loadObject(state.objects,hash,id))!==encode(object))throw Error('existing evidence object differs');
   if(publish(state.receipts,String(receipt.revision).padStart(6,'0')+'.json',record,MAX_RECEIPT))return {...object,revision:receipt.revision,reused:false};
  }throw Error('evidence publication conflict');
 }catch{throw Error('研究证据冻结参数、时点、容量或完整性校验失败');}
}
function readResearchEvidenceBundle(root,{symbol,provider,asOf=Date.now(),hash}={}){
 try{const id=identity(symbol,provider);if(!instant(asOf)||hash!==undefined&&!hex.test(hash))throw Error('invalid evidence query');return readState(root,id,{asOf,hash}).latest;}catch{throw Error('研究证据私有存储或完整性校验失败');}
}
module.exports={freezeResearchEvidenceBundle,readResearchEvidenceBundle};
