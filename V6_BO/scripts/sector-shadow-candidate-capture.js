#!/usr/bin/env node
'use strict';
/**
 * User-initiated opt-in same-day candidate capture. Only writes one private
 * file if it did not already exist, and never overwrites an earlier receipt.
 * No network, price-cohort fabrication, training, simulation or orders.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {safePath,readJson}=require('./sector-h5-raw-replay-audit');
const {prepareSectorShadowCandidateCapture,hash}=
 require('../src/core/sector-shadow-candidate-capture');
const MAX_INPUT_BYTES=16*1024*1024,MAX_ARCHIVE_BYTES=40*1024*1024;
const fileHash=x=>crypto.createHash('sha256').update(x).digest('hex');
const safety={schemaVersion:1,mode:'sector-shadow-candidate-private-capture',
 canTrade:false,canTrain:false,canNotify:false,autoPromotion:false,
 weightsChanged:false,productionWeightsChanged:false,
 verifiedLive:false,externallyTimestampCertified:false,
 providerLicenseIndependentlyVerified:false,prospectiveCertified:false};
const block=reason=>({...safety,status:'blocked',reason,changed:false});
function parse(argv){
 if(!Array.isArray(argv)||argv.length!==4||argv[0]!=='once')
  throw Error('usage: once <snapshot-absolute-json> <frozen-membership-absolute-json> <private-output-dir>');
 const [snapshotFile,membershipFile,outputDir]=argv.slice(1).map(safePath);
 if(snapshotFile===membershipFile||
   outputDir===snapshotFile||outputDir===membershipFile||
   snapshotFile.startsWith(outputDir+path.sep)||
   membershipFile.startsWith(outputDir+path.sep)||
   outputDir.startsWith(snapshotFile+path.sep)||
   outputDir.startsWith(membershipFile+path.sep))
  throw Error('private-input-and-output-paths-must-be-separated');
 return {snapshotFile,membershipFile,outputDir};
}
function compareExisting(outputFile,snapshot,membership,sourceDigests,now){
 const old=readJson(outputFile,MAX_ARCHIVE_BYTES).data;
 const {integrity,...body}=old||{};
 if(old?.schemaVersion!==1||
   old.mode!=='sector-h5-single-day-readiness-input-unverified'||
   typeof integrity!=='string'||!/^[a-f0-9]{64}$/.test(integrity)||
   integrity!==hash(body)||
   !Number.isSafeInteger(old.candidateCapturedAt)||
   old.candidateCapturedAt>now)
  return block('existing-candidate-file-corrupted-or-clock-inconsistent');
 const res=prepareSectorShadowCandidateCapture(snapshot,membership,
  {now:old.candidateCapturedAt});
 if(res.status!=='candidate-freeze-prepared-unverified')
  return block('existing-candidate-cannot-replay-same-day-original-source');
 const expected={...res.capture,sourceDigests};
 if(JSON.stringify(body)!==JSON.stringify(expected))
  return block('existing-candidate-conflicts-with-frozen-original-inputs');
 return {...safety,status:'already-frozen-identical',changed:false,
  tradeDate:res.tradeDate,rankedIndustries:res.rankedIndustries,
  captureIntegrity:integrity,
  note:'该日已经有相同的只读预检冻结证据；未重写、不回填、不得据此训练'};
}
function runOnce(conf,{now=Date.now()}={}){
 if(!Number.isSafeInteger(now)||now<946684800000||now>=4102444800000)
  return block('invalid-operator-clock');
 const snapshotFile=safePath(conf.snapshotFile),
  membershipFile=safePath(conf.membershipFile),
  outputDir=safePath(conf.outputDir);
 if(snapshotFile===membershipFile)
  return block('duplicate-private-input-file');
 const quotes=readJson(snapshotFile,MAX_INPUT_BYTES),
  members=readJson(membershipFile,MAX_INPUT_BYTES);
 const snapshot=quotes.data,membership=members.data;
 if(typeof snapshot?.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.date))
  return block('invalid-source-date');
 const outputFile=safePath(path.join(outputDir,'candidate-'+snapshot.date+'.json'));
 const sourceDigests={snapshotSha256:quotes.digest,membershipSha256:members.digest};
 if(fs.existsSync(outputFile))
  return compareExisting(outputFile,snapshot,membership,sourceDigests,now);
 const result=prepareSectorShadowCandidateCapture(snapshot,membership,{now});
 if(result.status!=='candidate-freeze-prepared-unverified')
  return block(result.reason||'same-day-preflight-not-ready');
 const record={...result.capture,sourceDigests};
 const payload=JSON.stringify({...record,integrity:hash(record)})+'\n';
 if(Buffer.byteLength(payload)>MAX_ARCHIVE_BYTES)
  return block('candidate-archive-too-large');
 // Never prepare folders or publish anything if the initial quality gate
 // failed. Re-evaluate input identity after output parent creation.
 fs.mkdirSync(outputDir,{recursive:true,mode:0o700});
 safePath(outputDir);
 const newerQuotes=readJson(snapshotFile,MAX_INPUT_BYTES),
  newerMembers=readJson(membershipFile,MAX_INPUT_BYTES);
 if(newerQuotes.digest!==quotes.digest||newerMembers.digest!==members.digest)
  return block('input-changed-before-publishing');
 const temp=path.join(outputDir,'.candidate-stage-'+process.pid+'-'+
  crypto.randomBytes(8).toString('hex'));
 let fd,changed=false;
 try{
  fd=fs.openSync(temp,'wx',0o600);
  fs.writeFileSync(fd,payload);fs.fsyncSync(fd);
  fs.closeSync(fd);fd=undefined;
  try{fs.linkSync(temp,outputFile);changed=true;}
  catch(e){if(e.code!=='EEXIST')throw e;}
  if(changed){
   const dirFd=fs.openSync(outputDir,'r');
   try{fs.fsyncSync(dirFd);}finally{fs.closeSync(dirFd);}
  }
 }finally{
  if(fd!==undefined)fs.closeSync(fd);
  try{fs.unlinkSync(temp);}catch{}
 }
 if(!changed)return compareExisting(outputFile,snapshot,membership,sourceDigests,now);
 return {...safety,status:'same-day-candidate-captured-unverified',
  changed:true,tradeDate:result.tradeDate,
  rankedIndustries:result.rankedIndustries,
  captureIntegrity:hash(record),
  note:'仅将当日原始报价、分类与预检写入私人不可覆盖JSON；尚无完整股票收盘价cohort和H5标签；文件时间及SHA未经外部认证'};
}
function main(argv=process.argv.slice(2),options){
 return runOnce(parse(argv),options);
}
if(require.main===module){
 try{
  const result=main();
  console.log(JSON.stringify(result));
  if(result.status==='blocked')process.exitCode=2;
 }catch{
  // Never echo operator filenames, symbols, API keys, raw input or stack.
  console.error(JSON.stringify({...safety,status:'failed-private-input-validation',
   changed:false,reason:'private-source-path-json-or-archive-invalid'}));
  process.exitCode=1;
 }
}
module.exports={parse,compareExisting,runOnce,main};