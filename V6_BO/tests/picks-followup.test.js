'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {project}=require('../public/assets/picks-followup.js');
const zeros='a'.repeat(64);
function valid(){return {schemaVersion:1,mode:'forward-signal-price-observation',
  canTrade:false,verifiedLive:false,prospectiveCertified:false,executionSimulated:false,
  asOf:'2026-11-09',cohortFingerprint:zeros,marketFingerprint:zeros,
  records:[{signalId:'one',symbol:'600001',signalDate:'2026-11-02',baselineClose:10,system:'fourteen',cohort:'突破',
  windows:[{tradingDays:1,status:'observed',targetDate:'2026-11-03',priceReturnPct:0},
   {tradingDays:5,status:'observed',targetDate:'2026-11-09',priceReturnPct:2.5},
   {tradingDays:20,status:'pending',targetDate:null,priceReturnPct:null},
   {tradingDays:60,status:'calendar-incomplete',targetDate:null,priceReturnPct:null}]}]};}
test('missing evidence is unknown, not 0% or failed',()=>{
  assert.equal(project(null,'600001').state,'missing');
  assert.equal(project({price:12,pct:5},'600001').observed,0);
});
test('two observed horizons incl zero, two pending; no invented maturities',()=>{
  const r=project(valid(),'600001');
  assert.equal(r.state,'available');assert.equal(r.observed,2);assert.equal(r.unresolved,2);
  assert.equal(r.entries[0].windows[0].pct,0);
  assert.equal(r.entries[0].windows[1].pct,2.5);
  assert.equal(r.entries[0].windows[2].pct,null);
});
test('different-stock signals are excluded, multiple same-stock episodes remain separate',()=>{
  const p=valid();p.records.push({...p.records[0],symbol:'000002'});
  p.records.push({...p.records[0],signalId:'two',cohort:'量价'});
  const r=project(p,'600001');assert.equal(r.entries.length,2);assert.equal(r.totalSignals,2);
  assert.equal(project(p,'000002').entries.length,1);
});
test('bad records and future target prices fail closed',()=>{
  const p=valid();p.records[0].windows[0].targetDate='2026-11-12';
  assert.equal(project(p,'600001').entries[0].windows[0].pct,null);
  p.verifiedLive=true;assert.equal(project(p,'600001').state,'invalid');
  p.verifiedLive=false;p.cohortFingerprint='forged';assert.equal(project(p,'600001').state,'invalid');
});
test('corporate action and missing or suspended are unknown rather than losses',()=>{
  const p=valid();p.records[0].windows[0].status='corporate-action-unresolved';
  p.records[0].windows[1].status='missing-or-suspended';
  const r=project(p,'600001');assert.equal(r.observed,0);
  assert.deepEqual(r.entries[0].windows.map(x=>x.pct),[null,null,null,null]);
});
