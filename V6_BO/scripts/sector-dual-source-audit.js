#!/usr/bin/env node
'use strict';
/** No network. Default preview is read-only; publication is private/immutable. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {auditSectorDualSource}=require('../src/core/sector-dual-adjusted-source-audit');
const MAX=32*1024*1024;
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function safe(p){
 if(typeof p!=='string'||!path.isAbsolute(p)||p.includes('\0'))
  throw Error('研究路径必须为绝对路径');
 const full=path.resolve(p);
 if(full.split(path.sep).includes('public'))throw Error('研究数据禁止放在公开静态目录');
 let at=path.parse(full).root;
 for(const part of full.slice(at.length).split(path.sep).filter(Boolean)){
  at=path.join(at,part);
  if(fs.existsSync(at)&&fs.lstatSync(at).isSymbolicLink())
   throw Error('研究路径禁止符号链接');
 }
 return full;
}
function parse(argv){
 const [mode,inputPath,outputPath,...extra]=argv||[];
 if(!['preview','publish'].includes(mode)||typeof inputPath!=='string'||extra.length||
   (mode==='preview'&&outputPath!==undefined)||
   (mode==='publish'&&typeof outputPath!=='string'))
  throw Error('用法: sector-dual-source-audit.js preview <私有双源证据JSON> | publish <私有双源证据JSON> <私有不可覆盖报告JSON>');
 const input=safe(inputPath),output=outputPath===undefined?null:safe(outputPath);
 if(output&&(output===input||output.startsWith(input+path.sep)||
  input.startsWith(output+path.sep)))
  throw Error('报告不得覆盖或嵌套输入');
 return {mode,input,output};
}
function read(p){
 const st=fs.lstatSync(safe(p));
 if(!st.isFile()||st.size<2||st.size>MAX)throw Error('证据必须是32MiB以内普通JSON');
 return JSON.parse(fs.readFileSync(p,'utf8'));
}
function immutable(file,body){
 file=safe(file);if(Buffer.byteLength(body)>MAX)throw Error('审计记录超限');
 const dir=path.dirname(file);fs.mkdirSync(dir,{recursive:true,mode:0o700});safe(dir);
 const stage=path.join(dir,'.dual-adjusted-'+process.pid+'-'+crypto.randomBytes(8).toString('hex'));
 let fd;
 try{
  fd=fs.openSync(stage,'wx',0o600);fs.writeFileSync(fd,body);fs.fsyncSync(fd);
  fs.closeSync(fd);fd=undefined;
  try{fs.linkSync(stage,file);}
  catch(e){
   if(e.code!=='EEXIST')throw e;
   const stat=fs.lstatSync(file);
   if(!stat.isFile()||stat.size>MAX||fs.readFileSync(file,'utf8')!==body)
    throw Error('同一报告已存在不同内容，拒绝覆盖');
   return false;
  }
  const parent=fs.openSync(dir,'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
  return true;
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(stage);}catch{}}
}
function runOnce(conf,{now=Date.now()}={}){
 const bundle=read(conf.input);
 if(bundle?.schemaVersion!==1||bundle.mode!=='sector-dual-source-imported-evidence'||
  bundle.source!=='imported'||!Number.isSafeInteger(bundle.asOf)||
  bundle.asOf<=0||bundle.asOf>now)
  return {status:'blocked-input-contract',changed:false,canTrain:false,canTrade:false};
 const {schemaVersion,mode,source,...fields}=bundle;
 const report=auditSectorDualSource(fields);
 const summary={status:report.status,reason:report.reason||null,
  tradeDate:report.tradeDate||null,windows:report.horizons.map(h=>({
   sessions:h.sessions,status:h.status,agreedSectors:h.agreedSectors,
   disagreeingSectors:h.disagreeingSectors,unknownSectors:h.unknownSectors})),
  outOfSampleValidated:false,canTrain:false,canTrade:false,changed:false};
 if(conf.mode==='preview'||report.status==='blocked'||report.status==='insufficient-evidence')
  return summary;
 const record={schemaVersion:1,mode:'immutable-sector-dual-source-research',
  inputFingerprint:digest(bundle),report,
  canTrain:false,canTrade:false,verifiedLive:false};
 const raw=JSON.stringify({...record,integrity:digest(record)})+'\n';
 return {...summary,changed:immutable(conf.output,raw)};
}
function main(argv=process.argv.slice(2),options){return runOnce(parse(argv),options);}
if(require.main===module){
 try{
  const result=main();console.log(JSON.stringify(result));
  if(result.status.startsWith('blocked'))process.exitCode=2;
 }catch{
  console.error(JSON.stringify({status:'failed-stop-and-audit',
   canTrain:false,canTrade:false}));process.exitCode=1;
 }
}
module.exports={parse,read,runOnce,main};
