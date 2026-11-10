#!/usr/bin/env node
'use strict';
/** Offline pair-quality preview or explicit private, immutable audit publication. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {auditSectorPairQuality}=require('../src/core/sector-provider-pair-rolling-quality');
const MAX=32*1024*1024;
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function safe(p){
 if(typeof p!=='string'||!path.isAbsolute(p)||p.includes('\0'))
  throw Error('跨日研究必须使用私有绝对路径');
 const full=path.resolve(p);
 if(full.split(path.sep).includes('public'))
  throw Error('私有跨日证据不得存入公开静态目录');
 let part=path.parse(full).root;
 for(const name of full.slice(part.length).split(path.sep).filter(Boolean)){
  part=path.join(part,name);
  if(fs.existsSync(part)&&fs.lstatSync(part).isSymbolicLink())
   throw Error('证据路径不允许符号链接');
 }
 return full;
}
function parse(argv){
 const [mode,inputFile,outputFile,...extra]=argv||[];
 if(!['preview','publish'].includes(mode)||typeof inputFile!=='string'||extra.length||
  (mode==='preview'&&outputFile!==undefined)||
  (mode==='publish'&&typeof outputFile!=='string'))
  throw Error('用法: sector-provider-pair-quality.js preview <私有信号日列表与双源归档JSON> | publish <私有信号日列表与双源归档JSON> <私有不可覆盖报告JSON>');
 const input=safe(inputFile),output=outputFile===undefined?null:safe(outputFile);
 if(output&&(output===input||output.startsWith(input+path.sep)||
  input.startsWith(output+path.sep)))throw Error('研究输入与报告不能重叠');
 return {mode,input,output};
}
function read(file){
 const st=fs.lstatSync(safe(file));
 if(!st.isFile()||st.size<2||st.size>MAX)throw Error('必须导入32MiB以内的常规JSON证据');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
function immutable(file,raw){
 file=safe(file);
 if(Buffer.byteLength(raw)>MAX)throw Error('研究报告超过32MiB');
 const dir=path.dirname(file);
 fs.mkdirSync(dir,{recursive:true,mode:0o700});safe(dir);
 const tmp=path.join(dir,'.pair-quality-'+process.pid+'-'+crypto.randomBytes(8).toString('hex'));
 let fd;
 try{
  fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,raw);fs.fsyncSync(fd);
  fs.closeSync(fd);fd=undefined;
  try{fs.linkSync(tmp,file);}catch(e){
   if(e.code!=='EEXIST')throw e;
   const stat=fs.lstatSync(file);
   if(!stat.isFile()||stat.size>MAX||fs.readFileSync(file,'utf8')!==raw)
    throw Error('已有同名不同内容的跨日质量报告，拒绝覆盖');
   return false;
  }
  const parent=fs.openSync(dir,'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
  return true;
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch{}}
}
function runOnce(conf,{now=Date.now()}={}){
 const b=read(conf.input);
 if(b?.schemaVersion!==1||b.mode!=='sector-provider-pair-quality-imported-input'||
  b.source!=='imported'||!Number.isSafeInteger(b.asOf)||b.asOf<=0||b.asOf>now)
  return {status:'blocked-input-contract',changed:false,canTrain:false,canTrade:false};
 const {schemaVersion,mode,source,...data}=b;
 const report=auditSectorPairQuality(data);
 const result={status:report.status,reason:report.reason||null,
  receivedEpisodeCount:report.receivedEpisodeCount||0,
  windows:report.horizons.map(h=>({
   sessions:h.sessions,status:h.status,
   maturedSignalDays:h.maturedSignalDays,
   comparableRatePct:h.comparableRatePct,
   disagreementRatePct:h.disagreementRatePct,
   nonComparableRatePct:h.nonComparableRatePct
  })),changed:false,canTrain:false,canTrade:false,outOfSampleValidated:false};
 if(conf.mode==='preview'||report.status==='blocked'||report.status==='insufficient-evidence')
  return result;
 const record={schemaVersion:1,mode:'immutable-sector-provider-pair-quality-research',
  inputFingerprint:sha(b),report,canTrade:false,canTrain:false,
  verifiedLive:false};
 const raw=JSON.stringify({...record,integrity:sha(record)})+'\n';
 return {...result,changed:immutable(conf.output,raw)};
}
function main(argv=process.argv.slice(2),deps){return runOnce(parse(argv),deps);}
if(require.main===module){
 try{
  const result=main();console.log(JSON.stringify(result));
  if(result.status.startsWith('blocked'))process.exitCode=2;
 }catch{
  console.error(JSON.stringify({status:'failed-stop-and-audit',
   canTrade:false,canTrain:false}));process.exitCode=1;
 }
}
module.exports={parse,read,runOnce,main};
