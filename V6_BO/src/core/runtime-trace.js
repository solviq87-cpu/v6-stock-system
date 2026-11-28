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
 'notification.queue','notification.attempt','notification.delivery','research.stage',
 'research.worker-dispatch','research.worker-execute','factor.worker-dispatch','factor.worker-execute',
 'task.decision-background','task.decision-evidence','market.financials','risk.plan-context',
 'risk.plan-observation','risk.plan-persist','notification.dispatch']);
const GROUPS=['task','market','factor','strategy','candidate','risk','paper','notification','research'];
const CODES=new Set(['STAGE_FAILED','SOURCE_UNAVAILABLE','RISK_REJECTED','BUSINESS_REJECTED',
 'NO_CHANGE','NOTIFICATION_BLOCKED','QUEUE_FULL','DELIVERY_UNKNOWN','DELIVERY_FAILED',
 'DELIVERY_RETRY','REPLICA','SESSION_CLOSED','ACCOUNT_DISABLED','NO_CANDIDATE','ALREADY_RUNNING','AUTOMATIC_QUOTE_NOT_CURRENT',
 'SINGLE_POSITION_LIMIT','GROSS_EXPOSURE_LIMIT','SECTOR_EXPOSURE_LIMIT','STRATEGY_EXPOSURE_LIMIT',
 'PREVIOUS_CLOSE_LOSS_LIMIT','CONSECUTIVE_LOSS_LIMIT','DEFENSIVE_RESTRICTION',
 'MISSING_POSITION_MARKS','MISSING_SECTOR_CLASSIFICATION','MISSING_STRATEGY_ATTRIBUTION',
 'MISSING_IMPORTED_SECTOR','MISSING_IMPORTED_PRIOR_CLOSE','PENDING_BUY_BUDGET_UNKNOWN',
 'PENDING_CASH_RESERVATION_MISMATCH','PENDING_SELL_RESERVATION_MISMATCH']);
