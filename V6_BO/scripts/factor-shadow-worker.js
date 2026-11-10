#!/usr/bin/env node
'use strict';
// Operator-enabled unattended research worker. Reads only private imported
// evidence, emits immutable shadow-model revisions, NEVER production weights.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {readJson,readSnapshot}=require('../src/core/forward-tracking-store');
const {evolveShadowFactors,verifyEpisode}=require('../src/core/factor-shadow-evolution');
const {assessGlobalTrialBudget}=require('../src/core/factor-global-trial-budget');
const {preregisterCandidate}=require('../src/core/factor-candidate-prereg');
const factorPack=require('../strategies/extended-factor-pack.json');
const {writeNew,safeNew}=require('./factor-shadow-evolution');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function parse(args){
 const [mode,manifestFile,outputDir,...flags]=args;
 if(!['once','watch','register'].includes(mode)||!manifestFile||!outputDir||
    !path.isAbsolute(manifestFile)||!path.isAbsolute(outputDir))
  throw Error('用法: factor-shadow-worker.js once|watch|register <私有manifest绝对路径> <私有模型目录绝对路径>');
 safeNew(path.join(outputDir,'shadow-guard.json'));
 if(mode==='register'){
  if(flags.length!==1||!path.isAbsolute(flags[0]))
   throw Error('register 仅接受一个候选权重JSON绝对路径');
  return {mode,manifestFile,outputDir,candidateWeightsFile:flags[0]};
 }
 const requirePreRegistration=flags.includes('--require-prereg');
 if(flags.filter(x=>x==='--require-prereg').length>1)
  throw Error('不可重复设置严格预注册门禁');
 const extra=flags.filter(x=>x!=='--require-prereg');
 if(extra.length&&(mode!=='watch'||extra.length!==2||extra[0]!=='--interval'))
  throw Error('轮询仅支持 watch --interval 毫秒及 --require-prereg');
 const interval=extra.length?Number(extra[1]):60000;
 if(!Number.isSafeInteger(interval)||interval<30000||interval>3600000)
  throw Error('研究轮询间隔必须为30000至3600000毫秒');
 return {mode,manifestFile,outputDir,interval,requirePreRegistration};
}
function latestAccepted(dir){
 if(!fs.existsSync(dir))return null;
 const names=fs.readdirSync(dir).filter(x=>/^shadow-\d{4}-\d{2}-\d{2}-[a-f0-9]{12}\.json$/.test(x));
 if(names.length>500)throw Error('研究模型归档超出单目录审计上限');
 const accepted=[];
 for(const name of names){
  const model=readJson(path.join(dir,name));
  if(model?.mode!=='v6-factor-shadow-evolution-v1'||typeof model.fingerprint!=='string')
   throw Error('研究模型归档结构无效');
  const {fingerprint,...payload}=model;
  if(hash(payload)!==fingerprint||
     name!==`shadow-${model.trainingEnd}-${fingerprint.slice(0,12)}.json`)
   throw Error('研究模型归档完整性无效（文件名与指纹/训练日期不一致）');
  if(model.status==='shadow-updated')accepted.push(model);
 }
 accepted.sort((a,b)=>b.version-a.version||b.trainingEnd.localeCompare(a.trainingEnd));
 if(accepted.length>1&&accepted[0].version===accepted[1].version&&
   accepted[0].fingerprint!==accepted[1].fingerprint)
  throw Error('存在重复研究版本编号，禁止自动选择');
 return accepted[0]||null;
}
/**
 * Restore the latest immutable cooldown decision after a worker restart.
 * A pause must survive process restarts; missing/invalid archive evidence
 * cannot silently reset the learned model's decay state.
 */
