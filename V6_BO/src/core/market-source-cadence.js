'use strict';

// Share provider snapshots across consumers in the same session. A failed
// attempt also counts towards the cadence. The wire governor owns 403/429.
function createMarketSourceCadence(clock=Date.now){
 const slots=new Map();
 function read(key,session,minIntervalMs,collect){
  const prior=slots.get(key),now=clock();
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
   slot.result={...result,finishedAt:clock()};slot.pending=null;
   return slot.result;
  });
  return slot.pending;
 }
 return read;
}

module.exports={createMarketSourceCadence};
