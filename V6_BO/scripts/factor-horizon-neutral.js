#!/usr/bin/env node
'use strict';
// Offline, operator-enabled 1/5/20/60 factor research report. No orders,
// scraping, missing-score estimates or edits to any official factor weight.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {auditStoredFactorHorizonSeries}=require('../src/core/factor-industry-multihorizon');
const {readJson}=require('../src/core/forward-tracking-store');
const {safeNew,writeNew}=require('./factor-shadow-evolution');
function parse(argv){
 const [mode,captureDir,trackingDir,outDir,...flags]=argv;
 if(!['once','watch'].includes(mode)||!
  [captureDir,trackingDir,outDir].every(v=>typeof v==='string'&&path.isAbsolute(v)))
  throw Error('用法: factor-horizon-neutral.js once|watch <私有冻结目录> <私有观察历史目录> <私有报告目录> [--interval 60000]');
 if(flags.length&&(mode!=='watch'||flags.length!==2||flags[0]!=='--interval'))
  throw Error('仅watch允许 --interval 毫秒');
 const interval=flags.length?Number(flags[1]):60000;
 if(!Number.isSafeInteger(interval)||interval<30000||interval>3600000)
  throw Error('多周期研究检查间隔必须为30000至3600000毫秒');
 safeNew(path.join(outDir,'research-guard.json'));
 return {mode,captureDir,trackingDir,outDir,interval};
}
function runOnce({captureDir,trackingDir,outDir,now=Date.now()}={}){
 parse(['once',captureDir,trackingDir,outDir]);
 if(!Number.isSafeInteger(now)||now<=0)throw Error('多周期研究时钟无效');
 const report=auditStoredFactorHorizonSeries({captureDir,trackingDir,now});
 const file=safeNew(path.join(outDir,'neutral-horizons-'+report.fingerprint+'.json'));
 if(fs.existsSync(file)){
  const old=readJson(file);
  if(JSON.stringify(old)!==JSON.stringify(report))
   throw Error('研究报告指纹冲突，禁止覆盖历史证据');
  return {ok:true,status:'unchanged',reportFingerprint:report.fingerprint,
   batchCount:report.batchCount,canTrade:false,weightsChanged:false};
 }
 fs.mkdirSync(outDir,{recursive:true,mode:0o700});
 safeNew(file);
 writeNew(file,report); // Immutable 0600 file, no replace on races.
 return {ok:true,status:'research-audit-written',
  reportFingerprint:report.fingerprint,batchCount:report.batchCount,
  captureDays:report.sourceCaptureDays,
  pendingDays:report.pendingCaptureDays.length,
  periods:report.windows.map(w=>({tradingDays:w.tradingDays,
   observedSignals:w.observedSignals,pendingSignals:w.pendingSignals})),
  canTrade:false,weightsChanged:false};
}
function main(argv){
 const conf=parse(argv);
 if(conf.mode==='once')return runOnce(conf);
 let busy=false,closed=false,lastError=null;
 const tick=()=>{
  if(busy||closed)return;busy=true;
  try{
   const result=runOnce(conf);
   if(result.status!=='unchanged')console.log(JSON.stringify(result));
   lastError=null;
  }catch(err){
   const message=String(err.message).slice(0,220);
   if(message!==lastError)console.error(JSON.stringify({ok:false,error:message}));
   lastError=message;
  }finally{busy=false;}
 };
 tick();
 const interval=setInterval(tick,conf.interval);
 const stop=()=>{closed=true;clearInterval(interval);};
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 return {ok:true,mode:'watch',canTrade:false};
}
if(require.main===module){
 try{const result=main(process.argv.slice(2));
  if(result.mode!=='watch')console.log(JSON.stringify(result));}
 catch(error){console.error(JSON.stringify({ok:false,error:String(error.message).slice(0,220)}));process.exitCode=1;}
}
module.exports={runOnce,parse,main};
