'use strict';
// Explicit editor read only. One bounded worker, no new account, no disk archive,
// no unbounded queue, no account details or error strings in runtime metrics.
const fs=require('node:fs'),path=require('node:path');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const {performance}=require('node:perf_hooks');
const {accountExitDiagnostics,unavailable}=require('../core/advanced-account-risk');
const {aShareCalendarDate}=require('../core/a-share-calendar');
const mode='advanced-account-risk-readonly';
const samples=[];
let active=false;
function metrics(){
 const sorted=samples.map(x=>x.ms).sort((a,b)=>a-b),pct=p=>sorted.length?sorted[Math.ceil(sorted.length*p)-1]:null;
 return {stage:'advanced-account-risk-read',sampleCount:sorted.length,p50Ms:pct(.5),p95Ms:pct(.95),failures:samples.filter(x=>x.status!=='observed').length,scope:'this-process bounded worker requests only'};
}
function readBooks(input){
 const now=Date.now(),day=aShareCalendarDate(now);
 if(day!==input.day)return {mode,status:'clock-changed',accounts:[],canTrade:false,writesAccount:false};
 const accounts=['pool','pre'].map(account=>{
  try{
   const file=path.join(input.root,account+'.json'),st=fs.lstatSync(file);
   if(!st.isFile()||st.isSymbolicLink()||st.size>20*1024*1024)return unavailable(account,'INVALID_EXISTING_ACCOUNT_FILE');
   // Use the exact original service's integrity and cash/order/fill validation.
   const book=require('../core/paper-application-service').createPaperApplicationService({file}).read();
   const checkedAt=Date.now();
   if(aShareCalendarDate(checkedAt)!==day)return unavailable(account,'CLOCK_CHANGED');
   return accountExitDiagnostics(book,{...input,account,now:checkedAt,
    continuous:input.continuous&&checkedAt-input.requestAt<=5000});
  }catch{return unavailable(account,'ORIGINAL_READ_REJECTED_OR_UNAVAILABLE');}
 });
 return {mode,status:accounts.every(x=>x.status==='observed-unverified')?'observed':'incomplete',accounts,canTrade:false,writesAccount:false};
}
function runAdvancedAccountRiskJob(input){
 const empty=status=>({mode,status,accounts:[],canTrade:false,writesAccount:false,telemetry:metrics()});
 if(input?.replica===true)return Promise.resolve(empty('replica'));
 if(!input||typeof input.root!=='string'||!path.isAbsolute(input.root)||!Number.isSafeInteger(input.requestAt)||!input.quotes||typeof input.quotes!=='object'||Object.keys(input.quotes).length>220)return Promise.resolve(empty('invalid-context'));
 if(active)return Promise.resolve(empty('busy'));
 active=true;const start=performance.now();
 return new Promise(resolve=>{
  let worker,timer,done=false;
  const finish=async result=>{
   if(done)return;done=true;clearTimeout(timer);
   try{await worker?.terminate();}catch{}finally{
    active=false;
    samples.push({ms:Math.round(performance.now()-start),status:result.status});if(samples.length>128)samples.shift();
    resolve({...result,telemetry:metrics()});
   }
  };
  try{
   worker=new Worker(__filename,{workerData:{kind:mode,input},resourceLimits:{maxOldGenerationSizeMb:128}});
   worker.once('message',finish);
   worker.once('error',()=>finish(empty('worker-error')));
   worker.once('exit',()=>finish(empty('worker-exit')));
   timer=setTimeout(()=>finish(empty('timeout')),8000);
  }catch{void finish(empty('worker-start-failed'));}
 });
}
if(!isMainThread&&workerData?.kind===mode){
 try{parentPort.postMessage(readBooks(workerData.input));}
 catch{parentPort.postMessage({mode,status:'unavailable',accounts:[],canTrade:false,writesAccount:false});}
}
module.exports={runAdvancedAccountRiskJob};
