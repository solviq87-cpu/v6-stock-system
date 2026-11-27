'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createFundHistoryCache,REFRESH_MS}=require('../src/core/fund-history-cache');
const code='600000',day='2026-11-26',epoch=Date.parse(day+'T10:00:00+08:00');
function rows(date,at,count=12){
 const out=[];let cursor=date;
 while(out.length<count){
  if(![0,6].includes(new Date(cursor+'T12:00:00Z').getUTCDay()))out.unshift({date:cursor,main:1000000,source:'eastmoney',
   fundsMethod:'vendor-order-size-estimate',fundsUnit:'CNY',retrievedAt:at,sourceTimestamp:null});
  cursor=new Date(Date.parse(cursor+'T12:00:00Z')-86400000).toISOString().slice(0,10);
 }
 return out;
}
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
test('a query older than the verified latest window never starts an ineffective current-provider request',async()=>{
 const current=rows(day,epoch-1000),cache=new Map([[code,current]]);let calls=0;
 const r=createFundHistoryCache({cache,clock:()=>epoch,fetchHistory:async()=>{calls++;return rows(day,epoch);}});
 assert.equal(await r.read(code,{day:'2026-11-25'}),null);
 assert.equal(await r.read(code,{day:'2026-11-24'}),null);
 assert.equal(calls,0);assert.equal(cache.get(code),current);assert.equal(r.status(code),null);
 assert.equal(await r.read(code,{day}),current);
});
test('clock rollback does not bypass the original failed-attempt retry interval',async()=>{
 let at=epoch,calls=0,up=false;
 const r=createFundHistoryCache({cache:new Map(),clock:()=>at,fetchHistory:async()=>{
  calls++;if(!up)throw Error('offline');return rows(day,at);
 }});
 assert.equal(await r.read(code,{day}),null);
 at=epoch-1000;assert.equal(await r.read(code,{day}),null);assert.equal(calls,1);
 at=epoch+REFRESH_MS-1;assert.equal(await r.read(code,{day}),null);assert.equal(calls,1);
 at++;up=true;assert.equal((await r.read(code,{day})).length,12);assert.equal(calls,2);
});
test('all concurrent waiters use one partial provider receipt even after a long first attempt',async()=>{
 let at=epoch,calls=0,release;const cache=new Map();
 const r=createFundHistoryCache({cache,clock:()=>at,fetchHistory:()=>{
  calls++;
  if(calls>1)return Promise.resolve(rows(day,at,4));
  return new Promise(resolve=>{release=resolve;});
 }});
 const work=Array.from({length:20},()=>r.read(code,{day,days:10}));
 await flush();assert.equal(calls,1);
 at+=REFRESH_MS+1;const receipt=rows(day,at,4);release(receipt);
 const values=await Promise.all(work);
 assert.equal(calls,1);assert.equal(values.length,20);
 assert.ok(values.every(v=>v===cache.get(code)&&v.length===4&&v[0].retrievedAt===at));
 assert.equal(r.status(code).status,'partial');
});
test('a concurrent historical waiter does not borrow the newer day or cause a second supplier call',async()=>{
 let at=epoch,calls=0,release;const r=createFundHistoryCache({cache:new Map(),clock:()=>at,fetchHistory:()=>{
  calls++;
  return calls===1?new Promise(resolve=>{release=resolve;}):Promise.resolve(rows(day,at));
 }});
 const first=r.read(code,{day}),older=r.read(code,{day:'2026-11-25'});
 await flush();at+=REFRESH_MS+1;release(rows(day,at));await first;
 assert.equal(await older,null);assert.equal(calls,1);
});
test('a new independent read still refreshes after the original fifteen-minute interval',async()=>{
 let at=epoch,calls=0;const r=createFundHistoryCache({cache:new Map(),clock:()=>at,fetchHistory:async()=>{calls++;return rows(day,at);}});
 const first=await r.read(code,{day});
 at+=REFRESH_MS-1;assert.equal(await r.read(code,{day}),first);assert.equal(calls,1);
 at++;const second=await r.read(code,{day});assert.equal(second.at(-1).retrievedAt,at);assert.equal(calls,2);
});
