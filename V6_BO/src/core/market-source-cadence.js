'use strict';

// Share provider snapshots across consumers in the same session. A failed
// attempt also counts towards the cadence. The wire governor owns 403/429.
function createMarketSourceCadence(clock=Date.now){
 const slots=new Map();
 // All providers use one wall clock. A rollback or invalid reading is not a
 // new session, a fresh observation or permission to bypass the cooldown.
 let highWater=-1;
 function readClock(){
  let now;try{now=clock();}catch{return null;}
  if(!Number.isSafeInteger(now)||now<0||now<highWater)return null;
  highWater=now;return now;
 }
 const clockFailure=()=>({status:'rejected',reason:Error('行情采集时钟无效或倒退'),reused:false,finishedAt:null});
 function read(key,session,minIntervalMs,collect){
  const now=readClock();
  if(now===null)return Promise.resolve(clockFailure());
  const prior=slots.get(key);
  if(prior?.pending){
   if(prior.session===session)return prior.pending.then(result=>({...result,reused:true}));
   return prior.pending.then(()=>read(key,session,minIntervalMs,collect));
  }
  if(prior?.session===session&&now>=prior.startedAt&&now-prior.startedAt<minIntervalMs)
   return Promise.resolve({...prior.result,reused:true});
  const slot={session,startedAt:now};
  slots.set(key,slot);
  slot.pending=Promise.resolve().then(collect).then(
   value=>({status:'fulfilled',value,reused:false}),
   reason=>({status:'rejected',reason,reused:false})
  ).then(result=>{
   const finishedAt=readClock();
   slot.result=finishedAt===null?clockFailure():{...result,finishedAt};slot.pending=null;
   return slot.result;
  });
  return slot.pending;
 }
 return read;
}

module.exports={createMarketSourceCadence};
