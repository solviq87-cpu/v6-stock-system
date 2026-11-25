'use strict';
// Observation only. Internal contexts never authorize a task, trade or delivery.
// Keep identifiers and hashes, never request bodies, prices, account values or errors.
const {AsyncLocalStorage}=require('node:async_hooks');
const {performance}=require('node:perf_hooks');
const crypto=require('node:crypto');
const {isMainThread}=require('node:worker_threads');
const STAGES=new Set(['task.tick','task.pool','market.snapshot','market.universe','market.history',
 'factor.evaluate','strategy.evaluate','candidate.publish','risk.entry','risk.notification',
 'paper.transaction','paper.publish','paper.buy','paper.sell','notification.digest',
 'notification.queue','notification.attempt','notification.delivery','research.stage']);
const GROUPS=['market','factor','strategy','candidate','risk','paper','notification'];
const CODES=new Set(['STAGE_FAILED','SOURCE_UNAVAILABLE','RISK_REJECTED','BUSINESS_REJECTED',
 'NO_CHANGE','NOTIFICATION_BLOCKED','QUEUE_FULL','DELIVERY_UNKNOWN','DELIVERY_FAILED',
 'DELIVERY_RETRY','REPLICA','SESSION_CLOSED','ACCOUNT_DISABLED','NO_CANDIDATE',
 'SINGLE_POSITION_LIMIT','GROSS_EXPOSURE_LIMIT','SECTOR_EXPOSURE_LIMIT','STRATEGY_EXPOSURE_LIMIT',
 'PREVIOUS_CLOSE_LOSS_LIMIT','CONSECUTIVE_LOSS_LIMIT','DEFENSIVE_RESTRICTION',
 'MISSING_POSITION_MARKS','MISSING_SECTOR_CLASSIFICATION','MISSING_STRATEGY_ATTRIBUTION',
 'MISSING_IMPORTED_SECTOR','MISSING_IMPORTED_PRIOR_CLOSE','PENDING_BUY_BUDGET_UNKNOWN',
 'PENDING_CASH_RESERVATION_MISMATCH','PENDING_SELL_RESERVATION_MISMATCH']);
