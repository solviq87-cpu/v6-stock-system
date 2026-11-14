'use strict';
// Bounded research agent: perception -> fixed plan -> existing gated cycle ->
// reflection. Neither memory nor this controller can authorize a model/trade.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {readJson}=require('./forward-tracking-store');
const {validatePaths,checkSource,runDailyCycle}=require('./factor-daily-research-cycle');
const {discoverCaptures}=require('./factor-maturity-manifest');
const {currentResearchCodeFingerprint,verifySeedRegistrationMetadata,SEED_MODE}=require('./factor-candidate-prereg');
const {safeNew,writeNew}=require('../../scripts/factor-shadow-evolution');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const sealed=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const inside=(a,b)=>a===b||a.startsWith(b+path.sep);
const day=t=>new Date(t+8*3600000).toISOString().slice(0,10);
function privatePath(file){
 const result=safeNew(file);
 if(result.split(path.sep).some(p=>['config','configs','strategy','strategies'].includes(p)))
  throw Error('agent-private-path-rejected');
 return result;
}
function validateConfig(config){
 if(!config||config.schemaVersion!==1||config.mode!=='v6-factor-research-agent'||
    config.researchOnly!==true||config.canTrade!==false||
    Object.keys(config).some(k=>!['schemaVersion','mode','researchOnly','canTrade','cycle','outputDir'].includes(k)))
  throw Error('agent-config-rejected');
 validatePaths(config.cycle);
 const out=privatePath(config.outputDir);
 for(const [key,value] of Object.entries(config.cycle))if(typeof value==='string'&&key!=='mode'){
  const target=path.resolve(value);
  if(inside(target,out)||inside(out,target))throw Error('agent-path-overlap-rejected');
  if(!['historyFile','picksFile','factorsFile'].includes(key))privatePath(value);
 }
 return config;
}
function names(dir,pattern){
 safeNew(path.join(dir,'.agent-read-guard'));
 if(!fs.existsSync(dir))return [];
 const all=fs.readdirSync(dir);
 if(all.length>2000)throw Error('agent-evidence-limit');
 // Reject aliases before traversing any evidence; never follow a symlink.
 for(const name of all)safeNew(path.join(dir,name));
 return all.filter(n=>pattern.test(n)).sort();
}
function lineage(dir){
 return names(dir,/^(shadow-|prereg-).*\.json$/).map(name=>{
  const item=readJson(path.join(dir,name)),{fingerprint,...body}=item;
  const seed=item.mode===SEED_MODE;
  const prereg=seed||item.mode==='v6-shadow-candidate-prereg-v1';
  const expected=prereg?`prereg-${fingerprint?.slice(0,12)}.json`:
   `shadow-${item.trainingEnd}-${fingerprint?.slice(0,12)}.json`;
  if(item.schemaVersion!==1||!sealed(fingerprint)||hash(body)!==fingerprint||name!==expected||
     (!prereg&&item.mode!=='v6-factor-shadow-evolution-v1')||
     item.canTrade!==false||item.productionWeightsChanged!==false)
   throw Error('agent-lineage-integrity-rejected');
  if(seed)verifySeedRegistrationMetadata(item);
  if(prereg&&!seed&&(!sealed(item.packFingerprint)||!sealed(item.algorithmFingerprint)||
     item.sealedBeforeFutureSignals!==true||!Number.isSafeInteger(item.registeredAt)||
     !Number.isSafeInteger(item.lastFrozenCapturedAt)||item.registeredAt<item.lastFrozenCapturedAt||
     !Array.isArray(item.frozenPrefixFingerprints)||item.frozenPrefixFingerprints.length<36||
     item.frozenPrefixFingerprints.some(f=>!sealed(f))||
     !Array.isArray(item.factorIds)||item.factorIds.length<2||
     item.factorIds.some(id=>!Number.isFinite(item.candidateWeights?.[id])||
      !Number.isFinite(item.acceptedWeights?.[id]))))throw Error('agent-prereg-metadata-rejected');
  return {name,fingerprint}; // No performance-driven action selection.
 });
}
function perceive(config,now){
 const cycle=config.cycle;
 const captures=fs.existsSync(cycle.captureDir)?discoverCaptures(cycle.captureDir,{now}):[];
 const frozen=captures.map(c=>({day:c.date,featureFingerprint:c.features.fingerprint,
  cohortFingerprint:c.cohort.fingerprint}));
 const archives=[];
 for(const date of names(cycle.trackingDir,/^\d{4}-\d{2}-\d{2}$/)){
  const dir=path.join(cycle.trackingDir,date,'forward-tracking-history');
  // Filenames alone: H5 payloads stay unopened until worker prereg/budget gates.
  archives.push([date,names(dir,/^\d{8}-\d{4}-\d{2}-\d{2}\.json$/)]);
 }
 const modelLineage=lineage(cycle.modelDir),inputs={};
 for(const key of ['historyFile','picksFile','factorsFile']){
  safeNew(cycle[key]);
  inputs[key]=fs.existsSync(cycle[key])?hash(readJson(cycle[key])):null;
 }
 let capture,observe;
 try{capture=checkSource(cycle,'capture',now);}catch{capture={status:'needs-data'};}
 try{observe=checkSource(cycle,'observe',now);}catch{observe={status:'needs-data'};}
 const sourceDay=capture.asOf??observe.asOf??null;
 const mode=capture.status==='ready'&&!frozen.some(c=>c.day===day(now))?'capture':'observe';
 const check=mode==='capture'?capture:observe;
 const ready=check.status==='ready';
 const localModel=process.env.V6_LOCAL_LEARNING_MODEL?hash({model:process.env.V6_LOCAL_LEARNING_MODEL,endpoint:process.env.V6_LOCAL_LEARNING_ENDPOINT||'http://127.0.0.1:11434',digest:process.env.V6_LOCAL_LEARNING_DIGEST||null}):null;
 const fingerprint=hash({config,inputs,frozen,archives,modelLineage,day:day(now),
  ...(localModel?{localModel}:{}),code:currentResearchCodeFingerprint(),controller:hash(fs.readFileSync(__filename,'utf8'))});
 return {fingerprint,mode,ready,sourceDay,captureDays:frozen.length,
  nextAction:ready?`run-${mode}-research-cycle`:
   (inputs.historyFile===null?'provide-current-day-authorized-source':
    captures.length===0?'provide-causal-current-day-picks-and-factor-evidence':'provide-current-day-authorized-source')};
}
const STAGES=new Set(['perception','planning','reflection','idle','unconfigured']);
const STATUSES=new Set(['preview-ready','needs-data','research-cycle-completed-not-certified',
 'failed-stop-and-audit-before-retry','unchanged','unconfigured','blocked-invalid-agent-journal']);
