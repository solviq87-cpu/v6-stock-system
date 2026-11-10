'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assessShadowRuntimeHealth}=require('../src/core/factor-shadow-runtime-health');
const calendar=(start,n)=>Array.from({length:n},(_,i)=>
 new Date(Date.parse(start+'T00:00:00Z')+i*86400000).toISOString().slice(0,10));
const now=Date.parse('2026-11-10T08:00:00Z');
const days=calendar('2026-10-06',36),presence=days.map(()=>true);
const budget={status:'budget-available',remainingTrials:5};
const pulse={schemaVersion:1,mode:'v6-shadow-watch-heartbeat-v1',
 observedAt:now-30000,intervalMs:60000,outcome:'tick-success',
 lastStatus:'skipped-awaiting-post-prereg-signals'};
const assess=o=>assessShadowRuntimeHealth({
 now,signalDays:days,reportFilesPresent:presence,budget,
 accepted:{version:2,lastObservationDay:days[30]},pulse,...o
});
test('read-only health distinguishes recent watch pulse from real model improvement',()=>{
 const r=assess();
 assert.equal(r.status,'recent-heartbeat-only-not-live-certified');
 assert.equal(r.heartbeat.status,'recent-heartbeat-observed');
 assert.equal(r.heartbeat.ageMs,30000);
 assert.equal(r.totalManifestSignalDays,36);
 assert.equal(r.lastManifestSignalDay,'2026-11-10');
 assert.equal(r.lastManifestCalendarAgeDays,0);
 assert.equal(r.missingReportCount,0);
 assert.equal(r.budgetState,'trial-budget-available');
 assert.equal(r.verifiedLive,false);
 assert.equal(r.trainingProgressCertified,false);
 assert.equal(r.canTrade,false);
 assert.equal(r.productionWeightsChanged,false);
 assert.equal(r.reportPresenceNotMaturityProof,true);
});
test('absent, stale and recent-failure heartbeats never claim service running',()=>{
 const absent=assess({pulse:null});
 assert.equal(absent.status,'watch-not-confirmed');
 assert.equal(absent.heartbeat.status,'not-observed');
 assert.ok(absent.issues.includes('no-observed-watch-heartbeat'));
 const stale=assess({pulse:{...pulse,observedAt:now-200000}});
 assert.equal(stale.status,'watch-heartbeat-stale');
 assert.equal(stale.heartbeat.status,'heartbeat-stale');
 const failed=assess({pulse:{...pulse,outcome:'tick-error',
  lastStatus:'worker-evaluation-error'}});
 assert.equal(failed.status,'watch-tick-failed');
 assert.ok(failed.issues.includes('watch-tick-error'));
});
test('missing H5 files blocks research evidence health despite a fresh pulse',()=>{
 const files=[...presence];files[8]=false;files[30]=false;
 const r=assess({reportFilesPresent:files});
 assert.equal(r.status,'missing-research-evidence');
 assert.equal(r.missingReportCount,2);
 assert.equal(r.sealedReportFileCount,34);
 assert.ok(r.issues.includes('missing-research-H5-files'));
});
test('budget exhaustion and shadow decay cooldown are explicit pause states',()=>{
 const exhausted=assess({budget:{status:'budget-exhausted',remainingTrials:0}});
 assert.equal(exhausted.status,'research-budget-paused');
 assert.equal(exhausted.researchState,'research-budget-paused');
 assert.ok(exhausted.issues.includes('trial-budget-exhausted'));
 const decay=assess({cooldown:{status:'paused-shadow-cooldown'}});
 assert.equal(decay.status,'research-decay-paused');
 assert.equal(decay.researchState,'research-decay-cooldown');
});
test('precommitted candidate with no later frozen signal is waiting, not progressing',()=>{
 const r=assess({registration:{latestFrozenSignalDay:days.at(-1)}});
 assert.equal(r.registrationStatus,'sealed-candidate-present');
 assert.ok(r.issues.includes('candidate-awaits-post-registration-signals'));
 assert.equal(r.trainingProgressCertified,false);
});
test('calendar-day age warning is NOT an asserted exchange trading-session outage',()=>{
 const oldDays=calendar('2026-08-01',36);
 const r=assess({signalDays:oldDays});
 assert.equal(r.status,'research-calendar-age-needs-review');
 assert.ok(r.issues.includes('oldest-visible-manifest-calendar-age-review'));
 assert.equal(r.marketCalendar,
  'Asia/Shanghai-calendar-days-not-trading-session-certified');
});
test('future frozen dates, duplicate dates and corrupt pulse fail closed',()=>{
 const futureDays=calendar('2026-10-10',36);
 assert.throws(()=>assess({signalDays:futureDays}),/未来/);
 const duplicate=[...days];duplicate[7]=duplicate[6];
 assert.throws(()=>assess({signalDays:duplicate}),/日历或证据参数/);
 assert.throws(()=>assess({pulse:{...pulse,observedAt:now+1}}),/心跳无效/);
 assert.throws(()=>assess({pulse:{...pulse,intervalMs:1}}),/心跳无效/);
});
