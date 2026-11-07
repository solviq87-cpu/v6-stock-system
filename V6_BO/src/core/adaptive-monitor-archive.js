'use strict';
// Byte-preserving, offline snapshots of the existing as monitor protocol.
// No re-evaluation of old reports, history reset, registry promotion or orders.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {createAdaptiveMonitor,ENGINE_VERSION}=require('./adaptive-research-monitor');
const VERSION='20261106aw',MAX_INDEX=8*1024*1024,MAX_REPORT=16*1024*1024,MAX_INPUT=8*1024*1024,MAX_HISTORY=1000,MAX_HISTORY_BYTES=128*1024*1024,MAX_META=2*1024*1024;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),hash=x=>sha(JSON.stringify(x));
const exists=file=>{try{fs.lstatSync(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
function safePath(value){if(typeof value!=='string'||!value||value.includes('\0'))throw Error('归档路径无效');const result=path.resolve(value);let cursor=path.parse(result).root;for(const part of result.slice(cursor.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);try{if(fs.lstatSync(cursor).isSymbolicLink())throw Error('归档路径禁止符号链接');}catch(e){if(e.code!=='ENOENT')throw e;}}return result;}
function directory(file){safePath(file);if(!fs.lstatSync(file).isDirectory())throw Error('归档路径必须是普通目录');}
function read(file,limit){safePath(file);const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));try{const st=fs.fstatSync(fd);if(!st.isFile()||st.size>limit)throw Error('归档文件类型或大小无效');const bytes=Buffer.alloc(st.size+1);let count=0,n;while(count<bytes.length&&(n=fs.readSync(fd,bytes,count,bytes.length-count,null))>0)count+=n;if(count!==st.size||count>limit)throw Error('归档读取期间文件大小变化');return bytes.subarray(0,count);}finally{fs.closeSync(fd);}}
function syncDir(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function writeNew(file,bytes,onPart){const fd=fs.openSync(file,'wx',0o600);try{if(onPart){const split=Math.floor(bytes.length/2);fs.writeFileSync(fd,bytes.subarray(0,split));onPart();fs.writeFileSync(fd,bytes.subarray(split));}else fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function sameNames(dir,names){directory(dir);if(JSON.stringify(fs.readdirSync(dir).sort())!==JSON.stringify(names.slice().sort()))throw Error('归档目录存在缺失、多出或未提交内容');}
function disjoint(a,b){const inside=(x,y)=>{const rel=path.relative(x,y);return rel===''||!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);};if(inside(a,b)||inside(b,a))throw Error('归档来源与目标目录不能重叠');}
function locked(lockFile,operation){safePath(lockFile);const fd=fs.openSync(lockFile,fs.constants.O_CREAT|fs.constants.O_RDWR|(fs.constants.O_NOFOLLOW||0),0o600);try{if(!fs.fstatSync(fd).isFile())throw Error('归档锁路径无效');const r=spawnSync('flock',['-n','3'],{stdio:['ignore','pipe','pipe',fd]});if(r.error||r.status!==0)throw Error('监视/归档目录被其他进程占用或缺少flock');return operation();}finally{fs.closeSync(fd);}}
// renameat2(RENAME_NOREPLACE) prevents even an empty, racing target directory
// from being overwritten. Fail closed on unsupported operating systems.
const PUBLISH=`import ctypes, errno, json, os, sys
try:
 f=ctypes.CDLL(None,use_errno=True).renameat2
 f.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
 f.restype=ctypes.c_int
 if f(-100,os.fsencode(sys.argv[1]),-100,os.fsencode(sys.argv[2]),1)!=0:
  print(json.dumps({'error':errno.errorcode.get(ctypes.get_errno(),'OS_ERROR')}));sys.exit(1)
except (AttributeError,OSError):
 print(json.dumps({'error':'UNSUPPORTED'}));sys.exit(1)
`;
function publish(stage,destination){safePath(stage);safePath(destination);const r=spawnSync(process.env.V6_NATIVE_PYTHON||'python3',['-c',PUBLISH,stage,destination],{encoding:'utf8',timeout:10000,maxBuffer:4096});if(r.error||r.status!==0){let reason='UNSUPPORTED';try{reason=JSON.parse(r.stdout).error;}catch{}throw Error(['EEXIST','ENOTEMPTY'].includes(reason)?'归档目标已存在，拒绝覆盖':'当前环境无法原子发布新目录：'+reason);}syncDir(path.dirname(destination));}
function snapshot(root){directory(root);const names=fs.readdirSync(root);if(names.some(n=>!['manifest.json','reports','monitor.guard'].includes(n)))throw Error('监视目录含未知/未提交内容，不能静默丢弃');if(exists(path.join(root,'monitor.guard'))&&!fs.lstatSync(path.join(root,'monitor.guard')).isFile())throw Error('监视锁不是普通文件');
 const verified=createAdaptiveMonitor({outputRoot:root,readOnly:true}).verify();const indexBytes=read(path.join(root,'manifest.json'),MAX_INDEX),index=JSON.parse(indexBytes);
 if(index.revision!==verified.revision||index.engineVersion!==ENGINE_VERSION||index.history.length>MAX_HISTORY)throw Error('监视快照版本不一致');sameNames(path.join(root,'reports'),index.history.map(e=>e.reportFile));
 const specs=[{path:'monitor/manifest.json',source:path.join(root,'manifest.json'),limit:MAX_INDEX,expected:indexBytes}];let reportBytes=0;
 for(const e of index.history){const bytes=read(path.join(root,'reports',e.reportFile),MAX_REPORT);reportBytes+=bytes.length;if(reportBytes>MAX_HISTORY_BYTES)throw Error('研究历史超过128MiB归档上限');specs.push({path:'monitor/reports/'+e.reportFile,source:path.join(root,'reports',e.reportFile),limit:MAX_REPORT,sha256:sha(bytes),bytes:bytes.length});}
 return {index,indexBytes,specs,summary:{revision:index.revision,reportBytes,firstAsOf:index.history[0].asOf,lastAsOf:index.history.at(-1).asOf,indexSHA256:sha(indexBytes),latestReportFingerprint:index.history.at(-1).reportFingerprint}};
}
const validFingerprint=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
function manifest(root,expectedFingerprint){directory(root);const raw=read(path.join(root,'archive.json'),MAX_META),doc=JSON.parse(raw);const {fingerprint,...payload}=doc;
 if(!validFingerprint(fingerprint)||fingerprint!==hash(payload)||expectedFingerprint!==undefined&&fingerprint!==expectedFingerprint)throw Error('归档指纹或预期指纹不符');
 if(doc.schemaVersion!==1||doc.kind!=='v6-adaptive-monitor-history'||doc.storageProtocol!==ENGINE_VERSION||doc.canTrade!==false||doc.verifiedLive!==false||doc.replayed!==false||typeof doc.createdByVersion!=='string'||typeof doc.createdAt!=='string'||!Number.isFinite(Date.parse(doc.createdAt))||!Array.isArray(doc.files)||doc.files.length<2||doc.files.length>MAX_HISTORY+2)throw Error('归档协议或文件列表无效');
 const seen=new Set();let total=0;for(const f of doc.files){if(!f||typeof f.path!=='string'||!['monitor/manifest.json','input.json'].includes(f.path)&&!/^monitor\/reports\/[a-f0-9]{64}\.json$/.test(f.path)||seen.has(f.path)||!Number.isSafeInteger(f.bytes)||f.bytes<1||!validFingerprint(f.sha256))throw Error('归档文件路径或指纹无效');seen.add(f.path);const limit=f.path==='monitor/manifest.json'?MAX_INDEX:f.path==='input.json'?MAX_INPUT:MAX_REPORT;if(f.bytes>limit)throw Error('归档文件超过上限');total+=f.bytes;}
 if(!seen.has('monitor/manifest.json')||total>MAX_HISTORY_BYTES+MAX_INDEX+MAX_INPUT)throw Error('归档总量或索引无效');
 sameNames(root,['archive.json','monitor',...(seen.has('input.json')?['input.json']:[])]);sameNames(path.join(root,'monitor'),['manifest.json','reports']);sameNames(path.join(root,'monitor/reports'),doc.files.filter(f=>f.path.startsWith('monitor/reports/')).map(f=>path.basename(f.path)));
 return {doc,raw};
}
function verifyMonitorArchive({archiveRoot,expectedFingerprint}={}){archiveRoot=safePath(archiveRoot);if(expectedFingerprint!==undefined&&!validFingerprint(expectedFingerprint))throw Error('预期归档指纹无效');const {doc,raw}=manifest(archiveRoot,expectedFingerprint);
 for(const f of doc.files){const bytes=read(path.join(archiveRoot,f.path),f.bytes);if(bytes.length!==f.bytes||sha(bytes)!==f.sha256)throw Error('归档文件字节指纹不符：'+f.path);}
 const s=snapshot(path.join(archiveRoot,'monitor'));if(JSON.stringify(s.summary)!==JSON.stringify(doc.history))throw Error('归档历史索引摘要不符');
 if(doc.files.some(f=>f.path==='input.json')){const input=JSON.parse(read(path.join(archiveRoot,'input.json'),MAX_INPUT));if(hash(input)!==s.index.history.at(-1).semanticSHA256)throw Error('归档输入不对应最后研究版本');}
 if(!read(path.join(archiveRoot,'archive.json'),MAX_META).equals(raw))throw Error('归档核验期间索引变化');return {verified:true,archiveFingerprint:doc.fingerprint,revision:doc.history.revision,reports:s.index.history.length,reportBytes:s.summary.reportBytes,storageProtocol:ENGINE_VERSION,canTrade:false,verifiedLive:false,replayed:false};
}
function destinationOperation(destination,operation){destination=safePath(destination);const parent=path.dirname(destination);fs.mkdirSync(parent,{recursive:true,mode:0o700});safePath(parent);return locked(path.join(parent,'.'+path.basename(destination)+'.archive.guard'),()=>operation(destination,parent));}
function exportMonitorArchive({sourceRoot,destination,expectedRevision,inputFile,onCheckpoint=()=>{}}={}){
 if(typeof onCheckpoint!=='function')throw Error('归档检查点回调无效');
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1||expectedRevision>MAX_HISTORY)throw Error('必须提供1至1000的预期监视修订');sourceRoot=safePath(sourceRoot);destination=safePath(destination);disjoint(sourceRoot,destination);if(inputFile)inputFile=safePath(inputFile);directory(sourceRoot);
 return destinationOperation(destination,(dest,parent)=>locked(path.join(sourceRoot,'monitor.guard'),()=>{
  if(exists(dest))throw Error('归档目标已存在，拒绝覆盖');const state=snapshot(sourceRoot);if(state.index.revision!==expectedRevision)throw Error('监视修订冲突，请核对原始版本');
  const specs=state.specs;let inputBytes;if(inputFile){inputBytes=read(inputFile,MAX_INPUT);if(hash(JSON.parse(inputBytes))!==state.index.history.at(-1).semanticSHA256)throw Error('输入与最后研究版本不符');specs.push({path:'input.json',source:inputFile,limit:MAX_INPUT,expected:inputBytes});}
  const stage=fs.mkdtempSync(path.join(parent,'.'+path.basename(dest)+'.archive-stage-'));let published=false;
  try{fs.mkdirSync(path.join(stage,'monitor'),{mode:0o700});fs.mkdirSync(path.join(stage,'monitor/reports'),{mode:0o700});const files=[];
   for(let n=0;n<specs.length;n++){const spec=specs[n],bytes=read(spec.source,spec.limit);if(spec.expected&&!bytes.equals(spec.expected)||spec.sha256&&sha(bytes)!==spec.sha256||spec.bytes!==undefined&&bytes.length!==spec.bytes)throw Error('归档期间监视源文件变化');writeNew(path.join(stage,spec.path),bytes,n===0?()=>onCheckpoint('archive-file-partial'):null);files.push({path:spec.path,bytes:bytes.length,sha256:sha(bytes)});if(n===0)onCheckpoint('archive-first-file');}
   const payload={schemaVersion:1,kind:'v6-adaptive-monitor-history',storageProtocol:ENGINE_VERSION,createdByVersion:VERSION,createdAt:new Date().toISOString(),canTrade:false,verifiedLive:false,replayed:false,history:state.summary,files};const doc={...payload,fingerprint:hash(payload)};writeNew(path.join(stage,'archive.json'),Buffer.from(JSON.stringify(doc)+'\n'));
   syncDir(path.join(stage,'monitor/reports'));syncDir(path.join(stage,'monitor'));syncDir(stage);verifyMonitorArchive({archiveRoot:stage,expectedFingerprint:doc.fingerprint});
   if(!read(path.join(sourceRoot,'manifest.json'),MAX_INDEX).equals(state.indexBytes)||inputFile&&!read(inputFile,MAX_INPUT).equals(inputBytes))throw Error('发布前监视输入或索引变化');onCheckpoint('archive-before-publish');publish(stage,dest);published=true;onCheckpoint('archive-published');
   return {archived:true,archiveFingerprint:doc.fingerprint,revision:state.summary.revision,reports:state.index.history.length,canTrade:false,replayed:false};
  }finally{if(!published)fs.rmSync(stage,{recursive:true,force:true});}
 }));
}
function restoreMonitorArchive({archiveRoot,destination,expectedFingerprint,onCheckpoint=()=>{}}={}){if(typeof onCheckpoint!=='function')throw Error('恢复检查点回调无效');if(!validFingerprint(expectedFingerprint))throw Error('恢复必须提供预期归档指纹');archiveRoot=safePath(archiveRoot);destination=safePath(destination);disjoint(archiveRoot,destination);
 return destinationOperation(destination,(dest,parent)=>{const checked=verifyMonitorArchive({archiveRoot,expectedFingerprint});
  if(exists(dest)){const same=verifyMonitorArchive({archiveRoot:dest,expectedFingerprint});return {...same,restored:false,status:'already-restored',monitorRoot:path.join(dest,'monitor')};}
  const {doc,raw}=manifest(archiveRoot,expectedFingerprint),stage=fs.mkdtempSync(path.join(parent,'.'+path.basename(dest)+'.restore-stage-'));let published=false;
  try{fs.mkdirSync(path.join(stage,'monitor'),{mode:0o700});fs.mkdirSync(path.join(stage,'monitor/reports'),{mode:0o700});
   for(let n=0;n<doc.files.length;n++){const f=doc.files[n],bytes=read(path.join(archiveRoot,f.path),f.bytes);if(bytes.length!==f.bytes||sha(bytes)!==f.sha256)throw Error('恢复期间归档源文件变化');writeNew(path.join(stage,f.path),bytes,n===0?()=>onCheckpoint('restore-file-partial'):null);if(n===0)onCheckpoint('restore-first-file');}
   writeNew(path.join(stage,'archive.json'),raw);syncDir(path.join(stage,'monitor/reports'));syncDir(path.join(stage,'monitor'));syncDir(stage);verifyMonitorArchive({archiveRoot:stage,expectedFingerprint});onCheckpoint('restore-before-publish');publish(stage,dest);published=true;onCheckpoint('restore-published');return {...checked,restored:true,status:'restored',monitorRoot:path.join(dest,'monitor')};
  }finally{if(!published)fs.rmSync(stage,{recursive:true,force:true});}
 });
}
module.exports={exportMonitorArchive,verifyMonitorArchive,restoreMonitorArchive};
