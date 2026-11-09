#!/usr/bin/env node
'use strict';
// Explicit operator-controlled offline handoff. No token handling, network,
// hidden HTTP requests, order writes, market collection or running scheduler.
const fs=require('node:fs'),path=require('node:path');
const {readJson}=require('../src/core/forward-tracking-store');
const {freezeCurrentPicks}=require('../src/core/quant-picks-eod-freeze');
function privateOutput(file){
 if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0'))
  throw Error('输出必须为私有绝对路径');
 const target=path.resolve(file);
 if(target.split(path.sep).includes('public'))throw Error('禁止向公开静态目录发布冻结信号');
 const dir=path.dirname(target);
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 let cursor=path.parse(target).root;
 for(const part of target.slice(cursor.length).split(path.sep).filter(Boolean)){
  cursor=path.join(cursor,part);
  try{if(fs.lstatSync(cursor).isSymbolicLink())throw Error('路径包含符号链接');}
  catch(e){if(e.code!=='ENOENT')throw e;}
 }
 return target;
}
function publish({candidatesFile,marketFile,outFile,now=Date.now()}){
 // Candidate evidence and the permitted EOD market file are independent inputs.
 // All local files are private and have the same safeguards as existing store.
 const candidates=readJson(candidatesFile),market=readJson(marketFile);
 const frozen=freezeCurrentPicks(candidates,market,{now});
 const target=privateOutput(outFile),dir=path.dirname(target);
 const stage=fs.mkdtempSync(path.join(dir,'.quant-picks-freeze-'));
 try{
  const temp=path.join(stage,'cohort.json');
  const fd=fs.openSync(temp,'wx',0o600);
  try{
   fs.writeFileSync(fd,JSON.stringify(frozen,null,2)+'\n');
   fs.fsyncSync(fd);
  }finally{fs.closeSync(fd);}
  // Atomic "publish if absent": never replace or reinterpret an older cohort.
  fs.linkSync(temp,target);
  const directory=fs.openSync(dir,'r');
  try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
 }finally{fs.rmSync(stage,{recursive:true,force:true});}
 return {ok:true,mode:'frozen-quant-picks-eod',signalCount:frozen.signals.length,
  frozenAt:frozen.frozenAt,fingerprint:frozen.fingerprint,canTrade:false,
  prospectiveCertified:false};
}
function main(args){
 if(args.length!==3)throw Error('用法: freeze-quant-picks.js <同日选股快照私有JSON> <授权收盘行情私有JSON> <新的冻结信号私有绝对路径>');
 return publish({candidatesFile:args[0],marketFile:args[1],outFile:args[2]});
}
if(require.main===module){
 try{process.stdout.write(JSON.stringify(main(process.argv.slice(2)))+'\n');}
 catch(error){process.stderr.write(JSON.stringify({ok:false,error:String(error.message).slice(0,220)})+'\n');process.exitCode=1;}
}
module.exports={publish,main};
