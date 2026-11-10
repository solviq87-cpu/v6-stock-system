'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inspectSectorShadowEligibility:inspect}=require('../src/core/sector-shadow-learning-preflight');
const {observeSectorShadowForward:observe}=require('../src/core/sector-shadow-forward-observer');
const {bridgeExistingMarketSector:bridge}=require('../src/core/sector-breadth-market-bridge');
const days=['2026-11-04','2026-11-05','2026-11-06',
 '2026-11-09','2026-11-10','2026-11-11'];
const clock=d=>Date.parse(d+'T10:30:00+08:00');
function fixture(day,{shift=0}={}){
 const end=clock(day),start=end-60000,stocks=[],sectors=[];
 for(let group=0;group<3;group++){
  const members=[];
  for(let i=0;i<5;i++){
   const code=String(600001+group*100+i);
   const change=[4,1,-2][group]+shift+(group===0?i*.1:0);
   stocks.push({code,pctChange:change,vendorQuoteAt:end-5000});
   members.push(code);
  }
  sectors.push({category:'industry',code:'BS_'+group,
   name:'industry'+group,memberCount:5,members});
 }
 const snapshot={date:day,source:'eastmoney-clist-unverified-live',
  universeSize:15,startedAt:new Date(start).toISOString(),
  retrievedAt:new Date(end).toISOString(),stocks};
 const membership={schemaVersion:1,source:'imported',
  provider:'baostock:query_stock_industry',
  classificationVersion:'baostock-csrc-2026-11-03-fixed-sha',
  tradeDate:day,observedAt:start-60000,sectors};
 const p=inspect(snapshot,membership,{asOf:end});
 assert.equal(p.status,'shadow-input-preview-unverified');
 const b=bridge(snapshot,membership,{asOf:end});
 assert.equal(b.status,'imported-unverified');
 const record={schemaVersion:1,mode:'dated-sector-research-only',
  status:b.status,reason:null,tradeDate:day,observedAt:end,data:b,
  verifiedLive:false,canTrade:false,weightsChanged:false};
 return {preflight:p,record};
}
const cases=days.map((d,i)=>fixture(d,{shift:i*.2}));
const frozen=cases[0].preflight,archives=cases.map(x=>x.record);
const run=(records=archives,asOf=clock(days.at(-1)))=>
 observe(frozen,records,{tradeDates:days,asOf});