function latestCooldown(dir,accepted){
 if(!accepted||!fs.existsSync(dir))return null;
 const names=fs.readdirSync(dir).filter(x=>/^shadow-\d{4}-\d{2}-\d{2}-[a-f0-9]{12}\.json$/.test(x));
 if(names.length>500)throw Error('冷却归档超出单目录审计上限');
 const states=[];
 for(const name of names){
  const m=readJson(path.join(dir,name));
  if(m?.mode!=='v6-factor-shadow-evolution-v1'||typeof m.fingerprint!=='string')
   throw Error('冷却研究档案结构无效');
  const {fingerprint,...payload}=m;
  if(hash(payload)!==fingerprint||
     name!==`shadow-${m.trainingEnd}-${fingerprint.slice(0,12)}.json`)
   throw Error('冷却研究档案完整性无效（文件名与指纹/训练日期不一致）');
  if(!['paused-shadow-decay','paused-shadow-cooldown','shadow-recovered'].includes(m.status))
   continue;
  if(m.previousFingerprint!==accepted.fingerprint)continue;
  // Sealed older PR #77 decay alerts predate the cooldown metadata.
  // Preserve their warning and let the core infer an ACTIVE gate from the
  // sealed lastObservationDay; never ignore these old alerts on restart.
  const legacy=m.status==='paused-shadow-decay'&&!m.cooldown;
  if((!legacy&&(!m.cooldown||
      m.cooldown.sourceAcceptedFingerprint!==accepted.fingerprint))||
     !/^\d{4}-\d{2}-\d{2}$/.test(m.lastObservationDay))
   throw Error('冷却状态缺少已接受研究模型血缘');
  states.push(m);
 }
 states.sort((a,b)=>b.lastObservationDay.localeCompare(a.lastObservationDay));
 if(states.length>1&&states[0].lastObservationDay===states[1].lastObservationDay&&
    states[0].fingerprint!==states[1].fingerprint)
  throw Error('同日存在冲突的研究冷却状态');
 return states[0]||null;
}
/**
 * Resolve the last spent holdout from immutable private research archives.
 * Rejected candidates count: looking at a held-out result consumes it.
 * Keep an audit chain across restarts rather than relying on in-memory state.
 */
function latestTrial(dir,accepted){
 if(!fs.existsSync(dir))return null;
 const names=fs.readdirSync(dir)
  .filter(x=>/^shadow-\d{4}-\d{2}-\d{2}-[a-f0-9]{12}\.json$/.test(x));
 if(names.length>500)throw Error('影子研究试验归档超过500项审计上限');
 const parent=accepted?.fingerprint||null,history=[];
 for(const name of names){
  const result=readJson(path.join(dir,name));
  if(result?.mode!=='v6-factor-shadow-evolution-v1'||
     typeof result.fingerprint!=='string')
   throw Error('影子研究试验档案结构无效');
  const {fingerprint,...payload}=result;
  if(hash(payload)!==fingerprint||
     name!==`shadow-${result.trainingEnd}-${fingerprint.slice(0,12)}.json`)
   throw Error('研究试验归档被篡改或文件名与封存日期不一致，拒绝读取');
  if(result.previousFingerprint!==parent)continue;
  const audit=result.trialAudit;
  // Earlier sealed research reports already exposed their evaluation
  // holdout but were written before a formal trial ledger existed.
  const legacy=!audit&&['shadow-retained','paused-market-shock'].includes(result.status);
  const consumed=audit?.status==='consumed';
  if(!legacy&&!consumed)continue;
  const end=legacy?result.lastObservationDay:audit.lastHoldoutDay;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(end)||
     end>result.lastObservationDay||
     (parent&&end<=accepted.lastObservationDay)||
     (!legacy&&(!/^\d{4}-\d{2}-\d{2}$/.test(audit.firstHoldoutDay)||
      audit.firstHoldoutDay>end||!Number.isSafeInteger(audit.trialNumber)||
      audit.trialNumber<1||audit.holdoutDays<5)))
   throw Error('试验占用日期与研究血缘不一致');
  history.push({end,result,count:legacy?1:audit.trialNumber,
   previousTrialFingerprint:legacy?null:audit.previousTrialFingerprint});
 }
 history.sort((a,b)=>a.end.localeCompare(b.end));
 for(let i=0;i<history.length;i++){
  const current=history[i],prior=history[i-1];
  if(prior&&current.end<=prior.end)
   throw Error('同一批保留日被不同研究试验重复占用');
  if(!prior&&current.count!==1)
   throw Error('首个研究试验编号或档案前缀缺失');
  if(prior&&(current.count!==prior.count+1||
     current.previousTrialFingerprint!==prior.result.fingerprint))
   throw Error('研究试验归档链断裂或顺序错误');
 }
 return history.at(-1)?.result||null;
}
/**
 * Count ALL committed holdout inspections, not just trials under the last
 * accepted model. Validate archive integrity before deriving the budget.
 */
