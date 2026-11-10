'use strict';
/**
 * Opt-in single-shot factor research orchestration for already-imported data.
 * No provider login/network, no broker/paper account, no automatic scheduling.
 * "Preview" is strictly zero-write. "Apply" can only write independently
 * guarded private research artifacts, stage by stage. A partial failure is
 * replayed safely under each module's immutable evidence / append guards.
 */
const fs=require('node:fs'),path=require('node:path');
const {readJson}=require('./forward-tracking-store');
const {adaptAuthorizedHistory}=require('./factor-authorized-market-bridge');
const {discoverCaptures}=require('./factor-maturity-manifest');
const {inspectResearchChain}=require('./factor-chain-readiness');
const {safeNew}=require('../../scripts/factor-shadow-evolution');
const {inspect:preflight}=require('../../scripts/factor-source-preflight');
const {runOnce:marketOnce}=require('../../scripts/authorized-factor-market');
const {runOnce:captureOnce}=require('../../scripts/factor-eod-capture');
const {runOnce:maturityOnce}=require('../../scripts/factor-maturity-link');
const {runOnce:neutralOnce}=require('../../scripts/factor-horizon-neutral');
const {runOnce:shadowOnce}=require('../../scripts/factor-shadow-worker');
const DAY=86400000;
const currentDay=t=>new Date(t+8*3600000).toISOString().slice(0,10);
const FIELDS=['historyFile','picksFile','factorsFile','marketFile','captureDir',
 'trackingDir','manifestFile','neutralDir','modelDir'];
