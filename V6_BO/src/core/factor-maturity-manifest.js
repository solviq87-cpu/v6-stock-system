'use strict';
/**
 * Read-only evidence bridge: immutable daily capture -> first sealed 5-session
 * forward observation -> reproducible training manifest.
 *
 * The first matured observation is pinned; updating a later price snapshot
 * must not rewrite already-trained factor outcomes.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {readJson,readSnapshot}=require('./forward-tracking-store');
const {freezeCohort}=require('./forward-signal-observer');
const {verifyAndJoin}=require('./factor-shadow-evolution');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const day=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&
  Number.isFinite(Date.parse(d+'T00:00:00Z'))&&
  new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
function verifyDailyCapture(receiptFile,{now=Date.now()}={}){
 const dir=path.dirname(receiptFile),name=path.basename(receiptFile);
 const match=/^receipt-(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
 if(!match||!day(match[1])||!Number.isSafeInteger(now)||now<=0)
  throw Error('因子日归档名称或研究时间无效');
 const date=match[1],receipt=readJson(receiptFile);
 const {integrity,...body}=receipt;
 if(receipt?.schemaVersion!==1||
    receipt.mode!=='causal-factor-eod-capture-receipt'||
    receipt.signalDay!==date||integrity!==hash(body)||
    !Number.isSafeInteger(receipt.createdAt)||receipt.createdAt>now||
    !/^[a-f0-9]{64}$/.test(receipt.inputFingerprint))
  throw Error('每日因子捕获回执无效');
 const cohortFile=path.join(dir,'cohort-'+date+'.json');
 const featuresFile=path.join(dir,'features-'+date+'.json');
 const cohort=readJson(cohortFile),features=readJson(featuresFile);
 const {fingerprint:cohortSeal,...cohortBody}=cohort;
 const {fingerprint:featuresSeal,...featuresBody}=features;
 if(cohortSeal!==hash(cohortBody)||featuresSeal!==hash(featuresBody)||
    cohortSeal!==receipt.cohortFingerprint||
    featuresSeal!==receipt.featureFingerprint||
    cohort.mode!=='frozen-forward-signal-cohort'||
    features.mode!=='frozen-factor-feature-episode'||
    features.signalDay!==date||features.cohortFingerprint!==cohortSeal||
    cohort.frozenAt!==receipt.createdAt||features.capturedAt!==receipt.createdAt||
    features.originalCohortFrozenAt!==cohort.frozenAt||
    cohort.feed?.source!=='imported'||
    !Array.isArray(cohort.signals)||cohort.signals.length<5||
    cohort.signals.some(s=>s.signalDate!==date))
  throw Error('同日原始信号/因子特征/捕获回执不一致');
 const reconstructed=freezeCohort({schemaVersion:1,
  feed:cohort.feed,signals:cohort.signals},{now:cohort.frozenAt});
 if(hash(reconstructed)!==hash(cohort))
  throw Error('原信号冻结协议未通过重算审计');
 return {date,cohort,features,cohortFile,featuresFile,receiptFile};
}
function discoverCaptures(captureDir,{now=Date.now()}={}){
 if(typeof captureDir!=='string'||!path.isAbsolute(captureDir)||
    !fs.existsSync(captureDir)||!fs.statSync(captureDir).isDirectory())
  throw Error('每日因子快照目录不存在或不是绝对私有目录');
 const names=fs.readdirSync(captureDir);
 const receipts=names.filter(x=>/^receipt-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort();
 if(receipts.length>400)throw Error('因子学习单次最多消费400个每日冻结批次');
 // A partially published new capture must not be counted as a training day.
 // Incomplete capture writes carry no receipt and therefore cannot train.
 return receipts.map(name=>verifyDailyCapture(path.join(captureDir,name),{now}));
}
function firstMaturedArchive(stateFile,features,{now=Date.now()}={}){
 const dir=path.join(path.dirname(stateFile),'forward-tracking-history');
 if(!fs.existsSync(dir))return null;
 const names=fs.readdirSync(dir).filter(x=>/^\d{8}-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort();
 if(names.length>1500)throw Error('单批次研究观察版本数超出安全上限');
 let earliest=null;
 for(const name of names){
  const filename=path.join(dir,name),saved=readSnapshot(filename),report=saved?.report;
  if(!report)throw Error('历史观察归档不存在或无效');
  const observations=verifyAndJoin(features,report,now);
  const mature=observations.length>0&&observations.every(r=>r.targetDate!==null||
   // Missing/suspended and corporate action cases may have no valid return,
   // but targetDate must still be a known reached trading day.
   false);
  const windows=report.records.map(r=>r.windows?.[1]);
  const fullyMature=windows.length===features.features.length&&
   windows.every(w=>w&&typeof w.targetDate==='string'&&w.targetDate<=report.asOf&&
    ['observed','missing-or-suspended','corporate-action-unresolved'].includes(w.status));
  if(mature&&fullyMature&&!earliest)earliest=filename;
 }
 return earliest;
}
function createManifest(episodes){
 if(!Array.isArray(episodes)||episodes.length>400)
  throw Error('研究因子批次列表无效');
 const sorted=[...episodes].sort((a,b)=>a.day.localeCompare(b.day));
 const seen=new Set(),entries=[];
 for(const x of sorted){
  if(!day(x.day)||seen.has(x.day)||!path.isAbsolute(x.featuresFile)||
     !path.isAbsolute(x.reportFile))throw Error('研究批次重复或存在无效私有路径');
  seen.add(x.day);
  entries.push({featuresFile:x.featuresFile,reportFile:x.reportFile});
 }
 const payload={schemaVersion:1,mode:'v6-forward-training-manifest',
  evidenceBasis:'first-matured-sealed-5-trading-day',
  episodes:entries,canTrade:false,productionWeightsChanged:false};
 return {...payload,integrity:hash(payload)};
}
module.exports={verifyDailyCapture,discoverCaptures,firstMaturedArchive,createManifest,hash};
