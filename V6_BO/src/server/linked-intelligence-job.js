'use strict';
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const workerBudget=require('./worker-admission-budget');
let active=false;
function runLinkedIntelligenceJob(payload,{memoryRoot,action='analyze'}={}){
 if(active)return Promise.resolve({ok:false,error:'联动研究任务正在运行'});
 const lease=workerBudget.tryAcquire('linked-intelligence');
 if(!lease)return Promise.resolve({ok:false,error:'联动研究任务正在运行'});
 active=true;
 return new Promise(resolve=>{
  let worker,timer,done=false;
  const finish=async result=>{if(done)return;done=true;clearTimeout(timer);await lease.stop();active=false;resolve(result);};
  try{
   worker=lease.watch(new Worker(__filename,lease.options({kind:'linked-intelligence',payload,memoryRoot,action})));
   worker.once('message',finish);worker.once('error',()=>finish({ok:false,error:'联动研究未完成'}));
   worker.once('exit',()=>finish({ok:false,error:'联动研究已停止'}));
   timer=setTimeout(()=>finish({ok:false,error:'联动研究超过时限'}),15000);
  }catch{finish({ok:false,error:'无法启动联动研究'});}
 });
}
if(!isMainThread&&workerData?.kind==='linked-intelligence'){
 try{
  const result=workerData.action==='read-memory'
   ?require('../core/stock-intelligence-memory').readStockMemory(workerData.memoryRoot,workerData.payload.symbol,{limit:20})
   :require('../core/linked-market-intelligence').buildLinkedIntelligence(workerData.payload,{memoryRoot:workerData.memoryRoot});
  parentPort.postMessage({ok:true,result});
 }
 catch(e){parentPort.postMessage({ok:false,error:String(e.message).slice(0,160)});}
}
module.exports={runLinkedIntelligenceJob};
