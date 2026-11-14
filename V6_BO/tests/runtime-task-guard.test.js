'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../server.js'),'utf8');
function harness(){
 let now=1000;const errors=[];
 const context={Map,Date:{now:()=>now},console:{error:(...args)=>errors.push(args)},require:require('node:module').createRequire(require.resolve('../server.js'))};
 const start=source.indexOf('const _taskBusy = new Map()'),end=source.indexOf('// ⛔ 调用约定',start);
 assert.ok(start>=0&&end>start);vm.runInNewContext(source.slice(start,end),context);
 return {guard:context.guard,clock:value=>{now=value;},errors};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('long-running task keeps exclusive ownership after fifteen minutes and warns once',async()=>{
 const h=harness(),job=deferred();let runs=0;
 const run=h.guard('news',()=>{runs++;return job.promise;});const first=run();
 h.clock(901000);run();h.clock(1801000);run();
 assert.equal(runs,1,'elapsed time cannot cancel the running promise');assert.equal(h.errors.length,1);
 job.resolve('saved');assert.equal(await first,'saved');assert.equal(await run(),'saved');assert.equal(runs,2);
});
test('old completion cannot release ownership of another still-running job',async()=>{
 const h=harness(),first=deferred(),second=deferred();let runs=0;
 const run=h.guard('pool',()=>++runs===1?first.promise:second.promise);
 const a=run();h.clock(901001);run();first.resolve();await a;
 const b=run();run();assert.equal(runs,2);second.resolve();await b;
});
test('manual and scheduled wrappers share the name lock; unrelated tasks proceed',async()=>{
 const h=harness(),job=deferred();let runs=0;
 const scheduled=h.guard('pool',()=>{runs++;return job.promise;});
 const manual=h.guard('pool',()=>{runs++;});const pending=scheduled();await manual();
 assert.equal(await h.guard('news',async()=>42)(),42);assert.equal(runs,1);
 job.resolve();await pending;await manual();assert.equal(runs,2);
});
test('rejection is logged, releases the name and permits a later retry',async()=>{
 const h=harness();let runs=0;
 const run=h.guard('pool',async()=>{if(++runs===1)throw Error('offline');return 42;});
 assert.equal(await run(),undefined);assert.equal(h.errors.length,1);assert.equal(await run(),42);
});
test('zero and backward wall clocks never release a pending task',async()=>{
 const h=harness(),job=deferred();let runs=0;h.clock(0);
 const run=h.guard('pool',()=>{runs++;return job.promise;});const first=run();
 h.clock(-1000);run();assert.equal(runs,1);job.resolve();await first;
});
