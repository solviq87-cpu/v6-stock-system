#!/usr/bin/env node
'use strict';
// Operator-enabled unattended research worker. Reads only private imported
// evidence, emits immutable shadow-model revisions, NEVER production weights.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {readJson,readSnapshot}=require('../src/core/forward-tracking-store');
const {evolveShadowFactors}=require('../src/core/factor-shadow-evolution');
const {writeNew,safeNew}=require('./factor-shadow-evolution');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function parse(args){
 const [mode,manifestFile,outputDir,...flags]=args;
 if(!['once','watch'].includes(mode)||!manifestFile||!outputDir||
    !path.isAbsolute(manifestFile)||!path.isAbsolute(outputDir))
  throw Error('用法: factor-shadow-worker.js once|watch <私有manifest绝对路径> <私有模型目录绝对路径> [--interval 60000]');
 if(flags.length&&(mode!=='watch'||flags.length!==2||flags[0]!=='--interval'))
  throw Error('轮询仅支持 watch --interval 毫秒');
 const interval=flags.length?Number(flags[1]):60000;
 if(!Number.isSafeInteger(interval)||interval<30000||interval>3600000)
  throw Error('研究轮询间隔必须为30000至3600000毫秒');
 safeNew(path.join(outputDir,'shadow-guard.json'));
 return {mode,manifestFile,outputDir,interval};
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
  if(hash(payload)!==fingerprint)throw Error('研究模型归档完整性无效');
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
  if(hash(payload)!==fingerprint||!name.includes(fingerprint.slice(0,12)))
   throw Error('冷却研究档案完整性无效');
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
function runOnce({manifestFile,outputDir,now=Date.now()}={}){
 const conf=parse(['once',manifestFile,outputDir]);
 const manifest=readJson(conf.manifestFile);
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
 const previous=latestAccepted(conf.outputDir);
 const previousCooldown=latestCooldown(conf.outputDir,previous);
 const episodes=manifest.episodes.map(x=>{
  if(typeof x?.featuresFile!=='string'||typeof x.reportFile!=='string')
   throw Error('批次文件路径无效');
  return {features:readJson(x.featuresFile),report:readEpisodeReport(x.reportFile)};
 });
 let result;
 try{
  result=evolveShadowFactors(episodes,{now,previous,previousCooldown,
   marketContext:manifest.marketContext});
 }catch(e){
  if(previous&&/未增加新的训练时间窗/.test(String(e.message)))
   return {ok:true,status:'skipped-no-new-training',version:previous.version,
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
module.exports={parse,runOnce,latestAccepted,latestCooldown,main,readEpisodeReport};
