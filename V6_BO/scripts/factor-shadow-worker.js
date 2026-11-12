#!/usr/bin/env node
'use strict';
// Operator-enabled unattended research worker. Reads only private imported
// evidence, emits immutable shadow-model revisions, NEVER production weights.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {readJson,readSnapshot}=require('../src/core/forward-tracking-store');
const {evolveShadowFactors,verifyEpisode}=require('../src/core/factor-shadow-evolution');
const {verifyCanonicalManifestLineage,discoverCaptures}=require('../src/core/factor-maturity-manifest');
const {assessGlobalTrialBudget}=require('../src/core/factor-global-trial-budget');
const {assessShadowRuntimeHealth}=require('../src/core/factor-shadow-runtime-health');
const {preregisterCandidate,verifyPreregisteredCandidate,currentResearchCodeFingerprint}=
 require('../src/core/factor-candidate-prereg');
const {preregisterSeedCandidate,verifySeedRegistrationMetadata,SEED_MODE}=
 require('../src/core/factor-candidate-prereg');
const {proposeFromSealedResearch}=require('../src/core/factor-shadow-candidate-proposer');
const factorPack=require('../strategies/extended-factor-pack.json');
const {writeNew,safeNew}=require('./factor-shadow-evolution');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function parse(args){
 const [mode,manifestFile,outputDir,...flags]=args;
 if(!['once','watch','register','register-auto','register-seed','health'].includes(mode)||!manifestFile||!outputDir||
    !path.isAbsolute(manifestFile)||!path.isAbsolute(outputDir))
  throw Error('用法: factor-shadow-worker.js once|watch|register|register-auto|health <私有manifest绝对路径> <私有模型目录绝对路径>；register-seed <私有捕获目录> <私有模型目录> <固定种子配置JSON>');
 safeNew(path.join(outputDir,'shadow-guard.json'));
 if(mode==='register-seed'){
  if(flags.length!==1||!path.isAbsolute(flags[0]))
   throw Error('register-seed 仅接受私有捕获目录、模型目录及固定种子配置JSON绝对路径');
  return {mode,captureDir:manifestFile,outputDir,seedConfigFile:flags[0]};
 }
 if(mode==='health'){
  if(flags.length)throw Error('只读研究健康检查不接受额外参数');
  return {mode,manifestFile,outputDir};
 }
 if(mode==='register'){
  if(flags.length!==1||!path.isAbsolute(flags[0]))
   throw Error('register 仅接受一个候选权重JSON绝对路径');
  return {mode,manifestFile,outputDir,candidateWeightsFile:flags[0]};
 }
 if(mode==='register-auto'){
  if(flags.length)throw Error('register-auto 不接受外部权重文件或其他参数');
  return {mode,manifestFile,outputDir};
 }
 const requirePreRegistration=flags.includes('--require-prereg');
 const autoRegisterCandidate=flags.includes('--auto-prereg');
 if(flags.filter(x=>x==='--require-prereg').length>1||
    flags.filter(x=>x==='--auto-prereg').length>1)
  throw Error('不可重复设置严格预注册或自动接力门禁');
 if(autoRegisterCandidate&&(mode!=='watch'||!requirePreRegistration))
  throw Error('自动接力仅允许 watch 同时明确启用 --require-prereg');
 const extra=flags.filter(x=>x!=='--require-prereg'&&x!=='--auto-prereg');
 if(extra.length&&(mode!=='watch'||extra.length!==2||extra[0]!=='--interval'))
  throw Error('轮询仅支持 watch --interval 毫秒及 --require-prereg/--auto-prereg');
 const interval=extra.length?Number(extra[1]):60000;
 if(!Number.isSafeInteger(interval)||interval<30000||interval>3600000)
  throw Error('研究轮询间隔必须为30000至3600000毫秒');
 return {mode,manifestFile,outputDir,interval,requirePreRegistration,
  autoRegisterCandidate};
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
  if(hash(payload)!==fingerprint||
     name!==`shadow-${report.trainingEnd}-${fingerprint.slice(0,12)}.json`)
   throw Error('试验预算档案完整性或封存日期文件名无效');
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
  if(!['v6-shadow-candidate-prereg-v1',SEED_MODE].includes(r?.mode)||typeof r.fingerprint!=='string')
   throw Error('候选预注册档案结构无效');
  const {fingerprint,...payload}=r;
  if(hash(payload)!==fingerprint||name!=='prereg-'+fingerprint.slice(0,12)+'.json')
   throw Error('候选预注册档案完整性无效');
  if(r.mode===SEED_MODE)verifySeedRegistrationMetadata(r);
  if(r.parentAcceptedFingerprint===parent&&r.parentTrialFingerprint===trial)
   matches.push(r);
 }
 if(matches.length>1)throw Error('同一研究血缘存在多个预注册候选，拒绝挑选');
 return matches[0]||null;
}
/**
 * Private in-lock candidate registration. It never opens any H5 reportFile.
 * Called both by explicit register-auto and the opt-in strict watch handoff,
 * so two workers cannot reserve the same candidate simultaneously.
 */
