'use strict';
const {Worker}=require('node:worker_threads');
const workerBudget=require('./worker-admission-budget');
let active=false;
function runResearchJob(payload,{timeoutMs=30000}={}){
  if(active)return Promise.resolve({ok:false,error:'研究任务正在运行，请稍后重试'});
  const lease=workerBudget.tryAcquire('research');
  if(!lease)return Promise.resolve({ok:false,error:'研究任务正在运行，请稍后重试'});
  active=true;
  return new Promise(resolve=>{
    let worker,timer,done=false;
    const finish=async result=>{if(done)return;done=true;clearTimeout(timer);await lease.stop();active=false;resolve(result);};
    try{
      worker=lease.watch(new Worker(require.resolve('./research-worker'),lease.options(payload)));
      worker.once('message',finish);worker.once('error',()=>finish({ok:false,error:'研究任务执行失败'}));
      worker.once('exit',()=>{if(!done)finish({ok:false,error:'研究任务异常退出'});});
      timer=setTimeout(()=>finish({ok:false,error:'研究任务超过30秒限制'}),timeoutMs);
    }catch{finish({ok:false,error:'研究任务无法启动'});}
  });
}
module.exports={runResearchJob};