function globalTrialBudget(dir,signalDays){
 const names=fs.existsSync(dir)?fs.readdirSync(dir)
  .filter(x=>/^shadow-\d{4}-\d{2}-\d{2}-[a-f0-9]{12}\.json$/.test(x)):[];
 if(names.length>500)throw Error('全局试验预算归档超过500项');
 const archives=names.map(name=>{
  const report=readJson(path.join(dir,name));
  if(report?.mode!=='v6-factor-shadow-evolution-v1'||
     typeof report.fingerprint!=='string')throw Error('试验预算档案结构无效');
  const {fingerprint,...payload}=report;
  if(hash(payload)!==fingerprint||!name.includes(fingerprint.slice(0,12)))
   throw Error('试验预算档案完整性无效');
  return report;
 });
 return assessGlobalTrialBudget(archives,signalDays,hash(factorPack));
}
/**
 * One pending immutable candidate per active accepted/trial lineage. Multiple
 * precommitments would let researchers shop alternatives before evaluation.
 */
function latestCandidateRegistration(dir,accepted,previousTrial){
 if(!fs.existsSync(dir))return null;
 const names=fs.readdirSync(dir).filter(x=>/^prereg-[0-9a-f]{12}\.json$/.test(x));
 if(names.length>500)throw Error('候选预注册目录超过500项');
 const parent=accepted?.fingerprint||null,trial=previousTrial?.fingerprint||null;
 const matches=[];
 for(const name of names){
  const r=readJson(path.join(dir,name));
  if(r?.mode!=='v6-shadow-candidate-prereg-v1'||typeof r.fingerprint!=='string')
   throw Error('候选预注册档案结构无效');
  const {fingerprint,...payload}=r;
  if(hash(payload)!==fingerprint||name!=='prereg-'+fingerprint.slice(0,12)+'.json')
   throw Error('候选预注册档案完整性无效');
  if(r.parentAcceptedFingerprint===parent&&r.parentTrialFingerprint===trial)
   matches.push(r);
 }
 if(matches.length>1)throw Error('同一研究血缘存在多个预注册候选，拒绝挑选');
 return matches[0]||null;
}
/**
 * Explicit PRE-outcome registration: verify only frozen features, never read
 * any forward reportFile. Candidate weights come from a separate bounded
 * JSON file and are persisted before future signal snapshots may be created.
 */
function runRegister({manifestFile,outputDir,candidateWeightsFile,now=Date.now()}={}){
 const conf=parse(['register',manifestFile,outputDir,candidateWeightsFile]);
 const manifest=readJson(conf.manifestFile);
 validateManifest(manifest);
 return withResearchLock(conf.outputDir,()=>{
 const features=manifest.episodes.map(e=>{
  if(typeof e?.featuresFile!=='string'||!path.isAbsolute(e.featuresFile))
   throw Error('预注册必须提供冻结特征绝对路径');
  // Deliberately DO NOT OPEN e.reportFile in the registration stage.
  const frozen=readJson(e.featuresFile);
  verifyEpisode(frozen,now);
  return frozen;
 });
 const accepted=latestAccepted(conf.outputDir);
 const previousTrial=latestTrial(conf.outputDir,accepted);
 if(latestCandidateRegistration(conf.outputDir,accepted,previousTrial))
  throw Error('同一血缘已存在预注册候选，禁止多个事前参数版本');
 const base=features[0].factors;
 const weights=accepted?.shadowWeights||
  Object.fromEntries(base.map(x=>[x.id,x.baseWeight]));
 const entry=preregisterCandidate({features,candidateWeights:readJson(candidateWeightsFile),
  acceptedWeights:weights,registeredAt:now,
  parentAcceptedFingerprint:accepted?.fingerprint||null,
  parentTrialFingerprint:previousTrial?.fingerprint||null,
  packFingerprint:hash(factorPack)});
 const file=path.join(outputDir,'prereg-'+entry.fingerprint.slice(0,12)+'.json');
 writeNew(file,entry);
 return {ok:true,status:'candidate-preregistered',fingerprint:entry.fingerprint,
  latestFrozenSignalDay:entry.latestFrozenSignalDay,registeredAt:now,
  canTrade:false,productionWeightsChanged:false};
 });
}
function readEpisodeReport(file){
 const original=readJson(file);
 if(original?.mode==='v6-forward-tracking-snapshot'){
  // Immutable tracking history is a sealed wrapper. Audit its SHA and
  // recomputed rule statistics before using the embedded H5 price report.
  const archived=readSnapshot(file);
  if(!archived)throw Error('缺少成熟观察归档');
  return archived.report;
 }
 return original; // Legacy explicit offline plain observer report.
}
/**
 * A single private model directory may have only one research writer.
 * An abandoned lock is intentionally NOT stolen: an operator must first
 * inspect the prior worker and its immutable trial archives.
 */