const DIRS=new Set(['captureDir','trackingDir','neutralDir','modelDir']);
const ROOT={captureDir:'capture',trackingDir:'tracking',neutralDir:'neutral',modelDir:'models'};
function validatePaths(config){
 if(!config||config.schemaVersion!==1||
    config.mode!=='v6-factor-daily-research-cycle'||
    config.researchOnly!==true||config.canTrade!==false)
  throw Error('必须使用显式不可交易的研究流程配置');
 const known=new Set(['schemaVersion','mode','researchOnly','canTrade',...FIELDS]);
 if(Object.keys(config).some(k=>!known.has(k)))
  throw Error('配置中出现未批准字段或潜在凭据');
 const files=new Set();
 for(const key of FIELDS){
  const value=config[key];
  if(typeof value!=='string'||!path.isAbsolute(value)||
     value.includes('\u0000'))throw Error('研究链配置缺少私有绝对路径: '+key);
  const check=DIRS.has(key)?path.join(value,'.factor-cycle-path-guard'):value;
  safeNew(check);
  const canonical=path.resolve(value);
  if(files.has(canonical))throw Error('研究链输入、输出路径重合');
  files.add(canonical);
 }
 // Research artifacts are never allowed in a child of their own input or in
 // another research writer's output directory, even under a renamed alias.
 for(const a of Object.keys(ROOT)){
  const dir=path.resolve(config[a])+path.sep;
  for(const b of Object.keys(ROOT))if(a!==b&&
    (path.resolve(config[b])+path.sep).startsWith(dir))
   throw Error('研究写入目录不能嵌套或相互覆盖');
  for(const b of FIELDS)if(!DIRS.has(b)&&path.resolve(config[b]).startsWith(dir))
   throw Error('研究写入目录不能包含独立输入文件');
 }
 return config;
}
function publicStatus(stage,status,extra={}){
 return {schemaVersion:1,mode:'v6-factor-daily-research-cycle',
  stage,status,readOnly:status!=='research-cycle-completed-not-certified',
  providerRightsIndependentlyVerified:false,liveQuotesVerified:false,
  deploymentVerified:false,canTrade:false,productionWeightsChanged:false,
  ...extra};
}
function checkSource(config,mode,now){
 const history=readJson(config.historyFile),
  market=adaptAuthorizedHistory(history,{now});
 const day=currentDay(now);
 if(market.asOf!==day)return {status:'skip-no-closed-session-today',
  asOf:market.asOf,nowDay:day};
 // Operator arrival time is not an exchange quote timestamp. Requiring the
 // same day and bounded age avoids silently processing yesterday's EOD input.
 const maxAge=mode==='capture'?15*60000:8*3600000;
 if(now-market.observedAt>maxAge)
  return {status:'skip-source-observation-too-old',asOf:market.asOf};
 if(mode==='capture'){
  const report=preflight({historyFile:config.historyFile,
   picksFile:config.picksFile,factorsFile:config.factorsFile,now});
  if(!report.contractReady)
   return {status:'blocked-source-or-signal-evidence',
    failedStages:report.checks.filter(c=>!c.ok).map(c=>c.stage)};
  return {status:'ready',asOf:market.asOf,
   signalDays:1,expectedSignals:report.checks.at(-1).signals,
   selectedFactors:report.checks.at(-1).availableFactorIds};
 }
 if(!fs.existsSync(config.captureDir))
  return {status:'skip-no-captured-signal-days',asOf:market.asOf};
 const capture=discoverCaptures(config.captureDir,{now});
 if(capture.length===0)
  return {status:'skip-no-captured-signal-days',asOf:market.asOf};
 const mismatched=capture.some(e=>
  e.cohort.feed.provider!==market.feed.provider||
  e.cohort.feed.datasetId!==market.feed.datasetId||
  e.cohort.feed.priceBasis!==market.feed.priceBasis);
 if(mismatched)throw Error('历史冻结的价格供应商或数据集与当次行情来源不同');
 return {status:'ready',asOf:market.asOf,signalDays:capture.length};
}
function inspectResult(config,now){
 const r=inspectResearchChain({captureDir:config.captureDir,
  trackingDir:config.trackingDir,manifestFile:config.manifestFile,
  modelDir:config.modelDir},{now});
 return {chainStatus:r.status,signalDays:r.signalDays,
  maturedH5Days:r.maturedH5Days,manifestDays:r.manifestDays,
  independentTradingDaysNeeded:r.independentTradingDaysNeeded,
  shadowModelVersion:r.shadowModelVersion??null};
}
function runDailyCycle(config,{mode='observe',apply=false,now=Date.now()}={}){
 validatePaths(config);
 if(!['capture','observe'].includes(mode)||typeof apply!=='boolean'||
    !Number.isSafeInteger(now)||now<=0)
  throw Error('模式必须为capture或observe，apply必须为显式布尔值');
 const check=checkSource(config,mode,now);
 if(check.status!=='ready')
  return publicStatus('preflight',check.status,{
   sourceDay:check.asOf??null,
   blockedStages:check.failedStages??[],applied:false});
 if(!apply)return publicStatus('preflight','preview-'+mode+'-ready',
  {sourceDay:check.asOf,signals:check.expectedSignals??null,
   selectedFactors:check.selectedFactors??[],
   archivedSignalDays:check.signalDays,applied:false});
 // Single orchestrator writer. The underlying modules have independent,
 // fail-closed locks and immutable event stores for interrupted restarts.
 const lock=safeNew(path.join(path.dirname(config.manifestFile),'.factor-research-cycle.lock'));
 fs.mkdirSync(path.dirname(lock),{recursive:true,mode:0o700});
 safeNew(lock);
 let fd;
 try{fd=fs.openSync(lock,'wx',0o600);}
 catch(e){if(e.code==='EEXIST')throw Error('研究链上一运行尚未结束或残留锁未核实');throw e;}
 const stages=[],phase=(stage,call)=>{
  try{const out=call();stages.push({stage,status:out.status||'ok'});return out;}
  catch(e){
   // Outputs already published remain append-only. Never claim atomicity
   // across independent state files; operator must retry after inspection.
   const error=new Error('研究链已停在'+stage+'，需检查部分私有归档并核实后重试: '+e.message);
   error.stage=stage;error.completedStages=stages;throw error;
  }
 };
 try{
  fs.writeFileSync(fd,String(process.pid));fs.fsyncSync(fd);
  phase('authorized-market-sync',()=>marketOnce({
   sourceFile:config.historyFile,outputFile:config.marketFile,mode:'sync',now}));
  if(mode==='capture')phase('immutable-eod-capture',()=>captureOnce({
   picksFile:config.picksFile,marketFile:config.marketFile,
   factorFile:config.factorsFile,outputDir:config.captureDir,now}));
  const maturity=phase('maturity-pinned-history',()=>maturityOnce({
   captureDir:config.captureDir,marketFile:config.marketFile,
   trackingDir:config.trackingDir,manifestFile:config.manifestFile,now}));
  phase('neutral-multihorizon-report',()=>neutralOnce({
   captureDir:config.captureDir,trackingDir:config.trackingDir,
   outDir:config.neutralDir,now}));
  if(maturity.maturedDays>=36){
   phase('independent-shadow-model',()=>shadowOnce({
    manifestFile:config.manifestFile,outputDir:config.modelDir,now}));
  }else stages.push({stage:'independent-shadow-model',
   status:'skipped-insufficient-matured-h5-days'});
  const state=phase('read-only-chain-audit',()=>({
   status:'checked',...inspectResult(config,now)}));
  return publicStatus('finished','research-cycle-completed-not-certified',{
   applied:true,sourceDay:check.asOf,stages,
   chainStatus:state.chainStatus,archivedSignalDays:state.signalDays,
   maturedH5Days:state.maturedH5Days,
   manifestDays:state.manifestDays,
   independentTradingDaysNeeded:state.independentTradingDaysNeeded,
   shadowModelVersion:state.shadowModelVersion
  });
 }finally{
  fs.closeSync(fd);fs.unlinkSync(lock);
 }
}
module.exports={validatePaths,checkSource,runDailyCycle};
