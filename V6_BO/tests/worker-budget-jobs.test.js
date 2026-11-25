'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events'),{createRequire}=require('node:module');
const budget=require('../src/server/worker-admission-budget');
const {aShareCalendarDate}=require('../src/core/a-share-calendar');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const context=()=>{const requestAt=Date.now();return {root:'/unused-private-account',requestAt,day:aShareCalendarDate(requestAt),marketOpen:true,continuous:true,replica:false,quotes:{}};};
const busy=result=>result?.ok===false||result?.status==='busy';
function harness({mode='held',timeout=false,deferredStop=false}={}){
 const workers=[],modules=new Map();
 class Worker extends EventEmitter{
  constructor(file,options){
   super();if(mode==='start-failure')throw Error('/private/start-secret');
   this.file=file;this.options=options;workers.push(this);
   if(mode==='error')queueMicrotask(()=>this.emit('error',Error('/private/worker-secret')));
   if(mode==='exit')queueMicrotask(()=>this.emit('exit',1));
  }
  terminate(){
   if(deferredStop)return new Promise(resolve=>{this.confirmStop=()=>{this.emit('exit',0);resolve(0);};});
   this.emit('exit',0);return Promise.resolve(0);
  }
  unref(){}
 }
 function load(name){
  if(modules.has(name))return modules.get(name);
  const file=path.join(__dirname,'../src/server',name+'.js'),real=createRequire(file),module={exports:{}};
  const req=id=>id==='node:worker_threads'?{Worker,isMainThread:true}:real(id);req.resolve=real.resolve;
  new Function('module','exports','__filename','require','setTimeout','clearTimeout',fs.readFileSync(file,'utf8'))(
   module,module.exports,file,req,timeout?fn=>{setImmediate(fn);return {unref(){}};}:setTimeout,timeout?()=>{}:clearTimeout);
  modules.set(name,module.exports);return module.exports;
 }
 return {workers,load};
}
const calls=x=>[
 ()=>x.load('research-job').runResearchJob({priority:'critical'}),
 ()=>x.load('adaptive-research-job').runAdaptiveJob({}),
 ()=>x.load('research-workspace-job').runWorkspaceJob({action:'shortline',root:'/unused-private-archive'}),
 ()=>x.load('stock-observation-job').runStockObservationJob({symbol:'600000'},{action:'read'}),
 ()=>x.load('public-factor-job').runPublicFactorJob({}),
 ()=>x.load('linked-intelligence-job').runLinkedIntelligenceJob({}),
 ()=>x.load('learning-runtime-job').runLearningRuntimeJob({}),
 ()=>x.load('advanced-account-risk-job').runAdvancedAccountRiskJob(context())
];

test('different existing job wrappers share two background slots and keep risk independently available',async t=>{
 const x=harness(),jobs=calls(x),first=jobs[0](),second=jobs[1]();
 t.after(()=>{for(const worker of x.workers)worker.emit('message',{ok:true,status:'observed'});});
 assert.equal(x.workers.length,2);
 for(const run of jobs.slice(2,-1))assert.ok(busy(await run()));
 assert.equal(x.workers.length,2,'busy work never reaches a constructor');
 const risk=jobs.at(-1)();assert.equal(x.workers.length,3);
 assert.equal(x.workers.at(-1).options.resourceLimits.maxOldGenerationSizeMb,128);
 assert.equal(budget.stats().background.active,2);assert.equal(budget.stats().risk.active,1);
 for(const worker of x.workers)worker.emit('message',{ok:true,status:'observed'});
 await Promise.all([first,second,risk]);assert.equal(budget.stats().background.active,0);assert.equal(budget.stats().risk.active,0);
});

test('constructor failure, worker error, exit and original timeout release every existing wrapper',async()=>{
 for(const mode of ['start-failure','error','exit','timeout']){
  const x=harness({mode:mode==='timeout'?'held':mode,timeout:mode==='timeout'});
  for(const run of calls(x)){
   const result=await run();assert.equal(result.ok===true,false);
   assert.equal(budget.stats().background.active,0,mode);assert.equal(budget.stats().risk.active,0,mode);
   assert.doesNotMatch(JSON.stringify(result),/private\/|worker-secret|start-secret/);
  }
  const cache=x.load('decision-financial-cache').createDecisionFinancialCache({retryMs:1000,timeoutMs:10});
  try{
   cache.read(['600000']);
   for(let i=0;i<20&&cache.read(['600000']).validationByCode['600000'].status==='pending';i++)await tick();
   assert.equal(cache.read(['600000']).validationByCode['600000'].status,'error',mode);
  }finally{await cache.close();}
  assert.equal(budget.stats().background.active,0,mode);
 }
});

