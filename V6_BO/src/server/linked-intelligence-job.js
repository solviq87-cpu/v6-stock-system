'use strict';
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
let active=false;
function runLinkedIntelligenceJob(payload,{memoryRoot,action='analyze'}={}){
 if(active)return Promise.resolve({ok:false,error:'联动研究任务正在运行'});
 active=true;
 return new Promise(resolve=>{
  let worker,timer,done=false;
  const finish=async result=>{if(done)return;done=true;clearTimeout(timer);try{if(worker)await worker.terminate();}finally{active=false;resolve(result);}};
  try{
   worker=new Worker(__filename,{workerData:{kind:'linked-intelligence',payload,memoryRoot,action},resourceLimits:{maxOldGenerationSizeMb:192}});
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
