#!/usr/bin/env node
'use strict';
/**
 * Explicit operator-only, read-only private-file entry point for #125.
 * Input files must already exist; the CLI NEVER fetches market data,
 * writes results, opens a server, trains models, or touches paper trading.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {evaluateReplayedSectorH5WalkForward}=require('../src/core/sector-h5-raw-evidence-replay');
const MAX_BATCH_BYTES=32*1024*1024,MAX_CAL_BYTES=1024*1024;
const SHA=x=>crypto.createHash('sha256').update(x).digest('hex');
const base={schemaVersion:1,mode:'sector-h5-private-file-replay-only',
 verifiedLive:false,providerLicenseIndependentlyVerified:false,
 externallyTimestampCertified:false,prospectiveCertified:false,
 outOfSampleValidated:false,eligibleForResearchPromotion:false,
 canTrain:false,canTrade:false,canNotify:false,autoPromotion:false,
 weightsChanged:false,productionWeightsChanged:false};
const blocked=reason=>({...base,status:'blocked',reason,
 rawEvidenceReplayed:false,folds:null});
function safePath(input){
 if(typeof input!=='string'||!path.isAbsolute(input)||input.includes('\0'))
  throw Error('research-file-path-not-absolute');
 const full=path.resolve(input);
 if(full.split(path.sep).includes('public'))
  throw Error('public-static-path-forbidden');
 let cursor=path.parse(full).root;
 for(const piece of full.slice(cursor.length).split(path.sep).filter(Boolean)){
  cursor=path.join(cursor,piece);
  if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink())
   throw Error('symlink-component-forbidden');
 }
 return full;
}
function parse(argv){
 if(!Array.isArray(argv)||argv.length<3||argv.length>7||argv[0]!=='once')
  throw Error('usage: once <private-batch-absolute-json> <private-calendar-absolute-json> [--cost-bps 30] [--as-of-ms 1234567890000]');
 const batchFile=safePath(argv[1]),calendarFile=safePath(argv[2]);
 if(batchFile===calendarFile)throw Error('research-inputs-must-be-distinct');
 let roundTripCostBps=30,asOf=null;
 const extra=argv.slice(3),used=new Set();
 if(extra.length%2)throw Error('option-value-pair-required');
 for(let i=0;i<extra.length;i+=2){
  const flag=extra[i],value=extra[i+1];
  if(!['--cost-bps','--as-of-ms'].includes(flag)||used.has(flag)||
    typeof value!=='string'||!Number.isSafeInteger(Number(value)))
   throw Error('invalid-research-option');
  used.add(flag);
  if(flag==='--cost-bps'){
   roundTripCostBps=Number(value);
   if(!/^\d{1,3}$/.test(value)||roundTripCostBps>500)
    throw Error('invalid-fixed-cost-basis-points');
  }else{
   asOf=Number(value);
   if(!/^\d{13}$/.test(value)||asOf<946684800000||asOf>=4102444800000)
    throw Error('invalid-research-as-of-milliseconds');
  }
 }
 return {batchFile,calendarFile,roundTripCostBps,asOf};
}
function readJson(file,maxBytes){
 const p=safePath(file),f=fs.openSync(p,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{
  const stat=fs.fstatSync(f);
  if(!stat.isFile()||stat.size<2||stat.size>maxBytes)
   throw Error('research-file-type-or-size-invalid');
  const raw=fs.readFileSync(f,'utf8');
  if(Buffer.byteLength(raw,'utf8')!==stat.size)
   throw Error('research-file-mutated-while-reading');
  return {data:JSON.parse(raw),digest:SHA(raw)};
 }finally{fs.closeSync(f);}
}
function runOnce(conf,{now=Date.now()}={}){
 if(!Number.isSafeInteger(now)||now<946684800000||now>=4102444800000)
  return blocked('invalid-local-research-clock');
 const raw=readJson(conf.batchFile,MAX_BATCH_BYTES),
  calendar=readJson(conf.calendarFile,MAX_CAL_BYTES);
 if(raw.data?.schemaVersion!==1||
   raw.data.mode!=='sector-h5-private-raw-batch-unverified'||
   !Array.isArray(raw.data.entries)||
   raw.data.entries.length<24||raw.data.entries.length>80)
  return blocked('raw-evidence-batch-contract-invalid');
 if(calendar.data?.schemaVersion!==1||calendar.data?.source!=='imported'||
   calendar.data.mode!=='a-share-explicit-trade-calendar-unverified'||
   !Array.isArray(calendar.data.tradeDates)||
   calendar.data.tradeDates.length<150||
   calendar.data.tradeDates.length>1200)
  return blocked('explicit-trading-calendar-contract-invalid');
 const asOf=conf.asOf??now;
 if(!Number.isSafeInteger(asOf)||asOf>now||asOf<946684800000)
  return blocked('future-or-invalid-operator-research-clock');
 const audited=evaluateReplayedSectorH5WalkForward(raw.data.entries,{
  tradeDates:calendar.data.tradeDates,asOf,
  roundTripCostBps:conf.roundTripCostBps
 });
 if(audited.status!=='raw-replayed-descriptive-audit-unverified')
  return blocked('replay-or-scorecard-'+String(audited.reason||'unavailable'));
 return {...base,status:'private-raw-replayed-descriptive-unverified',
  rawEvidenceReplayed:true,asOf,
  batchSha256:raw.digest,calendarSha256:calendar.digest,
  evidenceFingerprint:audited.evidenceFingerprint,
  signalDays:audited.signalDays,
  priceFeedIdentity:audited.priceFeedIdentity,
  quoteSource:audited.quoteSource,
  costStress:audited.costStress,
  folds:audited.folds,
  note:'已从操作者私有JSON重算板块H5价格研究，输入SHA仅校验文件一致性；不是可信封存时间、真实收益证明、数据许可或自动训练授权'};
}
function main(argv=process.argv.slice(2),options){
 return runOnce(parse(argv),options);
}
if(require.main===module){
 try{
  const result=main();
  // One bounded JSON summary; never log raw member symbols or input paths.
  console.log(JSON.stringify(result));
  if(result.status==='blocked')process.exitCode=2;
 }catch{
  console.error(JSON.stringify({...base,
   status:'failed-private-input-validation',rawEvidenceReplayed:false,
   reason:'private-file-or-options-invalid'}));
  process.exitCode=1;
 }
}
module.exports={parse,safePath,readJson,runOnce,main};