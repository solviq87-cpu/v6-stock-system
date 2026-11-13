'use strict';
// Browser-triggered recollection reuses the server cache between admitted runs.
// This is separate from the wire-level supplier budget and grants no feed rights.
const INTERVALS=Object.freeze({global:60000,sectorsZT:60000,auction:60000,pre:120000,
 review:300000,nextplan:300000,myrules:360000,news:120000,pool:300000,bigmoney:60000,abmove:60000,strategycards:15000});
function createPanelRefreshPolicy({now=Date.now}={}){
 const starts=new Map();
 return {admit(name){
  const interval=INTERVALS[name];
  if(!interval)return {allowed:true,retryAfterMs:0};
  const at=now();
  if(!Number.isSafeInteger(at)||at<=0)return {allowed:false,retryAfterMs:interval};
  const previous=starts.get(name);
  if(previous!==undefined&&(at<previous||at-previous<interval))
   return {allowed:false,retryAfterMs:at<previous?interval:interval-(at-previous)};
  starts.set(name,at);
  return {allowed:true,retryAfterMs:0};
 }};
}
module.exports={createPanelRefreshPolicy,INTERVALS};
