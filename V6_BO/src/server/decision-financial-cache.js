'use strict';

// Requests only read this bounded memory projection. The complete archive chain
// and its raw receipts are checked in one disposable, read-only worker. An old
// result is never used while its replacement is still being checked.
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const workerBudget=require('./worker-admission-budget');
const KIND='decision-financial-cache',PENDING='原始财报证据正在校验';
const UNAVAILABLE='原始财报证据校验暂不可用；稍后自动重试';
const TIMEOUT='原始财报证据校验超时；稍后自动重试';
const flags={researchOnly:true,canTrade:false,canNotify:false,calibrationCertified:false};
const codeOK=code=>typeof code==='string'&&/^\d{6}$/.test(code);
const timeOK=at=>Number.isSafeInteger(at)&&at>0&&at<8e15;
const MAX_DATA_BYTES=512*1024;
function bound(value,min,max,label){
 if(!Number.isSafeInteger(value)||value<min||value>max)throw Error('财报缓存'+label+'超出边界');
 return value;
}

function readInWorker(codes,{evidenceRoot,observationRoot,now,signal}){
 return new Promise((resolve,reject)=>{
  let worker,finished=false,lease=null;
  const finish=(error,result)=>{
   if(finished)return;
   finished=true;signal.removeEventListener('abort',abort);
   // Do not dispatch the next batch until this worker has actually stopped.
   Promise.resolve(lease?.stop()).then(()=>error?reject(error):resolve(result),()=>reject(Error('worker-stop-failed')));
  };
  const abort=()=>finish(Error('worker-aborted'));
  if(signal.aborted){abort();return;}
  lease=workerBudget.tryAcquire(KIND);
  if(!lease)return reject(Error('worker-budget-busy'));
  signal.addEventListener('abort',abort,{once:true});
  try{
   worker=lease.watch(new Worker(__filename,lease.options({kind:KIND,codes,evidenceRoot,observationRoot,now})));
   worker.once('message',message=>message?.ok===true?finish(null,message.result):finish(Error('worker-read-failed')));
   worker.once('error',()=>finish(Error('worker-error')));
   worker.once('exit',()=>finish(Error('worker-exited')));
   worker.unref();
  }catch{finish(Error('worker-start-failed'));}
 });
}

