'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {runAdaptiveJob}=require('../server/adaptive-research-job');
const {atomicWrite}=require('./market-data-center');
const ENGINE_VERSION='20261106as',MAX_INPUT=8*1024*1024,MAX_REPORT=16*1024*1024,MAX_HISTORY=1000,MAX_ARCHIVE=128*1024*1024;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),hash=x=>sha(JSON.stringify(x));
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const text=x=>typeof x==='string'&&x.trim()&&x.length<=160;
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
function instant(x){if(typeof x!=='string')return false;const m=x.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/);return !!m&&day(m[1])&&+m[2]<24&&+m[3]<60&&+m[4]<60&&(m[5]==='Z'||(+m[6]<24&&+m[7]<60))&&Number.isFinite(Date.parse(x));}
function validIdentity({source,provider,version,asOf,decisionAt}={}){
 return ['imported','simulated'].includes(source)&&text(provider)&&text(version)&&day(asOf)&&instant(decisionAt)&&asOf<=new Date(Date.parse(decisionAt)+28800000).toISOString().slice(0,10);
}
function validResult(result,semanticSHA256){
 return result?.schemaVersion===1&&result.mode==='adaptive-market-research'&&result.canTrade===false&&result.verifiedLive===false&&result.brokerConnected===false&&
  (result.learning?.liveRulesChanged===undefined||result.learning.liveRulesChanged===false)&&digest(semanticSHA256)&&result.datasetFingerprint===semanticSHA256&&validIdentity({...result,version:result.inputVersion});
}
function matchesInput(result,input,semanticSHA256){return validResult(result,semanticSHA256)&&result.source===input.source&&result.provider===input.provider&&result.inputVersion===input.version&&result.asOf===input.asOf&&result.decisionAt===input.decisionAt;}
function safePath(value){
 const result=path.resolve(value);let current=path.parse(result).root;
 for(const part of result.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);try{if(fs.lstatSync(current).isSymbolicLink())throw Error('研究路径禁止符号链接');}catch(e){if(e.code!=='ENOENT')throw e;}}
 return result;
}
function readBytes(file,limit){
 safePath(file);const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{const st=fs.fstatSync(fd);if(!st.isFile()||st.size>limit)throw Error('研究文件类型或大小无效');const bytes=Buffer.alloc(limit+1);let count=0,n;
 while(count<bytes.length&&(n=fs.readSync(fd,bytes,count,bytes.length-count,null))>0)count+=n;
 if(count>limit)throw Error('研究文件超过大小上限');return bytes.subarray(0,count);
 }finally{fs.closeSync(fd);}
}
const sealed=payload=>({...payload,fingerprint:hash(payload)});
function unseal(record){const {fingerprint,...payload}=record||{};if(typeof fingerprint!=='string'||fingerprint!==hash(payload))throw Error('研究文件完整性校验失败');return payload;}
function syncDir(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function createAdaptiveMonitor({inputFile,outputRoot,compute=runAdaptiveJob,onCheckpoint=()=>{},readOnly=false}={}){
 if((!readOnly&&!inputFile)||!outputRoot)throw Error('需要输入文件及输出目录');
 if(inputFile)inputFile=safePath(inputFile);outputRoot=safePath(outputRoot);
 if(!readOnly)fs.mkdirSync(outputRoot,{recursive:true,mode:0o700});const reports=path.join(outputRoot,'reports');safePath(reports);if(!readOnly)fs.mkdirSync(reports,{recursive:true,mode:0o700});
 const indexFile=path.join(outputRoot,'manifest.json'),lockFile=path.join(outputRoot,'monitor.guard');let running=false;
 // In-process continuity only: a fresh instance still relies on disk evidence.
 let observed=[];
 function remember(history){const next=history.map(hash);if(next.length<observed.length||observed.some((h,i)=>h!==next[i]))throw Error('已观察研究历史截断或改写');observed=next;}
 function readReport(name){if(typeof name!=='string'||!/^[a-f0-9]{64}\.json$/.test(name))throw Error('研究报告文件名无效');const bytes=readBytes(path.join(reports,name),MAX_REPORT),record=JSON.parse(bytes.toString('utf8')),payload=unseal(record);
  if(payload.schemaVersion!==1||payload.engineVersion!==ENGINE_VERSION||!digest(payload.inputSHA256)||!validResult(payload.result,payload.semanticSHA256)||name!==payload.inputSHA256+'.json')throw Error('研究报告来源或版本无效');
  return {record,bytes:bytes.length};
 }
 function readIndex(){
  safePath(indexFile);safePath(reports);
  if(!fs.existsSync(indexFile)){if(observed.length)throw Error('已观察研究历史索引缺失');if(fs.readdirSync(reports).some(n=>!n.startsWith('.')))return {index:null,orphanOnly:true,bytes:0};return {index:null,orphanOnly:false,bytes:0};}
  const index=JSON.parse(readBytes(indexFile,8*1024*1024).toString('utf8')),payload=unseal(index);
  if(payload.schemaVersion!==1||payload.engineVersion!==ENGINE_VERSION||!Number.isSafeInteger(payload.revision)||payload.revision<1||!Array.isArray(payload.history)||payload.history.length!==payload.revision||payload.history.length>MAX_HISTORY)throw Error('研究索引版本或历史无效');
  let bytes=0,latestRecord;const seen=new Set(),semantics=new Set(),identities=new Set();let priorDate='';
  for(const entry of payload.history){
   if(!entry||typeof entry!=='object')throw Error('研究索引记录无效');
   const identity=JSON.stringify([entry.provider,entry.asOf,entry.inputVersion]);
   if(seen.has(entry.reportFile)||semantics.has(entry.semanticSHA256)||identities.has(identity))throw Error('研究索引重复报告或输入版本');
   seen.add(entry.reportFile);semantics.add(entry.semanticSHA256);identities.add(identity);
   const report=readReport(entry.reportFile);bytes+=report.bytes;if(bytes>MAX_ARCHIVE)throw Error('研究历史超过128MiB在线核验上限');
   const r=report.record;latestRecord=r;if(r.fingerprint!==entry.reportFingerprint||r.inputSHA256!==entry.inputSHA256||r.semanticSHA256!==entry.semanticSHA256||r.result.asOf!==entry.asOf||r.result.provider!==entry.provider||r.result.inputVersion!==entry.inputVersion||entry.asOf<priorDate)throw Error('研究索引与报告不一致');priorDate=entry.asOf;
  }
  remember(payload.history);return {index,bytes,orphanOnly:false,latestRecord};
 }
 async function runOnce(){
  if(readOnly)throw Error('只读研究查看器禁止运行');
  if(running)throw Error('本地研究已在运行');running=true;let fd;
  try{
   safePath(lockFile);fd=fs.openSync(lockFile,fs.constants.O_CREAT|fs.constants.O_RDWR|(fs.constants.O_NOFOLLOW||0),0o600);if(!fs.fstatSync(fd).isFile())throw Error('研究锁路径无效');
   const lock=spawnSync('flock',['-n','3'],{stdio:['ignore','pipe','pipe',fd]});if(lock.error||lock.status!==0)throw Error('本地研究目录已被其他进程占用或缺少flock');
   // Hold the descriptor until every awaited computation and publication completes.
   const {index,bytes:archiveBytes,orphanOnly}=readIndex(),inputBytes=readBytes(inputFile,MAX_INPUT),input=JSON.parse(inputBytes.toString('utf8')),inputSHA256=sha(inputBytes),semanticSHA256=hash(input),history=index?.history||[];
   if(!input||input.schemaVersion!==1||!validIdentity(input))throw Error('研究输入身份无效');
   const assertInputUnchanged=()=>{if(sha(readBytes(inputFile,MAX_INPUT))!==inputSHA256)throw Error('研究期间输入变化，未发布新索引，请重试');};
   const assertIndexUnchanged=()=>{
    safePath(indexFile);
    if(fs.existsSync(indexFile)!==Boolean(index)||index&&hash(JSON.parse(readBytes(indexFile,MAX_INPUT).toString('utf8')))!==hash(index))throw Error('研究索引在计算期间变化，拒绝覆盖');
   };
   const last=history.at(-1);if(last&&input.asOf<last.asOf)throw Error('输入日期倒退，拒绝替换较新研究');
   const same=history.find(r=>r.semanticSHA256===semanticSHA256);
   if(same){if(same!==last)throw Error('输入回退至旧研究版本，拒绝替换当前版本');return {status:'unchanged',revision:index.revision,asOf:same.asOf,reportFile:same.reportFile,reportFingerprint:same.reportFingerprint,canTrade:false};}
   if(history.some(r=>r.provider===input.provider&&r.inputVersion===input.version&&r.asOf===input.asOf&&r.semanticSHA256!==semanticSHA256))throw Error('同一来源/日期/输入版本不能对应不同内容');
   if(history.length>=MAX_HISTORY)throw Error('研究历史达到1000条上限，请离线归档到新目录');
   const reportFile=inputSHA256+'.json',dest=path.join(reports,reportFile);let stored,recovered=false;
   if(orphanOnly){const names=fs.readdirSync(reports).filter(n=>!n.startsWith('.'));if(names.length!==1||names[0]!==reportFile)throw Error('索引缺失且不能唯一恢复，拒绝重置历史');}
   if(fs.existsSync(dest)){
    stored=readReport(reportFile);if(!matchesInput(stored.record.result,input,semanticSHA256))throw Error('研究孤段输入不符');recovered=true;
   }else{
    // Existing non-hidden orphans without an index may indicate a deleted index.
    // Recover only the exact input's valid report, never reset unrelated history.
    if(orphanOnly)throw Error('索引缺失但存在其他研究报告，拒绝重置');
    const result=await compute(structuredClone(input));if(result?.ok!==true)throw Error(result?.error||'本地研究失败');
    if(!matchesInput(result.result,input,semanticSHA256))throw Error('研究输出与输入身份、指纹或权限不符');
    assertInputUnchanged();assertIndexUnchanged();
    const record=sealed({schemaVersion:1,engineVersion:ENGINE_VERSION,inputSHA256,semanticSHA256,result:result.result});const encoded=JSON.stringify(record)+'\n';
    if(Buffer.byteLength(encoded)>MAX_REPORT||archiveBytes+Buffer.byteLength(encoded)>MAX_ARCHIVE)throw Error('研究报告或在线历史超过大小上限');
    const stage=fs.mkdtempSync(path.join(reports,'.publish-'));
    try{const staged=path.join(stage,'report.json');atomicWrite(staged,encoded);assertInputUnchanged();assertIndexUnchanged();fs.linkSync(staged,dest);syncDir(reports);}finally{fs.rmSync(stage,{recursive:true,force:true});}
    stored={record,bytes:Buffer.byteLength(encoded)};onCheckpoint('report-published');
   }
   if(archiveBytes+stored.bytes>MAX_ARCHIVE)throw Error('研究历史超过128MiB在线核验上限');
   const record=stored.record,entry={inputSHA256,semanticSHA256,provider:record.result.provider,inputVersion:record.result.inputVersion,asOf:record.result.asOf,reportFile,reportFingerprint:record.fingerprint};
   const next=sealed({schemaVersion:1,engineVersion:ENGINE_VERSION,revision:history.length+1,history:[...history,entry]});atomicWrite(indexFile,JSON.stringify(next)+'\n',{beforeRename:()=>{
    assertIndexUnchanged();const current=readReport(reportFile);if(current.record.fingerprint!==record.fingerprint||!matchesInput(current.record.result,input,semanticSHA256))throw Error('研究报告提交前变化');
    assertInputUnchanged();
   }});remember(next.history);onCheckpoint('index-published');
   return {status:recovered?'recovered':'updated',revision:next.revision,asOf:entry.asOf,reportFile,reportFingerprint:entry.reportFingerprint,canTrade:false};
  }finally{if(fd!==undefined)fs.closeSync(fd);running=false;}
 }
 return {runOnce,latest:()=>{const s=readIndex();if(!s.index)throw Error('研究索引不存在');const entry=s.index.history.at(-1);return {revision:s.index.revision,reportFingerprint:entry.reportFingerprint,result:s.latestRecord.result};},verify:()=>{const s=readIndex();if(!s.index)throw Error('研究索引不存在');return {verified:true,revision:s.index.revision,bytes:s.bytes,canTrade:false};}};
}
module.exports={createAdaptiveMonitor,ENGINE_VERSION};
