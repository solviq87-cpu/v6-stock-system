#!/usr/bin/env node
'use strict';
/**
 * Offline, read-only input CLI for the temporal leakage audit.
 * Only optional publication is to an immutable private diagnostic file.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {auditSectorWalkForward}=require('../src/core/sector-walkforward-leakage-audit');
const MAX=32*1024*1024;
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function local(p){
 if(typeof p!=='string'||!path.isAbsolute(p)||p.includes('\0'))
  throw Error('研究数据必须使用私有绝对路径');
 const full=path.resolve(p);
 if(full.split(path.sep).includes('public'))throw Error('禁止写入或读取公开静态目录');
 let cursor=path.parse(full).root;
 for(const piece of full.slice(cursor.length).split(path.sep).filter(Boolean)){
  cursor=path.join(cursor,piece);
  if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink())
   throw Error('私有数据路径禁止符号链接');
 }
 return full;
}
function parse(argv){
 if(!Array.isArray(argv)||argv.length!==4||argv[0]!=='audit')
  throw Error('用法: sector-walkforward-audit.js audit <导入的冻结样本及观察JSON> <明确日期拆分JSON> <私有审计输出JSON>');
 const [episodesFile,splitFile,outputFile]=argv.slice(1).map(local);
 const all=[episodesFile,splitFile,outputFile];
 if(new Set(all).size!==3||all.some((p,i)=>all.some((q,j)=>
   i!==j&&(p.startsWith(q+path.sep)||q.startsWith(p+path.sep)))))
  throw Error('输入和研究输出文件不能重叠或互相嵌套');
 return {episodesFile,splitFile,outputFile};
}
function read(file){
 const stat=fs.lstatSync(local(file));
 if(!stat.isFile()||stat.size<1||stat.size>MAX)throw Error('导入JSON文件类型或大小无效');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
function immutable(file,body){
 file=local(file);
 if(Buffer.byteLength(body)>MAX)throw Error('审计结果超出限制');
 const dir=path.dirname(file);fs.mkdirSync(dir,{recursive:true,mode:0o700});local(dir);
 const stage=path.join(dir,'.v6-sector-audit-'+process.pid+'-'+crypto.randomBytes(8).toString('hex'));
 let fd;
 try{
  fd=fs.openSync(stage,'wx',0o600);fs.writeFileSync(fd,body);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  try{fs.linkSync(stage,file);}
  catch(e){
   if(e.code!=='EEXIST')throw e;
   const st=fs.lstatSync(file);
   if(!st.isFile()||st.size>MAX||fs.readFileSync(file,'utf8')!==body)
    throw Error('已有同位置不同时间切分审核结果，拒绝覆盖');
   return false;
  }
  const dirFd=fs.openSync(dir,'r');try{fs.fsyncSync(dirFd);}finally{fs.closeSync(dirFd);}
  return true;
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(stage);}catch{}}
}
function runOnce(conf,{now=Date.now()}={}){
 const episodes=read(conf.episodesFile),split=read(conf.splitFile);
 if(episodes?.schemaVersion!==1||episodes.source!=='imported'||
   !Array.isArray(episodes.episodes)||episodes.episodes.length>2500||
   split?.schemaVersion!==1||split.source!=='imported')
  return {status:'blocked-input-contract',changed:false,canTrain:false,canTrade:false};
 const audit=auditSectorWalkForward(episodes.episodes,{tradeDates:split.tradeDates,
  trainEnd:split.trainEnd,validationStart:split.validationStart,
  validationEnd:split.validationEnd,asOf:now});
 if(audit.status==='blocked')return {...audit,changed:false};
 const sourceFingerprints={episodeManifest:sha(episodes),
  splitManifest:sha(split)};
 const record={schemaVersion:1,mode:'immutable-sector-walkforward-diagnostic',
  evaluatedAt:now,sourceFingerprints,audit,canTrade:false,canTrain:false};
 const body=JSON.stringify({...record,integrity:sha(record)})+'\n';
 const changed=immutable(conf.outputFile,body);
 return {status:'chronological-audit-unverified',changed,
  trainEpisodes:audit.train.episodes,
  validationEpisodes:audit.validation.episodes,
  excluded:audit.exclusion,canTrain:false,canTrade:false,
  outOfSampleValidated:false};
}
function main(argv=process.argv.slice(2),deps){return runOnce(parse(argv),deps);}
if(require.main===module){
 try{const out=main();console.log(JSON.stringify(out));if(out.status.startsWith('blocked'))process.exitCode=2;}
 catch(e){console.error(JSON.stringify({status:'blocked-invalid-or-conflicting-evidence',
  canTrain:false,canTrade:false}));process.exitCode=1;}
}
module.exports={parse,read,runOnce,main};
