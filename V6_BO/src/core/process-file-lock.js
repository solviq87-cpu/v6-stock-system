'use strict';
const fs=require('node:fs');
function acquireProcessLock(lockPath, message='资源正在被其他进程更新，拒绝并发写入'){
  let fd;
  try { fd=fs.openSync(lockPath,'wx',0o600); }
  catch(e){
    if(e.code!=='EEXIST') throw e;
    let owner;
    try { owner=JSON.parse(fs.readFileSync(lockPath,'utf8')); }
    catch(_) { throw new Error('发现无法核验的旧锁文件，拒绝自动清理'); }
    if(!owner||!Number.isSafeInteger(owner.pid)||owner.pid<=0) throw new Error('发现无法核验的旧锁文件，拒绝自动清理');
    try { process.kill(owner.pid,0); throw new Error(message); }
    catch(probe){
      if(probe.code!=='ESRCH') throw probe;
    }
    // The owner process is gone. Exclusive recreation below resolves competing recoverers.
    try { fs.unlinkSync(lockPath); }
    catch(unlinkError){ if(unlinkError.code!=='ENOENT') throw unlinkError; }
    fd=fs.openSync(lockPath,'wx',0o600);
  }
  try {
    fs.writeFileSync(fd,JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));
    fs.fsyncSync(fd);
    return fd;
  } catch(e) {
    try{fs.closeSync(fd);}catch(_){}
    try{fs.unlinkSync(lockPath);}catch(_){}
    throw e;
  }
}
function releaseProcessLock(fd,lockPath){
  try{fs.closeSync(fd);}catch(_){}
  try{fs.unlinkSync(lockPath);}catch(_){}
}
module.exports={acquireProcessLock,releaseProcessLock};