const ACTIONS=new Set(['run-capture-research-cycle','run-observe-research-cycle',
 'provide-current-day-authorized-source','provide-causal-current-day-picks-and-factor-evidence',
 'await-next-source-or-research-lineage','audit-private-research-artifacts-before-retry',
 'provide-sealed-prior-research-or-explicit-preregistration','await-signals-frozen-after-preregistration',
 'await-independent-matured-h5-days','await-preregistered-prefix-h5-maturity','await-global-trial-budget','configure-private-research-agent']);
function summary(value={}){
 return {stage:STAGES.has(value.stage)?value.stage:'reflection',
  status:STATUSES.has(value.status)?value.status:'failed-stop-and-audit-before-retry',
  nextAction:ACTIONS.has(value.nextAction)?value.nextAction:'audit-private-research-artifacts-before-retry',
  sourceDay:typeof value.sourceDay==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value.sourceDay)?value.sourceDay:null,
  captureDays:Number.isSafeInteger(value.captureDays)&&value.captureDays>=0?value.captureDays:0,
  shadowStatus:typeof value.shadowStatus==='string'&&value.shadowStatus.length<100&&/^(skipped-[a-z0-9-]+|candidate-auto-preregistered|shadow-[a-z-]+|paused-[a-z-]+)$/.test(value.shadowStatus)?value.shadowStatus:null,
  ...(typeof value.modelName==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value.modelName)&&/^[a-f0-9]{64}$/.test(value.modelDigest||'')?{modelName:value.modelName,modelDigest:value.modelDigest}:{}),
  version:Number.isSafeInteger(value.version)&&value.version>=0?value.version:null,
  eventFingerprint:sealed(value.eventFingerprint)?value.eventFingerprint:null,
  checkTime:Number.isSafeInteger(value.checkTime)?value.checkTime:null,
  researchOnly:true,canTrade:false,productionWeightsChanged:false};
}
function readEvents(dir){
 if(fs.existsSync(dir)&&(!fs.statSync(dir).isDirectory()||(fs.statSync(dir).mode&0o077)!==0))
  throw Error('agent-journal-directory-not-private');
 const files=names(dir,/^event-.*\.json$/),events=[];
 let parent=null;
 for(const name of files){
  if(fs.statSync(path.join(dir,name)).size>16384)throw Error('agent-journal-entry-too-large');
  const event=readJson(path.join(dir,name)),{fingerprint,...body}=event;
  const prior=events.at(-1),requiredAck=prior?.outcome==='failed'?prior.fingerprint:null;
  if((fs.statSync(path.join(dir,name)).mode&0o777)!==0o600)
   throw Error('agent-journal-file-not-private');
  if(event.schemaVersion!==1||event.mode!=='v6-factor-research-agent-event'||
     !sealed(fingerprint)||hash(body)!==fingerprint||event.parentMemory!==parent||
     event.sequence!==events.length+1||!sealed(event.inputFingerprint)||
     !sealed(event.settledFingerprint)||!sealed(event.decisionFingerprint)||
     !['completed','needs-data','failed'].includes(event.outcome)||
     !['capture','observe'].includes(event.action)||
     (event.acknowledgedFailure??null)!==requiredAck||
     name!==`event-${String(event.sequence).padStart(8,'0')}-${fingerprint.slice(0,12)}.json`||
     hash(summary(event.summary))!==hash(event.summary)||
     event.summary.eventFingerprint!==null)
   throw Error('agent-journal-integrity-rejected');
  events.push(event);parent=fingerprint;
 }
 return events;
}
function readAgentStatus(dir){
 if(!dir)return summary({stage:'unconfigured',status:'unconfigured',nextAction:'configure-private-research-agent'});
 try{
  privatePath(dir);
  const event=readEvents(dir).at(-1);
  return event?summary({...event.summary,eventFingerprint:event.fingerprint}):
   summary({stage:'unconfigured',status:'unconfigured',nextAction:'configure-private-research-agent'});
 }catch{return summary({stage:'reflection',status:'blocked-invalid-agent-journal',nextAction:'audit-private-research-artifacts-before-retry'});}
}
function runAgent(config,{apply=false,now=Date.now(),ackFailure}={}){
 if(process.env.V6_LOCAL_LEARNING_MODEL&&!/^(?:sha256:)?[a-f0-9]{64}$/.test(process.env.V6_LOCAL_LEARNING_DIGEST||''))throw Error('agent-local-model-digest-required');
 try{const value=run(config,{apply,now,ackFailure});return value&&typeof value.then==='function'?value.catch(()=>{throw Error('factor-research-agent-stopped-check-private-config-evidence-and-lock');}):value;}
 catch{throw Error('factor-research-agent-stopped-check-private-config-evidence-and-lock');}
}
function run(config,{apply,now,ackFailure}){
 validateConfig(config);
 if(typeof apply!=='boolean'||!Number.isSafeInteger(now)||now<=0)throw Error('agent-options-rejected');
 if(ackFailure!==undefined&&(!apply||!sealed(ackFailure)))throw Error('agent-failure-ack-rejected');
 const dir=config.outputDir,lock=privatePath(path.join(dir,'.factor-agent.lock'));
 if(fs.existsSync(lock))throw Error('agent-lock-rejected');
 // Preview reads all seals, but creates neither output directories nor locks.
 if(!apply)return plan(perceive(config,now),readEvents(dir),now).output;
 fs.mkdirSync(dir,{recursive:true,mode:0o700});privatePath(lock);
 const fd=fs.openSync(lock,'wx',0o600);
 let released=false;
 const release=()=>{if(released)return;released=true;const held=fs.fstatSync(fd);fs.closeSync(fd);const current=fs.lstatSync(lock);if(held.ino!==current.ino||held.dev!==current.dev)throw Error('agent-lock-identity-changed');fs.unlinkSync(lock);};
 try{
  fs.writeFileSync(fd,String(process.pid));fs.fsyncSync(fd);
  const events=readEvents(dir),last=events.at(-1);
  if(ackFailure!==undefined&&(last?.outcome!=='failed'||last.fingerprint!==ackFailure))throw Error('agent-failure-ack-rejected');
  const before=perceive(config,now),planned=plan(before,events,now,{acknowledged:ackFailure!==undefined});
  if(planned.repeated){release();return planned.output;}
  let after=before;
  const finish=outcome=>{
  const shadow=outcome?.stages?.find(s=>s.stage==='independent-shadow-model');
  const status=!before.ready?'needs-data':outcome.status==='research-cycle-completed-not-certified'?
   outcome.status:'failed-stop-and-audit-before-retry';
  const output=summary({stage:'reflection',status,sourceDay:after.sourceDay,
   captureDays:after.captureDays,shadowStatus:shadow?.status,modelName:shadow?.modelName,modelDigest:shadow?.modelDigest,version:outcome?.shadowModelVersion,
   nextAction:status==='failed-stop-and-audit-before-retry'?'audit-private-research-artifacts-before-retry':
    !before.ready?before.nextAction:shadow?.nextAction??'await-next-source-or-research-lineage',checkTime:now});
  const body={schemaVersion:1,mode:'v6-factor-research-agent-event',sequence:events.length+1,
   parentMemory:events.at(-1)?.fingerprint??null,inputFingerprint:before.fingerprint,
   acknowledgedFailure:ackFailure??null,
   settledFingerprint:after.fingerprint,decisionFingerprint:hash({action:before.mode,ready:before.ready,nextAction:before.nextAction}),
   action:before.mode,outcome:!before.ready?'needs-data':status==='research-cycle-completed-not-certified'?'completed':'failed',
   summary:output};
  const fingerprint=hash(body);
  writeNew(path.join(dir,`event-${String(body.sequence).padStart(8,'0')}-${fingerprint.slice(0,12)}.json`),{...body,fingerprint});
  return summary({...output,eventFingerprint:fingerprint});
  };
  if(before.ready){
   let outcome;
   try{outcome=runDailyCycle(config.cycle,{mode:before.mode,apply:true,now});}
   catch{outcome={status:'failed-stop-and-audit-before-retry'};}
   if(outcome&&typeof outcome.then==='function')return outcome.then(value=>{try{after=perceive(config,now);return finish(value);}catch{return finish({status:'failed-stop-and-audit-before-retry'});}},()=>finish({status:'failed-stop-and-audit-before-retry'})).finally(release);
   if(outcome.status!=='failed-stop-and-audit-before-retry')try{after=perceive(config,now);}catch{outcome={status:'failed-stop-and-audit-before-retry'};}
   const value=finish(outcome);release();return value;
  }
  const value=finish(null);release();return value;
 }catch(e){release();throw e;}
}
function plan(perception,events,now,{acknowledged=false}={}){
 const last=events.at(-1);
 // Partial writes change perception too. A changed source or date must not
 // silently authorize another execution after an audit-required failure.
 if(last?.outcome==='failed'&&!acknowledged)return {repeated:true,output:summary({...last.summary,
  stage:'idle',status:'failed-stop-and-audit-before-retry',
  nextAction:'audit-private-research-artifacts-before-retry',eventFingerprint:last.fingerprint,checkTime:now})};
 const repeated=!acknowledged&&!!last&&[last.inputFingerprint,last.settledFingerprint].includes(perception.fingerprint);
 if(repeated)return {repeated:true,output:summary({...last.summary,stage:'idle',
  status:last.summary.status==='failed-stop-and-audit-before-retry'?last.summary.status:'unchanged',
  eventFingerprint:last.fingerprint,checkTime:now})};
 return {repeated:false,output:summary({stage:'planning',status:perception.ready?'preview-ready':'needs-data',
  sourceDay:perception.sourceDay,captureDays:perception.captureDays,nextAction:perception.nextAction,checkTime:now})};
}
module.exports={runAgent,readAgentStatus,validateConfig};
