'use strict';
/**
 * Read-only chain audit for real operator-owned V6 research artifacts.
 *
 * Local integrity hashes show unchanged files, not exchange signatures.
 * A successful integrity audit never certifies provider rights, L2 rights,
 * market freshness, model profitability, or an active WorkBuddy deployment.
 */
const fs=require('node:fs'),path=require('node:path');
const {discoverCaptures,firstMaturedArchive,hash}=require('./factor-maturity-manifest');
const {readJson,readSnapshot}=require('./forward-tracking-store');
const {verifyAndJoin}=require('./factor-shadow-evolution');
const {readEpisodeReport,latestAccepted}=require('../../scripts/factor-shadow-worker');
const {safeNew}=require('../../scripts/factor-shadow-evolution');
const mature=w=>w&&typeof w.targetDate==='string'&&
  ['observed','missing-or-suspended','corporate-action-unresolved'].includes(w.status);
function normalizePaths({captureDir,trackingDir,manifestFile,modelDir}={}){
 const fields={captureDir,trackingDir,manifestFile,modelDir};
 for(const [key,value] of Object.entries(fields)){
  if(typeof value!=='string'||!path.isAbsolute(value))
   throw Error('因子链核验需要完整私有绝对路径: '+key);
 }
 // Also checks existing ancestors, path symlinks and /public.
 for(const key of Object.keys(fields))
  safeNew(key.endsWith('Dir')?path.join(fields[key],'readiness-check.json'):fields[key]);
 return fields;
}
function inspectResearchChain(config,{now=Date.now()}={}){
 const {captureDir,trackingDir,manifestFile,modelDir}=normalizePaths(config);
 if(!Number.isSafeInteger(now)||now<=0)throw Error('研究链检查时间无效');
 const base={schemaVersion:1,mode:'v6-factor-research-chain-readiness',
  checkedAt:now,readOnly:true,authorizedProviderIndependentlyVerified:false,
  liveQuotesVerified:false,cloudDeploymentVerified:false,
  canTrade:false,productionWeightsChanged:false,
  shadowModelProfitabilityVerified:false};
 if(!fs.existsSync(captureDir)){
  return {...base,status:'no-captured-evidence',signalDays:0,
   maturedH5Days:0,manifestDays:0,independentTradingDaysNeeded:36,
   eligibleForTraining:false,shadowModels:0};
 }
 const captures=discoverCaptures(captureDir,{now});
 const all=new Map(),snapshotDays=[],missingObservations=[],pendingH5=[];
 for(const entry of captures){
  if(all.has(entry.date))throw Error('冻结研究日重复');
  all.set(entry.date,entry);
  const file=safeNew(path.join(trackingDir,entry.date,'current.json'));
  const state=readSnapshot(file);
  if(!state){missingObservations.push(entry.date);continue;}
  // This recomputes the frozen factor and price cohort relationship instead
  // of trusting only the self-reported date and current-state SHA.
  verifyAndJoin(entry.features,state.report,now);
  const w=state.report.records.map(r=>r.windows?.[1]);
  if(w.length!==entry.features.features.length)
   throw Error('研究信号与观察窗口个数不符');
  if(w.every(mature)){
   snapshotDays.push(entry.date);
  }else{
   pendingH5.push(entry.date);
  }
 }
 let manifestDays=0,manifestStale=false,manifestFingerprint=null;
 const pinnedDays=new Set();
 if(fs.existsSync(manifestFile)){
  const manifest=readJson(manifestFile),{integrity,...body}=manifest;
  if(manifest.schemaVersion!==1||
     manifest.mode!=='v6-forward-training-manifest'||
     manifest.evidenceBasis!=='first-matured-sealed-5-trading-day'||
     manifest.canTrade!==false||manifest.productionWeightsChanged!==false||
     integrity!==hash(body)||!Array.isArray(manifest.episodes)||
     manifest.episodes.length>400)
   throw Error('因子研究索引内容或完整性不合格');
  manifestFingerprint=integrity;
  for(const episode of manifest.episodes){
   const file=safeNew(episode?.featuresFile),reportFile=safeNew(episode?.reportFile);
   const day=path.basename(file).match(/^features-(\d{4}-\d{2}-\d{2})\.json$/)?.[1];
   const capture=day&&all.get(day);
   if(!capture||file!==capture.featuresFile||pinnedDays.has(day)||
      !reportFile.startsWith(path.join(trackingDir,day,'forward-tracking-history')+path.sep))
    throw Error('研究索引股票日或归档路径缺少可信对应');
   const report=readEpisodeReport(reportFile);
   verifyAndJoin(capture.features,report,now);
   if(!report.records.every(r=>mature(r.windows?.[1])))
    throw Error('未成熟H5进入自动学习索引');
   const first=firstMaturedArchive(path.join(trackingDir,day,'current.json'),
    capture.features,{now});
   if(first!==reportFile)
    throw Error('不是最早封存的成熟H5版本，拒绝事后调换研究答案');
   pinnedDays.add(day);
  }
  manifestDays=pinnedDays.size;
  manifestStale=snapshotDays.some(day=>!pinnedDays.has(day));
 }
 const previous=latestAccepted(modelDir);
 let status;
 if(captures.length===0)status='no-captured-evidence';
 else if(snapshotDays.length===0)status='awaiting-h5-observations';
 else if(!fs.existsSync(manifestFile))status='manifest-not-published';
 else if(manifestStale)status='manifest-needs-refresh';
 else if(manifestDays<36)status='insufficient-independent-h5-days';
 else if(!previous)status='shadow-model-not-accepted';
 else status='shadow-research-version-present';
 return {...base,status,
  signalDays:captures.length,maturedH5Days:snapshotDays.length,
  pendingH5Days:pendingH5.length,
  missingObservationDays:missingObservations.length,
  manifestDays,manifestFingerprint,
  independentTradingDaysNeeded:Math.max(0,36-manifestDays),
  eligibleForTraining:false, // Full leakage/regime/OOS gates not evaluated here.
  shadowModelVersion:previous?.version??null,
  shadowModelStatus:previous?.status??'none',
  shadowModelTrainingEnd:previous?.trainingEnd??null};
}
module.exports={normalizePaths,inspectResearchChain};
