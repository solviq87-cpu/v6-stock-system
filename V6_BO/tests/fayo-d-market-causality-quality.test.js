'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {auditSnapshotQuoteTimes,classifyQuoteTime}=require('../src/core/market-snapshot-quote-time');
const {bridgeExistingMarketSector:bridge}=require('../src/core/sector-breadth-market-bridge');
const {evaluateMarketEvidence:quality}=require('../src/core/market-evidence-quality');
const {auditQuoteSourceWindow:window}=require('../src/core/quote-source-window-quality');
const {createMarketResponseSnapshot}=require('../src/core/market-response-snapshot');
const NOW=Date.parse('2026-11-26T10:00:00+08:00'),DAY='2026-11-26';
const market=()=>({date:DAY,source:'eastmoney-clist-unverified-live',retrievedAt:new Date(NOW).toISOString(),
 startedAt:new Date(NOW-10000).toISOString(),universeSize:5,stocks:Array.from({length:5},(_,i)=>({code:String(600001+i),pctChange:1,vendorQuoteAt:NOW-1000}))});
const member=()=>({schemaVersion:1,source:'imported',provider:'declared-membership',classificationVersion:'v1',tradeDate:DAY,observedAt:NOW-20000,
 sectors:[{category:'industry',code:'BK1',name:'行业',members:market().stocks.map(x=>x.code),memberCount:5}]});
test('later quote audit never promotes original future-at-receipt evidence',()=>{
 const m=market();m.stocks[0].vendorQuoteAt=NOW+1000;
 const r=auditSnapshotQuoteTimes(m,{asOf:NOW+2000});
 assert.equal(r.counts.future,1);assert.equal(r.recentSourceTimeCount,4);assert.equal(r.originalRetrievedAt,NOW);
 assert.equal(r.canTrade,false);
});
test('audit time cannot substitute for a missing, invalid or later snapshot receipt',()=>{
 for(const raw of [undefined,'2026-02-30T02:00:00.000Z','2026-11-26T02:00:00']){
  const m=market();m.retrievedAt=raw;
  const r=auditSnapshotQuoteTimes(m,{asOf:NOW});assert.equal(r.recentSourceTimeCount,0);
  assert.equal(r.counts['receipt-time-unknown'],5);
 }
 const r=auditSnapshotQuoteTimes(market(),{asOf:NOW-1});
 assert.equal(r.counts['snapshot-not-yet-observed'],5);assert.equal(r.recentSourceTimeCount,0);
});
test('valid receipt still uses original quote age at the 90-second research boundary',()=>{
 const m=market();m.stocks[0].vendorQuoteAt=NOW-90000;
 assert.equal(auditSnapshotQuoteTimes(m,{asOf:NOW}).recentSourceTimeCount,5);
 assert.equal(auditSnapshotQuoteTimes(m,{asOf:NOW+1}).counts['stale-source-time'],1);
 assert.equal(classifyQuoteTime({vendorQuoteAt:NOW},{requestDate:DAY,retrievedAt:NOW}).canTrade,false);
});
test('sector bridge refuses duplicates even when first copy had no usable quote',()=>{
 const m=market();m.stocks[0].vendorQuoteAt=null;
 m.stocks[1].code=m.stocks[0].code;
 assert.equal(bridge(m,member()).reason,'duplicated-or-malformed-market-symbol');
});
test('sector proxy excludes future-at-receipt and explicitly conflicting or halted quotes',()=>{
 const m=market();m.stocks[0].vendorQuoteAt=NOW+1000;
 assert.equal(bridge(m,member(),{asOf:NOW+2000}).reason,'fresh-market-quote-coverage-insufficient');
 for(const flag of [{suspended:true},{tradable:false},{sourceConflict:true},{quoteStatus:'conflict'}]){
  const n=market();Object.assign(n.stocks[0],flag);
  assert.equal(bridge(n,member()).reason,'fresh-market-quote-coverage-insufficient');
 }
 assert.equal(bridge(market(),member()).freshQuotes,5);
});
const q=()=>({catalogued:true,timestampComparable:true,volumeUnitVerified:true,amountUnitVerified:true,amountCoverageGapBars:0,amountComparedBars:5,comparedBars:5,suspensionCoverageComplete:true,discrepancies:0});
test('quality scoring refuses invalid denominator, negative or impossible counts and coerced flags',()=>{
 for(const change of [{comparedBars:0,amountComparedBars:0},{comparedBars:NaN},{discrepancies:-1},{discrepancies:0.5},{amountComparedBars:6},{amountComparedBars:4},{amountCoverageGapBars:1},{catalogued:'false'},{suspensionCoverageComplete:1},{amountUnitVerified:false}]){
  assert.throws(()=>quality({...q(),...change}),/统计/);
 }
});
test('consistent, incomplete and contradictory evidence retain original score semantics',()=>{
 const r=quality(q());assert.equal(r.evidenceCompletenessScore,85);assert.equal(r.status,'consistent-research-only');assert.equal(r.canTrade,false);
 const partial=quality({...q(),amountUnitVerified:false,amountComparedBars:0});assert.equal(partial.status,'incomplete-evidence');assert.equal(partial.evidenceCompletenessScore,75);
 const conflict=quality({...q(),discrepancies:1});assert.equal(conflict.status,'quarantined-conflict');
});
const slots=[NOW,NOW+30000,NOW+60000];
function report(at){return {schemaVersion:1,mode:'two-source-public-quote-diagnostic',code:'600001',
 asOf:new Date(at).toISOString(),source1:'tencent',source2:'eastmoney',canTrade:false,canNotify:false,certifiedLive:false,
 exchangeVerified:false,providerLicensed:false,calendarVerified:false,status:'sources-agree-unverified',discrepancyBps:0,
 quoteAt:at-1000,quoteTimeGapMs:0,sourceStatuses:['tencent','eastmoney'].map(provider=>({provider,status:'fresh-unverified',quoteAt:at-1000}))};}
