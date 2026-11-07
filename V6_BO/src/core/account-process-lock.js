'use strict';
const fs=require('node:fs'),{spawnSync}=require('node:child_process');
/** Linux kernel lock survives the flock helper exit through the shared descriptor,
 * and is automatically released even if the Node writer is killed. */
function withAccountLock(file,operation){
 if(fs.existsSync(file+'.lock'))throw Error('账户正在处理其他请求或存在旧锁，需离线核验');
 const flags=fs.constants.O_CREAT|fs.constants.O_RDWR|(fs.constants.O_NOFOLLOW||0);
 const fd=fs.openSync(file+'.guard',flags,0o600);
 try{
  if(!fs.fstatSync(fd).isFile())throw Error('账户锁路径无效');
  const result=spawnSync('flock',['-n','3'],{stdio:['ignore','pipe','pipe',fd]});
  if(result.error)throw Error('账户锁需要系统util-linux flock工具');
  if(result.status!==0)throw Error('账户正在处理其他请求');
  return operation();
 }finally{fs.closeSync(fd);}
}
module.exports={withAccountLock};
