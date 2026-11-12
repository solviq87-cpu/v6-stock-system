#!/usr/bin/env node
'use strict';
/**
 * Operator-only, private write-once full-industry baseline cohort capture.
 * Input is an earlier candidate-YYYY-MM-DD.json from PR #149 plus a single
 * imported same-day full-member unadjusted close batch (not future bars).
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {readJson,safePath}=require('./sector-h5-raw-replay-audit');
const {hash}=require('../src/core/sector-shadow-candidate-capture');
const {freezeSectorH5MemberCloses}=require('../src/core/sector-h5-full-member-close-freeze');
const SOURCE_MAX=32*1024*1024,OUTPUT_MAX=40*1024*1024;
const flags={schemaVersion:1,mode:'sector-h5-full-member-close-private-freeze',
 verifiedLive:false,providerLicenseIndependentlyVerified:false,
 externallyTimestampCertified:false,prospectiveCertified:false,
 canTrain:false,canTrade:false,canNotify:false,autoPromotion:false,
 weightsChanged:false,productionWeightsChanged:false};
const blocked=reason=>({...flags,status:'blocked',reason,changed:false});
function parse(args){
 if(!Array.isArray(args)||args.length!==4||args[0]!=='once')
  throw Error('usage: once <candidate-json> <same-day-eod-close-json> <private-output-dir>');
 const [candidateFile,closeFile,outputDir]=args.slice(1).map(safePath);
 if(candidateFile===closeFile||candidateFile===outputDir||closeFile===outputDir||
   [candidateFile,closeFile].some(x=>x.startsWith(outputDir+path.sep)||
    outputDir.startsWith(x+path.sep)))
  throw Error('input-output-path-overlap');
 return {candidateFile,closeFile,outputDir};
}
function verifyExisting(file,candidate,prices,digests,now){
 const record=readJson(file,OUTPUT_MAX).data;
 const {integrity,...body}=record||{};
 if(record?.schemaVersion!==1||
   record.mode!=='sector-h5-frozen-member-close-cohorts-unverified'||
   !Number.isSafeInteger(record.frozenAt)||record.frozenAt>now||
   typeof integrity!=='string'||!/^[a-f0-9]{64}$/.test(integrity)||
   integrity!==hash(body))
  return blocked('corrupted-or-future-frozen-eod-close-archive');
 const rebuilt=freezeSectorH5MemberCloses(candidate,prices,{now:record.frozenAt});
 if(rebuilt.status!=='full-member-close-cohorts-frozen-unverified')
  return blocked('original-eod-close-freeze-cannot-be-replayed');
 const expected={...rebuilt.freeze,...digests};
 if(JSON.stringify(body)!==JSON.stringify(expected))
  return blocked('conflicting-frozen-cohort-or-price-source-cannot-overwrite');
 return {...flags,status:'already-frozen-identical',changed:false,
  tradeDate:record.tradeDate,
  rankedIndustryCount:record.rankedIndustryCount,
  totalMemberCount:record.totalMemberCount,archiveIntegrity:integrity};
}
function runOnce(conf,{now=Date.now()}={}){
 if(!Number.isSafeInteger(now)||now<946684800000||now>=4102444800000)
  return blocked('invalid-current-clock');
 const c=readJson(conf.candidateFile,SOURCE_MAX),
  p=readJson(conf.closeFile,SOURCE_MAX);
 const candidate=c.data,prices=p.data;
 if(typeof candidate?.entry?.snapshot?.date!=='string'||
   !/^\d{4}-\d{2}-\d{2}$/.test(candidate.entry.snapshot.date))
  return blocked('invalid-original-candidate-date');
 const outDir=safePath(conf.outputDir);
 const file=safePath(path.join(outDir,
  'cohorts-'+candidate.entry.snapshot.date+'.json'));
 const digests={candidateFileSha256:c.digest,priceFileSha256:p.digest};
 if(fs.existsSync(file))return verifyExisting(file,candidate,prices,digests,now);
 const prepared=freezeSectorH5MemberCloses(candidate,prices,{now});
 if(prepared.status!=='full-member-close-cohorts-frozen-unverified')
  return blocked(prepared.reason||'unreplayable-full-member-baseline');
 const record={...prepared.freeze,...digests};
 const body=JSON.stringify({...record,integrity:hash(record)})+'\n';
 if(Buffer.byteLength(body)>OUTPUT_MAX)return blocked('archive-exceeds-private-size-limit');
 // Before opening a writer, ensure the imported private files did not change.
 const oldCandidate=readJson(conf.candidateFile,SOURCE_MAX),
  oldPrice=readJson(conf.closeFile,SOURCE_MAX);
 if(oldCandidate.digest!==c.digest||oldPrice.digest!==p.digest)
  return blocked('input-changed-between-read-and-freeze');
 fs.mkdirSync(outDir,{recursive:true,mode:0o700});
 safePath(outDir);
 // Existing output directories may have been created outside this tool.
 // Refuse group/world traversal even though files themselves are 0600:
 // filenames and evidence timestamps are sensitive research metadata.
 const directory=fs.lstatSync(outDir);
 if(!directory.isDirectory()||(directory.mode&0o077)!==0)
  return blocked('private-research-output-directory-permissions-too-open');
 const temp=path.join(outDir,'.sector-h5-stage-'+process.pid+'-'+
  crypto.randomBytes(8).toString('hex'));
 let fd,created=false;
 try{
  fd=fs.openSync(temp,'wx',0o600);
  fs.writeFileSync(fd,body);fs.fsyncSync(fd);
  fs.closeSync(fd);fd=undefined;
  try{fs.linkSync(temp,file);created=true;}
  catch(e){if(e.code!=='EEXIST')throw e;}
  if(created){
   const df=fs.openSync(outDir,'r');
   try{fs.fsyncSync(df);}finally{fs.closeSync(df);}
  }
 }finally{
  if(fd!==undefined)fs.closeSync(fd);
  try{fs.unlinkSync(temp);}catch{}
 }
 if(!created)return verifyExisting(file,candidate,prices,digests,now);
 return {...flags,status:'full-industry-close-cohorts-captured-unverified',
  changed:true,tradeDate:prepared.tradeDate,
  rankedIndustryCount:prepared.rankedIndustryCount,
  totalMemberCount:prepared.totalMemberCount,archiveIntegrity:hash(record),
  note:'所有行业成员当日收盘基准已完整冻结；未生成未来价格、未证明外部可信时间或实盘可成交性'};
}
function main(args=process.argv.slice(2),options){return runOnce(parse(args),options);}
if(require.main===module){
 try{
  const result=main();
  console.log(JSON.stringify(result));
  if(result.status==='blocked')process.exitCode=2;
 }catch{
  console.error(JSON.stringify({...flags,status:'failed-private-input-validation',
   changed:false,reason:'private-source-or-archive-invalid'}));
  process.exitCode=1;
 }
}
module.exports={parse,verifyExisting,runOnce,main};