const audit=times=>window({registeredAt:NOW-1000,asOf:NOW+120000,expectedSlots:slots,maxReportLagMs:60000,
 observations:slots.map((slotAt,i)=>({slotAt,report:report(times[i])}))});
test('overlapping report-lag windows cannot count one quote diagnostic twice',()=>{
 const r=audit([NOW+30000,NOW+30000,NOW+60000]);
 assert.equal(r.status,'blocked');assert.equal(r.reason,'duplicate-or-regressing-report-time');
});
test('a delayed earlier slot cannot reverse the diagnostic observation order',()=>{
 assert.equal(audit([NOW+45000,NOW+30000,NOW+60000]).status,'blocked');
 const r=audit([NOW+1000,NOW+31000,NOW+61000]);assert.equal(r.status,'limited-alignment-unverified');
 assert.equal(r.pair.timeAlignedPairs,3);assert.equal(r.canAutoSelectProvider,false);
});
const day=DAY.replaceAll('-','');
const row=(extra={})=>({code:'600001',price:10,quoteSource:'tencent',quoteAt:NOW,receivedAt:NOW,...extra});
const response=(r,pick=r)=>({asOf:NOW,board:'all',items:[r],sectorView:[{name:'industry',picks:[pick]}]});
test('future original quote or receipt in retained scans cannot become current later',()=>{
 for(const change of [{quoteAt:NOW+1000,receivedAt:NOW+1000},{receivedAt:NOW+1000},{quoteAt:NOW,receivedAt:NOW-1000}]){
  const store=createMarketResponseSnapshot({clock:()=>NOW+2000});
  assert.equal(store.remember('quant','all',response(row(change)),{day}),true);
  const r=store.read('quant','all');
  for(const x of [r.items[0],r.sectorView[0].picks[0]]){
   assert.equal(x.snapshotTimeConflict,true);assert.equal(x.quoteStatus,'unknown');assert.equal(x.canTrade,false);
  }
  assert.equal(r.items[0].quoteAt,row(change).quoteAt);
 }
});
test('valid retained rows preserve source times and existing read-only behavior',()=>{
 const store=createMarketResponseSnapshot({clock:()=>NOW+16000});
 assert.equal(store.remember('quant','all',response(row()),{day}),true);
 const r=store.read('quant','all');assert.equal(r.items[0].quoteStatus,'stale');assert.equal(r.items[0].snapshotTimeConflict,undefined);
 assert.equal(r.items[0].quoteAt,NOW);assert.equal(r.items[0].receivedAt,NOW);
 assert.equal(r.canTrade,false);assert.equal(r.sectorView[0].picks[0].canNotify,false);
});
