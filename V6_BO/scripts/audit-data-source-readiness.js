#!/usr/bin/env node
'use strict';
/**
 * No network, no retries, no data-source enablement, no account mutations.
 * Use a SAVED one-shot public-quote-endpoint-health JSON from a private path.
 * Without a file, the report explicitly has zero live observations.
 */
const fs=require('node:fs'),path=require('node:path');
const {auditRegisteredSourceReadiness,auditRuntimeSourceUsage}=require('../src/core/data-source-readiness-audit');
const MAX_BYTES=128*1024;
function privateFile(filename){
 if(typeof filename!=='string'||!filename||/^[a-z][a-z0-9+.-]*:/i.test(filename))
  throw Error('输入须为本地私有JSON文件');
 const absolute=path.resolve(filename);
 const parts=absolute.split(path.sep);
 if(parts.some(p=>p.toLowerCase()==='public'))
  throw Error('禁止读取公开目录中的行情证据');
 let current=path.parse(absolute).root;
 for(const part of absolute.slice(current.length).split(path.sep)){
  if(!part)continue;
  current=path.join(current,part);
  const st=fs.lstatSync(current);
  if(st.isSymbolicLink())throw Error('拒绝符号链接证据文件和路径');
 }
 const fd=fs.openSync(absolute,fs.constants.O_RDONLY|
  fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const before=fs.fstatSync(fd);
  if(!before.isFile()||before.size<2||before.size>MAX_BYTES)
   throw Error('证据文件不是有界普通JSON文件');
  const buf=Buffer.alloc(before.size+1);
  let n=0,read;
  while(n<buf.length&&(read=fs.readSync(fd,buf,n,buf.length-n,null))>0)n+=read;
  const after=fs.fstatSync(fd);
  if(n!==before.size||after.size!==before.size||
     before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)
   throw Error('读取期间证据文件被修改');
  return JSON.parse(buf.subarray(0,n).toString('utf8'));
 }finally{fs.closeSync(fd);}
}
function run(argv=process.argv.slice(2),now=Date.now()){
 if(!Array.isArray(argv)||argv.length>1)
  throw Error('用法: audit-data-source-readiness.js [私有单次行情健康快照.json]');
 const snapshot=argv.length?privateFile(argv[0]):undefined;
 return auditRegisteredSourceReadiness({asOf:now,snapshot});
}
async function runWithRuntime(argv=process.argv.slice(2),now=Date.now()){
 if(argv[0]!=='--runtime-root')return run(argv,now);
 if(argv.length<2||argv.length>3)throw Error('用法: audit-data-source-readiness.js --runtime-root 私有运行目录 [私有单次行情健康快照.json]');
 return auditRuntimeSourceUsage({asOf:now,runtimeRoot:argv[1],snapshot:argv.length===3?privateFile(argv[2]):undefined});
}
if(require.main===module){
 runWithRuntime().then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n')).catch(()=>{
  console.error('数据源审核失败：私有证据格式、时间或文件访问不合法');process.exitCode=2;});
}
module.exports={run,privateFile,runWithRuntime};