test('only exact later trading sessions mature descriptive 3/5 windows, never training or trading',()=>{
 const untouched=structuredClone({frozen,archives,days});
 const r=run();
 assert.equal(r.status,'research-observation-unverified');
 assert.equal(r.threeSession.status,'descriptive-observed-unverified');
 assert.equal(r.fiveSession.status,'descriptive-observed-unverified');
 assert.deepEqual(r.threeSession.calendarDates,days.slice(1,4));
 assert.deepEqual(r.fiveSession.calendarDates,days.slice(1,6));
 assert.equal(r.threeSession.observedSectors,3);
 assert.equal(r.fiveSession.observedSectors,3);
 const sample=r.fiveSession.sectors.find(s=>s.code==='BS_0');
 assert.equal(sample.status,'descriptive-observed-unverified');
 assert.equal(sample.observedTradingDates.length,5);
 assert.equal(sample.scoreChange,Number((sample.latestScore-sample.baselineScore).toFixed(3)));
 assert.equal(r.labelsAvailable,false);
 assert.equal(r.returnsAvailable,false);
 assert.equal(r.outOfSampleValidated,false);
 assert.equal(r.canTrain,false);
 assert.equal(r.canTrade,false);
 assert.equal(r.canNotify,false);
 assert.equal(r.weightsChanged,false);
 assert.equal(r.autoPromotion,false);
 assert.deepEqual({frozen,archives,days},untouched,'pure research must not mutate inputs');
});
test('before a fifth later session occurs, three can be observed while five remains pending',()=>{
 const r=run(archives.slice(0,4),clock(days[3]));
 assert.equal(r.threeSession.status,'descriptive-observed-unverified');
 assert.equal(r.fiveSession.status,'pending');
 assert.equal(r.fiveSession.reason,'future-trading-sessions-not-yet-observed');
 assert.equal(r.canTrain,false);
});
test('missing middle session is not silently skipped even when the latest session exists',()=>{
 const r=run(archives.filter(x=>x.tradeDate!==days[2]));
 for(const h of [r.threeSession,r.fiveSession]){
  assert.equal(h.status,'pending');
  assert.equal(h.reason,'missing-consecutive-daily-archives');
  assert.deepEqual(h.missingTradeDates,[days[2]]);
 }
});
test('a reworked candidate or a missing frozen baseline is rejected',()=>{
 const changed=structuredClone(frozen);
 changed.shadowSample.sectors[0].score+=1;
 const invalid=observe(changed,archives,{tradeDates:days,asOf:clock(days.at(-1))});
 assert.equal(invalid.status,'blocked');
 assert.equal(invalid.reason,'candidate-does-not-match-baseline-archive');
 assert.equal(run(archives.slice(1)).status,'blocked');
});
test('changed classification, quote origin, and later mismatched source are not comparable',()=>{
 for(const mutate of [
  x=>x.data.classificationVersion='different',
  x=>x.data.quoteProvider='other-quote-source',
  x=>x.data.membershipProvider='other-membership-provider'
 ]){
  const records=structuredClone(archives);mutate(records[2]);
  const r=run(records);
  assert.equal(r.threeSession.status,'blocked');
  assert.equal(r.fiveSession.status,'blocked');
 }
});
test('future member-count drift, impossible breadth scores, and wrong observation clocks block',()=>{
 for(const mutate of [
  x=>x.data.study.sectors[0].memberCount=6,
  x=>x.data.study.sectors[0].score=1000,
  x=>x.data.study.sectors[0].upPct=-1,
  x=>x.data.marketQuoteCoveragePct=30,
  x=>x.observedAt+=3600000
 ]){
  const records=structuredClone(archives);mutate(records[2]);
  const r=run(records);
  assert.equal(r.threeSession.status,'blocked');
  assert.equal(r.fiveSession.status,'blocked');
  assert.equal(r.canTrain,false);
 }
});
test('duplicate, unknown and future archives are rejected; calendar gaps cannot invent time',()=>{
 const repeated=run([...archives,archives[1]]);
 assert.equal(repeated.status,'blocked');
 assert.equal(repeated.reason,'duplicate-unlisted-or-future-archive');
 const later=structuredClone(archives);
 later.push({...later[5],tradeDate:'2026-11-12'});
 assert.equal(run(later).status,'blocked');
 const noFuture=observe(frozen,archives.slice(0,1),{
  tradeDates:days.slice(0,3),asOf:clock(days[2])});
 assert.equal(noFuture.threeSession.status,'pending');
 assert.equal(noFuture.threeSession.reason,'explicit-future-calendar-too-short');
 assert.equal(noFuture.fiveSession.status,'pending');
 const invalidCalendar=observe(frozen,archives,{
  tradeDates:[days[0],days[2],days[1],...days.slice(3)],asOf:clock(days.at(-1))});
 assert.equal(invalidCalendar.status,'blocked');
});
test('untrusted preview claims cannot unlock model weights or labels',()=>{
 for(const change of [
  x=>x.canTrain=true,
  x=>x.shadowSample.labelsAvailable=true,
  x=>x.shadowSample.outOfSampleValidated=true,
  x=>x.shadowSample.mode='sector-shadow-training'
 ]){
  const f=structuredClone(frozen);change(f);
  const r=observe(f,archives,{tradeDates:days,asOf:clock(days.at(-1))});
  assert.equal(r.status,'blocked');assert.equal(r.canTrain,false);
 }
});