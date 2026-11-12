'use strict';
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const active=new Set();
function runStockObservationJob(payload,options={}){
 const group=options.jobGroup==='automatic'?'automatic':'interactive';
 if(active.has(group))return Promise.resolve({ok:false,error:'股票观察任务正在运行'});
 active.add(group);
 return new Promise(resolve=>{
  let worker,timer,done=false;
  const finish=async result=>{if(done)return;done=true;clearTimeout(timer);try{if(worker)await worker.terminate();}finally{active.delete(group);resolve(result);}};
  try{worker=new Worker(__filename,{workerData:{payload,options},resourceLimits:{maxOldGenerationSizeMb:192}});
   worker.once('message',finish);worker.once('error',()=>finish({ok:false,error:'股票观察任务未完成'}));
   worker.once('exit',()=>finish({ok:false,error:'股票观察任务已停止'}));
   timer=setTimeout(()=>finish({ok:false,error:'股票观察任务超过55秒'}),55000);
  }catch{finish({ok:false,error:'无法启动股票观察任务'});}
 });
}
if(!isMainThread){
 const {payload,options}=workerData;
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
  :require('../core/stock-observation-research').observeStock(payload,options))
 .then(result=>parentPort.postMessage({ok:true,result})).catch(()=>parentPort.postMessage({ok:false,error:'股票参数、存储或研究输入无效'}));
}
module.exports={runStockObservationJob};