test('a successful result cannot return its slot before the worker has stopped',async()=>{
 const x=harness({deferredStop:true}),job=x.load('research-job').runResearchJob({}),other=budget.tryAcquire('research-workspace');
 assert.ok(other);let resolved=false;job.then(()=>{resolved=true;});
 x.workers[0].emit('message',{ok:true});await tick();
 assert.equal(resolved,false);assert.equal(budget.tryAcquire('public-factor'),null);
 x.workers[0].confirmStop();await job;
 const replacement=budget.tryAcquire('public-factor');assert.ok(replacement);
 x.workers[0].emit('exit',0);assert.equal(budget.stats().background.active,2);
 await replacement.stop();await other.stop();
});

test('workspace keeps its bounded local queue and authorization without reserving waiting workers',async t=>{
 const x=harness(),workspace=x.load('research-workspace-job'),held=budget.tryAcquire('research-workspace');assert.ok(held);
 const pending=[];t.after(async()=>{for(const worker of x.workers)worker.emit('message',{ok:true});await held.stop();});
 const request={action:'shortline',root:'/unused-a'},first=workspace.runWorkspaceJob(request);pending.push(first);
 assert.equal(workspace.runWorkspaceJob(request),first,'identical original reads coalesce');
 const second=workspace.runWorkspaceJob({action:'shortline',root:'/unused-b'});pending.push(second);
 const edit=workspace.runWorkspaceJob({action:'shortline',root:'/unused-a',input:{revision:1}});pending.push(edit);
 const denied=await workspace.runWorkspaceJob({action:'shortline',root:'/unused-c'});assert.ok(busy(denied));
 await tick();assert.equal(x.workers.length,1);assert.equal(budget.stats().background.active,2);
 for(let i=0;i<3;i++){assert.ok(x.workers[i]);x.workers[i].emit('message',{ok:true});await tick();}
 await Promise.all(pending);assert.equal(budget.stats().background.active,1);
 const count=x.workers.length;
 const unauthorized=await workspace.runWorkspaceJob({action:'intelligence-feedback'},{authorize:()=>false});
 assert.equal(unauthorized.httpStatus,403);assert.equal(x.workers.length,count);
 await held.stop();assert.equal(budget.stats().background.active,0);
});

test('busy admission preserves original private account bytes and creates no research artifacts',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-budget-private-')),file=path.join(root,'pool.json');
 const app=require('../src/core/paper-application-service').createPaperApplicationService({file});
 app.adoptLegacy({enabled:true,initial:1000,cash:1000,realized:0,positions:{},trades:[]});
 const original=fs.readFileSync(file),names=fs.readdirSync(root).sort();
 const held=[budget.tryAcquire('research-workspace'),budget.tryAcquire('research-workspace'),budget.tryAcquire('advanced-account-risk')];
 t.after(async()=>{for(const lease of held)await lease.stop();fs.rmSync(root,{recursive:true,force:true});});
 const x=harness();
 assert.ok(busy(await x.load('stock-observation-job').runStockObservationJob({symbol:'600000'},
  {workspaceRoot:path.join(root,'research'),observationRoot:path.join(root,'observations')})));
 assert.ok(busy(await x.load('research-workspace-job').runWorkspaceJob({action:'settings',root:path.join(root,'research'),input:{}})));
 assert.equal((await x.load('advanced-account-risk-job').runAdvancedAccountRiskJob({...context(),root})).status,'busy');
 const cache=x.load('decision-financial-cache').createDecisionFinancialCache({evidenceRoot:path.join(root,'evidence'),observationRoot:path.join(root,'observations')});
 try{
  cache.read(['600000']);for(let i=0;i<20&&cache.read(['600000']).validationByCode['600000'].status==='pending';i++)await tick();
  assert.equal(cache.read(['600000']).validationByCode['600000'].status,'error');
 }finally{await cache.close();}
 assert.equal(x.workers.length,0);assert.deepEqual(fs.readFileSync(file),original);
 assert.deepEqual(fs.readdirSync(root).sort(),names);assert.equal(app.read().account.cash,1000);
});
