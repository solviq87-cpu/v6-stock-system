#!/usr/bin/env node
'use strict';
/** Offline, fail-closed backup and restore verification for V6 state files. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function safeName(name){return typeof name==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name)&&name!=='.'&&name!=='..'}
function regularFile(p){const s=fs.lstatSync(p);if(!s.isFile()||s.size>64*1024*1024)throw Error('not a regular state file or too large: '+p);return s}
function noSymlinkAncestors(target){let current=path.resolve(target);while(true){{try{const stat=fs.lstatSync(current);if(stat.isSymbolicLink())throw Error('symlink in backup/restore path: '+current)}catch(e){if(e.code!=='ENOENT')throw e}}const parent=path.dirname(current);if(parent===current)break;current=parent}}
function syncDirectory(dir){let fd;try{fd=fs.openSync(dir,'r');fs.fsyncSync(fd)}catch(e){if(!['EINVAL','ENOTSUP','EISDIR','EPERM'].includes(e.code))throw e}finally{if(fd!==undefined)fs.closeSync(fd)}}
function writeAtomic(dest,bytes){fs.mkdirSync(path.dirname(dest),{recursive:true});const tmp=dest+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';let fd;try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,dest);syncDirectory(path.dirname(dest))}finally{if(fd!==undefined)try{fs.closeSync(fd)}catch{};try{fs.unlinkSync(tmp)}catch{}}}
function captureFailure(code){const error=Error(code);error.code=code;throw error}
function captureOptions(options){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['maxTotalBytes','expectedFiles'].includes(k)))captureFailure('INVALID_BACKUP_CAPTURE_OPTIONS');
 const maxTotalBytes=options.maxTotalBytes===undefined?Number.MAX_SAFE_INTEGER:options.maxTotalBytes;
 if(!Number.isSafeInteger(maxTotalBytes)||maxTotalBytes<0)captureFailure('INVALID_BACKUP_CAPTURE_OPTIONS');
 let expected=null;
 if(options.expectedFiles!==undefined){
  if(!Array.isArray(options.expectedFiles)||!options.expectedFiles.length)captureFailure('INVALID_BACKUP_CAPTURE_OPTIONS');
  expected=new Map();let total=0;
  for(const row of options.expectedFiles){
   if(!row||!safeName(row.name)||row.name==='manifest.json'||expected.has(row.name)||!Number.isSafeInteger(row.size)||row.size<0||row.size>64*1024*1024||typeof row.sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sha256))captureFailure('INVALID_BACKUP_CAPTURE_OPTIONS');
   expected.set(row.name,{size:row.size,sha256:row.sha256});total+=row.size;
   if(!Number.isSafeInteger(total)||total>maxTotalBytes)captureFailure('BACKUP_BYTE_BUDGET_EXCEEDED');
  }
 }
 return {maxTotalBytes,expected};
}
function sameFile(a,b){return a.isFile()&&b.isFile()&&['dev','ino','size','mtimeMs','ctimeMs','mode'].every(key=>a[key]===b[key])}
function captureBytes(file,expected,remaining){
 const initial=regularFile(file);noSymlinkAncestors(file);
 if(expected&&initial.size!==expected.size)captureFailure('BACKUP_SOURCE_CHANGED');
 if(initial.size>remaining)captureFailure('BACKUP_BYTE_BUDGET_EXCEEDED');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
 try{
  const opened=fs.fstatSync(fd);
  if(!sameFile(initial,opened))captureFailure('BACKUP_SOURCE_CHANGED');
  // Read exactly the prechecked length. readFileSync could follow a growing
  // file past the disk/memory budget before a later manifest check rejects it.
  const bytes=Buffer.alloc(opened.size);let offset=0;
  while(offset<bytes.length){const count=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!count)captureFailure('BACKUP_SOURCE_CHANGED');offset+=count;}
  if(fs.readSync(fd,Buffer.alloc(1),0,1,opened.size)!==0)captureFailure('BACKUP_SOURCE_CHANGED');
  const after=fs.fstatSync(fd);let current;
  try{noSymlinkAncestors(file);current=fs.lstatSync(file);}catch{captureFailure('BACKUP_SOURCE_CHANGED');}
  if(!sameFile(opened,after)||!sameFile(opened,current))captureFailure('BACKUP_SOURCE_CHANGED');
  if(expected&&sha(bytes)!==expected.sha256)captureFailure('BACKUP_SOURCE_CHANGED');
  return bytes;
 }finally{fs.closeSync(fd);}
}
function backup(files,backupDir,options={}){
 if(!Array.isArray(files)||!files.length)throw Error('state files required');
 const {maxTotalBytes,expected}=captureOptions(options);
 const dir=path.resolve(backupDir);noSymlinkAncestors(dir);if(fs.existsSync(dir))throw Error('backup destination already exists');
 const seen=new Set(),records=[];const contents=[];let total=0;
 for(const file of files){const name=path.basename(file);if(!safeName(name)||name==='manifest.json'||seen.has(name))throw Error('unsafe or duplicate state filename');seen.add(name);if(expected&&!expected.has(name))captureFailure('BACKUP_EXPECTED_FILES_MISMATCH');const bytes=captureBytes(file,expected?.get(name),maxTotalBytes-total);total+=bytes.length;records.push({name,size:bytes.length,sha256:sha(bytes)});contents.push(bytes)}
 if(expected&&expected.size!==seen.size)captureFailure('BACKUP_EXPECTED_FILES_MISMATCH');
 fs.mkdirSync(dir,{recursive:false,mode:0o700});
 try{for(let i=0;i<records.length;i++)writeAtomic(path.join(dir,records[i].name),contents[i]);const manifest={schema:1,createdAt:new Date().toISOString(),files:records};writeAtomic(path.join(dir,'manifest.json'),Buffer.from(JSON.stringify(manifest,null,2)+'\n'));return manifest}
 catch(e){fs.rmSync(dir,{recursive:true,force:true});throw e}
}
function checkedBackupBytes(directory,item){
 try{return captureBytes(path.join(directory,item.name),item,item.size);}
 catch(error){throw Error('backup integrity mismatch: '+item.name,{cause:error});}
}
function verify(backupDir){
 const dir=path.resolve(backupDir),manifestFile=path.join(dir,'manifest.json');noSymlinkAncestors(dir);regularFile(manifestFile);
 const manifest=JSON.parse(captureBytes(manifestFile,null,64*1024*1024).toString('utf8'));if(manifest.schema!==1||!Array.isArray(manifest.files)||!manifest.files.length||typeof manifest.createdAt!=='string'||!Number.isFinite(Date.parse(manifest.createdAt))||new Date(manifest.createdAt).toISOString()!==manifest.createdAt)throw Error('invalid backup manifest');
 const seen=new Set();for(const item of manifest.files){if(!item||!safeName(item.name)||item.name==='manifest.json'||seen.has(item.name)||!Number.isSafeInteger(item.size)||item.size<0||item.size>64*1024*1024||typeof item.sha256!=='string'||!/^[a-f0-9]{64}$/.test(item.sha256))throw Error('unsafe or duplicate backup entry');seen.add(item.name);checkedBackupBytes(dir,item)}
 const actual=fs.readdirSync(dir).sort();const expected=['manifest.json',...seen].sort();if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('unexpected backup contents');
 return manifest;
}
function restore(backupDir,destination,{apply=false}={}){
 const manifest=verify(backupDir),dest=path.resolve(destination);
 noSymlinkAncestors(dest);if(path.relative(path.resolve(backupDir),dest)===''||!path.relative(path.resolve(backupDir),dest).startsWith('..'+path.sep)&&path.relative(path.resolve(backupDir),dest)!=='..')throw Error('restore destination overlaps backup');
 if(fs.existsSync(dest)&&(!fs.lstatSync(dest).isDirectory()||fs.readdirSync(dest).length))throw Error('restore destination must be empty');
 if(!apply)return {verified:true,restored:false,files:manifest.files.map(x=>x.name)};
 const parent=path.dirname(dest),base=path.basename(dest);fs.mkdirSync(parent,{recursive:true});noSymlinkAncestors(parent);
 const stage=path.join(parent,'.'+base+'.restore-'+crypto.randomBytes(8).toString('hex'));
 fs.mkdirSync(stage,{recursive:false,mode:0o700});
 try{
  // Verify each bounded read against the exact earlier manifest. A source
  // replaced after verify() must not be copied as an unchecked payload.
  for(const item of manifest.files)writeAtomic(path.join(stage,item.name),checkedBackupBytes(path.resolve(backupDir),item));
  const stagedNames=fs.readdirSync(stage).sort(),expected=manifest.files.map(x=>x.name).sort();
  if(JSON.stringify(stagedNames)!==JSON.stringify(expected))throw Error('staged restore contents mismatch');
  for(const item of manifest.files)checkedBackupBytes(stage,item);
  syncDirectory(stage);
  if(fs.existsSync(dest)){const st=fs.lstatSync(dest);if(st.isSymbolicLink()||!st.isDirectory()||fs.readdirSync(dest).length)throw Error('restore destination must be empty');fs.rmdirSync(dest)}
  fs.renameSync(stage,dest);syncDirectory(parent);
 }catch(e){fs.rmSync(stage,{recursive:true,force:true});throw e}
 return {verified:true,restored:true,files:manifest.files.map(x=>x.name)};
}
if(require.main===module){try{const [action,...args]=process.argv.slice(2);let result;if(action==='backup'&&args.length>=2)result=backup(args.slice(1),args[0]);else if(action==='verify'&&args.length===1)result=verify(args[0]);else if(action==='restore'&&(args.length===2||args.length===3&&args[2]==='--apply'))result=restore(args[0],args[1],{apply:args[2]==='--apply'});else throw Error('usage: backup <new-dir> <state-file...> | verify <backup-dir> | restore <backup-dir> <empty-dir> [--apply]');console.log(JSON.stringify(result,null,2))}catch(e){console.error(e.message);process.exitCode=1}}
module.exports={backup,verify,restore};
