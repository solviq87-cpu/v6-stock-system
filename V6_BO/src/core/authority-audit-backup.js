'use strict';
// An offline consistent account + rejection-evidence bundle, not whole-site DR.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {withAccountLock}=require('./account-process-lock');
const {createPaperApplicationService}=require('./paper-application-service');
const {createRejectionAudit}=require('./rejection-audit');
const recovery=require('../../scripts/disaster-recovery');
const META='V6_AUTHORITY_AUDIT_BUNDLE.json';
const safe=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,126}$/.test(x)&&x!==META&&x!=='manifest.json';
function noLinks(target){let current=path.resolve(target);while(true){try{if(fs.lstatSync(current).isSymbolicLink())throw Error('备份/恢复路径不得包含符号链接');}catch(e){if(e.code!=='ENOENT')throw e;}const parent=path.dirname(current);if(parent===current)break;current=parent;}}
function syncDirectory(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function captureFailure(code){const error=Error(code);error.code=code;throw error;}
function backupAccountWithAudit(accountFile,destination,{maxTotalBytes=256*1024*1024,expectedFiles}={}){
 if(!Number.isSafeInteger(maxTotalBytes)||maxTotalBytes<0||maxTotalBytes>256*1024*1024)captureFailure('INVALID_BACKUP_CAPTURE_OPTIONS');
 if(expectedFiles!==undefined&&(!Array.isArray(expectedFiles)||!expectedFiles.length||expectedFiles.some(row=>!row||!safe(row.name)||!Number.isSafeInteger(row.size)||row.size<0||typeof row.sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sha256))||new Set(expectedFiles.map(row=>row.name)).size!==expectedFiles.length))captureFailure('INVALID_BACKUP_CAPTURE_OPTIONS');
 accountFile=path.resolve(accountFile);destination=path.resolve(destination);noLinks(accountFile);noLinks(destination);const name=path.basename(accountFile),auditFile=accountFile+'.audit.json';if(!safe(name)||!safe(path.basename(auditFile)))throw Error('账户备份文件名无效');
 return withAccountLock(accountFile,()=>withAccountLock(auditFile,()=>{
  if(expectedFiles){
   if(!expectedFiles.some(row=>row.name===name)||fs.existsSync(auditFile)&&!expectedFiles.some(row=>row.name===path.basename(auditFile)))captureFailure('BACKUP_EXPECTED_FILES_MISMATCH');
   // The preflight inventory is checked under both original writer locks,
   // before the account/audit readers can consume a grown source file.
   for(const row of expectedFiles){
    const file=row.name===name?accountFile:row.name===path.basename(auditFile)?auditFile:path.join(auditFile+'.segments',row.name);
    noLinks(file);let stat;try{stat=fs.lstatSync(file);}catch{captureFailure('BACKUP_SOURCE_CHANGED');}
    if(!stat.isFile()||stat.size!==row.size)captureFailure('BACKUP_SOURCE_CHANGED');
   }
  }
  createPaperApplicationService({file:accountFile}).read();const state=createRejectionAudit(auditFile).storageFiles();for(const f of state.files)noLinks(f);
  const files=[accountFile,...state.files];const totalBytes=files.reduce((n,f)=>n+fs.statSync(f).size,0);if(totalBytes>maxTotalBytes)captureFailure('BACKUP_BYTE_BUDGET_EXCEEDED');
  if(expectedFiles&&JSON.stringify(files.map(f=>path.basename(f)).sort())!==JSON.stringify(expectedFiles.map(row=>row.name).sort()))captureFailure('BACKUP_EXPECTED_FILES_MISMATCH');
  const parent=path.dirname(destination);fs.mkdirSync(parent,{recursive:true});noLinks(parent);const temp=fs.mkdtempSync(path.join(parent,'.audit-bundle-'));
  try{const meta={schemaVersion:1,kind:'v6-authority-audit',accountName:name,auditName:path.basename(auditFile),auditPresent:state.files.includes(auditFile),archiveNames:state.files.filter(f=>f!==auditFile).map(f=>path.basename(f)),total:state.total,head:state.head};const metadata=path.join(temp,META),bytes=Buffer.from(JSON.stringify(meta)+'\n');if(bytes.length>1024*1024)captureFailure('BACKUP_METADATA_OVER_BUDGET');fs.writeFileSync(metadata,bytes,{mode:0o600});const manifest=recovery.backup([...files,metadata],destination,{maxTotalBytes:maxTotalBytes+bytes.length,...(expectedFiles?{expectedFiles:[...expectedFiles,{name:META,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}]}:{})});return {verified:true,files:manifest.files.length,auditEvents:state.total,auditHead:state.head};}
  finally{fs.rmSync(temp,{recursive:true,force:true});}
 }));
}
function validateBundle(directory){const manifest=recovery.verify(directory),meta=JSON.parse(fs.readFileSync(path.join(directory,META),'utf8'));
 if(meta.schemaVersion!==1||meta.kind!=='v6-authority-audit'||!safe(meta.accountName)||meta.auditName!==meta.accountName+'.audit.json'||typeof meta.auditPresent!=='boolean'||!Array.isArray(meta.archiveNames)||meta.archiveNames.length>4096||new Set(meta.archiveNames).size!==meta.archiveNames.length||meta.archiveNames.some(n=>!safe(n)||!/^\d+-\d+-[a-f0-9]{64}\.json$/.test(n))||!Number.isSafeInteger(meta.total)||meta.total<0||meta.head!==null&&!/^[a-f0-9]{64}$/.test(meta.head)||!meta.auditPresent&&meta.archiveNames.length)throw Error('账户审计备份索引无效');
 const expected=[META,meta.accountName,...(meta.auditPresent?[meta.auditName]:[]),...meta.archiveNames].sort();if(JSON.stringify(manifest.files.map(f=>f.name).sort())!==JSON.stringify(expected))throw Error('账户审计备份清单不完整或含额外文件');return meta;
}
function restoreAccountWithAudit(directory,destination,{apply=false}={}){
 directory=path.resolve(directory);destination=path.resolve(destination);noLinks(directory);noLinks(destination);const rel=path.relative(directory,destination);if(rel===''||!rel.startsWith('..'+path.sep)&&rel!=='..')throw Error('恢复目标不能位于备份内');
 if(fs.existsSync(destination)&&(!fs.lstatSync(destination).isDirectory()||fs.readdirSync(destination).length))throw Error('恢复目标必须为空目录');
 const meta=validateBundle(directory),parent=path.dirname(destination);fs.mkdirSync(parent,{recursive:true});noLinks(parent);const stage=fs.mkdtempSync(path.join(parent,'.authority-audit-restore-'));let published=false;
 try{
  recovery.restore(directory,stage,{apply:true});
  if(meta.archiveNames.length){const archiveDir=path.join(stage,meta.auditName+'.segments');fs.mkdirSync(archiveDir,{mode:0o700});for(const name of meta.archiveNames)fs.renameSync(path.join(stage,name),path.join(archiveDir,name));syncDirectory(archiveDir);}
  fs.unlinkSync(path.join(stage,META));const account=path.join(stage,meta.accountName);const snapshot=createPaperApplicationService({file:account}).read();const evidence=createRejectionAudit(account+'.audit.json').storageFiles();
  if(evidence.total!==meta.total||evidence.head!==meta.head)throw Error('恢复后的审计链与备份锚点不符');
  syncDirectory(stage);
  if(apply){if(fs.existsSync(destination)){if(!fs.lstatSync(destination).isDirectory()||fs.readdirSync(destination).length)throw Error('恢复目标必须为空目录');fs.rmdirSync(destination);}fs.renameSync(stage,destination);published=true;const fd=fs.openSync(parent,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  return {verified:true,restored:apply,auditEvents:evidence.total,accountRevision:snapshot.revision};
 }finally{if(!published)fs.rmSync(stage,{recursive:true,force:true});}
}
module.exports={backupAccountWithAudit,restoreAccountWithAudit};
