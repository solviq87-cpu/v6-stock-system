'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fetchEastmoneySnapshot}=require('../src/core/eastmoney-market-snapshot');
const START=Date.parse('2026-11-27T10:00:00+08:00');
const page=(n,total=2)=>({ok:true,status:200,json:async()=>({data:{total,diff:[{
 f12:String(n).padStart(6,'0'),f13:0,f3:1.5,f124:START/1000
}]}})});
// No network or real provider quota is consumed; the existing queue boundary
// remains injectable and every physical fetch is counted in these tests.
const governor=beforeRun=>({run:async(target,work)=>{beforeRun?.();return work();},checkResponse(){}});
const options=(clock,fetchImpl,extra={})=>({now:START,clock,fetchImpl,pageSize:1,maxPages:2,
 requestGovernor:governor(),...extra});

test('reject clock rollback during first page even when still after initial start',async()=>{
 let now=START+1000,calls=0;
 await assert.rejects(fetchEastmoneySnapshot(options(()=>now,async()=>{
  calls++;now=START+500;return page(calls);
 })),/时钟|时间.*倒退/);
 assert.equal(calls,1,'do not send another page of a rejected snapshot');
});
test('clock rollback while queued for second page stops the next wire request',async()=>{
 let now=START,calls=0,queued=0;
 const requestGovernor=governor(()=>{if(++queued===2)now=START+500;});
 await assert.rejects(fetchEastmoneySnapshot(options(()=>now,async()=>{
  calls++;now=START+1000;return page(calls);
 },{requestGovernor})),/时钟|时间.*倒退/);
 assert.equal(queued,2);assert.equal(calls,1);
});
test('final receipt cannot go backwards after last page has passed validation',async()=>{
 let reads=0;
 const times=[START,START+1000,START+2000,START+1500];
 await assert.rejects(fetchEastmoneySnapshot(options(()=>times[Math.min(reads++,3)],async()=>page(1,1))),/时钟|时间.*倒退/);
});
test('coercible or noninteger acquisition clock readings are invalid, not milliseconds',async()=>{
 for(const value of [new Date(START),new Date(START).toISOString(),START+0.5,NaN,Infinity,null,false]){
  let calls=0;
  await assert.rejects(fetchEastmoneySnapshot(options(()=>value,async()=>{calls++;return page(1,1);})),/时钟|时间/);
  assert.equal(calls,0);
 }
});
test('coercible or invalid initial request clock must never start a request',async()=>{
 for(const now of [new Date(START),new Date(START).toISOString(),START+0.5,0,-1,NaN]){
  let calls=0;
  await assert.rejects(fetchEastmoneySnapshot(options(()=>START,async()=>{calls++;return page(1,1);},{now})),/时钟|时间/);
  assert.equal(calls,0);
 }
});
test('normal monotonic and frozen clocks keep two-page and original quote semantics',async()=>{
 for(const frozen of [true,false]){
  let now=START,calls=0;
  const result=await fetchEastmoneySnapshot(options(()=>now,async()=>{
   calls++;if(!frozen)now+=1000;return page(calls);
  }));
  assert.equal(calls,2);assert.equal(result.pages,2);assert.equal(result.stocks.length,2);
  assert.equal(Date.parse(result.startedAt),START);
  assert.equal(Date.parse(result.retrievedAt),now);
  assert.equal(result.samplingDurationMs,now-START);
  assert.equal(result.stocks[0].vendorQuoteAt,START);
  assert.equal(result.verifiedLive,false);
 }
});
test('original cross-day and maximum sampling-span guards remain enforced',async()=>{
 let calls=0,now=START;
 await assert.rejects(fetchEastmoneySnapshot(options(()=>now,async()=>{calls++;now=START+120001;return page(1,1);})),/跨度/);
 assert.equal(calls,1);
 const start=Date.parse('2026-11-27T23:59:59+08:00');now=start;calls=0;
 await assert.rejects(fetchEastmoneySnapshot(options(()=>now,async()=>{calls++;now=start+1000;return page(1,1);},{now:start})),/跨越.*日期/);
 assert.equal(calls,1);
});
