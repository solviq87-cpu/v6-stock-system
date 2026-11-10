#!/usr/bin/env node
'use strict';
/**
 * Explicit private, read-only single-day input readiness. No live feed,
 * retrospective cohort creation, research archive write, model or order.
 */
const path=require('node:path');
const {readJson,safePath}=require('./sector-h5-raw-replay-audit');
const {inspectSectorH5DailyReadiness}=require('../src/core/sector-h5-evidence-readiness');
const base={schemaVersion:1,mode:'sector-h5-daily-readiness-cli',
 canWrite:false,canTrain:false,canTrade:false,canNotify:false,
 autoPromotion:false,weightsChanged:false,productionWeightsChanged:false,
 outOfSampleValidated:false,providerLicenseIndependentlyVerified:false};
const invalid=reason=>({...base,status:'blocked',reason,allLabelsReplayed:false});
function parse(argv){
 if(!Array.isArray(argv)||!['once'].includes(argv[0])||
  ![3,5].includes(argv.length))
  throw Error('usage: once <private-day-absolute-json> <calendar-absolute-json> [--as-of-ms 1234567890000]');
 const evidenceFile=safePath(argv[1]),calendarFile=safePath(argv[2]);
 if(evidenceFile===calendarFile)throw Error('same-input-file-forbidden');
 let asOf=null;
 if(argv.length===5){
  if(argv[3]!=='--as-of-ms'||typeof argv[4]!=='string'||
   !/^\d{13}$/.test(argv[4])||
   Number(argv[4])<946684800000||Number(argv[4])>=4102444800000)
   throw Error('invalid-as-of');
  asOf=Number(argv[4]);
 }
 return {evidenceFile,calendarFile,asOf};
}
function runOnce(conf,{now=Date.now()}={}){
 if(!Number.isSafeInteger(now)||now<946684800000||now>=4102444800000)
  return invalid('invalid-local-clock');
 const asOf=conf.asOf??now;
 if(!Number.isSafeInteger(asOf)||asOf>now||asOf<946684800000)
  return invalid('future-research-clock');
 const day=readJson(conf.evidenceFile,8*1024*1024);
 const cal=readJson(conf.calendarFile,1024*1024);
 if(day.data?.schemaVersion!==1||
  day.data.mode!=='sector-h5-single-day-readiness-input-unverified'||
  !day.data.entry||typeof day.data.entry!=='object'||
  cal.data?.schemaVersion!==1||
  cal.data.mode!=='a-share-explicit-trade-calendar-unverified'||
  cal.data.source!=='imported'||!Array.isArray(cal.data.tradeDates))
  return invalid('input-or-calendar-contract-invalid');
 const result=inspectSectorH5DailyReadiness(day.data.entry,{
  asOf,tradeDates:cal.data.tradeDates});
 return {...base,...result,mode:'sector-h5-daily-readiness-cli',
  evidenceSha256:day.digest,calendarSha256:cal.digest,
  note:'只读研究资料完整性检查；SHA仅表示导入文件内容一致，非可信时间戳、真实行情或第三方合规授权'};
}
function main(args=process.argv.slice(2),opts){
 return runOnce(parse(args),opts);
}
if(require.main===module){
 try{
  const result=main();
  console.log(JSON.stringify(result));
  if(result.status!=='ready-for-history-audit-unverified')
   process.exitCode=2;
 }catch{
  // No private path, stock identifier or JSON body in error output.
  console.error(JSON.stringify({...base,status:'failed-private-input-validation',
   allLabelsReplayed:false,reason:'private-input-parse-or-filesystem-invalid'}));
  process.exitCode=1;
 }
}
module.exports={parse,runOnce,main};