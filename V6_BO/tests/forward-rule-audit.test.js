'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {auditForwardRules}=require('../src/core/forward-rule-audit');
function result(n=2){return {schemaVersion:1,mode:'forward-signal-price-observation',canTrade:false,
  verifiedLive:false,prospectiveCertified:false,executionSimulated:false,asOf:'2026-11-09',
  records:Array.from({length:n},(_,i)=>({signalId:'id'+i,symbol:'600001',system:'fourteen',cohort:'突破',
    windows:[{tradingDays:1,status:'observed',priceReturnPct:i%2?2:0},
     {tradingDays:5,status:'missing-or-suspended',priceReturnPct:null},
     {tradingDays:20,status:'pending',priceReturnPct:null},
     {tradingDays:60,status:'corporate-action-unresolved',priceReturnPct:null}]}))};}
test('sample audit never proves a winning rule even if returns are positive',()=>{
 const r=auditForwardRules(result(40));const h=r.groups[0].windows[0];
 assert.equal(h.status,'descriptive-only');assert.equal(h.ruleEffectiveness,'not-proven');
 assert.equal(r.causalEffectProven,false);assert.equal(r.weightsUpdated,false);
 assert.equal(h.positiveFractionPct,50);assert.equal(h.medianPriceReturnPct,1);
});
test('pending, missing and corporate action are not zeros and do not count as losses',()=>{
 const h=auditForwardRules(result(2)).groups[0].windows;
 assert.equal(h[0].observedCount,2);assert.equal(h[0].positiveFractionPct,50);
 assert.equal(h[1].observedCount,0);assert.equal(h[1].maturedCount,2);assert.equal(h[1].positiveFractionPct,null);
 assert.equal(h[2].awaitingCount,2);assert.equal(h[2].maturedCount,0);
 assert.equal(h[3].corporateActionUnresolvedCount,2);
});
test('many correlated events on one stock cannot be called independent stocks',()=>{
 const r=auditForwardRules(result(40));assert.equal(r.groups[0].signalCount,40);
 assert.equal(r.groups[0].distinctSymbols,1);
});
test('duplicate events, invalid statuses and unsafe mode fail closed',()=>{
 const p=result(2);p.records[1].signalId='id0';assert.throws(()=>auditForwardRules(p),/重复/);
 p.records[1].signalId='id1';p.records[0].windows[0].status='pretend';assert.throws(()=>auditForwardRules(p),/协议/);
 p.records[0].windows[0].status='observed';p.canTrade=true;assert.throws(()=>auditForwardRules(p),/无效/);
});
test('nonmatured or low coverage fail readiness even with many events',()=>{
 const p=result(40);p.records.slice(1).forEach(r=>r.windows[0]={tradingDays:1,status:'missing-or-suspended',priceReturnPct:null});
 const h=auditForwardRules(p).groups[0].windows[0];
 assert.equal(h.observedCoveragePct,2.5);assert.equal(h.status,'insufficient-matured-sample');
});
