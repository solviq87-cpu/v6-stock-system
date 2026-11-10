#!/usr/bin/env node
'use strict';
/** Pure private offline walk-forward read/preflight + opt-in immutable publish. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {auditSectorWalkForward}=require('../src/core/sector-walkforward-oos-audit');
const MAX=32*1024*1024;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function safePath(p){
 if(typeof p!=='string'||!path.isAbsolute(p)||p.includes('\0'))
  throw Error('研究文件必须是绝对路径');
 const full=path.resolve(p);
 if(full.split(path.sep).includes('public'))throw Error('禁止在公开静态目录存储研究文件');
 let at=path.parse(full).root;
 for(const part of full.slice(at.length).split(path.sep).filter(Boolean)){
  at=path.join(at,part);
  if(fs.existsSync(at)&&fs.lstatSync(at).isSymbolicLink())
   throw Error('研究路径禁止符号链接');
 }
 return full;
}
function parse(argv){
 const [mode,inputFile,outputFile,...rest]=argv||[];
 if(!['preview','publish'].includes(mode)||rest.length||
  typeof inputFile!=='string'||(mode==='publish'&&typeof outputFile!=='string')||
  (mode==='preview'&&outputFile!==undefined))
  throw Error('用法: sector-walkforward-oos-audit.js preview <已导入冻结观察组合JSON> | publish <已导入冻结观察组合JSON> <私有不可变报告JSON>');
 const input=safePath(inputFile),out=outputFile===undefined?null:safePath(outputFile);
 if(out&&(out===input||out.startsWith(input+path.sep)||
  input.startsWith(out+path.sep)))throw Error('研究输入和输出不得相互覆盖或嵌套');
 return {mode,input,out};
}
function readJson(file){
 const stat=fs.lstatSync(safePath(file));
 if(!stat.isFile()||stat.size<2||stat.size>MAX)
  throw Error('研究输入不是32MiB以内常规JSON');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
function immutable(file,body){
 file=safePath(file);const dir=path.dirname(file);
 if(Buffer.byteLength(body)>MAX)throw Error('研究报告超过32MiB');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});safePath(dir);
 const tmp=path.join(dir,'.oos-'+process.pid+'-'+crypto.randomBytes(8).toString('hex'));
 let fd;
 try{
  fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,body);fs.fsyncSync(fd);
  fs.closeSync(fd);fd=undefined;
  try{fs.linkSync(tmp,file);}
  catch(e){
   if(e.code!=='EEXIST')throw e;
   const stat=fs.lstatSync(file);
   if(!stat.isFile()||stat.size>MAX||fs.readFileSync(file,'utf8')!==body)
    throw Error('已有不同内容的样本外审计报告，拒绝覆盖');
   return false;
  }
  const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
  return true;
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch{}}
}
function runOnce(config){
 const input=readJson(config.input);
 if(input?.schemaVersion!==1||input.mode!=='sector-walkforward-oos-input')
  throw Error('研究输入协议不符合样本外观察审计');
 const {schemaVersion,mode,...options}=input;
 const report=auditSectorWalkForward(options);
 const summary={status:report.status,reason:report.reason||null,
  cohortCount:report.cohortCount||0,
  panels:report.panels?.map(p=>({sessions:p.sessions,status:p.status,
   trainCount:p.trainCount,testCount:p.testCount,
   purgedTrainCount:p.purgedTrainDates?.length||0}))||[],
  outOfSampleValidated:false,canTrain:false,canTrade:false,weightsChanged:false};
 if(config.mode==='preview'||report.status==='blocked')
  return {...summary,changed:false};
 const record={schemaVersion:1,mode:'immutable-sector-walkforward-descriptive-audit',
  sourceFingerprint:hash(input),report,
  canTrain:false,canTrade:false,verifiedLive:false};
 const body=JSON.stringify({...record,integrity:hash(record)})+'\n';
 return {...summary,changed:immutable(config.out,body)};
}
function main(argv=process.argv.slice(2)){return runOnce(parse(argv));}
if(require.main===module){
 try{
  const r=main();console.log(JSON.stringify(r));
  if(r.status==='blocked')process.exitCode=2;
 }catch(e){
  console.error(JSON.stringify({status:'failed-stop-and-audit',
   canTrain:false,canTrade:false}));process.exitCode=1;
 }
}
module.exports={parse,readJson,runOnce,main};
