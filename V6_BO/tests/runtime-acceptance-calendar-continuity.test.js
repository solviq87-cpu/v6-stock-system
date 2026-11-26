'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createRuntimeAcceptance}=require('../src/core/runtime-acceptance');
const sha='a'.repeat(40),oldHash='b'.repeat(64),newHash='c'.repeat(64);
const dates=['2026-11-23','2026-11-24','2026-11-25','2026-11-26','2026-11-27','2026-11-30'];
const at=(day,h=9,m=30)=>Date.parse(day+'T'+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':00+08:00');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-runtime-calendar-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let now=at(dates[0]),failing=false,cal={status:'available',tradeDates:dates,metadata:{source:'original-calendar',runtimeEligible:true,sha256:oldHash,from:dates[0],to:dates.at(-1)}};
 const ops=createRuntimeAcceptance({root,canWrite:()=>true,clock:()=>now,liveCollector:true,env:{NODE_ENV:'production'},
  calendar:async()=>{if(cal instanceof Error)throw cal;return cal;},release:async()=>({verifiedInstalled:true,sourceSha:sha}),
  collect:async()=>{if(failing)throw Error('collector failure');return {mode:'live',market:{expectedSymbols:1,attempts:1,successes:1,quotes:[{code:'600001',source:'provider',price:10,quoteAt:now-1000,receivedAt:now}]}};}});
 return {root,ops,setNow:v=>now=v,setFailing:v=>failing=v,setCalendar:v=>cal=v,calendar:()=>cal};
}
test('a revised calendar cannot erase the first failed qualified attempt or shift the original five-day window',async t=>{
 const f=fixture(t);f.setFailing(true);assert.equal((await f.ops.tick()).recorded,true);f.setFailing(false);
 for(const day of dates.slice(1)){f.setNow(at(day));assert.equal((await f.ops.tick()).recorded,true);}
 f.setNow(at(dates.at(-1),16,0));const raw=fs.readFileSync(path.join(f.root,dates[0]+'.jsonl'));
 f.setCalendar({...f.calendar(),tradeDates:dates.slice(1),metadata:{...f.calendar().metadata,sha256:newHash}});
 const r=await f.ops.report();assert.equal(r.days[0].day,dates[0]);assert.equal(r.days[0].attemptSamples,1);assert.ok(r.days[0].failures.includes('collector-failure'));
 assert.equal(r.stages[0].from,dates[0]);assert.equal(r.stages[0].to,dates[4]);assert.ok(r.stages[0].blockers.includes('calendar-attempt-days-omitted'));
 assert.deepEqual(r.calendar.omittedAttemptDays,[dates[0]]);assert.equal(r.calendar.windowCoverageConfirmed,false);assert.deepEqual(fs.readFileSync(path.join(f.root,dates[0]+'.jsonl')),raw);
});
test('calendar outages preserve old genuine observation days but cannot certify complete window coverage',async t=>{
 const f=fixture(t);assert.equal((await f.ops.tick()).liveEligible,true);f.setNow(at(dates[0],16,0));
 for(const cal of [{status:'unavailable'},Error('calendar unavailable')]){
  f.setCalendar(cal);const r=await f.ops.report();assert.equal(r.days.length,1);assert.equal(r.observedTradingDays,1);
  assert.equal(r.calendar.windowCoverageConfirmed,false);assert.ok(r.stages[0].blockers.includes('calendar-window-coverage-unverified'));assert.equal(r.longTermAccepted,false);
 }
});
test('calendar fingerprint changes require review even when all dates stay the same',async t=>{
 const f=fixture(t);assert.equal((await f.ops.tick()).recorded,true);f.setNow(at(dates[0],16,0));
 f.setCalendar({...f.calendar(),metadata:{...f.calendar().metadata,sha256:newHash}});const r=await f.ops.report();
 assert.deepEqual(r.calendar.versionMismatchDays,[dates[0]]);assert.ok(r.stages[0].blockers.includes('calendar-version-changed-requires-review'));assert.equal(r.calendar.windowCoverageConfirmed,false);
});
test('invalid date identities and dates outside declared coverage cannot authorize new sampling',async t=>{
 for(const override of [{tradeDates:[dates[0],'2026-02-30']},{metadata:{from:'2026-11-24',to:dates.at(-1)}},{metadata:{from:dates[0],to:'2026-11-22'}}]){
  const f=fixture(t);f.setCalendar({...f.calendar(),...override,metadata:{...f.calendar().metadata,...override.metadata}});
  assert.equal((await f.ops.tick()).reason,'calendar-unavailable');assert.deepEqual(fs.readdirSync(f.root),[]);
 }
});
test('an unchanged qualified calendar retains genuine missed days in a complete date population',async t=>{
 const f=fixture(t);assert.equal((await f.ops.tick()).liveEligible,true);f.setNow(at(dates[2]));assert.equal((await f.ops.tick()).liveEligible,true);
 f.setNow(at(dates[2],16,0));const r=await f.ops.report();assert.equal(r.calendar.windowCoverageConfirmed,true);assert.equal(r.elapsedTradingDaysComplete,true);
 assert.deepEqual(r.missingTradingDays,[dates[1]]);assert.equal(r.elapsedTradingDays,3);assert.equal(r.observedTradingDays,2);
});
