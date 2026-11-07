'use strict';
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
if(!isMainThread){try{parentPort.postMessage({ok:true,result:require('../core/adaptive-market-lab').runAdaptiveResearch(workerData)});}catch(e){parentPort.postMessage({ok:false,error:String(e.message).slice(0,200)});}}
let active=false;
function runAdaptiveJob(payload,{timeoutMs=30000}={}){
 if(active)return Promise.resolve({ok:false,error:'自适应研究任务正在运行'});active=true;
 return new Promise(resolve=>{let worker,timer,done=false;const finish=async result=>{if(done)return;done=true;clearTimeout(timer);if(worker)await worker.terminate();active=false;resolve(result);};
 try{worker=new Worker(__filename,{workerData:payload,resourceLimits:{maxOldGenerationSizeMb:256}});worker.once('message',finish);worker.once('error',()=>finish({ok:false,error:'自适应研究执行失败'}));worker.once('exit',()=>{if(!done)finish({ok:false,error:'自适应研究异常退出'});});timer=setTimeout(()=>finish({ok:false,error:'自适应研究超过时限'}),timeoutMs);}catch{finish({ok:false,error:'自适应研究无法启动'});}
 });
}
module.exports={runAdaptiveJob};
