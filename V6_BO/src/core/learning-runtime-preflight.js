'use strict';
// A read-only view of the agent's current plan and separately its journal.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {safeNew}=require('../../scripts/factor-shadow-evolution');
const {runAgent,readAgentStatus,validateConfig}=require('./factor-research-agent');
const {checkSource}=require('./factor-daily-research-cycle');
const MAX=65536;
const actions=new Set(['run-capture-research-cycle','run-observe-research-cycle','provide-current-day-authorized-source','provide-causal-current-day-picks-and-factor-evidence','await-next-source-or-research-lineage','audit-private-research-artifacts-before-retry','provide-sealed-prior-research-or-explicit-preregistration','await-signals-frozen-after-preregistration','await-independent-matured-h5-days','await-preregistered-prefix-h5-maturity','await-global-trial-budget','configure-private-research-agent']);
const modelKeys=['V6_LOCAL_LEARNING_MODEL','V6_LOCAL_LEARNING_ENDPOINT','V6_LOCAL_LEARNING_DIGEST'];
function readConfig(file){
 safeNew(file);
 const before=fs.lstatSync(file);
 if(!before.isFile()||(before.mode&0o7777)!==0o600||before.size>MAX)throw Error('invalid');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const held=fs.fstatSync(fd),after=fs.lstatSync(file);
  if(!held.isFile()||(held.mode&0o7777)!==0o600||held.size>MAX||held.dev!==before.dev||held.ino!==before.ino||held.dev!==after.dev||held.ino!==after.ino)throw Error('invalid');
  safeNew(file);
  const buffer=Buffer.alloc(MAX+1);let used=0,n;
  while(used<buffer.length&&(n=fs.readSync(fd,buffer,used,buffer.length-used,null))>0)used+=n;
  if(used>MAX)throw Error('invalid');
  const end=fs.fstatSync(fd);
  if(end.size!==held.size||end.mtimeMs!==held.mtimeMs||end.ctimeMs!==held.ctimeMs)throw Error('invalid');
  return JSON.parse(buffer.subarray(0,used).toString('utf8'));
 }finally{fs.closeSync(fd);}
}
function modelConfig(env){
 const name=env.V6_LOCAL_LEARNING_MODEL;
 if(!name)return {status:'disabled',modelName:null,modelDigest:null,checkedAt:null,inferenceVerified:false};
 const digest=env.V6_LOCAL_LEARNING_DIGEST,endpoint=env.V6_LOCAL_LEARNING_ENDPOINT||'http://127.0.0.1:11434';
 let url;
 try{url=new URL(endpoint);}catch{}
 if(typeof name!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(name)||typeof digest!=='string'||!/^(?:sha256:)?[a-f0-9]{64}$/.test(digest)||typeof endpoint!=='string'||!/^http:\/\/(?:127\.0\.0\.1|\[::1\]):[0-9]+\/?$/.test(endpoint)||!url||!url.port||+endpoint.match(/:(\d+)\/?$/)[1]<1||+endpoint.match(/:(\d+)\/?$/)[1]>65535||url.username||url.password||url.pathname!=='/'||url.search||url.hash)
  return {status:'invalid-config',modelName:null,modelDigest:null,checkedAt:null,inferenceVerified:false};
 return {status:'not-probed',modelName:name,modelDigest:digest.replace(/^sha256:/,''),checkedAt:null,inferenceVerified:false,url};
}
function probe(model){return new Promise(resolve=>{
 let done=false,req,timer;
 const finish=status=>{if(done)return;done=true;clearTimeout(timer);if(req)req.destroy();resolve(status);};
 timer=setTimeout(()=>finish('unavailable'),5000);
 try{
  req=http.get(new URL('/api/tags',model.url),{agent:false},res=>{
   if(res.statusCode!==200){res.resume();finish('unavailable');return;}
   let size=0,parts=[];
   res.on('data',chunk=>{size+=chunk.length;if(size>MAX){finish('unavailable');return;}parts.push(chunk);});
   res.on('error',()=>finish('unavailable'));
   res.on('aborted',()=>finish('unavailable'));
   res.on('end',()=>{try{
    const data=JSON.parse(Buffer.concat(parts).toString('utf8'));
    if(!Array.isArray(data?.models)){finish('unavailable');return;}
    const matches=data.models.filter(x=>x?.name===model.modelName);
    const digest=matches[0]?.digest;
    finish(matches.length===1&&typeof digest==='string'&&digest.replace(/^sha256:/,'')===model.modelDigest?'verified':'digest-mismatch');
   }catch{finish('unavailable');}});
  });
  req.on('error',()=>finish('unavailable'));
 }catch{finish('unavailable');}
});}
async function inspectLearningRuntime({probeModel=false,now=Date.now(),env=process.env}={}){
 const time=Number.isSafeInteger(now)&&now>0?now:null;
 const model=modelConfig(env||{});
 if(probeModel===true&&model.status==='not-probed'){model.status=await probe(model);model.checkedAt=time;}
 delete model.url;
 const report={schemaVersion:1,mode:'v6-learning-runtime-preflight',checkedAt:time,readOnly:true,researchOnly:true,canTrade:false,productionWeightsChanged:false,overall:'unconfigured',nextAction:'configure-private-research-agent',configuration:{status:'unconfigured'},model,current:{status:'unconfigured',nextAction:null,sourceDay:null,captureDays:null},lastRun:null};
 const file=env?.V6_FACTOR_AGENT_CONFIG_FILE;
 if(!file)return report;
 report.configuration.status='invalid';report.current.status='not-checked';
 let config;
 try{
  if(typeof file!=='string'||!path.isAbsolute(file)||!time)throw Error('invalid');
  config=validateConfig(readConfig(file));
  const configPath=path.resolve(file),output=path.resolve(config.outputDir);
  const relative=path.relative(output,configPath);
  if(!relative||(!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)))throw Error('invalid');
  const memory=env.V6_FACTOR_AGENT_DIR;
  if(memory&&(typeof memory!=='string'||!path.isAbsolute(memory)||safeNew(memory)!==output)){
   report.configuration.status='memory-mismatch';throw Error('mismatch');
  }
  report.configuration.status='configured';
 }catch{report.overall='blocked';report.nextAction='check-private-configuration';return report;}
 try{
  const last=readAgentStatus(config.outputDir);
  if(last.status==='blocked-invalid-agent-journal')throw Error('journal');
  if(last.status!=='unconfigured')report.lastRun=last;
  if(modelKeys.some(k=>(env[k]||'')!==(process.env[k]||'')))throw Error('environment');
  const preview=await runAgent(config,{apply:false,now});
  let status=preview.status==='failed-stop-and-audit-before-retry'?'blocked':
   ['preview-ready','needs-data','unchanged'].includes(preview.status)?preview.status:'blocked';
  let nextAction=actions.has(preview.nextAction)?preview.nextAction:'audit-private-research-artifacts-before-retry';
  if(status==='unchanged'){
   let ready=false;
   for(const mode of ['capture','observe'])try{if(checkSource(config.cycle,mode,now).status==='ready')ready=true;}catch{}
   if(!ready){status='needs-data';nextAction='provide-current-day-authorized-source';}
  }
  report.current={status,nextAction,sourceDay:typeof preview.sourceDay==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(preview.sourceDay)?preview.sourceDay:null,captureDays:Number.isSafeInteger(preview.captureDays)&&preview.captureDays>=0?preview.captureDays:null};
 }catch{report.current={status:'blocked',nextAction:'audit-private-research-artifacts-before-retry',sourceDay:null,captureDays:null};}
 if(report.current.status==='blocked'){report.overall='blocked';report.nextAction=report.current.nextAction;}
 else if(['invalid-config','unavailable','digest-mismatch'].includes(model.status)){report.overall='blocked';report.nextAction='check-local-model-configuration';}
 else if(report.current.status==='needs-data'||(report.current.status==='unchanged'&&['provide-current-day-authorized-source','provide-causal-current-day-picks-and-factor-evidence'].includes(report.current.nextAction))){report.overall='needs-data';report.nextAction=report.current.nextAction;}
 else if(model.status==='not-probed'){report.overall='awaiting-model-probe';report.nextAction='probe-local-model';}
 else{report.overall='ready-for-research';report.nextAction=report.current.nextAction;}
 return report;
}
// Read only the original configured private daily capture. No directory
// scanning, remote calls, agent execution, account writes or inferred dates.
function readPortfolioSizeCapture({now=Date.now(),env=process.env,calendar}={}){
 const file=env?.V6_FACTOR_AGENT_CONFIG_FILE;
 if(typeof file!=='string'||!path.isAbsolute(file)||!Number.isSafeInteger(now)||now<=0)return null;
 try{
  const config=validateConfig(readConfig(file)),output=path.resolve(config.outputDir);
  const rel=path.relative(output,path.resolve(file));
  if(!rel||(!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel)))return null;
  if(env.V6_FACTOR_AGENT_DIR&&(!path.isAbsolute(env.V6_FACTOR_AGENT_DIR)||safeNew(env.V6_FACTOR_AGENT_DIR)!==output))return null;
  const {sizeReferenceDays,buildSizePartition}=require('./factor-size-style-evidence');
  const {verifyDailyCapture}=require('./factor-maturity-manifest');
  const {verifyEpisode}=require('./factor-shadow-evolution');
  for(const day of sizeReferenceDays(calendar,now)){
   const receipt=safeNew(path.join(config.cycle.captureDir,'receipt-'+day+'.json'));
   // A missing current receipt can use the known adjacent prior session.
   // A corrupt current receipt is not a reason to silently fall back.
   if(!fs.existsSync(receipt))continue;
   const files=[receipt,...['cohort','features'].map(k=>safeNew(path.join(config.cycle.captureDir,k+'-'+day+'.json')))];
   const stats=files.map(p=>fs.lstatSync(p));
   if(stats.some(s=>!s.isFile()||(s.mode&0o7777)!==0o600||s.size<=0||s.size>4*1024*1024))return null;
   const captured=verifyDailyCapture(receipt,{now}),e=verifyEpisode(captured.features,now),cohort=captured.cohort;
   if(e.signalDay!==day||JSON.stringify(e.priceFeed)!==JSON.stringify(cohort.feed)||e.features.length!==cohort.signals.length)return null;
   const originals=new Map(cohort.signals.map(s=>[s.signalId,s]));
   if(originals.size!==e.features.length||e.features.some(x=>{const s=originals.get(x.signalId);
     return !s||['symbol','signalDate','signalAt','baselineClose'].some(k=>s[k]!==x[k]);}))return null;
   for(let i=0;i<files.length;i++){
    const after=fs.lstatSync(safeNew(files[i])),before=stats[i];
    if(!after.isFile()||after.dev!==before.dev||after.ino!==before.ino||after.mode!==before.mode||
     after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)return null;
   }
   const partition=buildSizePartition(e.features,{provider:e.feed.provider,datasetId:e.feed.datasetId,signalDay:day});
   return partition.status==='declared-point-in-time-partition'?captured.features:null;
  }
 }catch{/* Optional research archive cannot block the original account read. */}
 return null;
}
module.exports={inspectLearningRuntime,readPortfolioSizeCapture};
