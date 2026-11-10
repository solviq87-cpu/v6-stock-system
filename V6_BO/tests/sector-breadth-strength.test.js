'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateSectorBreadthStrength:evaluate}=require('../src/core/sector-breadth-strength');
const {researchLiveMarket}=require('../src/core/live-market-research');
const asOf=Date.parse('2026-11-10T10:30:00+08:00'),tradeDate='2026-11-10',at=asOf-60000;
const codes=Array.from({length:20},(_,i)=>String(i+1).padStart(6,'0'));
function fixture(){
 const pcts=[2.4,2.5,2.3,3,2.2,2.1,2.8,2.5,-.2,-.5,20,18,-1,-1,-1,-1,-1,-1,-1,-1];
 const snapshot={date:tradeDate,source:'eastmoney-clist-unverified-live',universeSize:20,
  retrievedAt:new Date(asOf).toISOString(),pages:1,stocks:codes.map((code,i)=>({code,pctChange:pcts[i],vendorQuoteAt:at}))};
 const board=(code,name,memberCodes,changePct)=>({code,name,kind:'industry',source:'eastmoney-board-unverified',tradeDate,
  observedAt:at,totalMembers:memberCodes.length,memberCodes,changePct});
 const sectorObservations={tradeDate,source:'eastmoney-board-unverified',observedAt:at,
  sectors:[board('BK1001','普涨样本',codes.slice(0,10),2.1),board('BK1002','权重独涨样本',codes.slice(10),3.2)]};
 return {snapshot,sectorObservations,asOf};
}
test('detects broad gains ahead of misleading board % leader; no order or official score changes',()=>{
 const input=fixture(),copy=structuredClone(input),r=evaluate(input);
 assert.equal(r.status,'observed-unverified');
 assert.equal(r.sectors.industry[0].name,'普涨样本');
 assert.equal(r.sectors.industry[0].label,'broad-leading');
 assert.equal(r.sectors.industry[1].label,'narrow-led');
 assert.ok(r.sectors.industry[0].score>r.sectors.industry[1].score);
 assert.equal(r.sectors.industry[0].up,8);
 assert.equal(r.sectors.industry[1].up,2);
 assert.equal(r.canTrade,false);assert.equal(r.rankingModified,false);
 assert.equal(r.verifiedLive,false);assert.deepEqual(input,copy);
});
test('missing original quote timestamp cannot be replaced by receipt time',()=>{
 const input=fixture();input.snapshot.stocks.forEach(s=>delete s.vendorQuoteAt);
 const r=evaluate(input);assert.equal(r.status,'insufficient-evidence');
 assert.equal(r.reason,'market-fresh-coverage-insufficient');
});
test('future and stale quote time, prior day and mismatched providers fail closed',()=>{
 for(const update of [
  x=>x.snapshot.stocks.forEach(s=>s.vendorQuoteAt=asOf+1000),
  x=>x.snapshot.stocks.forEach(s=>s.vendorQuoteAt=asOf-3600000),
  x=>x.snapshot.date='2026-11-09',
  x=>x.sectorObservations.observedAt=asOf+1000,
  x=>x.sectorObservations.tradeDate='2026-11-09'
 ]){
  const input=fixture();update(input);
  assert.notEqual(evaluate(input).status,'observed-unverified');
 }
 const x=fixture();x.sectorObservations.sectors[0].source='different-source';
 const r=evaluate(x);assert.equal(r.sectors.industry.length,1);assert.equal(r.status,'insufficient-comparison');
});
test('partial board membership, duplicate members and malformed numbers do not create false breadth',()=>{
 const x=fixture();x.sectorObservations.sectors[0].totalMembers=100;
 assert.equal(evaluate(x).sectors.industry.length,1);
 const y=fixture();y.sectorObservations.sectors[0].memberCodes[1]=y.sectorObservations.sectors[0].memberCodes[0];
 assert.equal(evaluate(y).sectors.industry.length,1);
 const z=fixture();z.sectorObservations.sectors[0].changePct='2.1';
 assert.equal(evaluate(z).sectors.industry.length,1);
});
test('concept overlap allowed across boards, not within the same board',()=>{
 const x=fixture();const b=structuredClone(x.sectorObservations.sectors[0]);
 b.code='BK2000';b.kind='concept';x.sectorObservations.sectors.push(b);
 const r=evaluate(x);
 assert.equal(r.sectors.concept.length,1);assert.equal(r.sectors.industry.length,2);
});
test('simulation labels and incomparable sector types never pass observational ranking',()=>{
 const x=fixture();x.snapshot.source='simulated';
 assert.equal(evaluate(x).status,'insufficient-evidence');
 const y=fixture();y.sectorObservations.source='fixture';
 assert.equal(evaluate(y).status,'insufficient-evidence');
 const z=fixture();z.sectorObservations.sectors[1].kind='concept';
 assert.equal(evaluate(z).status,'insufficient-comparison');
});
test('live research only adds optional read-only sector study when explicitly supplied',async()=>{
 const input=fixture();const opts={now:asOf,fetchSnapshot:async()=>input.snapshot};
 const before=await researchLiveMarket(opts);
 assert.equal(Object.hasOwn(before,'sectorStrengthStudy'),false);
 const after=await researchLiveMarket({...opts,sectorObservation:input.sectorObservations});
 assert.equal(after.sectorStrengthStudy.sectors.industry[0].label,'broad-leading');
 assert.deepEqual(after.breadth,before.breadth);
 assert.deepEqual(after.candidateIntersection,before.candidateIntersection);
 assert.equal(after.rankingModified,false);
});
