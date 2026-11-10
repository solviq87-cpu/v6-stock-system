'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fuseMultiSourcePrices,checkMultiPublicPrices}=
 require('../src/core/multi-source-price-consensus');

const now=Date.parse('2026-11-10T10:02:00+08:00');
const code='600519';
const source=id=>({id,status:'fresh-unverified',quote:{
 code,exchange:'SH',currency:'CNY',adjustment:'unadjusted',
 status:'normal',price:10,previousClose:9.9,quoteAt:now-1000
}});
const sources=[source('tencent'),source('eastmoney')];

test('an explicit operator calendar omitting this weekday blocks an otherwise aligned price',()=>{
 const r=fuseMultiSourcePrices({code,now,sources,tradingDates:['2026-11-09']});
 assert.equal(r.status,'outside-provided-trading-calendar');
 assert.equal(r.referencePrice,null);
 assert.equal(r.operatorCalendarProvided,true);
 assert.equal(r.operatorCalendarMatch,false);
 assert.equal(r.exchangeCalendarVerified,false);
 assert.equal(r.eligibleCount,2);
 assert.equal(r.canTrade,false);
});

test('a matching operator calendar retains strict source comparison but never certifies the exchange',()=>{
 const r=fuseMultiSourcePrices({code,now,sources,
  tradingDates:['2026-11-09','2026-11-10','2026-11-11']});
 assert.equal(r.status,'sources-agree-unverified');
 assert.equal(r.referencePrice,10);
 assert.equal(r.operatorCalendarProvided,true);
 assert.equal(r.operatorCalendarMatch,true);
 assert.equal(r.exchangeCalendarVerified,false);
 assert.equal(r.certifiedLive,false);
 assert.equal(r.canNotify,false);
 assert.equal(r.canTrade,false);
 const old=fuseMultiSourcePrices({code,now,sources});
 assert.equal(old.status,'sources-agree-unverified');
 assert.equal(old.operatorCalendarProvided,false);
 assert.equal(old.operatorCalendarMatch,null);
});

test('an operator-declared closed day prevents both public and optional network work',async()=>{
 let called=0;
 const r=await checkMultiPublicPrices({code,now,tradingDates:['2026-11-09'],
  probe:async()=>{called++;throw Error('public should not run');},
  fetchItick:async()=>{called++;throw Error('optional should not run');}});
 assert.equal(called,0);
 assert.equal(r.status,'outside-provided-trading-calendar');
 assert.equal(r.referencePrice,null);
 assert.equal(r.sourceStatuses.length,4);
 assert.equal(r.canTrade,false);
});

test('calendar validation rejects invalid dates, duplicates, descending order and unbounded lists',async()=>{
 const bad=[
  [],
  ['2026-02-30'],
  ['2026-11-10','2026-11-10'],
  ['2026-11-10','2026-11-09'],
  ['2026-11-10T00:00:00Z'],
  ['2026-11-10',123],
  Array.from({length:4097},()=> '2026-11-10')
 ];
 for(const tradingDates of bad){
  assert.throws(()=>fuseMultiSourcePrices({code,now,sources,tradingDates}),/导入交易日历/);
  let called=0;
  await assert.rejects(()=>checkMultiPublicPrices({code,now,tradingDates,
   probe:async()=>{called++;throw Error('should not probe');},
   fetchItick:async()=>{called++;throw Error('should not fetch');}}),/导入交易日历/);
  assert.equal(called,0);
 }
});
