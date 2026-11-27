'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../src/core/quote-cross-check.js'),'utf8');
const START=Date.parse('2026-11-20T10:00:00+08:00');
// Isolate the actual cross-check scheduler/cache. The network capture and
// downstream price fusion are deterministic fixtures, not a real provider test.
function fixture(){
 let now=START,throwClock=false,openDay=true,captureCalls=0,wireCalls=0,fuseCalls=0;
 let release,blocked,kind='agreement';
 const makeRows=at=>[
  {provider:'tencent',status:'eligible-for-comparison',quoteAt:at-2000,observedPrice:10,inConsensus:kind==='agreement'},
  {provider:'eastmoney',status:'eligible-for-comparison',quoteAt:at-1000,observedPrice:kind==='conflict'?11:10,inConsensus:kind==='agreement'}
 ];
 const governor={run:async(url,fn)=>fn(),checkResponse(){}};
 const deps={
  './public-market':{createPublicMarket:options=>({async sync(){
   captureCalls++;await options.fetchImpl('https://example.invalid/quote',{signal:{throwIfAborted(){}}});
   if(blocked)await blocked;
   const at=options.clock();
   return {sources:kind==='unavailable'?[]:makeRows(at)};
  }})},
  './public-quote-probe':{projectProbe:raw=>raw},
  './multi-source-price-consensus':{fuseMultiSourcePrices:({code,now:at,sources})=>{
   fuseCalls++;return {code,checkedAt:new Date(at).toISOString(),status:kind==='agreement'?'sources-agree-unverified':kind==='conflict'?'source-price-or-time-conflict':'insufficient-comparable-sources',
    sourceStatuses:sources,referencePrice:kind==='agreement'?10:null,canTrade:false,canNotify:false};
  }},
  './quote-dual-source-diagnostic':{session:at=>Number.isSafeInteger(at)&&at>0},
  './market-request-governor':{marketRequests:governor}
 };
 const module={exports:{}};
 vm.runInNewContext(source,{module,require:id=>{assert.ok(Object.hasOwn(deps,id),id);return deps[id];}});
 const check=module.exports.createQuoteCrossCheck({isOpenDay:()=>openDay,clock:()=>{if(throwClock)throw Error('clock');return now;},governor,
  fetchImpl:async()=>{wireCalls++;return {status:200,headers:{}};}});
 return {check,setTime:at=>{now=at;},setThrow:value=>{throwClock=value;},setKind:value=>{kind=value;},
  halt:()=>{openDay=false;},delay:()=>{blocked=new Promise(resolve=>{release=resolve;});return ()=>release();},
  counts:()=>({captureCalls,wireCalls,fuseCalls})};
}
const code='600001';
test('cache reuses an original pair through 15000 ms then withdraws the reference without a new wire call',async()=>{
 const f=fixture(),first=await f.check(code);assert.equal(first.referencePrice,10);
 f.setTime(START+13000);assert.equal((await f.check(code)).referencePrice,10);
 f.setTime(START+13001);const expired=await f.check(code);
 assert.equal(expired.status,'cached-evidence-expired');assert.equal(expired.referencePrice,null);
 assert.equal(expired.checkedAt,first.checkedAt);assert.equal(expired.sourceStatuses.length,0);
 assert.equal(first.referencePrice,10,'original decision evidence is not overwritten');
 assert.equal(f.counts().wireCalls,1);
 f.setTime(START+29999);assert.equal((await f.check(code)).status,'cached-evidence-expired');
 f.setTime(START+30000);assert.equal((await f.check(code)).referencePrice,10);
 assert.equal(f.counts().wireCalls,2);
});
test('expired conflict evidence cannot keep appearing as a current conflict',async()=>{
 const f=fixture();f.setKind('conflict');const first=await f.check(code);
 assert.equal(first.status,'source-price-or-time-conflict');
 f.setTime(START+14000);const result=await f.check(code);
 assert.equal(result.status,'cached-evidence-expired');assert.equal(result.checkedAt,first.checkedAt);
 assert.equal(result.referencePrice,null);assert.equal(result.sourceStatuses.length,0);
 assert.equal(f.counts().wireCalls,1);
});
test('a backwards clock cannot resurrect a previously expired cached result',async()=>{
 const f=fixture();await f.check(code);f.setTime(START+20000);await f.check(code);
 f.setTime(START+5000);const rejected=await f.check(code);
 assert.equal(rejected.status,'clock-invalid');assert.equal(rejected.referencePrice,null);
 assert.equal(rejected.checkedAt,null);assert.equal(f.counts().wireCalls,1);
 f.setTime(START+20000);assert.equal((await f.check(code)).status,'cached-evidence-expired');
 f.setTime(START+30000);assert.equal((await f.check(code)).referencePrice,10);
});
test('bad or throwing initial clock neither triggers transport nor invents a timestamp',async()=>{
 const f=fixture();
 for(const at of [NaN,Infinity,null,0,START+0.5,String(START)]){
  f.setTime(at);const r=await f.check(code);assert.equal(r.status,'clock-invalid');
  assert.equal(r.checkedAt,null);assert.equal(r.referencePrice,null);
 }
 f.setTime(START);f.setThrow(true);assert.equal((await f.check(code)).status,'clock-invalid');
 assert.equal(f.counts().wireCalls,0);f.setThrow(false);
 assert.equal((await f.check(code)).referencePrice,10);
});
test('in-flight rollback cannot publish a result and still consumes original cooldown',async()=>{
 const f=fixture(),release=f.delay(),pending=f.check(code);
 f.setTime(START-1);release();const r=await pending;
 assert.equal(r.status,'clock-invalid');assert.equal(r.referencePrice,null);assert.equal(r.checkedAt,null);
 assert.equal(f.counts().fuseCalls,0);assert.equal(f.counts().wireCalls,1);
 f.setTime(START+1000);assert.equal((await f.check(code)).status,'rate-limited');
 f.setTime(START+30000);assert.equal((await f.check(code)).referencePrice,10);
});
test('a rollback noticed by a concurrent consumer invalidates the original pending capture even after clock recovery',async()=>{
 const f=fixture(),release=f.delay(),pending=f.check(code);
 f.setTime(START+1000);const joined=f.check(code);
 f.setTime(START+500);const rejectedPending=f.check(code);
 f.setTime(START+1000);release();const rejected=await rejectedPending;
 assert.equal(rejected.status,'clock-invalid');
 for(const result of await Promise.all([pending,joined])){
  assert.equal(result.status,'clock-invalid');assert.equal(result.referencePrice,null);
 }
 assert.equal(f.counts().fuseCalls,0);assert.equal(f.counts().wireCalls,1);
});
test('failed no-evidence capture retains its original diagnostic and cooldown',async()=>{
 const f=fixture();f.setKind('unavailable');const first=await f.check(code);
 f.setTime(START+25000);const cached=await f.check(code);
 assert.equal(cached.status,'insufficient-comparable-sources');assert.equal(cached.checkedAt,first.checkedAt);
 assert.equal(cached.referencePrice,null);assert.equal(f.counts().wireCalls,1);
});
test('same-stock pending deduplication, different-stock cooldown and session gate remain intact',async()=>{
 const f=fixture(),release=f.delay(),one=f.check(code),two=f.check(code);
 assert.equal((await f.check('600002')).status,'rate-limited');release();
 const [a,b]=await Promise.all([one,two]);assert.equal(a.referencePrice,10);assert.equal(a,b);
 assert.equal(f.counts().wireCalls,1);f.halt();
 assert.equal((await f.check(code)).status,'session-closed');assert.equal(f.counts().wireCalls,1);
});
