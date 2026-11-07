'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {withAccountLock}=require('./account-process-lock');
const {atomicWrite}=require('./market-data-center');
const MAX=8*1024*1024;
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function readRegular(file,limit){const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));try{const st=fs.fstatSync(fd);if(!st.isFile()||st.size>limit)throw Error('拒单审计文件无效或超过上限');return fs.readFileSync(fd);}finally{fs.closeSync(fd);}}
function entryExists(file){try{fs.lstatSync(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function createSegmentedAuditStore(file,{maxBytes=MAX,faultInjector=null}={}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>MAX||faultInjector!==null&&typeof faultInjector!=='function')throw Error('审计分段配置无效');
 file=path.resolve(file);const dir=file+'.segments';
 function checkDir(create=false){if(create)fs.mkdirSync(dir,{mode:0o700,recursive:true});const st=fs.lstatSync(dir);if(!st.isDirectory()||st.isSymbolicLink())throw Error('审计归档目录无效');}
 function chain(events,start,previous){if(!Array.isArray(events))throw Error('拒单审计格式无效');for(let i=0;i<events.length;i++){const e=events[i];if(!e||typeof e!=='object')throw Error('拒单审计事件无效');const {fingerprint,...payload}=e;if(!Number.isSafeInteger(payload.sequence)||payload.sequence!==start+i||payload.previousHash!==previous||fingerprint!==hash(payload))throw Error('拒单审计完整性校验失败');previous=fingerprint;}return previous;}
 function load({afterSequence=0,limit=0}={}){
  if(!entryExists(file)){if(entryExists(dir)){checkDir();if(fs.readdirSync(dir).length)throw Error('审计主索引缺失，拒绝重置归档历史');}return {root:{schemaVersion:1,events:[]},events:[],total:0,head:null,files:[]};}
  const root=JSON.parse(readRegular(file,MAX));let events=[],head=null,total=0;const files=[file];
  if(root.schemaVersion===1){head=chain(root.events,1,null);return {root,events:root.events.slice(afterSequence,afterSequence+limit),total:root.events.length,head,files};}
  if(root.schemaVersion!==2||!Array.isArray(root.archives)||root.archives.length>4096)throw Error('拒单审计索引格式无效');
  const {fingerprint,...payload}=root;if(fingerprint!==hash(payload))throw Error('拒单审计索引完整性校验失败');
  if(root.archives.length)checkDir();
  if(root.archives.reduce((n,a)=>n+(Number.isSafeInteger(a?.bytes)?a.bytes:Infinity),0)>128*1024*1024)throw Error('审计历史超过128MiB在线校验上限，需离线迁移');
  const collect=(batch,start)=>{if(limit){const first=Math.max(0,afterSequence+1-start),last=Math.min(batch.length,afterSequence+limit+1-start);if(first<last)events.push(...batch.slice(first,last));}};
  for(const a of root.archives){
   if(!a||typeof a.name!=='string'||a.name.length>125||!/^\d+-\d+-[a-f0-9]{64}\.json$/.test(a.name)||!Number.isSafeInteger(a.from)||!Number.isSafeInteger(a.to)||a.from!==total+1||a.to<a.from||a.previousHash!==head||!digest(a.headHash)||!digest(a.sha256)||!Number.isSafeInteger(a.bytes)||a.bytes<1||a.bytes>MAX+4096)throw Error('审计归档索引或顺序无效');
   const location=path.join(dir,a.name),raw=readRegular(location,MAX+4096);if(raw.length!==a.bytes||hash(raw)!==a.sha256)throw Error('审计归档文件指纹不符');const s=JSON.parse(raw);
   if(s.schemaVersion!==1||s.from!==a.from||s.to!==a.to||s.previousHash!==head||s.headHash!==a.headHash||!Array.isArray(s.events)||s.events.length!==a.to-a.from+1)throw Error('审计归档内容与索引不符');
   head=chain(s.events,total+1,head);if(head!==a.headHash)throw Error('审计归档链末端不符');collect(s.events,total+1);total=a.to;files.push(location);
  }
  if(root.baseSequence!==total||root.baseHash!==head)throw Error('审计活动段锚点不符');head=chain(root.events,total+1,head);collect(root.events,total+1);total+=root.events.length;
  return {root,events,total,head,files};
 }
 const inject=stage=>{if(faultInjector)faultInjector(stage);};
 function seal(root){if(root.schemaVersion===1)return root;delete root.fingerprint;root.fingerprint=hash(root);return root;}
 function syncDir(directory){const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 function publishArchive(name,bytes){checkDir(true);const target=path.join(dir,name);
  if(entryExists(target)){if(!readRegular(target,MAX+4096).equals(bytes))throw Error('已有归档内容冲突，禁止覆盖');return;}
  const temp=path.join(dir,'.archive-'+crypto.randomBytes(8).toString('hex')+'.tmp');let fd;
  try{inject('before-archive-write');fd=fs.openSync(temp,'wx',0o600);if(faultInjector){const split=Math.floor(bytes.length/2);fs.writeSync(fd,bytes.subarray(0,split));inject('during-archive-write');fs.writeSync(fd,bytes.subarray(split));}else fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
   try{fs.linkSync(temp,target);}catch(e){if(e.code!=='EEXIST'||!readRegular(target,MAX+4096).equals(bytes))throw e;}
   fs.unlinkSync(temp);syncDir(dir);syncDir(path.dirname(dir));inject('after-archive-publish');
  }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch{}}
 }
 function rotateLocked(state){const {root,total,head}=state;if(!root.events.length)return {rotated:false,total,head,archiveCount:root.archives?.length||0};
  const from=root.schemaVersion===1?1:root.baseSequence+1,previousHash=root.schemaVersion===1?null:root.baseHash;
  const segment={schemaVersion:1,from,to:total,previousHash,headHash:head,events:root.events};const bytes=Buffer.from(JSON.stringify(segment)+'\n'),sha256=hash(bytes),name=from+'-'+total+'-'+sha256+'.json';
  const next=seal({schemaVersion:2,baseSequence:total,baseHash:head,archives:[...(root.archives||[]),{name,from,to:total,previousHash,headHash:head,sha256,bytes:bytes.length}],events:[]});const encoded=JSON.stringify(next)+'\n';
  if(next.archives.length>4096||next.archives.reduce((n,a)=>n+a.bytes,0)>128*1024*1024||Buffer.byteLength(encoded)>MAX)throw Error('审计归档索引容量已满，需运维迁移');
  publishArchive(name,bytes);inject('before-index-switch');atomicWrite(file,encoded);inject('after-index-switch');
  return {rotated:true,total,head,archiveCount:next.archives.length,archive:name};
 }
 function append(payload){return withAccountLock(file,()=>{let state=load();const {sequence:ignored1,previousHash:ignored2,fingerprint:ignored3,...values}=payload;
  const event={sequence:state.total+1,previousHash:state.head,...values};event.fingerprint=hash(event);
  if(!Number.isSafeInteger(event.sequence))throw Error('审计序号超出范围');let root={...state.root,events:[...state.root.events,event]};let encoded=JSON.stringify(seal(root))+'\n';
  if((Buffer.byteLength(JSON.stringify(root.events))>maxBytes||Buffer.byteLength(encoded)>MAX)&&state.root.events.length){rotateLocked(state);state=load();root={...state.root,events:[event]};encoded=JSON.stringify(seal(root))+'\n';}
  if(Buffer.byteLength(JSON.stringify(root.events))>maxBytes||Buffer.byteLength(encoded)>MAX)throw Error('单条审计证据或归档索引超过容量，拒绝丢失证据');atomicWrite(file,encoded);return event;
 });}
 function read({afterSequence=0,limit=100}={}){if(!Number.isSafeInteger(afterSequence)||afterSequence<0||!Number.isSafeInteger(limit)||limit<1||limit>500)throw Error('审计分页无效');const state=load({afterSequence,limit});return {events:state.events,total:state.total,verified:true};}
 function rotate(){return withAccountLock(file,()=>rotateLocked(load()));}
 function storageFiles(){const state=load();return {files:state.files,total:state.total,head:state.head,archiveDirectory:dir};}
 return {append,read,rotate,storageFiles};
}
module.exports={createSegmentedAuditStore};
