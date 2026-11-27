'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createFundHistoryCache,verifiedRows,REFRESH_MS}=require('../src/core/fund-history-cache');
const day='2026-11-27',now=Date.parse(day+'T10:00:00+08:00'),code='600000';
// A deliberately closed weekday in this explicit fixture tests gap detection.
const dates=['2026-11-10','2026-11-11','2026-11-12','2026-11-13','2026-11-16','2026-11-17','2026-11-18','2026-11-19','2026-11-20','2026-11-23','2026-11-24','2026-11-26',day];
const calendarReader=()=>({status:'available',calendar:{from:dates[0],to:'2026-11-30'},tradeDates:dates});
const rows=(ds=dates.slice(-12),receipt=now)=>ds.map(date=>({date,main:100,source:'eastmoney',fundsMethod:'vendor-order-size-estimate',fundsUnit:'CNY',retrievedAt:receipt,sourceTimestamp:null}));
function make(opts={}){return createFundHistoryCache({cache:new Map(),clock:()=>now,calendarReader,fetchHistory:async()=>rows(),...opts});}
const input={day,days:10};
test('closed calendar day conflicts with apparent complete vendor window',async()=>{
 const data=rows([...dates.slice(-11),'2026-11-25'].sort()),r=make({fetchHistory:async()=>data});
 await r.read(code,input);assert.equal(r.status(code).status,'partial');assert.equal(r.status(code).coverageStatus,'calendar-conflict');assert.deepEqual(r.status(code).closedDayRows,['2026-11-25']);
});
test('malformed full calendar cannot certify even an apparently complete tail',async()=>{
 const r=make({calendarReader:()=>({...calendarReader(),tradeDates:[...dates,day]})});await r.read(code,input);
 assert.equal(r.status(code).complete,false);assert.equal(r.status(code).expectedSessions,null);
});
test('genuine zero and negative money remain observed while null stays unknown',async()=>{
 const data=rows();data[3].main=0;data[4].main=-50;data.at(-2).main=null;const r=make({fetchHistory:async()=>data});
 const v=await r.read(code,input);assert.equal(v[3].main,0);assert.equal(v[4].main,-50);assert.equal(v.at(-2).main,null);assert.deepEqual(r.status(code).missingSessions,[dates.at(-2)]);
});
test('wrong identity aliases and explicit invalid trade date fail even without caller code',()=>{
 for(const patch of [{code:600000},{code,symbol:'000001'},{tradeDate:''}]){
  const data=rows();Object.assign(data[0],patch);assert.equal(verifiedRows(data,{day,now}),null);
 }
});
test('old receive time cannot be relabelled as a new fetched batch even with no previous cache',async()=>{
 const r=make({fetchHistory:async()=>rows(dates.slice(-12),now-1000)});assert.equal(await r.read(code,input),null);assert.equal(r.status(code).status,'unavailable');
});
test('new local receipt cannot replace newer original vendor time or contradict equal original time',async()=>{
 const previous=rows(dates.slice(-12),now-REFRESH_MS),p=previous.at(-1);p.sourceTimestamp=now-REFRESH_MS-1000;
 for(const patch of [{sourceTimestamp:p.sourceTimestamp-1000},{sourceTimestamp:p.sourceTimestamp,main:999},{sourceTimestamp:null}]){
  const data=rows();Object.assign(data.at(-1),patch);const cache=new Map([[code,previous]]),r=make({cache,fetchHistory:async()=>data});
  assert.equal(await r.read(code,input),previous);assert.equal(cache.get(code),previous);
 }
});
