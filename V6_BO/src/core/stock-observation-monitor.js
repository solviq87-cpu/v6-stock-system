'use strict';
const {processStockObservationQueue,readStockObservationQueue}=require('./stock-observation-queue');
const {runStockObservationJob}=require('../server/stock-observation-job');
const {researchPaths}=require('./stock-observation-research');
const {readPriceEventResearch}=require('./price-event-research-agent');
const {scheduleStockResearchFollowup,processStockResearchFollowups,readStockResearchFollowups}=require('./stock-research-followups');
function readStockResearchStatus(options,{now=Date.now}={}){
 const roots=researchPaths(options),asOf=now();
 return {queue:readStockObservationQueue(options.queueRoot||require('node:path').join(require('node:path').dirname(options.observationRoot),'stock-observation-queue'),{now:asOf}),
  researchFollowups:readStockResearchFollowups(roots.followupRoot,{now:asOf}),
  priceEventResearch:readPriceEventResearch(roots.priceEventRoot,{asOf}),
  dailyResearch:require('./stock-research-watchlist').readResearchWatchlist(roots.watchRoot)};
}

function createStockObservationMonitor({queueRoot,jobOptions,intervalMs=60000,keepAlive=false},dependencies={}){
 if(!Number.isSafeInteger(intervalMs)||intervalMs<60000||intervalMs>3600000)throw Error('观察队列间隔应为60秒至1小时');
 const {setTimer=setTimeout,clearTimer=clearTimeout,now=Date.now,readCalendar,capture=async intent=>{
  const result=await runStockObservationJob({symbol:intent.symbol,provider:intent.provider||'auto',historyDays:120,includeContext:true,
    trigger:intent.hypothesisHash?'target-close-revisit':intent.targetDate?'daily-research-observation':'push-attempt-observation',
    origin:{kind:intent.trigger||'research-revisit',intentId:intent.id||null,pushDecisionAt:intent.decisionAt||null,signalRefs:intent.signalRefs||[],messageHash:intent.messageHash||null}},
   {...jobOptions,jobGroup:'automatic'});
  if(!result.ok||result.result?.memory?.status==='failed'||result.result?.priceEventResearch?.status==='failed'||result.result?.watch?.status==='failed'||result.result?.watch?.registered===false||result.result?.researchFollowups?.status==='blocked')throw Error('研究观察未完成');
  if(intent.hypothesisHash&&(!result.result.priceEventResearch||result.result.priceEventResearch.pendingTargets?.some(t=>t.hypothesisHash===intent.hypothesisHash)||!result.result.priceEventResearch.forwardValidation?.evaluated))throw Error('目标研究结果尚未封存');
  return result.result;
 }}=dependencies;
 let running=false,halted=false,timer=null,inFlight=null,last=null;
 function runOnce(){
  if(inFlight)return inFlight;
  inFlight=processStockObservationQueue(queueRoot,{capture,now,maxJobs:1}).then(async result=>{
    let followups={processed:0},dailyResearch={processed:0};
    if(jobOptions){
     const roots=researchPaths(jobOptions),research=readPriceEventResearch(roots.priceEventRoot,{asOf:now()});
     for(const pending of research.pendingTargets){const receipt=scheduleStockResearchFollowup(roots.followupRoot,pending);if(!receipt.scheduled)throw Error('研究复访队列未接收');}
     followups=await processStockResearchFollowups(roots.followupRoot,{capture,now,maxJobs:1});
     dailyResearch=await require('./stock-research-watchlist').processResearchWatchlist(roots.watchRoot,{capture,now,calendarFile:jobOptions.calendarFile,readCalendar,maxJobs:1});
    }
    last={status:'checked',processed:result.processed,followups:followups.processed,dailyResearch:dailyResearch.processed,checkedAt:now()};
    return {...result,followups,dailyResearch};
   })
   .finally(()=>{inFlight=null;});return inFlight;
 }
 async function tick(){
  try{await runOnce();}catch{last={status:'blocked-invalid-queue',checkedAt:now()};running=false;halted=true;}
  if(running){timer=setTimer(()=>{timer=null;void tick();},intervalMs);if(!keepAlive)timer?.unref?.();}
 }
 function start(){if(halted)throw Error('研究队列需核查后重启');if(running)return;running=true;void tick();}
 function wake(){if(!running||inFlight)return;if(timer!==null){clearTimer(timer);timer=null;}void tick();}
 async function stop(){running=false;if(timer!==null){clearTimer(timer);timer=null;}if(inFlight)await inFlight;}
 function status({lifecycleOnly=false}={}){
  if(lifecycleOnly)return {running,halted,inFlight:!!inFlight,last,researchOnly:true,canTrade:false,canNotify:false};
  let queue;try{queue=readStockObservationQueue(queueRoot,{now:now()});}catch{queue={status:'blocked-invalid-queue'};}
  let research={};if(jobOptions)try{research=readStockResearchStatus(jobOptions,{now});}catch{research={researchStatus:'blocked-invalid-archive'};}
  return {running,halted,inFlight:!!inFlight,last,queue,...research,researchOnly:true,canTrade:false,canNotify:false};
 }
 return {start,wake,runOnce,stop,status};
}
module.exports={createStockObservationMonitor,readStockResearchStatus};