const OUTCOMES=new Set(['completed','blocked','failed','unknown','skipped']);
// Interpret only existing allowlisted receipts. Grouping repeated observations
// is NOT root-cause correlation, liveness proof or authorization to recover.
const ISSUE_RULES=Object.freeze({
 SOURCE_UNAVAILABLE:{outcomes:['blocked','failed','unknown'],severity:'warning',nextAction:'核查原供应商和采集回执；原因未证实时保持未知'},
 STAGE_FAILED:{outcomes:['failed'],severity:'error',nextAction:'核查原任务的授权诊断及失败回执'},
 QUEUE_FULL:{outcomes:['blocked','failed','skipped'],severity:'warning',nextAction:'核查原队列容量与排队时间，不重复提交'},
 ALREADY_RUNNING:{outcomes:['skipped'],severity:'info',nextAction:'原并发保护已触发；核对运行任务，不强制重启'},
 AUTOMATIC_QUOTE_NOT_CURRENT:{outcomes:['blocked','skipped'],severity:'warning',nextAction:'等待通过原报价时点及来源门禁的证据'},
 DELIVERY_UNKNOWN:{outcomes:['unknown'],severity:'warning',nextAction:'核对实际接收回执；不把受理当送达或改发公共通道'},
 DELIVERY_FAILED:{outcomes:['failed'],severity:'error',nextAction:'核对原私密通知失败回执'},
 DELIVERY_RETRY:{outcomes:['failed'],severity:'warning',nextAction:'核对原有界重试；不再发起第二套重试'},
 UNCLASSIFIED_FAILURE:{outcomes:['failed'],severity:'error',nextAction:'原因待核实，核对原始失败回执'},
 UNCLASSIFIED_OUTCOME:{outcomes:['unknown'],severity:'warning',nextAction:'结果待核实，核对原始回执'}
});
const validIssueTime=value=>Number.isSafeInteger(value)&&value>0&&value<=8e15;
function issueRule(stage,status,code){
 if(!STAGES.has(stage)||!Object.hasOwn(ISSUE_RULES,code))return null;
 const rule=ISSUE_RULES[code];
 return rule.outcomes.includes(status)?rule:null;
}
function addIssue(groups,row){
 const code=row.reasonCode===null?(row.status==='failed'?'UNCLASSIFIED_FAILURE':
  row.status==='unknown'?'UNCLASSIFIED_OUTCOME':null):row.reasonCode;
 if(!issueRule(row.stage,row.status,code))return;
 const key=JSON.stringify([row.stage,row.status,code]);
 let group=groups.get(key);
 if(!group){group={stage:row.stage,outcome:row.status,reasonCode:code,observations:0,
  firstObservedAt:null,lastObservedAt:null,unknownTimeCount:0};groups.set(key,group);}
 group.observations++;
 if(!validIssueTime(row.startedAt)||!validIssueTime(row.finishedAt)||row.finishedAt<row.startedAt){
  group.unknownTimeCount++;return;
 }
 group.firstObservedAt=group.firstObservedAt===null?row.finishedAt:Math.min(group.firstObservedAt,row.finishedAt);
 group.lastObservedAt=group.lastObservedAt===null?row.finishedAt:Math.max(group.lastObservedAt,row.finishedAt);
}
function projectRuntimeIssues(trace,now,hooks){
 const result=(status,groups=[])=>({scope:'bounded-original-trace-observations',status,groups,
  grouping:'same-stage-outcome-and-code-only',rootCauseCertified:false,currentFaultCertified:false,
  recoveryAuthorized:false,deliveryCertified:false,canTrade:false,canNotify:false});
 const raw=trace?.diagnosticIssues;
 if(trace?.scope!=='this-process-observed-stages'||raw===undefined)return result('not-observed');
 if(raw?.schemaVersion!==1||!validIssueTime(now)||!Array.isArray(hooks)||
    !Array.isArray(raw.groups)||raw.groups.length>1024||
    !Number.isSafeInteger(trace.observedSpanCount)||trace.observedSpanCount<0||trace.observedSpanCount>1024)
  return result('invalid-evidence');
 const counts=new Map(),seen=new Set(),groups=[];
 let samples=0;
 for(const hook of hooks){if(!STAGES.has(hook.stage)||counts.has(hook.stage)||
  !Number.isSafeInteger(hook.samples)||hook.samples<0||hook.samples>1024)return result('invalid-evidence');
  counts.set(hook.stage,hook);samples+=hook.samples;}
 if(samples!==trace.observedSpanCount)return result('invalid-evidence');
 const used=new Map();
 for(const row of raw.groups){
  const rule=issueRule(row?.stage,row?.outcome,row?.reasonCode);
  if(!rule)return result('invalid-evidence');
  const key=JSON.stringify([row.stage,row.outcome,row.reasonCode]),bucket=JSON.stringify([row.stage,row.outcome]);
  const available=counts.get(row.stage)?.[row.outcome],n=row.observations,unknown=row.unknownTimeCount;
  if(seen.has(key)||!Number.isSafeInteger(n)||n<1||!Number.isSafeInteger(unknown)||unknown<0||unknown>n||
     !Number.isSafeInteger(available)||available<0||(used.get(bucket)||0)+n>available)return result('invalid-evidence');
  const first=row.firstObservedAt,last=row.lastObservedAt;
  if(unknown===n?(first!==null||last!==null):(!validIssueTime(first)||!validIssueTime(last)||first>last||last>now))
   return result('invalid-evidence');
  seen.add(key);used.set(bucket,(used.get(bucket)||0)+n);
  groups.push({stage:row.stage,outcome:row.outcome,reasonCode:row.reasonCode,observations:n,
   firstObservedAt:first,lastObservedAt:last,unknownTimeCount:unknown,severity:rule.severity,
   affectedStage:row.stage,nextAction:rule.nextAction,rootCauseStatus:'unverified'});
 }
 return result(groups.length?'observed':samples?'no-classified-issues-in-retained-window':'not-observed',groups);
}
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
 const storage=new AsyncLocalStorage(),issued=new WeakSet(),associations=new WeakMap(),controls=new WeakMap(),received=new WeakSet(),active=new Map(),rows=[];
 let dropped=0,evicted=0;
 const stamp=()=>{const n=safeCall(clock,null);return Number.isSafeInteger(n)&&n>0?n:null;};
 const mono=()=>{const n=safeCall(monotonic,null);return Number.isFinite(n)?n:null;};
 const elapsed=(start,end)=>Number.isFinite(start)&&Number.isFinite(end)&&end>=start?Math.round((end-start)*100)/100:null;
 const trusted=value=>value&&typeof value==='object'&&issued.has(value);
 const current=()=>{const value=storage.getStore();return trusted(value)?value:null;};
 const issue=value=>{
  const links=Object.freeze((value.links||[]).slice(0,16).map(link=>Object.freeze({traceId:link.traceId,spanId:link.spanId})));
  const context=Object.freeze({...value,versions:Object.freeze({...value.versions}),links});
  issued.add(context);return context;
 };
 const unobserved=()=>({context:null,annotate(){},end(){return null;},fail(){},mark(){},
  run:fn=>storage.run(null,fn)});
 function droppedSpan(){dropped++;return unobserved();}
 function startSpan(stage,input={}){
  const parent=current();
  if(!STAGES.has(stage)||active.size>=activeLimit)return droppedSpan();
  const meta=metadata(input),context=issue({traceId:parent?.traceId||crypto.randomBytes(16).toString('hex'),
   spanId:crypto.randomBytes(16).toString('hex'),versions:Object.freeze({...parent?.versions,...meta.versions}),links:parent?.links||[]});
  const row={traceId:context.traceId,spanId:context.spanId,parentSpanId:parent?.spanId||null,
   links:context.links.slice(0,16),stage,startedAt:stamp(),versions:{...context.versions},refs:meta.refs};
  const started=mono();let ended=false,outcome='completed',reasonCode=null,measured=null,calls=0;
  active.set(context.spanId,row);
  const handle={context,
   annotate(value){if(ended)return;const clean=metadata(value);Object.assign(row.versions,clean.versions);Object.assign(row.refs,clean.refs);},
   mark(status,code){if(!ended){if(OUTCOMES.has(status))outcome=status;reasonCode=CODES.has(code)?code:null;}},
   fail(error){let code=null;safeCall(()=>{code=(Array.isArray(error?.reasonCodes)?error.reasonCodes:[]).slice(0,20).find(value=>CODES.has(value))||(CODES.has(error?.code)?error.code:null);},null);
    handle.mark(code?'blocked':'failed',code||'STAGE_FAILED');},
   end(status,code){if(ended)return null;if(status)handle.mark(status,code);ended=true;active.delete(context.spanId);
    const duration=calls?measured:elapsed(started,mono()),value={...row,finishedAt:stamp(),durationMs:Number.isFinite(duration)?Math.round(duration*100)/100:null,status:outcome,reasonCode,...(calls?{calls,timing:'sum-of-actual-calls'}:{})};
    rows.push(value);if(rows.length>limit){rows.shift();evicted++;}return clone(value);},
   measure(fn){const start=mono();calls++;try{return handle.run(fn);}catch(error){safeCall(()=>handle.fail(error),null);throw error;}finally{
    const d=elapsed(start,mono());measured=d===null||calls>1&&measured===null?null:(measured??0)+d;
   }},
   run:fn=>storage.run(context,fn)};
  controls.set(context,handle);
  return handle;
 }
 function begin(stage,input){return safeCall(()=>startSpan(stage,input),null)||droppedSpan();}
 function sync(stage,fn,meta){const span=begin(stage,meta);try{return span.run(()=>fn(span));}catch(error){safeCall(()=>span.fail(error),null);throw error;}finally{safeCall(()=>span.end(),null);}}
 async function asyncStage(stage,fn,meta){const span=begin(stage,meta);try{return await span.run(()=>fn(span));}catch(error){safeCall(()=>span.fail(error),null);throw error;}finally{safeCall(()=>span.end(),null);}}
 function capture(){return current();}
 function markCurrent(status,code){controls.get(current())?.mark(status,code);}
 function annotateCurrent(meta){controls.get(current())?.annotate(meta);}
 function batch(stage,meta){let span=null;return {run(fn){span??=begin(stage,meta);return span.measure?span.measure(fn):span.run(fn);},end(){return span?.end();}};}
 function resume(context,fn){return trusted(context)?storage.run(context,fn):fn();}
 function detached(fn){return storage.run(null,fn);}
 function withLinks(contexts,fn){
  const links=[];for(const value of Array.isArray(contexts)?contexts.slice(0,32):[]){if(trusted(value)&&ID.test(value.spanId||'')&&!links.some(x=>x.spanId===value.spanId))links.push({traceId:value.traceId,spanId:value.spanId});}
  const parent=current();if(!links.length)return fn();
  const context=issue({traceId:parent?.traceId||crypto.randomBytes(16).toString('hex'),spanId:parent?.spanId||null,
   versions:parent?.versions||Object.freeze({}),links:Object.freeze(links.slice(0,16).map(Object.freeze))});
  return storage.run(context,fn);
 }
 function associate(value,context=current()){if(value&&typeof value==='object'){if(trusted(context))associations.set(value,context);else associations.delete(value);}return value;}
 const contextOf=value=>value&&typeof value==='object'?associations.get(value)||null:null;
 function read({recent=32}={}){const count=Number.isSafeInteger(recent)?Math.max(0,Math.min(128,recent)):32;
  return {schemaVersion:1,scope:'this-process-observed-stages',capacity:limit,active:active.size,dropped,evicted,
   spans:clone(count?rows.slice(-count):[]),canTrade:false,writesAccount:false};}
 function summary(){
  // Aggregate the bounded ring once. Keep each exact duration for the
  // existing percentiles; neither sampling nor history retention changes.
  const accumulator=()=>({samples:0,completed:0,failed:0,blocked:0,unknown:0,skipped:0,times:[]});
  const diagnosticGroups=new Map();
  const groups=new Map(GROUPS.map(stage=>[stage,accumulator()]));
  const byHook=new Map([...STAGES].map(stage=>[stage,accumulator()]));
  function add(value,row){
   if(!value)return;
   value.samples++;value[row.status]++;
   if(Number.isFinite(row.durationMs))value.times.push(row.durationMs);
  }
  for(const row of rows){
   add(groups.get(row.stage.slice(0,row.stage.indexOf('.'))),row);
   add(byHook.get(row.stage),row);
   addIssue(diagnosticGroups,row);
  }
  const describe=(stage,{times,samples,completed,failed,blocked,unknown,skipped})=>{
   times.sort((a,b)=>a-b);
   const percentile=p=>times.length?times[Math.ceil(times.length*p)-1]:null;
   return {stage,status:samples?'observed':'not-observed',samples,completed,failed,blocked,unknown,skipped,
    timedSamples:times.length,p50Ms:percentile(.5),p95Ms:percentile(.95)};
  };
  const stages=[...groups].map(([stage,value])=>describe(stage,value));
  const hooks=[...byHook].map(([stage,value])=>describe(stage,value));
  return {...read({recent:0}),observedSpanCount:rows.length,stages,hooks,diagnosticIssues:{schemaVersion:1,groups:[...diagnosticGroups.values()].map(row=>({...row}))},coverage:'only executed hooks; unobserved stages are not inferred'};
 }
 // Only internal workerData may carry this small envelope. Main-thread callers
 // cannot restore a JSON/client context; same-process resume requires issuance.
 function workerContext(){const value=current();return value&&ID.test(value.spanId||'')?clone({version:1,traceId:value.traceId,spanId:value.spanId,versions:value.versions}):null;}
 function inWorker(value,fn){
  if(isMainThread||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['version','traceId','spanId','versions'].includes(k))||value.version!==1||typeof value.traceId!=='string'||typeof value.spanId!=='string'||!ID.test(value.traceId)||!ID.test(value.spanId))return fn();
  const versions={};for(const key of ['application','source','strategy','factor','riskPolicy','feePolicy'])if(HASH.test(value.versions?.[key]||''))versions[key]=value.versions[key];
  return storage.run(issue({traceId:value.traceId,spanId:value.spanId,versions:Object.freeze(versions),links:[]}),fn);
 }
 // One bounded receipt per issued active dispatch. Reject disconnected or replayed
 // spans rather than turning malformed/missing worker evidence into a success.
 function workerReceipt(parent){
  if(isMainThread||dropped||evicted||!parent||!ID.test(parent.traceId||'')||!ID.test(parent.spanId||''))return null;
  const spans=rows.filter(row=>row.traceId===parent.traceId);
  return spans.length&&spans.length<=64?{version:1,spans:clone(spans)}:null;
 }
 function importWorkerReceipt(parent,receipt,executionStage){return safeCall(()=>{
  if(!isMainThread||!trusted(parent)||!active.has(parent.spanId)||received.has(parent)||receipt?.version!==1||
   !['research.worker-execute','factor.worker-execute'].includes(executionStage)||
   active.get(parent.spanId)?.stage!==executionStage.replace('execute','dispatch')||!Array.isArray(receipt.spans)||!receipt.spans.length||receipt.spans.length>64)return false;
  const clean=[],ids=new Set(),existing=new Set([...rows.map(row=>row.spanId),...active.keys()]);
  const ts=value=>value===null||Number.isSafeInteger(value)&&value>0;
  const duration=value=>value===null||Number.isFinite(value)&&value>=0;
  const hashes=(value,keys)=>Object.fromEntries(keys.filter(key=>typeof value?.[key]==='string'&&HASH.test(value[key])).map(key=>[key,value[key]]));
  for(const row of receipt.spans){
   if(!row||row.traceId!==parent.traceId||typeof row.spanId!=='string'||!ID.test(row.spanId)||existing.has(row.spanId)||ids.has(row.spanId)||
    typeof row.parentSpanId!=='string'||!ID.test(row.parentSpanId)||![executionStage,'research.stage','factor.evaluate'].includes(row.stage)||
    !OUTCOMES.has(row.status)||!(row.reasonCode===null||CODES.has(row.reasonCode))||!ts(row.startedAt)||!ts(row.finishedAt)||!duration(row.durationMs))return false;
   ids.add(row.spanId);clean.push({traceId:parent.traceId,spanId:row.spanId,parentSpanId:row.parentSpanId,links:[],stage:row.stage,
    startedAt:row.startedAt,finishedAt:row.finishedAt,durationMs:row.durationMs,status:row.status,reasonCode:row.reasonCode,origin:'worker-thread',
    versions:hashes(row.versions,['application','source','strategy','factor','riskPolicy','feePolicy']),refs:hashes(row.refs,['signal','decision','input','account','event'])});
  }
  const roots=clean.filter(row=>row.parentSpanId===parent.spanId);
  if(roots.length!==1||roots[0].stage!==executionStage||clean.filter(row=>row.stage===executionStage).length!==1)return false;
  const byId=new Map(clean.map(row=>[row.spanId,row]));
  for(const row of clean){let next=row,visited=new Set();while(next.parentSpanId!==parent.spanId){
   if(visited.has(next.spanId))return false;visited.add(next.spanId);next=byId.get(next.parentSpanId);if(!next)return false;
  }}
  received.add(parent);for(const row of clean){rows.push(row);if(rows.length>limit){rows.shift();evicted++;}}return true;
 },false);}
 function createStageTrace(){
  const stages=[],parent=current()||safeCall(()=>issue({traceId:crypto.randomBytes(16).toString('hex'),spanId:null,versions:{},links:[]}),null);
  // Preserve the original independently-owned stage journal even if the global
  // trace ring is saturated. Dropped spans cannot erase original diagnostics.
  function record(name,status,startedAt,start,span){
   const row=safeCall(()=>span.end(),null);
   stages.push({stage:name,status,startedAt,finishedAt:stamp(),durationMs:elapsed(start,mono()),
    ...(status==='failed'?{errorCode:'STAGE_FAILED'}:{}),
    ...(row?{traceId:row.traceId,spanId:row.spanId,parentSpanId:row.parentSpanId}:{})});
  }
  return {stages,
   async asyncStage(name,fn){const startedAt=stamp(),start=mono(),span=resume(parent,()=>begin('research.stage'));let status='completed';
    try{return await span.run(fn);}catch(error){status='failed';safeCall(()=>span.fail(error),null);throw error;}finally{record(name,status,startedAt,start,span);}},
   syncStage(name,fn){const startedAt=stamp(),start=mono(),span=resume(parent,()=>begin('research.stage'));let status='completed';
    try{return span.run(fn);}catch(error){status='failed';safeCall(()=>span.fail(error),null);throw error;}finally{record(name,status,startedAt,start,span);}}
  };
 }
 const wrapSync=(stage,fn,meta)=>function(...args){return sync(stage,()=>fn.apply(this,args),typeof meta==='function'?safeCall(()=>meta(...args),{}):meta);};
 const wrapAsync=(stage,fn,meta)=>function(...args){return asyncStage(stage,()=>fn.apply(this,args),typeof meta==='function'?safeCall(()=>meta(...args),{}):meta);};
 return {begin,sync,async:asyncStage,wrapSync,wrapAsync,batch,capture,markCurrent,annotateCurrent,resume,detached,withLinks,associate,contextOf,read,summary,workerContext,inWorker,workerReceipt,importWorkerReceipt,createStageTrace};
}
module.exports={...createRuntimeTrace(),createRuntimeTrace,projectRuntimeIssues};
