'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMarketRequestGovernor}=require('../src/core/market-request-governor');
const EM='https://push2.eastmoney.com/api/qt/stock/get';
const TX='https://qt.gtimg.cn/q=sh600000';
const epoch=Date.UTC(2026,10,13);
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(initial=epoch){
 let at=initial,next=0,calls=0;const timers=new Map();
 const g=createMarketRequestGovernor({now:()=>{if(at==='throw')throw Error('clock unavailable');return at;},
  setTimeout:(fn,delay)=>{const id=++next;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id)});
 function request(url=EM){
  const receipt={done:false};let p;
  try{p=g.run(url,()=>{calls++;return 'sent';});}
  catch(e){receipt.done=true;receipt.error=e;return receipt;}
  Promise.resolve(p).then(value=>{receipt.done=true;receipt.value=value;},error=>{receipt.done=true;receipt.error=error;});
  return receipt;
 }
 return {g,timers,request,setAt:v=>{at=v},get calls(){return calls},fire(){const first=timers.entries().next().value;if(first){timers.delete(first[0]);first[1].fn();}}};
}
function restricted(x,r){
 assert.equal(r.done,true);assert.equal(r.error?.code,'MARKET_RESTRICTED');assert.equal(r.error?.stateUnavailable,true);
 assert.equal(x.g.state(EM).stateUnavailable,true);assert.equal(x.timers.size,0);
}
test('invalid or overflowing clock never invokes a supplier or creates a timer',async()=>{
 for(const at of [NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER,'throw']){
  const x=fixture(at),r=x.request();await flush();
  assert.equal(x.calls,0);restricted(x,r);
 }
});
test('clock rollback across supplier families stops new physical starts and stays closed',async()=>{
 const x=fixture(),first=x.request();await flush();assert.equal(first.value,'sent');
 x.setAt(epoch-1);const r=x.request(TX);await flush();assert.equal(x.calls,1);restricted(x,r);
 x.setAt(epoch+3600000);const later=x.request();await flush();restricted(x,later);assert.equal(x.calls,1);
});
test('dispatch timer rollback rejects queued and untrusted in-flight results without cancelling already running work',async()=>{
 const x=fixture(),active=deferred();let started=0,finished=0,settled=false;
 const first=x.g.run(EM,()=>{started++;return active.promise.then(value=>{finished++;return value;});});
 const completion=first.then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
 const pending=x.request();assert.equal(x.timers.size,1);
 x.setAt(epoch-1);x.fire();await flush();
 restricted(x,pending);assert.equal(started,1);assert.equal(x.calls,0);
 // The original physical task was not cancelled; its eventual result is
 // fenced from consumers by the shared clock/state gate.
 assert.equal(settled,false);assert.equal(finished,0);assert.equal(x.g.state(EM).active,1);
 x.setAt(epoch+1000); // clock recovery cannot make the old result trustworthy
 active.resolve('original active completed');
 const result=await completion;
 assert.equal(finished,1);assert.equal(settled,true);assert.equal(result.value,undefined);
 assert.equal(result.error?.code,'MARKET_RESTRICTED');assert.equal(result.error?.stateUnavailable,true);
 await flush();assert.equal(x.g.state(EM).active,0);assert.equal(x.timers.size,0);
 const later=x.request(TX);await flush();restricted(x,later);assert.equal(x.calls,0);
});
test('the fresh clock read at physical dispatch cannot skip validation after a valid enqueue',async()=>{
 let reads=0,calls=0;const x=createMarketRequestGovernor({now:()=>++reads===1?epoch:NaN,
  setTimeout:()=>{throw Error('unexpected timer');},clearTimeout:()=>{}});
 const result=await x.run(EM,()=>{calls++;return 'sent';}).then(value=>({value}),error=>({error}));
 assert.equal(calls,0);assert.equal(result.error?.stateUnavailable,true);
});
test('a restriction received under a broken clock fails closed rather than opening a fallback',async()=>{
 const x=fixture();x.request();await flush();x.setAt(epoch-1);
 let error;try{x.g.checkResponse(EM,429,{'Retry-After':'120'});}catch(e){error=e;}
 assert.equal(error?.code,'MARKET_RESTRICTED');assert.equal(error?.stateUnavailable,true);
 const r=x.request(TX);await flush();restricted(x,r);assert.equal(x.calls,1);
});
test('normal starts and original minimum cooldown still use the configured clock',async()=>{
 const x=fixture(),a=x.request();await flush();assert.equal(a.value,'sent');
 const queued=x.request();x.setAt(epoch+999);x.fire();await flush();assert.equal(queued.done,false);
 x.setAt(epoch+1000);x.fire();await flush();assert.equal(queued.value,'sent');
 let e;try{x.g.checkResponse(EM,429,{});}catch(error){e=error;}
 assert.equal(e?.resumeAt,epoch+61000);
 x.setAt(epoch+61000);const fresh=x.request();await flush();assert.equal(fresh.value,'sent');assert.equal(x.timers.size,0);
});
