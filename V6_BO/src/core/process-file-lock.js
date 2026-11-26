'use strict';
const fs=require('node:fs'),path=require('node:path');
const {acquireAccountGuard}=require('./account-process-lock');
// The PID marker is kept for old-lock evidence and compatibility; the stable
// kernel guard serializes every new acquisition/recovery and release. Old
// processes must be stopped before deploying this protocol, as before upgrades.
const live=new WeakMap();
function sameMarker(lockPath,stat){
 try{const current=fs.lstatSync(lockPath);return current.isFile()&&!current.isSymbolicLink()&&current.dev===stat.dev&&current.ino===stat.ino;}
 catch(error){if(error.code==='ENOENT')return false;throw error;}
}
function readOldMarker(lockPath){
 let fd;
 try{
  fd=fs.openSync(lockPath,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.size<1||stat.size>4096)throw Error('invalid marker');
  const owner=JSON.parse(fs.readFileSync(fd,'utf8'));
  if(!owner||!Number.isSafeInteger(owner.pid)||owner.pid<=0)throw Error('invalid pid');
  return {owner,stat};
 }catch{throw Error('发现无法核验的旧锁文件，拒绝自动清理');}
 finally{if(fd!==undefined)fs.closeSync(fd);}
}
function acquireProcessLock(lockPath,message='资源正在被其他进程更新，拒绝并发写入'){
 lockPath=path.resolve(lockPath);
 if(!lockPath.endsWith('.lock'))throw Error('锁路径必须使用原 .lock 后缀');
 const guard=acquireAccountGuard(lockPath.slice(0,-5),message);
 let marker,stat;
 const create=()=>fs.openSync(lockPath,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|(fs.constants.O_NOFOLLOW||0),0o600);
 try{
  try{marker=create();}
  catch(error){
   if(error.code!=='EEXIST')throw error;
   const old=readOldMarker(lockPath);
   try{process.kill(old.owner.pid,0);throw Error(message);}
   catch(probe){if(probe.code!=='ESRCH')throw probe;}
   // Do not unlink a different inode, even if an unexpected old writer exists.
   if(!sameMarker(lockPath,old.stat))throw Error('旧锁证据已变化，拒绝自动清理');
   fs.unlinkSync(lockPath);
   marker=create();
  }
  stat=fs.fstatSync(marker);
  fs.writeFileSync(marker,JSON.stringify({pid:process.pid,createdAt:new Date().toISOString(),protocol:'kernel-guard-v1'}));
  fs.fsyncSync(marker);
  const handle=Object.freeze({});live.set(handle,{lockPath,guard,marker,stat});return handle;
 }catch(error){
  if(marker!==undefined){
   try{if(stat&&sameMarker(lockPath,stat))fs.unlinkSync(lockPath);}catch{}
   try{fs.closeSync(marker);}catch{}
  }
  fs.closeSync(guard);throw error;
 }
}
function releaseProcessLock(handle,lockPath){
 const state=handle&&live.get(handle);
 if(!state||typeof lockPath!=='string'||path.resolve(lockPath)!==state.lockPath)return false;
 live.delete(handle);
 let removed=false;
 try{if(sameMarker(state.lockPath,state.stat)){fs.unlinkSync(state.lockPath);removed=true;}}catch{}
 finally{try{fs.closeSync(state.marker);}finally{fs.closeSync(state.guard);}}
 // A missing/replaced/unremovable marker is not silently removed; its evidence
 // remains for offline review. The guard is always released last.
 return removed;
}
module.exports={acquireProcessLock,releaseProcessLock};
