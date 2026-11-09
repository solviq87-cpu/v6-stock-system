'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {auditAuctionResonanceBasis:judge}=require('../src/core/auction-resonance-basis');
const now=Date.parse('2026-11-09T09:26:00+08:00');
const stockSnapshotAt=now-20000;
const valid=()=>({auction:{date:'20261109',time:'09:25:06',phase:3,strong:[{code:'000001'}]},
  stockSnapshotAt,stockSnapshotDay:'20261109',expectedDay:'20261109',calendarDay:'20261109',now});
test('same-day time/phase aligns only as unverified snapshot, never certified provider quote',()=>{
 const r=judge(valid());
 assert.equal(r.status,'same-day-capture-unverified');
 assert.equal(r.stale,false);
 assert.equal(r.eligibleForAuctionEvidence,true);
 assert.equal(r.providerQuoteAt,null);
 assert.equal(r.capturedAt,null);
 assert.equal(r.verifiedLive,false);
 assert.equal(r.executedAmountCertified,false);
 assert.match(r.reason,/仍未经认证/);
});
test('prior-day auction cannot be combined with current-day stock/sector feed',()=>{
 const r=judge({...valid(),auction:{...valid().auction,date:'20261106'}});
 assert.equal(r.status,'stale-auction-snapshot');
 assert.equal(r.stale,true);
 assert.equal(r.eligibleForAuctionEvidence,false);
 assert.match(r.reason,/跨日拼接/);
 const s=judge({...valid(),stockSnapshotDay:'20261106'});
 assert.equal(s.status,'stale-auction-snapshot');
});
test('Monday 09:00 before auction never treats Friday as Monday just because quoteBasis uses previous trading day',()=>{
 const r=judge({
  auction:{date:'20261106',time:'09:25:06',phase:3},
  stockSnapshotAt:Date.parse('2026-11-06T15:00:00+08:00'),
  now:Date.parse('2026-11-09T09:00:00+08:00'),
  calendarDay:'20261109',expectedDay:'20261106',
  stockSnapshotDay:'20261106'
 });
 assert.equal(r.status,'stale-auction-snapshot');
 assert.equal(r.eligibleForAuctionEvidence,false);
 assert.equal(r.verifiedLive,false);
});
test('missing source/day/capture timestamp or future receipt does not invent current auction',()=>{
 for(const input of [
  {...valid(),auction:null},
  {...valid(),auction:{time:'09:25:00',phase:3}},
  {...valid(),stockSnapshotAt:null},
  {...valid(),stockSnapshotAt:now+12000},
  {...valid(),expectedDay:'2026-11-09'},
  {...valid(),stockSnapshotDay:''}
 ]){
  const r=judge(input);
  assert.equal(r.eligibleForAuctionEvidence,false);
  assert.equal(r.providerQuoteAt,null);
 }
});
test('reject open-price/cumulative-volume late boot and inconsistent pre-auction phases',()=>{
 for(const bad of [
  {date:'20261109',time:'10:15:00',phase:0},
  {date:'20261109',time:'09:19:00',phase:2},
  {date:'20261109',time:'09:25:00',phase:1},
  {date:'20261109',time:'09:21:00',phase:3},
  {date:'20261109',time:'09:99:00',phase:3},
  {date:'20261109',time:'9:25',phase:0}
 ]){
  const r=judge({...valid(),auction:bad});
  assert.equal(r.status,'unverifiable-auction-phase');
  assert.equal(r.eligibleForAuctionEvidence,false);
 }
});
test('9:15-9:20 and 9:20-9:25 actual phase labels are retained but not considered executed prices',()=>{
 for(const [phase,time] of [[1,'09:16:12'],[2,'09:20:31'],[3,'09:25:12']]){
  const r=judge({...valid(),auction:{date:'20261109',phase,time}});
  assert.equal(r.eligibleForAuctionEvidence,true);
  assert.equal(r.phase,phase);
  assert.equal(r.executedAmountCertified,false);
  assert.equal(r.verifiedLive,false);
 }
});
