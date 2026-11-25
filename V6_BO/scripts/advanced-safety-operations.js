#!/usr/bin/env node
'use strict';
// Offline consumer of the original account/audit and encrypted recovery tools.
// No live cutover: every restore is disposable and confined to a new directory.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {createPaperApplicationService}=require('../src/core/paper-application-service');
const {createRejectionAudit}=require('../src/core/rejection-audit');
const {backupAccountWithAudit,restoreAccountWithAudit}=require('../src/core/authority-audit-backup');
const recovery=require('./disaster-recovery'),secure=require('./secure-backup');
const CATEGORIES=['authoritative-account','rejection-audit','configuration','access-control','model-artifact','market-source-evidence','research','cache'];
const EXTRA_CATEGORIES=new Set(CATEGORIES.slice(2));
const BUNDLE_LIMIT=32*1024*1024,TOTAL_LIMIT=128*1024*1024;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const idOk=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(x);
const elapsed=start=>Math.round((performance.now()-start)*1000)/1000;
function fail(code){const error=Error(code);error.code=code;throw error;}
function noLinks(target){
 let current=path.resolve(target);
 while(true){
  try{if(fs.lstatSync(current).isSymbolicLink())fail('SYMLINK_PATH_REJECTED');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const parent=path.dirname(current);if(parent===current)break;current=parent;
 }
}
function contains(parent,child){const rel=path.relative(parent,child);return rel===''||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);}
function sourceFile(file){
 if(typeof file!=='string'||file.length>4096||file.includes('\0')||!path.isAbsolute(file))fail('INVALID_SOURCE_PATH');
 file=path.resolve(file);noLinks(file);
 if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(path.basename(file))||path.basename(file)==='manifest.json')fail('UNSUPPORTED_BACKUP_FILENAME');
 let stat;try{stat=fs.lstatSync(file);}catch{fail('SOURCE_FILE_UNAVAILABLE');}
 if(!stat.isFile()||stat.size>BUNDLE_LIMIT)fail('SOURCE_FILE_INVALID_OR_OVER_BUDGET');
 return file;
}
function normalize(spec){
 if(!plain(spec)||spec.schemaVersion!==1||!Array.isArray(spec.accounts)||!spec.accounts.length||spec.accounts.length>20||
  spec.files!==undefined&&(!Array.isArray(spec.files)||spec.files.length>64))fail('INVALID_OPERATIONS_SPEC');
 const ids=new Set(),paths=new Set();
 const item=(entry,kind)=>{
  if(!plain(entry)||!idOk(entry.id)||ids.has(entry.id)||kind==='file'&&!EXTRA_CATEGORIES.has(entry.category))fail('INVALID_OR_DUPLICATE_SOURCE');
  const file=sourceFile(entry.file);if(paths.has(file))fail('DUPLICATE_SOURCE_PATH');
  ids.add(entry.id);paths.add(file);return {id:entry.id,file,...(kind==='file'?{category:entry.category}:{})};
 };
 return {schemaVersion:1,accounts:spec.accounts.map(x=>item(x,'account')),files:(spec.files||[]).map(x=>item(x,'file'))};
}
function record(file,id,category){
 sourceFile(file);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{
  const st=fs.fstatSync(fd);if(!st.isFile()||st.size>BUNDLE_LIMIT)fail('SOURCE_FILE_INVALID_OR_OVER_BUDGET');
  const bytes=fs.readFileSync(fd);if(bytes.length!==st.size||bytes.length>BUNDLE_LIMIT)fail('SOURCE_CHANGED_DURING_READ');
  return {file,id,category,name:path.basename(file),size:bytes.length,sha256:sha(bytes)};
 }finally{fs.closeSync(fd);}
}
function inspect(spec){
 const input=normalize(spec),records=[],accounts=[];
 for(const entry of input.accounts){
  let book,audit;const before=record(entry.file,entry.id,'authoritative-account');
  try{
   book=createPaperApplicationService({file:entry.file,readOnly:true}).read();
   audit=createRejectionAudit(entry.file+'.audit.json').storageFiles();
  }catch{fail('ORIGINAL_ACCOUNT_OR_AUDIT_INVALID');}
  if(book.paperOnly!==true||book.brokerConnected!==false)fail('ACCOUNT_SCOPE_INVALID');
  const rows=[before,...audit.files.map(file=>record(file,entry.id,'rejection-audit'))];
  if(rows.reduce((n,row)=>n+row.size,0)>BUNDLE_LIMIT)fail('ACCOUNT_BUNDLE_OVER_BUDGET');
  if(record(entry.file,entry.id,'authoritative-account').sha256!==before.sha256)fail('SOURCE_CHANGED_DURING_READ');
  records.push(...rows);
  accounts.push({id:entry.id,revision:book.revision,schemaVersion:book.schemaVersion,accountFingerprint:book.fingerprint,
   ledgerFingerprint:book.account.fingerprint,orders:Object.keys(book.orders).length,ledgerEvents:book.account.events.length,
   positions:Object.keys(book.account.positions).length,auditEvents:audit.total,auditHead:audit.head,
   originalReadValidated:true,conversionApplied:false,cutoverPerformed:false});
 }
 for(const entry of input.files){
  if(records.some(row=>row.file===entry.file))fail('DUPLICATE_SOURCE_PATH');
  records.push(record(entry.file,entry.id,entry.category));
 }
 const totalBytes=records.reduce((n,row)=>n+row.size,0);if(totalBytes>TOTAL_LIMIT)fail('TOTAL_BACKUP_OVER_BUDGET');
 const inventory=records.map(({file,...row})=>row);
 const report={schemaVersion:1,kind:'advanced-safety-preflight',scope:'existing-local-files',checkedAt:Date.now(),
  readyForIsolatedDrill:true,productionReady:false,fullSiteBackup:false,mutatesOriginalAccounts:false,
  requiresStoppedWritersForCutover:true,accounts,inventory,totalBytes,
  categories:CATEGORIES.map(category=>{const rows=inventory.filter(x=>x.category===category);return {category,status:rows.length?'supplied':'not-supplied',files:rows.length,bytes:rows.reduce((n,row)=>n+row.size,0)};}),
  consistency:'Per-file preflight; the drill uses the original account-and-audit locks for each consistent bundle.'};
 return {input,records,report};
}
function preflight(spec){return inspect(spec).report;}
function writeReport(destination,report){
 const fd=fs.openSync(path.join(destination,'report.json'),'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(report,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const dir=fs.openSync(destination,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
function drill(spec,destination,password){
 if(typeof password!=='string'||password.length<16||password.length>4096)fail('BACKUP_PASSWORD_REQUIRED');
 const before=inspect(spec);
 if(typeof destination!=='string'||!path.isAbsolute(destination)||destination.includes('\0')||destination.length>4096)fail('INVALID_DRILL_DESTINATION');
 destination=path.resolve(destination);noLinks(destination);
 try{fs.lstatSync(destination);fail('DRILL_DESTINATION_ALREADY_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
 for(const row of before.records)if(contains(path.dirname(row.file),destination)||contains(destination,row.file))fail('DRILL_DESTINATION_MUST_BE_ISOLATED');
 const parent=fs.statSync(path.dirname(destination));if(!parent.isDirectory())fail('DRILL_PARENT_UNAVAILABLE');
 fs.mkdirSync(destination,{mode:0o700});
 const work=fs.mkdtempSync(path.join(destination,'.isolated-'));
 const startedAt=Date.now(),start=performance.now(),captures=[],restored=[],artifacts=[];
 let phase='capture',backupMs=null,simulatedFailureAt=null,recoveryStart=null,report;
 try{
  const sources=[...before.input.accounts.map(entry=>({...entry,kind:'account'})),...before.input.files.map(entry=>({...entry,kind:'file'}))];
  for(const entry of sources){
   const label=entry.kind+'-'+entry.id,bundle=path.join(work,label+'-bundle'),capturedFromAt=Date.now();
   if(entry.kind==='account')backupAccountWithAudit(entry.file,bundle);else recovery.backup([entry.file],bundle);
   const manifest=recovery.verify(bundle);
   if(manifest.files.reduce((n,row)=>n+row.size,0)>BUNDLE_LIMIT)fail('CAPTURE_BUNDLE_OVER_BUDGET');
   const artifact=label+'.v6backup',encrypted=path.join(destination,artifact);
   secure.encrypt(bundle,encrypted,password);
   artifacts.push({id:entry.id,kind:entry.kind,category:entry.category||'authoritative-account',file:artifact,capturedFromAt,manifestCreatedAt:Date.parse(manifest.createdAt),
    size:fs.statSync(encrypted).size,sha256:sha(fs.readFileSync(encrypted)),encrypted:true});
   captures.push({entry,label,bundle,encrypted,manifest,capturedFromAt});
  }
  backupMs=elapsed(start);simulatedFailureAt=Date.now();recoveryStart=performance.now();phase='restore';
  for(const capture of captures){
   const {entry,label,bundle,encrypted,manifest}=capture;
   const decrypted=path.join(work,label+'-decrypted'),target=path.join(work,label+'-restored');
   secure.decrypt(encrypted,decrypted,password);
   if(JSON.stringify(recovery.verify(decrypted))!==JSON.stringify(manifest))fail('DECRYPTED_MANIFEST_MISMATCH');
   if(entry.kind==='account'){
    const result=restoreAccountWithAudit(decrypted,target,{apply:true});
    const restoredFile=path.join(target,path.basename(entry.file));
    const snapshot=createPaperApplicationService({file:restoredFile,readOnly:true}).read();
    const audit=createRejectionAudit(restoredFile+'.audit.json').storageFiles();
    const original=JSON.parse(fs.readFileSync(path.join(bundle,path.basename(entry.file)),'utf8'));
    if(snapshot.fingerprint!==original.fingerprint||result.auditEvents!==audit.total)fail('RESTORED_ACCOUNT_MISMATCH');
    // The audit restorer verifies segment placement and the complete chain head.
    restored.push({id:entry.id,kind:'account',revision:snapshot.revision,auditEvents:audit.total,auditHead:audit.head,
     originalServiceValidated:true,byteMatch:sha(fs.readFileSync(restoredFile))===manifest.files.find(row=>row.name===path.basename(entry.file)).sha256});
   }else{
    recovery.restore(decrypted,target,{apply:true});
    const item=manifest.files[0],bytes=fs.readFileSync(path.join(target,item.name));
    restored.push({id:entry.id,kind:'file',byteMatch:bytes.length===item.size&&sha(bytes)===item.sha256});
   }
  }
  if(restored.some(item=>item.byteMatch!==true))fail('RESTORED_BYTES_MISMATCH');
  const after=inspect(before.input);
  if(JSON.stringify(after.report.inventory)!==JSON.stringify(before.report.inventory))fail('ORIGINAL_INPUTS_CHANGED_DURING_DRILL');
  const rtoMs=elapsed(recoveryStart),finishedAt=Date.now();
  report={schemaVersion:1,kind:'advanced-safety-drill',status:'verified-isolated',scope:'local-isolated-encrypted-restore',
   productionExercise:false,productionReady:false,fullSiteBackup:false,cutoverPerformed:false,mutatesOriginalAccounts:false,
   originalInputsUnchanged:true,plaintextRetained:false,startedAt,simulatedFailureAt,finishedAt,
   preflight:before.report,artifacts,restored,
   measurements:{backupMs,rtoMs,rpoMs:simulatedFailureAt-Math.min(...captures.map(x=>x.capturedFromAt)),
    rpoBasis:'Conservative measured backup age: simulated failure minus earliest capture start; not a production data-loss guarantee.',
    rtoBasis:'Measured monotonic time from decrypt start through original-service, byte and source revalidation.',
    totalMs:elapsed(start),productionRpoMs:null,productionRtoMs:null},
   limitations:['No live cutover, cross-host recovery, full-site restoration or real outage was exercised.','Only the supplied source files and referenced audit segments are covered.']};
 }catch(error){
  report={schemaVersion:1,kind:'advanced-safety-drill',status:'failed',scope:'local-isolated-encrypted-restore',productionExercise:false,
   productionReady:false,cutoverPerformed:false,mutatesOriginalAccounts:false,plaintextRetained:false,startedAt,finishedAt:Date.now(),phase,
   reason:typeof error.code==='string'&&/^[A-Z_]{3,64}$/.test(error.code)?error.code:'ORIGINAL_TOOL_REJECTED',artifacts,
   measurements:{backupMs,rtoMs:null,rpoMs:null,totalMs:elapsed(start),productionRpoMs:null,productionRtoMs:null}};
 }finally{fs.rmSync(work,{recursive:true,force:true});}
 writeReport(destination,report);return report;
}
function readSpec(file){
 file=path.resolve(file);noLinks(file);const st=fs.lstatSync(file);
 if(!st.isFile()||st.size>1024*1024)fail('INVALID_SPEC_FILE');
 const value=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!plain(value)||!Array.isArray(value.accounts)||value.files!==undefined&&!Array.isArray(value.files))fail('INVALID_OPERATIONS_SPEC');
 for(const row of [...value.accounts,...(value.files||[])]){
  if(!plain(row)||typeof row.file!=='string')fail('INVALID_SOURCE_PATH');
  row.file=path.resolve(path.dirname(file),row.file);
 }
 return value;
}
function execute(args,{password=process.env.V6_BACKUP_PASSWORD}={}){
 if(args[0]==='preflight'&&args.length===2)return preflight(readSpec(args[1]));
 if(args[0]==='drill'&&args.length===3)return drill(readSpec(args[1]),path.resolve(args[2]),password);
 fail('USAGE: advanced-safety-operations.js preflight <spec.json> | drill <spec.json> <new-isolated-dir>; password: V6_BACKUP_PASSWORD');
}
if(require.main===module){
 try{const result=execute(process.argv.slice(2));console.log(JSON.stringify(result,null,2));if(result.status==='failed')process.exitCode=1;}
 catch(error){console.error(JSON.stringify({ok:false,error:typeof error.code==='string'&&/^(?:[A-Z_]{3,64}|USAGE:)/.test(error.code)?error.code:'OPERATIONS_REJECTED'}));process.exitCode=1;}
}
module.exports={preflight,drill,execute};
