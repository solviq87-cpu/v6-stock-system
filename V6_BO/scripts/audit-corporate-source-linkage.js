#!/usr/bin/env node
'use strict';
// Local-only read-only source-to-settlement audit. No network, trade, or account mutation.
const fs=require('node:fs'),path=require('node:path');
const {auditCorporateSourceLinkage}=require('../src/core/corporate-source-linkage');
const MAX_FILE=25*1024*1024;
function securePath(file){
 if(typeof file!=='string'||!path.isAbsolute(file)||
    file.split(/[\\/]/).some(part=>part.toLowerCase()==='public'))
  throw Error('只允许私有绝对路径，不允许 public 目录');
 const full=path.resolve(file),root=path.parse(full).root;
 let current=root;
 for(const part of full.slice(root.length).split(path.sep)){
  if(!part)continue;
  current=path.join(current,part);
  if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())
   throw Error('输入与输出不允许符号链接或链接祖先目录');
 }
 return full;
}
function read(file){
 const p=securePath(file),stat=fs.lstatSync(p);
 if(!stat.isFile()||stat.size>MAX_FILE||stat.size<2)
  throw Error('原始证据必须是25MiB以内的普通私有文件');
 const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const info=fs.fstatSync(fd);
  if(!info.isFile()||info.size>MAX_FILE)throw Error('原始证据超限');
  return JSON.parse(fs.readFileSync(fd,'utf8'));
 }finally{fs.closeSync(fd);}
}
function run(argv){
 if(!Array.isArray(argv)||argv.length!==4)
  throw Error('用法：audit-corporate-source-linkage.js <私有采集归档.json> <结算清单.json> <新审计报告.json> <核验时钟ms>');
 const [source,events,out,instant]=argv,dest=securePath(out),now=Number(instant);
 if(!Number.isSafeInteger(now)||now<=0)throw Error('核验时钟无效');
 if([securePath(source),securePath(events)].includes(dest))
  throw Error('源证据与输出文件不能相同');
 const report=auditCorporateSourceLinkage({capture:read(source),settlements:read(events),now});
 if(!Array.isArray(report.bySettlement)||report.canTrade!==false)
  throw Error('只允许研究级只读审计输出');
 const parent=path.dirname(dest),st=fs.lstatSync(parent);
 if(!st.isDirectory()||st.isSymbolicLink())throw Error('输出目录必须是已有的私有非链接目录');
 let fd;
 try{
  fd=fs.openSync(dest,'wx',0o600);
  fs.writeFileSync(fd,JSON.stringify(report,null,2)+'\n');
  fs.fsyncSync(fd);
 }finally{if(fd!==undefined)fs.closeSync(fd);}
 return {ok:true,output:dest,status:report.status,canTrade:false};
}
if(require.main===module){
 try{console.log(JSON.stringify(run(process.argv.slice(2))));}
 catch(err){console.error(String(err.message||err).slice(0,220));process.exitCode=1;}
}
module.exports={run};
