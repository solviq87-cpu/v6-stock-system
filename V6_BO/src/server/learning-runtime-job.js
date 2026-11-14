'use strict';
// Current-input inspection can be expensive; keep it off the quote polling thread.
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
let active=false;
function runLearningRuntimeJob({probeModel=false}={}){
 if(typeof probeModel!=='boolean')return Promise.resolve({ok:false,httpStatus:400,error:'运行检查参数无效'});
 if(active)return Promise.resolve({ok:false,httpStatus:503,error:'运行检查正在进行，请稍后重试'});
 active=true;
 return new Promise(resolve=>{
  let worker,timer,settled=false;
  const finish=async result=>{
   if(settled)return;settled=true;clearTimeout(timer);
   try{await worker?.terminate();}catch{}finally{active=false;resolve(result);}
  };
  try{
   worker=new Worker(__filename,{workerData:{kind:'learning-runtime',probeModel},resourceLimits:{maxOldGenerationSizeMb:192}});
   worker.once('message',result=>finish(result));
   worker.once('error',()=>finish({ok:false,httpStatus:503,error:'运行检查未完成，请稍后重试'}));
   worker.once('exit',()=>finish({ok:false,httpStatus:503,error:'运行检查已停止，请稍后重试'}));
   timer=setTimeout(()=>finish({ok:false,httpStatus:503,error:'运行检查超过时限，请缩小私有研究输入后重试'}),15000);
  }catch{void finish({ok:false,httpStatus:503,error:'运行检查无法启动'});}
 });
}
if(!isMainThread&&workerData?.kind==='learning-runtime'){
 Promise.resolve().then(()=>require('../core/learning-runtime-preflight').inspectLearningRuntime({probeModel:workerData.probeModel}))
  .then(result=>parentPort.postMessage({ok:true,result}))
  .catch(()=>parentPort.postMessage({ok:false,httpStatus:422,error:'运行配置或私有研究证据无法核对'}));
}
module.exports={runLearningRuntimeJob};