function createDecisionFinancialCache({evidenceRoot,observationRoot,clock=Date.now,ttlMs=30000,
 timeoutMs=55000,retryMs=15000,maxEntries=60,batchSize=10,readAsync}={}){
 if(typeof clock!=='function'||readAsync!==undefined&&typeof readAsync!=='function')throw Error('财报缓存读取器无效');
 bound(ttlMs,1,300000,'有效期');bound(timeoutMs,1,55000,'超时');bound(retryMs,1,300000,'退避');
 bound(maxEntries,1,60,'容量');bound(batchSize,1,10,'批量');
 const cache=new Map(),queue=new Map();
 let active=null,scheduled=null,closed=false,sequence=0;

 function schedule(){
  if(closed||active||scheduled||!queue.size)return;
  scheduled=setImmediate(()=>{scheduled=null;pump();});scheduled.unref();
 }
 function enqueue(code,row,now){
  row.generation=++sequence;row.requestedAt=now;row.status='pending';row.data=null;
  row.reason=PENDING;row.checkedAt=null;row.completedAt=null;row.expiresAt=null;
  queue.set(code,row.generation);schedule();
 }
 function obtain(code,now){
  let row=cache.get(code);
  if(row){cache.delete(code);cache.set(code,row);return row;}
  if(cache.size>=maxEntries){
   // Pending work is pinned. Rapid requests cannot silently drop another code
   // from the queue or create an unbounded collection of independent workers.
   const victim=[...cache].find(([,value])=>value.status!=='pending');
   if(!victim)return null;
   cache.delete(victim[0]);queue.delete(victim[0]);
  }
  row={};cache.set(code,row);enqueue(code,row,now);return row;
 }
 function failure(job,reason){
  const at=clock(),checkedAt=timeOK(at)?at:job.now;
  for(const {code,generation}of job.items){
   const row=cache.get(code);
   if(!row||row.generation!==generation)continue;
   Object.assign(row,{status:'error',data:null,reason,checkedAt,completedAt:checkedAt,expiresAt:checkedAt+retryMs});
  }
 }
 function publish(job,result){
  const completedAt=clock();
  if(!timeOK(completedAt)||completedAt<job.now){failure(job,'原始财报校验时点发生变化，请稍后重试');return;}
  if(!result||typeof result.byCode!=='object'||!result.byCode||Array.isArray(result.byCode)||
   typeof result.missingByCode!=='object'||!result.missingByCode||Array.isArray(result.missingByCode)){
   failure(job,UNAVAILABLE);return;
  }
  for(const {code,generation}of job.items){
   const row=cache.get(code);if(!row||row.generation!==generation)continue;
   let data=null,reason=null;
   try{
    if(Object.hasOwn(result.byCode,code)){
     const candidate=result.byCode[code],sets=Object.values(candidate?.datasets||{});
     if(!candidate||candidate.symbol!==code||candidate.source!=='eastmoney-financials'||!sets.length||
      sets.some(set=>!set||!timeOK(set.receivedAt)||set.receivedAt>job.now)||
      Buffer.byteLength(JSON.stringify(candidate))>MAX_DATA_BYTES)throw Error('invalid checked projection');
     data=structuredClone(candidate);
    }else{
     reason=result.missingByCode[code];
     if(typeof reason!=='string'||!reason.trim()||reason.length>1000)throw Error('missing checked projection');
    }
    Object.assign(row,{status:'ready',data,reason,checkedAt:job.now,completedAt,expiresAt:completedAt+ttlMs});
   }catch{
    Object.assign(row,{status:'error',data:null,reason:UNAVAILABLE,checkedAt:job.now,completedAt,expiresAt:completedAt+retryMs});
   }
  }
 }
 function pump(){
  if(closed||active)return;
  const items=[];
  for(const [code,generation]of queue){
   queue.delete(code);
   const row=cache.get(code);
   if(row?.status==='pending'&&row.generation===generation)items.push({code,generation,requestedAt:row.requestedAt});
   if(items.length>=Math.min(batchSize,maxEntries))break;
  }
  if(!items.length)return;
  // Coalesced callers can have different clocks. Use the earliest requested
  // cutoff, so a later request cannot introduce evidence into an earlier view.
  const job={items,now:Math.min(...items.map(item=>item.requestedAt)),controller:new AbortController(),timedOut:false};
  active=job;
  job.timer=setTimeout(()=>{
   if(active!==job||closed)return;
   job.timedOut=true;failure(job,TIMEOUT);job.controller.abort();
  },timeoutMs);job.timer.unref();
  job.done=Promise.resolve().then(()=>{
   if(closed||job.controller.signal.aborted)throw Error('cache-closed');
   return (readAsync||readInWorker)(items.map(item=>item.code),{evidenceRoot,observationRoot,now:job.now,signal:job.controller.signal});
  }).then(result=>{if(!closed&&!job.timedOut)publish(job,result);},()=>{
   if(!closed&&!job.timedOut)failure(job,UNAVAILABLE);
  }).finally(()=>{
   clearTimeout(job.timer);if(active===job)active=null;schedule();
  });
 }
 function read(codes,{now=clock()}={}){
  const selected=[...new Set((Array.isArray(codes)?codes.slice(0,1000):[]).filter(codeOK))].slice(0,50);
  const byCode={},missingByCode={},validationByCode={};
  for(const code of selected){
   if(closed){missingByCode[code]='原始财报校验已停止';continue;}
   if(!timeOK(now)){missingByCode[code]='原始财报校验时点无效';continue;}
   const row=obtain(code,now);
   if(!row){missingByCode[code]='原始财报校验队列已满，请稍后重试';continue;}
   if(row.status==='pending'&&now<row.requestedAt||row.status!=='pending'&&
    (now<row.checkedAt||now<row.completedAt||now>=row.expiresAt))enqueue(code,row,now);
   if(row.status==='ready'&&row.data)byCode[code]=structuredClone(row.data);
   else missingByCode[code]=row.reason;
   validationByCode[code]={status:row.status,asOf:row.checkedAt,completedAt:row.completedAt,expiresAt:row.expiresAt};
  }
  return {byCode,missingByCode,validationByCode,checkedAt:timeOK(now)?now:null,...flags};
 }
 function invalidate(code){
  if(closed||!codeOK(code))return false;
  const row=cache.get(code);if(!row)return false;
  const now=clock();
  if(!timeOK(now)){cache.delete(code);queue.delete(code);return false;}
  enqueue(code,row,now);return true;
 }
 function close(){
  if(!closed){
   closed=true;if(scheduled)clearImmediate(scheduled);scheduled=null;queue.clear();cache.clear();
   if(active){clearTimeout(active.timer);active.controller.abort();}
  }
  // Injected async readers must cooperate with AbortSignal if they own external
  // resources. A non-cooperative test promise never permits a second flight;
  // late completion is ignored, and close need not wait for that promise.
  return !readAsync&&active?active.done:Promise.resolve();
 }
 return {read,invalidate,close};
}

if(!isMainThread&&workerData?.kind===KIND){
 try{
  const {codes,evidenceRoot,observationRoot,now}=workerData;
  if(!Array.isArray(codes)||codes.length>10||!codes.every(codeOK)||!timeOK(now))throw Error('invalid worker input');
  const result=require('../core/decision-evidence').createDecisionFinancialReader({evidenceRoot,observationRoot,ttlMs:0}).read(codes,{now});
  parentPort.postMessage({ok:true,result});
 }catch{parentPort.postMessage({ok:false});}
}

module.exports={createDecisionFinancialCache};
