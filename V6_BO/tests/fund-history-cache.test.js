'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createFundHistoryCache,REFRESH_MS}=require('../src/core/fund-history-cache');
const at=(day,time='10:00:00')=>Date.parse(day+'T'+time+'+08:00');
function rows(day,receivedAt,count=12){
 const result=[];let cursor=day;
 while(result.length<count){
  if(![0,6].includes(new Date(cursor+'T12:00:00Z').getUTCDay()))result.unshift({date:cursor,main:1000000,
   source:'eastmoney',fundsMethod:'vendor-order-size-estimate',fundsUnit:'CNY',retrievedAt:receivedAt,sourceTimestamp:null});
  cursor=new Date(Date.parse(cursor+'T12:00:00Z')-86400000).toISOString().slice(0,10);
 }
 return result;
}
test('long-lived instance refreshes the next trading day and supplies the advertised ten-day window',async()=>{
 let now=at('2026-11-25'),calls=0;const cache=new Map([['600000',rows('2026-11-24',at('2026-11-24'))]]);
 const reader=createFundHistoryCache({cache,clock:()=>now,fetchHistory:async(code,count)=>{
  calls++;assert.equal(code,'600000');assert.equal(count,12);return rows(new Date(now+28800000).toISOString().slice(0,10),now);
 }});
 const first=await reader.read('600000',{day:'2026-11-25',days:10});
 assert.equal(first.length,12);assert.equal(first.at(-1).date,'2026-11-25');assert.equal(calls,1);
 await reader.read('600000',{day:'2026-11-25',days:10});assert.equal(calls,1);
 now=at('2026-11-26');const next=await reader.read('600000',{day:'2026-11-26',days:10});
 assert.equal(next.at(-1).date,'2026-11-26');assert.equal(calls,2);
});
test('failure retains old dates and receipt times, backs off, then recovers without fabricating a missing day',async()=>{
 let now=at('2026-11-25'),calls=0,fail=true;
 const old=rows('2026-11-24',at('2026-11-24')),cache=new Map([['600000',old]]);
 const reader=createFundHistoryCache({cache,clock:()=>now,fetchHistory:()=>{
  calls++;if(fail)throw Error('provider down');return rows('2026-11-25',now);
 }});
 assert.equal(await reader.read('600000',{day:'2026-11-25'}),old);
 assert.equal(reader.status('600000').status,'unavailable');assert.equal(calls,1);
 assert.equal(await reader.read('600000',{day:'2026-11-25'}),old);assert.equal(calls,1);
 assert.equal(cache.get('600000').at(-1).retrievedAt,at('2026-11-24'));
 now+=REFRESH_MS;fail=false;
 assert.equal((await reader.read('600000',{day:'2026-11-25'})).at(-1).date,'2026-11-25');assert.equal(calls,2);
});
test('concurrent rebuilds share one supplier request and intraday refresh remains bounded',async()=>{
 let now=at('2026-11-25'),calls=0,release;
 const reader=createFundHistoryCache({cache:new Map(),clock:()=>now,fetchHistory:()=>{
  calls++;return new Promise(resolve=>{release=()=>resolve(rows('2026-11-25',now));});
 }});
 const first=reader.read('600000',{day:'2026-11-25'}),second=reader.read('600000',{day:'2026-11-25'});
 await Promise.resolve();assert.equal(calls,1);release();await Promise.all([first,second]);
 now+=REFRESH_MS-1;await reader.read('600000',{day:'2026-11-25'});assert.equal(calls,1);
 now++;const third=reader.read('600000',{day:'2026-11-25'});await Promise.resolve();release();await third;assert.equal(calls,2);
});
test('future, contradictory, missing-unit and synthetic receipts never replace the last original snapshot',async()=>{
 const now=at('2026-11-25');
 for(const corrupt of [r=>{r.at(-1).date='2026-11-26';},r=>{r[0].date=r[1].date;},r=>{r[0].fundsUnit='USD';},
  r=>{r[0].sourceTimestamp=now+1;},r=>{r[0].synthetic=true;},r=>{r[0].retrievedAt=now+1;}]){
  const old=rows('2026-11-24',at('2026-11-24')),bad=rows('2026-11-25',now);corrupt(bad);
  const cache=new Map([['600000',old]]),reader=createFundHistoryCache({cache,clock:()=>now,fetchHistory:async()=>bad});
  assert.equal(await reader.read('600000',{day:'2026-11-25'}),old);assert.equal(reader.status('600000').status,'unavailable');
 }
});
test('partial provider windows retain unknown amounts without borrowing an older value',async()=>{
 const now=at('2026-11-25'),cache=new Map([['600000',rows('2026-11-24',at('2026-11-24'))]]),partial=rows('2026-11-25',now,6);
 partial[3].main=null;
 const reader=createFundHistoryCache({cache,clock:()=>now,fetchHistory:async()=>partial});
 const result=await reader.read('600000',{day:'2026-11-25',days:10});
 assert.equal(result.length,6);assert.equal(result[3].main,null);assert.equal(result[3].sourceTimestamp,null);
 assert.equal(reader.status('600000').status,'partial');
});
test('invalid future day or oversized window does not start supplier work',async()=>{
 const reader=createFundHistoryCache({cache:new Map(),clock:()=>at('2026-11-25'),fetchHistory:()=>assert.fail('must not fetch')});
 await assert.rejects(reader.read('600000',{day:'2026-11-26'}));
 await assert.rejects(reader.read('600000',{day:'2026-11-25',days:11}));
});
