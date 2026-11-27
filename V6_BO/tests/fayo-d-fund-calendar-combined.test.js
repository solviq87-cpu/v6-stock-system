'use strict';
// Exercise the actual default calendar reader and checked-in calendar file.
// Only supplier funds observations and clocks are controlled fixtures.
const test=require('node:test'),assert=require('node:assert/strict');
const calendar=require('../config/research-calendar-2026.json');
const {readResearchCalendar}=require('../src/core/research-calendar-source');
const {createFundHistoryCache}=require('../src/core/fund-history-cache');
const stamp=(d,t='16:00:00')=>Date.parse(d+'T'+t+'+08:00');
const day='2026-11-27',now=stamp(day),code='600000';
const sessions=calendar.sessions.filter(r=>r.open).map(r=>r.date);
const dates=d=>sessions.filter(x=>x<=d).slice(-12);
const funds=(ds,at)=>ds.map(date=>({date,main:100,source:'eastmoney',fundsMethod:'vendor-order-size-estimate',fundsUnit:'CNY',retrievedAt:at,sourceTimestamp:null}));
function make({at=now,rows=funds(dates(day),at),cache=new Map()}={}){
 let calls=0;
 return {reader:createFundHistoryCache({cache,clock:()=>at,fetchHistory:async()=>{calls++;return rows;}}),calls:()=>calls};
}
test('default checked-in calendar and real funds cache agree on the ten actual sessions',async()=>{
 const c=readResearchCalendar({asOf:now,symbol:code});
 assert.equal(c.status,'available');assert.equal(c.tradeDates.length,242);
 const rows=funds(dates(day),now);rows.at(-1).main=0;rows.at(-2).main=-50;
 const h=make({rows}),result=await h.reader.read(code,{day,days:10}),status=h.reader.status(code);
 assert.equal(result.at(-1).main,0);assert.equal(result.at(-2).main,-50);
 assert.equal(status.status,'observed');assert.deepEqual(status.expectedSessions,dates(day).slice(-10));
 assert.deepEqual(status.missingSessions,[]);assert.equal(status.calendarExternallyVerified,false);assert.equal(status.canTrade,false);
});
test('twelve rows including a real closed weekend cannot conceal an absent open session',async()=>{
 const missing=dates(day).at(-4),ds=dates(day).filter(d=>d!==missing).concat('2026-11-21').sort();
 const h=make({rows:funds(ds,now)});
 assert.equal((await h.reader.read(code,{day})).length,12);
 const s=h.reader.status(code);assert.equal(s.status,'partial');assert.equal(s.coverageStatus,'calendar-conflict');
 assert.deepEqual(s.missingSessions,[missing]);assert.deepEqual(s.closedDayRows,['2026-11-21']);
});
test('actual first-observed clock prevents premature calendar knowledge',async()=>{
 const d='2026-11-12',at=stamp(d,'16:00:00');
 assert.ok(at<Date.parse(calendar.firstObservedAt));
 assert.equal(readResearchCalendar({asOf:at,symbol:code}).status,'unavailable');
 const h=make({at,rows:funds(dates(d),at)});
 assert.equal((await h.reader.read(code,{day:d})).length,12);
 const s=h.reader.status(code);assert.equal(s.status,'partial');assert.equal(s.expectedSessions,null);assert.equal(s.missingSessions,null);
});
test('BSE without bundled exchange evidence remains unknown even for a full sample',async()=>{
 const h=make();assert.equal(readResearchCalendar({asOf:now,symbol:'920001'}).status,'unavailable');
 assert.equal((await h.reader.read('920001',{day})).length,12);
 const s=h.reader.status('920001');assert.equal(s.status,'partial');assert.equal(s.expectedSessions,null);
});
test('older explicit date uses retained original data but never fetches the latest fixed window',async()=>{
 const oldDay='2026-11-26',receipt=stamp(oldDay),old=funds(dates(oldDay),receipt),h=make({cache:new Map([[code,old]])});
 assert.deepEqual(await h.reader.read(code,{day:oldDay}),old);assert.equal(h.calls(),0);
 const empty=make();assert.equal(await empty.reader.read(code,{day:oldDay}),null);assert.equal(empty.calls(),0);
});
test('outside the recorded annual calendar a later receipt cannot invent 2027 sessions',async()=>{
 const d='2027-01-04',at=stamp(d),h=make({at,rows:funds([...dates(day).slice(-11),d],at)});
 assert.equal(readResearchCalendar({asOf:at,symbol:code}).status,'unavailable');
 assert.equal((await h.reader.read(code,{day:d})).length,12);
 const s=h.reader.status(code);assert.equal(s.status,'partial');assert.equal(s.expectedSessions,null);assert.equal(s.canTrade,false);
});