function registerCandidateLocked({manifest,outputDir,now,auto=false,
 candidateWeightsFile,features,accepted,previousTrial}={}){
 if(!Array.isArray(features)||features.length<36)
  throw Error('候选注册必须有已冻结的历史特征');
 if(latestCandidateRegistration(outputDir,accepted,previousTrial))
  throw Error('同一血缘已存在预注册候选，禁止多个事前参数版本');
 const defs=features[0].factors,weights=accepted?.shadowWeights||
  Object.fromEntries(defs.map(x=>[x.id,x.baseWeight]));
 const prior=auto?(previousTrial||accepted):null;
 if(auto&&!prior)
  throw Error('尚无已封存历史研究报告，自动候选预注册拒绝启动');
 const proposal=auto?proposeFromSealedResearch({
  source:prior,definitions:defs,acceptedWeights:weights,
  packFingerprint:hash(factorPack),
  latestFrozenDay:features.at(-1).signalDay
 }):null;
 const entry=preregisterCandidate({features,
  candidateWeights:auto?proposal.candidateWeights:readJson(candidateWeightsFile),
  acceptedWeights:weights,registeredAt:now,
  parentAcceptedFingerprint:accepted?.fingerprint||null,
  parentTrialFingerprint:previousTrial?.fingerprint||null,
  packFingerprint:hash(factorPack),
  autoSourceFingerprint:auto?proposal.sourceFingerprint:null});
 const file=path.join(outputDir,'prereg-'+entry.fingerprint.slice(0,12)+'.json');
 writeNew(file,entry);
 return {ok:true,status:auto?'candidate-auto-preregistered':'candidate-preregistered',
  fingerprint:entry.fingerprint,sourceFingerprint:proposal?.sourceFingerprint||null,
  latestFrozenSignalDay:entry.latestFrozenSignalDay,registeredAt:now,
  canTrade:false,productionWeightsChanged:false};
}
function registerCandidate({manifestFile,outputDir,candidateWeightsFile,
 now=Date.now(),auto=false}={}){
 const args=auto?['register-auto',manifestFile,outputDir]:
  ['register',manifestFile,outputDir,candidateWeightsFile];
 const conf=parse(args),manifest=readJson(conf.manifestFile);
 validateManifest(manifest);
 return withResearchLock(conf.outputDir,()=>{
  let features=manifest.episodes.map(e=>{
   if(typeof e?.featuresFile!=='string'||!path.isAbsolute(e.featuresFile))
    throw Error('预注册必须提供冻结特征绝对路径');
   // Neither manual nor automatic registration opens a price reportFile.
   const frozen=readJson(e.featuresFile);
   verifyEpisode(frozen,now);
   return frozen;
  });
  features=registrationFeatures(manifest,features,conf.captureDir,now);
  const accepted=latestAccepted(conf.outputDir);
  const previousTrial=latestTrial(conf.outputDir,accepted);
  return registerCandidateLocked({manifest,outputDir:conf.outputDir,now,auto,
   candidateWeightsFile,features,accepted,previousTrial});
 });
}
function runRegister(args={}){return registerCandidate(args);}
function runRegisterAuto(args={}){return registerCandidate({...args,auto:true});}
function runRegisterSeed({captureDir,outputDir,seedConfigFile,now=Date.now()}={}){
 const conf=parse(['register-seed',captureDir,outputDir,seedConfigFile]);
 const captureRoot=path.resolve(conf.captureDir),modelRoot=path.resolve(conf.outputDir);
 if(captureRoot===modelRoot||captureRoot.startsWith(modelRoot+path.sep)||
    modelRoot.startsWith(captureRoot+path.sep))
  throw Error('固定种子捕获目录与模型目录不能重合或嵌套');
 for(const file of [conf.seedConfigFile,path.join(conf.captureDir,'.seed-input-guard')])safeNew(file);
 const stat=fs.statSync(conf.seedConfigFile),captureStat=fs.statSync(conf.captureDir);
 if(!stat.isFile()||(stat.mode&0o077)!==0||!captureStat.isDirectory()||
    (captureStat.mode&0o077)!==0||
    (fs.existsSync(conf.outputDir)&&(fs.statSync(conf.outputDir).mode&0o077)!==0))
  throw Error('固定种子输入和模型目录必须使用私有权限');
 const seedConfig=readJson(conf.seedConfigFile);
 return withResearchLock(conf.outputDir,()=>{
  // Existing archive filenames alone deny bootstrap. No previous model or
  // held-out outcome is read to choose this once-only initial candidate.
  if(fs.readdirSync(conf.outputDir).some(name=>/^(shadow-|prereg-).*\.json$/.test(name)))
   throw Error('固定种子仅允许空白初始研究血缘，禁止重置旧试验或重复登记');
  const features=discoverCaptures(conf.captureDir,{now}).map(c=>{
   verifyEpisode(c.features,now);return c.features;
  });
  const entry=preregisterSeedCandidate({features,seedConfig,registeredAt:now});
  writeNew(path.join(conf.outputDir,'prereg-'+entry.fingerprint.slice(0,12)+'.json'),entry);
  return {ok:true,status:'candidate-seed-preregistered',fingerprint:entry.fingerprint,
   seedPolicy:entry.seedPolicy,registeredAt:entry.registeredAt,recordedAt:entry.recordedAt,
   latestFrozenSignalDay:entry.latestFrozenSignalDay,frozenPrefixDays:features.length,
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
const HEARTBEAT_NAME='.shadow-worker-heartbeat.json';
function writeWatchHeartbeat(dir,{now=Date.now(),intervalMs=60000,
 outcome='tick-success',lastStatus='unknown'}={}){
 if(!Number.isSafeInteger(now)||now<=0||
    !Number.isSafeInteger(intervalMs)||intervalMs<30000||intervalMs>3600000||
    !['tick-success','tick-error'].includes(outcome)||
    typeof lastStatus!=='string'||lastStatus.length>90||
    !/^[a-z0-9-]+$/.test(lastStatus))
  throw Error('研究心跳参数无效');
 const payload={schemaVersion:1,mode:'v6-shadow-watch-heartbeat-v1',
  observedAt:now,intervalMs,outcome,lastStatus,
  pid:process.pid,canTrade:false,productionWeightsChanged:false};
 const full={...payload,integrity:hash(payload)};
 const file=path.join(dir,HEARTBEAT_NAME),
  temp=path.join(dir,'.shadow-heartbeat-'+crypto.randomBytes(12).toString('hex')+'.tmp');
 safeNew(file);safeNew(temp);
 if(fs.existsSync(file)){
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink())
   throw Error('运行心跳不是普通私有文件');
 }
 const fd=fs.openSync(temp,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(full)+'\n');fs.fsyncSync(fd);}
 finally{fs.closeSync(fd);}
 try{fs.renameSync(temp,file);}
 catch(e){try{fs.unlinkSync(temp);}catch{}throw e;}
 return full;
}
function readWatchHeartbeat(dir){
 const file=path.join(dir,HEARTBEAT_NAME);
 if(!fs.existsSync(file))return null;
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)
  throw Error('研究心跳文件无效或可能被替换');
 const saved=JSON.parse(fs.readFileSync(file,'utf8')),
  {integrity,...body}=saved;
 if(integrity!==hash(body)||saved.canTrade!==false||
    saved.productionWeightsChanged!==false)
  throw Error('研究心跳内容完整性无效');
 return body;
}
function runHealth({manifestFile,outputDir,now=Date.now()}={}){
 const conf=parse(['health',manifestFile,outputDir]);
 const manifest=readJson(conf.manifestFile);
 if(manifest?.mode!=='v6-forward-training-manifest')
  throw Error('健康诊断仅接受规范研究清单，不接受未认证测试清单');
 validateManifest(manifest);
 const frozen=manifest.episodes.map(e=>{
  if(!e||typeof e.featuresFile!=='string'||!path.isAbsolute(e.featuresFile)||
     typeof e.reportFile!=='string'||!path.isAbsolute(e.reportFile))
   throw Error('健康诊断研究文件路径无效');
  const item=readJson(e.featuresFile);
  verifyEpisode(item,now);
  return item;
 });
 const days=frozen.map(x=>x.signalDay);
 const reportFilesPresent=manifest.episodes.map(x=>{
  try{
   const stat=fs.lstatSync(x.reportFile);
   return stat.isFile()&&!stat.isSymbolicLink();
  }catch(e){if(e.code==='ENOENT')return false;throw e;}
 });
 const accepted=latestAccepted(conf.outputDir),
  trial=latestTrial(conf.outputDir,accepted),
  cooldown=latestCooldown(conf.outputDir,accepted),
  registration=latestCandidateRegistration(conf.outputDir,accepted,trial),
  budget=globalTrialBudget(conf.outputDir,days),
  pulse=readWatchHeartbeat(conf.outputDir);
 return assessShadowRuntimeHealth({now,signalDays:days,reportFilesPresent,
  accepted,trial,cooldown,registration,budget,pulse});
}
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
 requirePreRegistration=false,autoRegisterCandidate=false,
 operatorMode=false,captureDir,watchPulse=false,watchIntervalMs=60000}={}){
 if(autoRegisterCandidate&&!requirePreRegistration)
  throw Error('自动接力必须先启用严格预注册');
 const conf=parse(['once',manifestFile,outputDir]);
 // Check the EXACT manifest consumed on this tick: watch must not continue
 // if a formerly canonical operator manifest was replaced while running.
 // Direct research tests intentionally retain legacy fixture compatibility.
 const manifest=readJson(conf.manifestFile);
 if(operatorMode&&manifest?.mode!=='v6-forward-training-manifest')
  throw Error('运维自动学习命令仅接受冻结回执与首份成熟H5绑定的正式研究清单，拒绝旧版简化测试清单');
 validateManifest(manifest);
 return withResearchLock(conf.outputDir,()=>{
  let outcome='tick-success',lastStatus='unknown';
  try{
   const result=evaluateOnce(
    {...conf,requirePreRegistration,autoRegisterCandidate,captureDir},now,manifest);
   lastStatus=result.status;
   return result;
  }catch(e){
   outcome='tick-error';lastStatus='worker-evaluation-error';
   throw e;
  }finally{
   if(watchPulse)writeWatchHeartbeat(conf.outputDir,
    {now,intervalMs:watchIntervalMs,outcome,lastStatus});
  }
 });
}
// Registration seals all receipt-backed features already visible, including
// H5-pending captures. No outcome file is opened to construct this prefix.
function registrationFeatures(manifest,frozen,captureDir,now){
 if(manifest.mode!=='v6-forward-training-manifest')return frozen;
 const dirs=new Set(manifest.episodes.map(e=>path.dirname(e.featuresFile)));
 if(dirs.size!==1)throw Error('自动预注册必须使用同一原始捕获目录');
 const dir=captureDir||[...dirs][0];
 safeNew(path.join(dir,'.prereg-capture-guard'));
 if(path.resolve(dir)!==path.resolve([...dirs][0]))throw Error('捕获目录与成熟清单血缘不一致');
 const captures=discoverCaptures(dir,{now});
 const all=captures.map(e=>{verifyEpisode(e.features,now);return e.features;});
 if(frozen.some((f,i)=>all[i]?.fingerprint!==f.fingerprint))
  throw Error('成熟清单不是原始捕获的连续前缀，禁止事后筛选研究日');
 return all;
}
function pendingRegistrationStatus(reg,{conf,manifest,frozen,previous,previousTrial,now}){
 const prefix=reg.frozenPrefixFingerprints;
 if(!Array.isArray(prefix)||prefix.length<frozen.length)return null;
 const all=registrationFeatures(manifest,frozen,conf.captureDir,now);
 const edge=all[prefix.length-1];
 if(reg.mode===SEED_MODE){
  verifySeedRegistrationMetadata(reg);
  if(reg.algorithmFingerprint!==currentResearchCodeFingerprint()||previous||previousTrial||
     prefix.length>all.length||prefix.some((fp,i)=>fp!==all[i]?.fingerprint)||
     (prefix.length>0&&(reg.latestFrozenSignalDay!==edge?.signalDay||reg.lastFrozenCapturedAt!==edge?.capturedAt))||
     all.slice(prefix.length).some(f=>f.capturedAt<=Math.max(reg.registeredAt,reg.recordedAt)))
   throw Error('待执行固定种子与真实冻结证据或研究代码不一致');
  return {ok:true,status:prefix.length>frozen.length?
   'skipped-awaiting-preregistered-prefix-maturity':'skipped-awaiting-post-prereg-signals',
   pendingPrefixDays:prefix.length-frozen.length,preregistrationFingerprint:reg.fingerprint,
   canTrade:false,productionWeightsChanged:false};
 }
 if(!Number.isSafeInteger(reg.registeredAt)||reg.registeredAt<=0||prefix.length>all.length||prefix.some((fp,i)=>fp!==all[i]?.fingerprint)||
    reg.algorithmFingerprint!==currentResearchCodeFingerprint()||reg.packFingerprint!==hash(factorPack)||
    reg.parentAcceptedFingerprint!==(previous?.fingerprint||null)||
    reg.parentTrialFingerprint!==(previousTrial?.fingerprint||null)||
    reg.latestFrozenSignalDay!==edge?.signalDay||
    reg.lastFrozenCapturedAt!==edge?.capturedAt||reg.registeredAt<edge?.capturedAt)
  throw Error('待执行候选预注册与全部冻结证据或研究代码已不一致');
 return {ok:true,status:prefix.length>frozen.length?
  'skipped-awaiting-preregistered-prefix-maturity':'skipped-awaiting-post-prereg-signals',
  pendingPrefixDays:prefix.length-frozen.length,preregistrationFingerprint:reg.fingerprint,
  canTrade:false,productionWeightsChanged:false};
}
function evaluateOnce(conf,now,manifest){
 const previous=latestAccepted(conf.outputDir);
 const previousCooldown=latestCooldown(conf.outputDir,previous);
 const previousTrial=latestTrial(conf.outputDir,previous);
 const preRegistration=latestCandidateRegistration(conf.outputDir,previous,previousTrial);
 const cooldownOnly=previousCooldown&&
  ['paused-shadow-decay','paused-shadow-cooldown'].includes(previousCooldown.status);
 // A recovered cooldown is NOT an active monitoring exemption. It needs a
 // freshly committed candidate before any new forward return is opened.
 if(conf.requirePreRegistration&&!preRegistration&&!cooldownOnly&&
    !conf.autoRegisterCandidate)
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
 if(trialBudget.remainingTrials===0&&!cooldownOnly)
  return {ok:true,status:'skipped-global-trial-budget-exhausted',
   usedTrials:trialBudget.usedTrials,maxTrials:trialBudget.maxTrials,
   windowStartDay:trialBudget.windowStartDay,
   canTrade:false,productionWeightsChanged:false};
 // An explicitly enabled strict watch can reserve exactly one candidate
 // from SEALED OLD research. It will not read ANY forward prices on the
 // registration tick; candidate must precede a later frozen signal.
 if(conf.autoRegisterCandidate&&!preRegistration&&!cooldownOnly){
  if(!previous&&!previousTrial)
   return {ok:true,status:'skipped-auto-prereg-needs-sealed-history',
    canTrade:false,productionWeightsChanged:false};
  return registerCandidateLocked({manifest,outputDir:conf.outputDir,now,
   auto:true,features:registrationFeatures(manifest,frozen,conf.captureDir,now),accepted:previous,previousTrial});
 }
 if(conf.requirePreRegistration&&!preRegistration&&!cooldownOnly)
  throw Error('候选预注册缺失：严格模式在读取远期收益前拒绝运行');
 // A newly committed candidate cannot have a future test signal yet.
 // Do not read old H5 reports while simply waiting for the first new
 // frozen signal; this also avoids spuriously re-testing the old holdout.
 if(conf.requirePreRegistration&&preRegistration&&!cooldownOnly){
  const waiting=pendingRegistrationStatus(preRegistration,{conf,manifest,frozen,previous,previousTrial,now});
  if(waiting)return waiting;
 }
 // Validate an already-sealed commitment against frozen FEATURES before
 // opening any forward-return files. Outcome-based eligibility is checked
 // again by evolveShadowFactors after the holdout has been loaded.
 if(preRegistration&&!cooldownOnly){
  const sorted=[...frozen].sort((a,b)=>a.signalDay.localeCompare(b.signalDay));
  const prefix=preRegistration.frozenPrefixFingerprints;
  if(!Array.isArray(prefix)||prefix.length>sorted.length||
     prefix.some((fp,i)=>fp!==sorted[i].fingerprint))
   throw Error('候选预注册冻结前缀与当前研究批次不一致，禁止读取远期收益');
  if(prefix.length<sorted.length){
   const next=sorted[prefix.length],defs=sorted[0].factors;
   verifyPreregisteredCandidate(preRegistration,{
    sorted:sorted.map(f=>({day:f.signalDay,featureFingerprint:f.fingerprint,featureCapturedAt:f.capturedAt})),
    ids:defs.map(f=>f.id),packFingerprint:hash(factorPack),
    oldWeights:previous?.shadowWeights||
     Object.fromEntries(defs.map(f=>[f.id,f.baseWeight])),
    previousFingerprint:previous?.fingerprint||null,
    previousTrialFingerprint:previousTrial?.fingerprint||null,
    freshTest:[{day:next.signalDay,featureCapturedAt:next.capturedAt}]
   });
  }
 }
 // A handful of still-maturing registered-prefix days are never a new
 // candidate holdout. Wait using features only, before opening H5 outcomes.
 if(preRegistration&&!cooldownOnly&&conf.requirePreRegistration){
  const sealedAt=preRegistration.mode===SEED_MODE?
   Math.max(preRegistration.registeredAt,preRegistration.recordedAt):preRegistration.registeredAt;
  const fresh=frozen.filter(f=>(preRegistration.mode===SEED_MODE&&preRegistration.latestFrozenSignalDay===null||
   f.signalDay>preRegistration.latestFrozenSignalDay)&&f.capturedAt>sealedAt);
  if(fresh.length<5)return {ok:true,status:'skipped-awaiting-post-prereg-matured-days',
   maturedPostRegistrationDays:fresh.length,requiredPostRegistrationDays:5,
   canTrade:false,productionWeightsChanged:false};
 }
 // Strictly recheck the ENTIRE frozen receipt -> first mature H5 archive
 // lineage for canonical manifests. A valid manifest hash alone is not proof.
 // Keep preregistration and trial-budget checks ahead of opening any H5 files.
 if(manifest.mode==='v6-forward-training-manifest')
  verifyCanonicalManifestLineage(manifest,{now});
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
  if(/样本不足或未来收益窗口重叠|新增独立样本外交易日不足|恢复后未达到5个事前注册的全新成熟保留日/.test(String(e.message)))
   return {ok:true,status:'skipped-insufficient-independent-h5-days',canTrade:false,productionWeightsChanged:false};
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
 if(config.mode==='register-seed')return runRegisterSeed(config);
 // The operational CLI MUST consume the receipt-backed canonical manifest.
 // Legacy minimal manifests remain supported by the direct research test API,
 // but are not accepted by the unattended operator commands.
 const operatorManifest=readJson(config.manifestFile);
 if(operatorManifest?.mode!=='v6-forward-training-manifest')
  throw Error('运维自动学习命令仅接受冻结回执与首份成熟H5绑定的正式研究清单，拒绝旧版简化测试清单');
 if(config.mode==='health')return runHealth(config);
 if(config.mode==='register')return runRegister(config);
 if(config.mode==='register-auto')return runRegisterAuto(config);
 if(config.mode==='once')return runOnce({...config,operatorMode:true});
 let busy=false,closing=false;
 const tick=()=>{
  if(busy||closing)return;
  busy=true;
  try{console.log(JSON.stringify(runOnce({...config,operatorMode:true,
   watchPulse:true,watchIntervalMs:config.interval})));}
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
module.exports={parse,runOnce,runRegister,runRegisterAuto,runRegisterSeed,latestAccepted,latestCooldown,
 latestTrial,globalTrialBudget,latestCandidateRegistration,main,readEpisodeReport,
 runHealth,readWatchHeartbeat,writeWatchHeartbeat};