const OUTCOMES=new Set(['completed','blocked','failed','unknown','skipped']);
const HASH=/^[a-f0-9]{64}$/;
const ID=/^[a-f0-9]{32}$/;
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const safeCall=(fn,fallback)=>{try{return fn();}catch{return fallback;}};
const clone=value=>JSON.parse(JSON.stringify(value));
function metadata(input){
 const out={versions:{},refs:{}};
 safeCall(()=>{
  for(const key of ['application','source','strategy','factor','riskPolicy','feePolicy']){
   const value=input?.versions?.[key];
   if(typeof value==='string'&&value.length>0&&value.length<=512)out.versions[key]=digest(value);
  }
  for(const key of ['signal','decision','input','account','event']){
   const value=input?.refs?.[key];if(typeof value==='string'&&HASH.test(value))out.refs[key]=value;
  }
 },null);
 return out;
}
function createRuntimeTrace({capacity=256,maxActive=64,clock=Date.now,monotonic=()=>performance.now()}={}){
 const limit=Number.isSafeInteger(capacity)?Math.max(1,Math.min(1024,capacity)):256;
 const activeLimit=Number.isSafeInteger(maxActive)?Math.max(1,Math.min(128,maxActive)):64;
 const storage=new AsyncLocalStorage(),issued=new WeakSet(),associations=new WeakMap(),controls=new WeakMap(),active=new Map(),rows=[];
 let dropped=0,evicted=0;
 const stamp=()=>safeCall(clock,0),mono=()=>safeCall(monotonic,0);
 const trusted=value=>value&&typeof value==='object'&&issued.has(value);
 const current=()=>{const value=storage.getStore();return trusted(value)?value:null;};
 const issue=value=>{const context=Object.freeze(value);issued.add(context);return context;};
 function begin(stage,input={}){
  const parent=current();
  if(!STAGES.has(stage)||active.size>=activeLimit){dropped++;return {context:parent,annotate(){},end(){return null;},fail(){},mark(){},run:fn=>fn()};}
  const meta=metadata(input),context=issue({traceId:parent?.traceId||crypto.randomBytes(16).toString('hex'),
   spanId:crypto.randomBytes(16).toString('hex'),versions:Object.freeze({...parent?.versions,...meta.versions}),links:parent?.links||[]});
  const row={traceId:context.traceId,spanId:context.spanId,parentSpanId:parent?.spanId||null,
   links:context.links.slice(0,16),stage,startedAt:stamp(),versions:{...context.versions},refs:meta.refs};
  const started=mono();let ended=false,outcome='completed',reasonCode=null,measured=null,calls=0;
  active.set(context.spanId,row);
  const handle={context,
   annotate(value){if(ended)return;const clean=metadata(value);Object.assign(row.versions,clean.versions);Object.assign(row.refs,clean.refs);},
   mark(status,code){if(!ended){if(OUTCOMES.has(status))outcome=status;reasonCode=CODES.has(code)?code:null;}},
   fail(error){let code=null;safeCall(()=>{code=(Array.isArray(error?.reasonCodes)?error.reasonCodes:[]).slice(0,20).find(value=>CODES.has(value))||null;},null);
    handle.mark(code?'blocked':'failed',code||'STAGE_FAILED');},
   end(status,code){if(ended)return null;if(status)handle.mark(status,code);ended=true;active.delete(context.spanId);
    const duration=measured??mono()-started,value={...row,finishedAt:stamp(),durationMs:Number.isFinite(duration)?Math.max(0,Math.round(duration*100)/100):null,status:outcome,reasonCode,...(measured!==null?{calls,timing:'sum-of-actual-calls'}:{})};
    rows.push(value);if(rows.length>limit){rows.shift();evicted++;}return clone(value);},
   measure(fn){const start=mono();calls++;try{return handle.run(fn);}catch(error){handle.fail(error);throw error;}finally{measured=(measured??0)+Math.max(0,mono()-start);}},
   run:fn=>storage.run(context,fn)};
  controls.set(context,handle);
  return handle;
 }
 function sync(stage,fn,meta){const span=begin(stage,meta);try{return span.run(()=>fn(span));}catch(error){span.fail(error);throw error;}finally{span.end();}}
 async function asyncStage(stage,fn,meta){const span=begin(stage,meta);try{return await span.run(()=>fn(span));}catch(error){span.fail(error);throw error;}finally{span.end();}}
 function capture(){return current();}
 function markCurrent(status,code){controls.get(current())?.mark(status,code);}
 function annotateCurrent(meta){controls.get(current())?.annotate(meta);}
 function batch(stage,meta){let span=null;return {run(fn){span??=begin(stage,meta);return span.measure?span.measure(fn):fn();},end(){return span?.end();}};}
 function resume(context,fn){return trusted(context)?storage.run(context,fn):fn();}
 function withLinks(contexts,fn){
  const links=[];for(const value of Array.isArray(contexts)?contexts.slice(0,32):[]){if(trusted(value)&&!links.some(x=>x.spanId===value.spanId))links.push({traceId:value.traceId,spanId:value.spanId});}
  const parent=current();if(!links.length)return fn();
  const context=issue({traceId:parent?.traceId||crypto.randomBytes(16).toString('hex'),spanId:parent?.spanId||null,
   versions:parent?.versions||Object.freeze({}),links:Object.freeze(links.slice(0,16).map(Object.freeze))});
  return storage.run(context,fn);
 }
 function associate(value,context=current()){if(value&&typeof value==='object'&&trusted(context))associations.set(value,context);return value;}
 const contextOf=value=>value&&typeof value==='object'?associations.get(value)||null:null;
 function read({recent=32}={}){const count=Number.isSafeInteger(recent)?Math.max(0,Math.min(128,recent)):32;
  return {schemaVersion:1,scope:'this-process-observed-stages',capacity:limit,active:active.size,dropped,evicted,
   spans:clone(count?rows.slice(-count):[]),canTrade:false,writesAccount:false};}
 function summary(){
  const stages=GROUPS.map(stage=>{const values=rows.filter(row=>row.stage.startsWith(stage+'.')),times=values.map(row=>row.durationMs).filter(Number.isFinite).sort((a,b)=>a-b);
   const percentile=p=>times.length?times[Math.ceil(times.length*p)-1]:null;
   return {stage,status:values.length?'observed':'not-observed',samples:values.length,completed:values.filter(r=>r.status==='completed').length,
    failed:values.filter(r=>r.status==='failed').length,blocked:values.filter(r=>r.status==='blocked').length,
    unknown:values.filter(r=>r.status==='unknown').length,p50Ms:percentile(.5),p95Ms:percentile(.95)};});
  return {...read({recent:0}),observedSpanCount:rows.length,stages,coverage:'only executed hooks; unobserved stages are not inferred'};
 }
 // Only internal workerData may carry this small envelope. Main-thread callers
 // cannot restore a JSON/client context; same-process resume requires issuance.
 function workerContext(){const value=current();return value?clone({version:1,traceId:value.traceId,spanId:value.spanId,versions:value.versions}):null;}
 function inWorker(value,fn){
  if(isMainThread||!value||Object.keys(value).some(k=>!['version','traceId','spanId','versions'].includes(k))||value.version!==1||!ID.test(value.traceId||'')||!ID.test(value.spanId||''))return fn();
  const versions={};for(const key of ['application','source','strategy','factor','riskPolicy','feePolicy'])if(HASH.test(value.versions?.[key]||''))versions[key]=value.versions[key];
  return storage.run(issue({traceId:value.traceId,spanId:value.spanId,versions:Object.freeze(versions),links:[]}),fn);
 }
 function createStageTrace(){const stages=[],parent=current()||issue({traceId:crypto.randomBytes(16).toString('hex'),spanId:null,versions:Object.freeze({}),links:[]});return {stages,
  async asyncStage(name,fn){const span=resume(parent,()=>begin('research.stage'));try{return await span.run(fn);}catch(error){span.fail(error);throw error;}finally{const row=span.end();if(row)stages.push({stage:name,status:row.status==='completed'?'completed':'failed',startedAt:row.startedAt,finishedAt:row.finishedAt,durationMs:row.durationMs,...(row.status==='completed'?{}:{errorCode:'STAGE_FAILED'}),traceId:row.traceId,spanId:row.spanId,parentSpanId:row.parentSpanId});}},
  syncStage(name,fn){const span=resume(parent,()=>begin('research.stage'));try{return span.run(fn);}catch(error){span.fail(error);throw error;}finally{const row=span.end();if(row)stages.push({stage:name,status:row.status==='completed'?'completed':'failed',startedAt:row.startedAt,finishedAt:row.finishedAt,durationMs:row.durationMs,...(row.status==='completed'?{}:{errorCode:'STAGE_FAILED'}),traceId:row.traceId,spanId:row.spanId,parentSpanId:row.parentSpanId});}}};}
 const wrapSync=(stage,fn,meta)=>function(...args){return sync(stage,()=>fn.apply(this,args),typeof meta==='function'?safeCall(()=>meta(...args),{}):meta);};
 const wrapAsync=(stage,fn,meta)=>function(...args){return asyncStage(stage,()=>fn.apply(this,args),typeof meta==='function'?safeCall(()=>meta(...args),{}):meta);};
 return {begin,sync,async:asyncStage,wrapSync,wrapAsync,batch,capture,markCurrent,annotateCurrent,resume,withLinks,associate,contextOf,read,summary,workerContext,inWorker,createStageTrace};
}
module.exports={...createRuntimeTrace(),createRuntimeTrace};
