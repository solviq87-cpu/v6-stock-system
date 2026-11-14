'use strict';
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const active=new Set();
function runStockObservationJob(payload,options={}){
 const group=options.jobGroup==='automatic'?'automatic':'interactive';
 if(active.has(group))return Promise.resolve({ok:false,error:'股票观察任务正在运行'});
 active.add(group);
 return new Promise(resolve=>{
  let worker,timer,done=false,progress=null;
  const finish=async result=>{if(done)return;done=true;clearTimeout(timer);try{if(worker)await worker.terminate();}finally{
   if(!options.action&&options.workspaceRoot&&!result.ok)result.diagnosticId=require('../core/research-workspace').saveDiagnostic(options,{symbol:payload?.symbol||null,provider:payload?.provider||null,status:'failed',stages:progress||[],errorCode:'CAPTURE_JOB_FAILED',retry:'原始档案保留；检查最后阶段后使用原入口重试'});
   active.delete(group);resolve(result);}};
  try{worker=new Worker(__filename,{workerData:{payload,options,__v6StockObservationJob:true},resourceLimits:{maxOldGenerationSizeMb:192}});
   worker.on('message',message=>{if(message?.progress){progress=message.progress;return;}void finish(message);});worker.once('error',()=>finish({ok:false,error:'股票观察任务未完成'}));
   worker.once('exit',()=>finish({ok:false,error:'股票观察任务已停止'}));
   timer=setTimeout(()=>finish({ok:false,error:'股票观察任务超过55秒'}),55000);
  }catch{finish({ok:false,error:'无法启动股票观察任务'});}
 });
}
if(!isMainThread&&workerData?.__v6StockObservationJob===true){
 const {payload,options}=workerData;
 const stages=[],capture=!options.action&&!!options.workspaceRoot;
 const onResearchStage=(stage,status)=>{const now=Date.now();if(status==='started')stages.push({stage,status,startedAt:now});else{const row=stages.findLast(r=>r.stage===stage&&r.status==='started');if(row)Object.assign(row,{status,finishedAt:now,durationMs:Math.max(0,now-row.startedAt)});}parentPort.postMessage({progress:stages});};
 Promise.resolve().then(()=>options.action==='status'
  ?require('../core/stock-observation-monitor').readStockResearchStatus(options)
  :options.action==='read-public-sectors'
  ?require('../core/public-sector-research').readPublicSectorResearch(options.publicSectorRoot)
  :options.action==='capture-public-sectors'
  ?require('../core/public-sector-research').capturePublicSectorResearch(options.publicSectorRoot,payload)
  :options.action==='sector'
  ?require('../core/stock-observation-research').sectorCaptureResearch({captureRoot:options.sectorCaptureRoot,calendarFile:options.calendarFile,asOf:Date.now(),sectorIds:payload.sectorIds})
  :options.action==='read'
  ?require('../core/stock-observation-research').readStockObservationResearch(payload,options)
  :require('../core/stock-observation-research').observeStock(payload,capture?{...options,onResearchStage}:options))
 .then(result=>{
  if(!options.action&&options.workspaceRoot&&result?.stock){
   onResearchStage('封存研究工作区','started');
   try{result.workspace=require('../core/research-workspace').saveObservation(result,options,{stages});onResearchStage('封存研究工作区','completed');}
   catch{onResearchStage('封存研究工作区','failed');result.workspace={status:'failed',error:'研究工作区封存失败，原始观察与研究档案保留'};}
  }
  if(capture){const complete=result?.stock&&result?.analysis&&result?.workspace?.status==='saved'&&result?.memory?.status!=='failed'&&result?.researchFollowups?.status!=='blocked';
   result.workspaceDiagnosticId=require('../core/research-workspace').saveDiagnostic(options,{symbol:payload.symbol,provider:result?.stock?.provider||payload.provider||null,runId:result.workspace?.runId||null,status:complete?'completed':'partial',stages,blockers:result.readiness?.blockers||[]});}
  parentPort.postMessage({ok:true,result});
 }).catch(()=>parentPort.postMessage({ok:false,error:'股票参数、存储或研究输入无效'}));
}
module.exports={runStockObservationJob};
