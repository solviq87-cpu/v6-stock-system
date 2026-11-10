#!/usr/bin/env node
'use strict';
/**
 * Offline, read-only preview and explicit immutable private publication of
 * supplier-adjusted sector / benchmark evidence reconciliation.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {reconcileSectorAdjusted}=require('../src/core/sector-adjusted-benchmark-reconcile');
const MAX=32*1024*1024;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function safePath(p){
 if(typeof p!=='string'||!path.isAbsolute(p)||p.includes('\0'))
  throw Error('研究文件必须为私有绝对路径');
 const full=path.resolve(p);
 if(full.split(path.sep).includes('public'))throw Error('不能访问或写入公开静态目录');
 let at=path.parse(full).root;
 for(const name of full.slice(at.length).split(path.sep).filter(Boolean)){
  at=path.join(at,name);
  if(fs.existsSync(at)&&fs.lstatSync(at).isSymbolicLink())
   throw Error('证据路径禁止符号链接');
 }
 return full;
}
function parse(argv){
 const [mode,inputFile,outputFile,...rest]=argv||[];
 if(!['preview','publish'].includes(mode)||typeof inputFile!=='string'||rest.length||
  (mode==='preview'&&outputFile!==undefined)||
  (mode==='publish'&&typeof outputFile!=='string'))
  throw Error('用法: sector-adjusted-benchmark-audit.js preview <全部私有研究证据JSON> | publish <全部私有研究证据JSON> <私有不可变报告JSON>');
 const input=safePath(inputFile),output=outputFile===undefined?null:safePath(outputFile);
 if(output&&(input===output||output.startsWith(input+path.sep)||
  input.startsWith(output+path.sep)))
  throw Error('输入和输出不得互相覆盖或嵌套');
 return {mode,input,output};
}
function read(file){
 const stat=fs.lstatSync(safePath(file));
 if(!stat.isFile()||stat.size<2||stat.size>MAX)throw Error('审计输入不是限定大小的普通JSON');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
function immutable(file,body){
 file=safePath(file);
 if(Buffer.byteLength(body)>MAX)throw Error('审计报告超限');
 const dir=path.dirname(file);
 fs.mkdirSync(dir,{recursive:true,mode:0o700});safePath(dir);
 const stage=path.join(dir,'.adjusted-sector-'+process.pid+'-'+crypto.randomBytes(8).toString('hex'));
 let fd;
 try{
  fd=fs.openSync(stage,'wx',0o600);
  fs.writeFileSync(fd,body);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  try{fs.linkSync(stage,file);}
  catch(e){
   if(e.code!=='EEXIST')throw e;
   const st=fs.lstatSync(file);
   if(!st.isFile()||st.size>MAX||fs.readFileSync(file,'utf8')!==body)
    throw Error('同一报告位置已有不同证据，拒绝覆盖');
   return false;
  }
  const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
  return true;
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(stage);}catch{}}
}
function runOnce(conf,{now=Date.now()}={}){
 const src=read(conf.input);
 if(src?.schemaVersion!==1||src.mode!=='imported-sector-adjusted-benchmark-bundle'||
  src.source!=='imported'||!Number.isSafeInteger(src.asOf)||src.asOf>now||
  src.asOf<=0)
  return {status:'blocked-input-contract',canTrade:false,canTrain:false,changed:false};
 const {schemaVersion,mode,source,...inputs}=src;
 const report=reconcileSectorAdjusted(inputs);
 const summary={status:report.status,reason:report.reason||null,
  tradeDate:report.tradeDate||null,
  horizons:report.horizons?.map(h=>({sessions:h.sessions,status:h.status,
   observedSectorCount:h.observedSectorCount}))||[],
  canTrain:false,canTrade:false,verifiedLive:false,
  outOfSampleValidated:false,changed:false};
 if(conf.mode==='preview'||report.status==='blocked'||report.status==='insufficient-evidence')
  return summary;
 const record={schemaVersion:1,mode:'immutable-sector-adjusted-benchmark-research',
  inputFingerprint:hash(src),report,canTrain:false,canTrade:false,verifiedLive:false};
 const body=JSON.stringify({...record,integrity:hash(record)})+'\n';
 return {...summary,changed:immutable(conf.output,body)};
}
function main(argv=process.argv.slice(2),deps){return runOnce(parse(argv),deps);}
if(require.main===module){
 try{
  const result=main();console.log(JSON.stringify(result));
  if(result.status.startsWith('blocked'))process.exitCode=2;
 }catch(e){
  console.error(JSON.stringify({status:'failed-stop-and-audit',
   canTrade:false,canTrain:false}));process.exitCode=1;
 }
}
module.exports={parse,read,runOnce,main};
