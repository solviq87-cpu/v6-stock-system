'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMarketRecovery}=require('../src/research/market-recovery');
const day='2026-11-20',next='2026-11-23',at=Date.parse('2026-11-23T16:00:00+08:00');
const data=(date,upLimit=1)=>({rows:[{date,knownAt:at,source:'fixture',upLimit}]});
function deferred(){let resolve;return {promise:new Promise(r=>resolve=r),resolve};}
test('H02 old-day collection is fenced before archive and projection',async()=>{
 let target=day,saves=0;const d=deferred();
 const r=createMarketRecovery({getDay:()=>target,clock:()=>at,collect:()=>d.promise,save:async()=>{saves++;return true;}});
 const p=r.tick();target=next;d.resolve(data(day));
 assert.deepEqual(await p,[]);assert.equal(saves,0);assert.equal(r.display().lastSuccessAt,null);
});
for(const initialReplica of [false,true])test('H02 role change fences public work: initial replica='+initialReplica,async()=>{
 let replica=initialReplica,saves=0;const d=deferred();
 const r=createMarketRecovery({getDay:()=>day,clock:()=>at,isReplica:()=>replica,replicaPublicReads:true,collect:()=>d.promise,save:async()=>{saves++;return true;}});
 const p=r.tick();replica=!replica;d.resolve(data(day));
 assert.deepEqual(await p,[]);assert.equal(saves,0);assert.equal(r.display().lastSuccessAt,null);
});
test('H02 failed archive never refreshes current success or cached history',async()=>{
 let clock=at,calls=0;
 const r=createMarketRecovery({getDay:()=>day,clock:()=>clock,collect:async()=>data(day,++calls),save:async()=>calls===1});
 await r.tick();const good=r.display().lastSuccessAt;clock+=3600000;await r.tick();
 assert.equal(r.display().lastSuccessAt,good);assert.equal(r.display().metrics.upLimit.value,1);assert.equal(r.rows(day)[0].upLimit,1);assert.equal(r.display().phase,'partial');
});
test('H02 archive receipt arriving after rollover cannot publish stale results',async()=>{
 let target=day;const started=deferred(),done=deferred();
 const r=createMarketRecovery({getDay:()=>target,clock:()=>at,collect:async()=>data(day),save:()=>{started.resolve();return done.promise;}});
 const p=r.tick();await started.promise;target=next;done.resolve(true);
 assert.deepEqual(await p,[]);assert.equal(r.display().lastSuccessAt,null);assert.deepEqual(r.rows(day),[]);
});
test('H02 one synchronous detail error does not cancel independently valid evidence',async()=>{
 let received=0;
 const r=createMarketRecovery({getDay:()=>day,clock:()=>at,collect:async()=>({rows:[{date:day,knownAt:at,upLimit:1,structurePools:[{date:day,source:'fixture',scope:'scope',knownAt:at,complete:true,totalCount:1,sealed:[{code:'600001',level:1}]}]}]}),save:async()=>true,
 readFlow:()=>{throw Error('offline');},readFlags:()=>{received++;return {day,code:'600001',aboveMa5:true,breakHigh:false,barSource:'fixture',barKnownAt:at};}});
 await r.tick();for(let i=0;i<20;i++)await Promise.resolve();
 assert.equal(received,1);assert.equal(r.display().closeWatch.items[0].aboveMa5,true);
});
test('H02 normal collection still coalesces readers and archives once',async()=>{
 let calls=0,saves=0;
 const r=createMarketRecovery({getDay:()=>day,clock:()=>at,collect:async()=>{calls++;return data(day);},save:async()=>{saves++;return true;}});
 await Promise.all([r.tick(),r.tick()]);
 assert.equal(calls,1);assert.equal(saves,1);assert.equal(r.display().lastSuccessAt,at);assert.equal(r.rows(day)[0].upLimit,1);
});
