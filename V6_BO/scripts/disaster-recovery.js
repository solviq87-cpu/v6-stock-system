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
function backup(files,backupDir){
 if(!Array.isArray(files)||!files.length)throw Error('state files required');
 const dir=path.resolve(backupDir);noSymlinkAncestors(dir);if(fs.existsSync(dir))throw Error('backup destination already exists');
 const seen=new Set(),records=[];const contents=[];
 for(const file of files){const name=path.basename(file);if(!safeName(name)||name==='manifest.json'||seen.has(name))throw Error('unsafe or duplicate state filename');seen.add(name);regularFile(file);const bytes=fs.readFileSync(file);records.push({name,size:bytes.length,sha256:sha(bytes)});contents.push(bytes)}
 fs.mkdirSync(dir,{recursive:false,mode:0o700});
 try{for(let i=0;i<records.length;i++)writeAtomic(path.join(dir,records[i].name),contents[i]);const manifest={schema:1,createdAt:new Date().toISOString(),files:records};writeAtomic(path.join(dir,'manifest.json'),Buffer.from(JSON.stringify(manifest,null,2)+'\n'));return manifest}
 catch(e){fs.rmSync(dir,{recursive:true,force:true});throw e}
}
function verify(backupDir){
 const dir=path.resolve(backupDir),manifestFile=path.join(dir,'manifest.json');noSymlinkAncestors(dir);regularFile(manifestFile);
 const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));if(manifest.schema!==1||!Array.isArray(manifest.files)||!manifest.files.length||typeof manifest.createdAt!=='string'||!Number.isFinite(Date.parse(manifest.createdAt))||new Date(manifest.createdAt).toISOString()!==manifest.createdAt)throw Error('invalid backup manifest');
 const seen=new Set();for(const item of manifest.files){if(!item||!safeName(item.name)||item.name==='manifest.json'||seen.has(item.name)||!Number.isSafeInteger(item.size)||item.size<0||item.size>64*1024*1024||typeof item.sha256!=='string'||!/^[a-f0-9]{64}$/.test(item.sha256))throw Error('unsafe or duplicate backup entry');seen.add(item.name);const file=path.join(dir,item.name);const stat=regularFile(file);if(stat.size!==item.size||sha(fs.readFileSync(file))!==item.sha256)throw Error('backup integrity mismatch: '+item.name)}
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
  for(const item of manifest.files)writeAtomic(path.join(stage,item.name),fs.readFileSync(path.join(backupDir,item.name)));
  const stagedNames=fs.readdirSync(stage).sort(),expected=manifest.files.map(x=>x.name).sort();
  if(JSON.stringify(stagedNames)!==JSON.stringify(expected))throw Error('staged restore contents mismatch');
  syncDirectory(stage);
  if(fs.existsSync(dest)){const st=fs.lstatSync(dest);if(st.isSymbolicLink()||!st.isDirectory()||fs.readdirSync(dest).length)throw Error('restore destination must be empty');fs.rmdirSync(dest)}
  fs.renameSync(stage,dest);syncDirectory(parent);
 }catch(e){fs.rmSync(stage,{recursive:true,force:true});throw e}
 return {verified:true,restored:true,files:manifest.files.map(x=>x.name)};
}
if(require.main===module){try{const [action,...args]=process.argv.slice(2);let result;if(action==='backup'&&args.length>=2)result=backup(args.slice(1),args[0]);else if(action==='verify'&&args.length===1)result=verify(args[0]);else if(action==='restore'&&(args.length===2||args.length===3&&args[2]==='--apply'))result=restore(args[0],args[1],{apply:args[2]==='--apply'});else throw Error('usage: backup <new-dir> <state-file...> | verify <backup-dir> | restore <backup-dir> <empty-dir> [--apply]');console.log(JSON.stringify(result,null,2))}catch(e){console.error(e.message);process.exitCode=1}}
module.exports={backup,verify,restore};
