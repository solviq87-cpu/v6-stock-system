'use strict';
const {processStockObservationQueue,readStockObservationQueue}=require('./stock-observation-queue');
const {runStockObservationJob}=require('../server/stock-observation-job');
function createStockObservationMonitor({queueRoot,jobOptions,intervalMs=60000,keepAlive=false},dependencies={}){
 if(!Number.isSafeInteger(intervalMs)||intervalMs<60000||intervalMs>3600000)throw Error('观察队列间隔应为60秒至1小时');
 const {setTimer=setTimeout,clearTimer=clearTimeout,now=Date.now,capture=async intent=>{
  const result=await runStockObservationJob({symbol:intent.symbol,provider:'auto',historyDays:120,includeContext:false,trigger:'push-attempt-observation'},
   {...jobOptions,jobGroup:'automatic'});
  if(!result.ok||result.result?.memory?.status==='failed')throw Error('研究观察未完成');
  return result.result;
 }}=dependencies;
 let running=false,halted=false,timer=null,inFlight=null,last=null;
 function runOnce(){
  if(inFlight)return inFlight;
  inFlight=processStockObservationQueue(queueRoot,{capture,now,maxJobs:1}).then(result=>{last={status:'checked',processed:result.processed,checkedAt:now()};return result;})
   .finally(()=>{inFlight=null;});return inFlight;
 }
 async function tick(){
  try{await runOnce();}catch{last={status:'blocked-invalid-queue',checkedAt:now()};running=false;halted=true;}
  if(running){timer=setTimer(()=>{timer=null;void tick();},intervalMs);if(!keepAlive)timer?.unref?.();}
 }
 function start(){if(halted)throw Error('研究队列需核查后重启');if(running)return;running=true;void tick();}
 function wake(){if(!running||inFlight)return;if(timer!==null){clearTimer(timer);timer=null;}void tick();}
 async function stop(){running=false;if(timer!==null){clearTimer(timer);timer=null;}if(inFlight)await inFlight;}
 function status(){
  let queue;try{queue=readStockObservationQueue(queueRoot,{now:now()});}catch{queue={status:'blocked-invalid-queue'};}
  return {running,halted,inFlight:!!inFlight,last,queue,researchOnly:true,canTrade:false,canNotify:false};
 }
 return {start,wake,runOnce,stop,status};
}
module.exports={createStockObservationMonitor};
