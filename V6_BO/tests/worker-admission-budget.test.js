'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter,once}=require('node:events'),{Worker}=require('node:worker_threads');
const budget=require('../src/server/worker-admission-budget');
const helper=require.resolve('../src/server/worker-admission-budget');
const key='__v6WorkerAdmissionBudgetV1';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const active=()=>budget.stats().background.active+budget.stats().risk.active;

test('two background declarations cannot consume the independent risk reservation',async t=>{
 assert.equal(active(),0);const leases=[];t.after(async()=>{for(const lease of leases)await lease.stop();});
 const take=kind=>{const lease=budget.tryAcquire(kind);assert.ok(lease);leases.push(lease);return lease;};
 const first=take('research-workspace'),second=take('research-workspace');
 assert.equal(budget.tryAcquire('research'),null);assert.equal(budget.tryAcquire('client-critical'),null);
 const risk=take('advanced-account-risk');assert.equal(budget.tryAcquire('advanced-account-risk'),null);
 assert.deepEqual(budget.stats().background,{maxWorkers:2,maxOldGenerationSizeMb:768,active:2,declaredOldGenerationSizeMb:768});
 assert.deepEqual(budget.stats().risk,{maxWorkers:1,maxOldGenerationSizeMb:128,active:1,declaredOldGenerationSizeMb:128});
 const input={priority:'critical',[key]:{shared:'client-control'},privateAccount:'never-in-metrics'};
 const options=first.options(input);assert.equal(options.resourceLimits.maxOldGenerationSizeMb,384);
 assert.ok(options.workerData[key].shared instanceof SharedArrayBuffer);assert.equal(input[key].shared,'client-control');
 assert.doesNotMatch(JSON.stringify(budget.stats()),/never-in-metrics|client-control|privateAccount/);
 await first.stop();await second.stop();assert.equal(budget.stats().risk.active,1);
 await risk.stop();assert.equal(active(),0);
});

test('uncertain termination retains admission until exit and a late stop cannot clear a reused slot',async t=>{
 const first=budget.tryAcquire('research'),other=budget.tryAcquire('public-factor');
 t.after(async()=>{await first.stop();await other.stop();});
 class PendingWorker extends EventEmitter{async terminate(){throw Error('fixture-stop-uncertain');}}
 const worker=first.watch(new PendingWorker());let completed=false;
 const stopped=first.stop().then(()=>{completed=true;});await delay(10);
 assert.equal(completed,false);assert.equal(budget.tryAcquire('linked-intelligence'),null);
 worker.emit('exit',1);await stopped;assert.equal(budget.stats().background.active,1);
 const replacement=budget.tryAcquire('learning-runtime');assert.ok(replacement);t.after(()=>replacement.stop());
 await first.stop();worker.emit('exit',1);
 assert.equal(budget.stats().background.active,2,'old cleanup does not clear replacement');
 await replacement.stop();await other.stop();assert.equal(active(),0);
});

test('real nested workers share the same admission and parent termination reclaims orphaned child leases',{timeout:10000},async t=>{
 const lease=budget.tryAcquire('research-workspace'),heartbeat=new SharedArrayBuffer(4),ticks=new Int32Array(heartbeat);
 assert.ok(lease);t.after(()=>lease.stop());
 const childSource=`const {parentPort,workerData}=require('node:worker_threads');
  require(workerData.helper);const ticks=new Int32Array(workerData.heartbeat);
  setInterval(()=>Atomics.add(ticks,0,1),2);parentPort.postMessage({ready:true});`;
 const parentSource=`const {parentPort,workerData,Worker}=require('node:worker_threads');
  const budget=require(workerData.helper),childLease=budget.tryAcquire('stock-observation');
  if(!childLease)throw Error('nested admission unexpectedly refused');
  const child=childLease.watch(new Worker(workerData.childSource,{...childLease.options({helper:workerData.helper,heartbeat:workerData.heartbeat}),eval:true}));
  child.once('message',()=>parentPort.postMessage({stats:budget.stats(),privateTransportRemoved:!Object.hasOwn(workerData,${JSON.stringify(key)})}));`;
 const worker=lease.watch(new Worker(parentSource,{...lease.options({helper,heartbeat,childSource}),eval:true}));
 const [ready]=await once(worker,'message');
 assert.equal(ready.privateTransportRemoved,true);assert.equal(ready.stats.background.active,2);
 assert.equal(ready.stats.background.declaredOldGenerationSizeMb,576);
 assert.equal(budget.tryAcquire('research'),null);
 const risk=budget.tryAcquire('advanced-account-risk');assert.ok(risk);t.after(()=>risk.stop());
 await lease.stop();assert.equal(budget.stats().background.active,0);
 const last=Atomics.load(ticks,0);await delay(20);assert.equal(Atomics.load(ticks,0),last,'nested worker actually stopped');
 assert.equal(budget.stats().risk.active,1,'another root lease survives parent cleanup');
 const replacement=budget.tryAcquire('stock-observation');assert.ok(replacement);t.after(()=>replacement.stop());
 await lease.stop();assert.equal(budget.stats().background.active,1);
 await replacement.stop();await risk.stop();assert.equal(active(),0);
});

test('simultaneous child admissions use atomic shared slots, not a budget per worker',{timeout:10000},async t=>{
 const root=budget.tryAcquire('research-workspace'),workers=[],leases=[];
 t.after(async()=>{await Promise.all(workers.map(worker=>worker.terminate()));await root.stop();for(const lease of leases)await lease.stop();});
 const source=`const {parentPort,workerData}=require('node:worker_threads');const budget=require(workerData.helper);
  parentPort.on('message',async message=>{if(message==='start'){const lease=budget.tryAcquire('public-factor');
   parentPort.postMessage({accepted:Boolean(lease),active:budget.stats().background.active});}});
  parentPort.postMessage({ready:true});`;
 for(let i=0;i<5;i++)workers.push(new Worker(source,{...root.options({helper}),eval:true}));
 await Promise.all(workers.map(worker=>once(worker,'message')));
 const results=workers.map(worker=>once(worker,'message'));for(const worker of workers)worker.postMessage('start');
 const replies=(await Promise.all(results)).map(([result])=>result);
 assert.equal(replies.filter(x=>x.accepted).length,1);assert.ok(replies.every(x=>x.active===2));
 assert.equal(budget.stats().background.active,2);
 await Promise.all(workers.map(worker=>worker.terminate()));await root.stop();assert.equal(active(),0);
});

test('an unbound child cannot manufacture a new independent budget',{timeout:10000},async()=>{
 const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');
  const budget=require(workerData.helper);parentPort.postMessage({available:budget.stats().available,accepted:Boolean(budget.tryAcquire('research'))});`,
 {eval:true,workerData:{helper,[key]:{shared:'body-controlled',owner:1n,token:1n}}});
 try{const [result]=await once(worker,'message');assert.deepEqual(result,{available:false,accepted:false});}
 finally{await worker.terminate();}
 assert.equal(active(),0);
});


test('release provenance shares the original bounded background slots and cannot borrow the risk slot',async()=>{
 const first=budget.tryAcquire('research-workspace'),second=budget.tryAcquire('release-provenance');
 try{
  assert.ok(first&&second);
  assert.equal(budget.tryAcquire('release-provenance'),null);
  assert.equal(budget.stats().background.active,2);
  assert.equal(budget.stats().background.declaredOldGenerationSizeMb,480);
  const risk=budget.tryAcquire('advanced-account-risk');assert.ok(risk);await risk.stop();
 }finally{await first?.stop();await second?.stop();}
 const next=budget.tryAcquire('release-provenance');assert.ok(next);await next.stop();
});