function withResearchLock(dir,work){
 const lock=safeNew(path.join(dir,'.shadow-worker.lock'));
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 safeNew(lock);
 let fd;
 try{fd=fs.openSync(lock,'wx',0o600);}
 catch(error){
  if(error.code==='EEXIST')
   throw Error('研究模型目录存在独占锁；请人工核对运行进程和试验档案，不得自动清锁');
  throw error;
 }
 try{
  fs.writeFileSync(fd,JSON.stringify({schemaVersion:1,pid:process.pid,
   startedAt:new Date().toISOString(),purpose:'shadow-research-only'})+'\n');
  fs.fsyncSync(fd);
  return work();
 }finally{
  let held;
  try{held=fs.fstatSync(fd);}finally{fs.closeSync(fd);}
  let current;
  try{current=fs.lstatSync(lock);}
  catch{throw Error('研究独占锁丢失；无法安全确认并发写入状态');}
  if(current.dev!==held.dev||current.ino!==held.ino)
   throw Error('研究独占锁身份变化；拒绝清理其他进程的锁');
  fs.unlinkSync(lock);
 }
}
function validateManifest(manifest){
 if(manifest?.mode==='v6-forward-training-manifest'){
  const {integrity,...body}=manifest;
  if(integrity!==hash(body)||manifest.canTrade!==false||
     manifest.productionWeightsChanged!==false||
     manifest.evidenceBasis!=='first-matured-sealed-5-trading-day')
   throw Error('自动学习manifest完整性或来源协议无效');
 }
 if(manifest?.schemaVersion!==1||!Array.isArray(manifest.episodes)||
    manifest.episodes.length<36||manifest.episodes.length>400)
  throw Error('需要完整时间排序研究批次目录');
}
function runOnce({manifestFile,outputDir,now=Date.now(),
 requirePreRegistration=false}={}){
 const conf=parse(['once',manifestFile,outputDir]);
 // Reject invalid manifests without creating or changing the output directory.
 const manifest=readJson(conf.manifestFile);
 validateManifest(manifest);
 return withResearchLock(conf.outputDir,()=>evaluateOnce(
  {...conf,requirePreRegistration},now,manifest));
}
function evaluateOnce(conf,now,manifest){
 const previous=latestAccepted(conf.outputDir);
 const previousCooldown=latestCooldown(conf.outputDir,previous);
 const previousTrial=latestTrial(conf.outputDir,previous);
 const preRegistration=latestCandidateRegistration(conf.outputDir,previous,previousTrial);
 if(conf.requirePreRegistration&&!preRegistration&&!previousCooldown)
  throw Error('候选预注册缺失：严格模式在读取远期收益前拒绝运行');
 // Audit the total experiment budget using immutable frozen FEATURE dates
 // BEFORE opening any H5 forward-return report. A budget-denied challenger
 // must not inspect held-out prices merely to discover that it cannot run.
 const frozen=manifest.episodes.map(x=>{
  if(typeof x?.featuresFile!=='string'||typeof x.reportFile!=='string')
   throw Error('批次文件路径无效');
  const features=readJson(x.featuresFile);
  verifyEpisode(features,now);
  return features;
 });
 const trialBudget=globalTrialBudget(conf.outputDir,
  frozen.map(x=>x.signalDay));
 const cooldownOnly=previousCooldown&&
  ['paused-shadow-decay','paused-shadow-cooldown'].includes(previousCooldown.status);
 if(trialBudget.remainingTrials===0&&!cooldownOnly)
  return {ok:true,status:'skipped-global-trial-budget-exhausted',
   usedTrials:trialBudget.usedTrials,maxTrials:trialBudget.maxTrials,
   windowStartDay:trialBudget.windowStartDay,
   canTrade:false,productionWeightsChanged:false};
 const episodes=manifest.episodes.map((x,i)=>({
  features:frozen[i],report:readEpisodeReport(x.reportFile)
 }));
 let result;
 try{
  result=evolveShadowFactors(episodes,{now,previous,previousCooldown,
   previousTrial,trialBudget,preRegistration,
   requirePreRegistration:conf.requirePreRegistration,
   marketContext:manifest.marketContext});
 }catch(e){
  if(previous&&/未增加新的训练时间窗/.test(String(e.message)))
   return {ok:true,status:'skipped-no-new-training',version:previous.version,
    canTrade:false,productionWeightsChanged:false};
  if(previousTrial&&/新增独立试验保留日不足/.test(String(e.message)))
   return {ok:true,status:'skipped-no-new-trial-holdout',
    version:previous?.version||0,
    previousTrialFingerprint:previousTrial.fingerprint,
    canTrade:false,productionWeightsChanged:false};
  if(/全局研究试验预算已耗尽/.test(String(e.message)))
   return {ok:true,status:'skipped-global-trial-budget-exhausted',
    usedTrials:trialBudget.usedTrials,maxTrials:trialBudget.maxTrials,
    windowStartDay:trialBudget.windowStartDay,
    canTrade:false,productionWeightsChanged:false};
  throw e;
 }
 const file=path.join(conf.outputDir,
  'shadow-'+result.trainingEnd+'-'+result.fingerprint.slice(0,12)+'.json');
 if(fs.existsSync(file)){
  const existing=readJson(file);
  if(hash(existing)===hash(result))return {ok:true,status:'skipped-identical-evidence',
   version:result.version,canTrade:false,productionWeightsChanged:false};
  throw Error('同名研究模型存在冲突，拒绝覆盖');
 }
 writeNew(file,result);
 return {ok:true,status:result.status,version:result.version,
  trainingEnd:result.trainingEnd,validationDays:result.validationDays,
  testDays:result.testDays,fingerprint:result.fingerprint,canTrade:false,
  productionWeightsChanged:false};
}
function main(args){
 const config=parse(args);
 if(config.mode==='register')return runRegister(config);
 if(config.mode==='once')return runOnce(config);
 let busy=false,closing=false;
 const tick=()=>{
  if(busy||closing)return;
  busy=true;
  try{console.log(JSON.stringify(runOnce(config)));}
  catch(e){console.error(JSON.stringify({ok:false,error:String(e.message).slice(0,220)}));}
  finally{busy=false;}
 };
 tick();
 const timer=setInterval(tick,config.interval);
 const shutdown=()=>{closing=true;clearInterval(timer);};
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
 return {ok:true,mode:'watch',canTrade:false};
}
if(require.main===module){
 try{
  const result=main(process.argv.slice(2));
  if(result?.mode!=='watch')console.log(JSON.stringify(result));
 }catch(e){console.error(JSON.stringify({ok:false,error:String(e.message).slice(0,220)}));process.exitCode=1;}
}
module.exports={parse,runOnce,runRegister,latestAccepted,latestCooldown,
 latestTrial,globalTrialBudget,latestCandidateRegistration,main,readEpisodeReport};
