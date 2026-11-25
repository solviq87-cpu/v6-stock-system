'use strict';
const fs=require('node:fs'),{spawnSync}=require('node:child_process');
/** Stable Linux kernel guard shared by the original account and transaction writers.
 * The parent retains the open file description after flock exits. Never unlink the guard. */
function acquireAccountGuard(file,message='账户正在处理其他请求'){
 const flags=fs.constants.O_CREAT|fs.constants.O_RDWR|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0);
 const fd=fs.openSync(file+'.guard',flags,0o600);
 try{
  if(!fs.fstatSync(fd).isFile())throw Error('账户锁路径无效');
  const result=spawnSync('flock',['-n','3'],{stdio:['ignore','ignore','ignore',fd],timeout:5000});
  if(result.error)throw Error('账户锁需要可用的系统util-linux flock工具');
  if(result.status!==0)throw Error(message);
  return fd;
 }catch(error){fs.closeSync(fd);throw error;}
}
function oldLockExists(file){
 try{fs.lstatSync(file+'.lock');return true;}
 catch(error){if(error.code==='ENOENT')return false;throw error;}
}
function withAccountLock(file,operation){
 if(oldLockExists(file))throw Error('账户正在处理其他请求或存在旧锁，需离线核验');
 const fd=acquireAccountGuard(file);
 try{
  if(oldLockExists(file))throw Error('账户正在处理其他请求或存在旧锁，需离线核验');
  return operation();
 }finally{fs.closeSync(fd);}
}
module.exports={withAccountLock,acquireAccountGuard};
