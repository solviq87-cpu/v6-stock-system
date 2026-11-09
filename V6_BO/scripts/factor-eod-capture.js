#!/usr/bin/env node
'use strict';
// Opt-in local-only daily capture. The authorized market/factor producers are
// separate; this script does NOT scrape quotes or generate unknown factors.
const fs=require('node:fs'),path=require('node:path');
const {readJson}=require('../src/core/forward-tracking-store');
const {captureFactorEpisode}=require('../src/core/factor-evidence-capture');
const {writeNew,safeNew}=require('./factor-shadow-evolution');
const chinaDay=t=>new Date(t+8*3600000).toISOString().slice(0,10);
function parse(args){
 const [mode,picksFile,marketFile,factorFile,outputDir,...rest]=args;
 if(!['once','watch'].includes(mode)||!picksFile||!marketFile||
    !factorFile||!outputDir||![picksFile,marketFile,factorFile,outputDir].every(path.isAbsolute))
  throw Error('用法: factor-eod-capture.js once|watch <收盘后候选JSON> <同日授权收盘行情JSON> <已有因子评分证据JSON> <私有输出目录> [--interval 30000]');
 if(rest.length&&(mode!=='watch'||rest.length!==2||rest[0]!=='--interval'))
  throw Error('仅watch允许 --interval 毫秒');
 const interval=rest.length?Number(rest[1]):30000;
 if(!Number.isSafeInteger(interval)||interval<15000||interval>3600000)
  throw Error('采集轮询间隔必须在15000至3600000毫秒之间');
 safeNew(path.join(outputDir,'capture-guard.json'));
 return {mode,picksFile,marketFile,factorFile,outputDir,interval};
}
function filesFor(outputDir,day){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('文件日期不合法');
 return {cohortFile:safeNew(path.join(outputDir,'cohort-'+day+'.json')),
  featuresFile:safeNew(path.join(outputDir,'features-'+day+'.json'))};
}
function publish(file,record){
 if(fs.existsSync(file)){
  const before=readJson(file);
  if(JSON.stringify(before)!==JSON.stringify(record))
   throw Error('已有不同的当日冻结研究证据，禁止覆盖');
  return false;
 }
 writeNew(file,record);
 return true;
}
function runOnce({picksFile,marketFile,factorFile,outputDir,now=Date.now()}={}){
 parse(['once',picksFile,marketFile,factorFile,outputDir]);
 if(!Number.isSafeInteger(now)||now<=0)throw Error('冻结时钟无效');
 fs.mkdirSync(outputDir,{recursive:true,mode:0o700});
 safeNew(path.join(outputDir,'capture-guard.json'));
 const lock=path.join(outputDir,'.factor-eod-capture.lock');
 let fd;
 try{fd=fs.openSync(lock,'wx',0o600);}
 catch(error){
  if(error.code==='EEXIST')throw Error('已有同日因子采集任务在运行，禁止并发；残留锁须人工核实');
  throw error;
 }
 try{
  fs.writeFileSync(fd,String(process.pid));fs.fsyncSync(fd);
  const picks=readJson(picksFile),market=readJson(marketFile),factorSnapshot=readJson(factorFile);
  const result=captureFactorEpisode({candidates:picks,market,factorSnapshot,now});
  const files=filesFor(outputDir,result.features.signalDay);
  const cohortNew=publish(files.cohortFile,result.cohort);
  const featuresNew=publish(files.featuresFile,result.features);
  return {ok:true,mode:'causal-factor-eod-capture',status:cohortNew||featuresNew?
    'new-frozen-evidence':'already-frozen-identical',
   day:result.features.signalDay,signals:result.cohort.signals.length,
   selectedFactors:result.features.factors.map(x=>x.id),
   withheldFactorCount:result.withheldFactorCount,
   cohortFingerprint:result.cohort.fingerprint,
   featureFingerprint:result.features.fingerprint,
   canTrade:false,productionWeightsChanged:false};
 }finally{
  fs.closeSync(fd);fs.unlinkSync(lock);
 }
}
function main(args){
 const conf=parse(args);
 if(conf.mode==='once')return runOnce(conf);
 let busy=false,closing=false,lastError=null;
 const tick=()=>{
  if(busy||closing)return;busy=true;
  try{
   const r=runOnce(conf);
   if(r.status!=='already-frozen-identical')console.log(JSON.stringify(r));
   lastError=null;
  }catch(error){
   const reason=String(error.message).slice(0,220);
   if(reason!==lastError)console.error(JSON.stringify({ok:false,error:reason}));
   lastError=reason;
  }finally{busy=false;}
 };
 tick();
 const timer=setInterval(tick,conf.interval);
 const stop=()=>{closing=true;clearInterval(timer);};
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 return {ok:true,mode:'watch',canTrade:false};
}
if(require.main===module){
 try{const r=main(process.argv.slice(2));if(r.mode!=='watch')console.log(JSON.stringify(r));}
 catch(error){console.error(JSON.stringify({ok:false,error:String(error.message).slice(0,220)}));process.exitCode=1;}
}
module.exports={parse,runOnce,filesFor,main};
