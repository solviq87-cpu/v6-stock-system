'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assessGlobalTrialBudget}=require('../src/core/factor-global-trial-budget');
const pack='a'.repeat(64);
const days=n=>Array.from({length:n},(_,i)=>
 new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10));
const record=(dates,index,{parent=null,mode='v6-factor-shadow-evolution-v1',
 status='shadow-retained'}={})=>({
 mode,packFingerprint:pack,status,previousFingerprint:parent,
 lastObservationDay:dates[index*5+5],fingerprint:String(index).padStart(64,'0'),
 trialAudit:{schemaVersion:1,status:'consumed',trialNumber:index+1,
  firstHoldoutDay:dates[index*5+1],lastHoldoutDay:dates[index*5+5],
  holdoutDays:5,candidateFingerprint:'b'.repeat(64)}
});
test('six trials across accepted and rejected model versions exhaust one global ninety-day allowance',()=>{
 const ds=days(120),reports=Array.from({length:6},(_,i)=>record(ds,i,
  {parent:i<2?null:'different-accepted-version-'+i,
   status:i%2?'shadow-updated':'shadow-retained'}));
 const r=assessGlobalTrialBudget(reports,ds.slice(0,90),pack);
 assert.equal(r.status,'budget-exhausted');
 assert.equal(r.maxTrials,6);
 assert.equal(r.usedTrials,6);
 assert.equal(r.remainingTrials,0);
 assert.equal(r.allTimeTrialCount,6);
 assert.equal(r.windowTradingDays,90);
 assert.equal(r.canTrade,false);
 assert.equal(r.productionWeightsChanged,false);
});
test('budget counts inspected older attempts even without a trialAudit field',()=>{
 const ds=days(100),legacy={mode:'v6-factor-shadow-evolution-v1',
  packFingerprint:pack,status:'paused-market-shock',
  lastObservationDay:ds[25],
  holdout:{firstFreshDay:ds[20]},fingerprint:'f'.repeat(64)};
 const r=assessGlobalTrialBudget([legacy,record(ds,6)],ds,pack);
 assert.equal(r.usedTrials,2);
 assert.equal(r.allTimeTrialCount,2);
 assert.equal(r.remainingTrials,4);
});
test('old trial windows exit on sliding observation-date window, without deleting audit history',()=>{
 const ds=days(150);
 const earlier=record(ds,0),later=record(ds,24);
 const r=assessGlobalTrialBudget([earlier,later],ds,pack);
 assert.equal(r.allTimeTrialCount,2);
 assert.equal(r.usedTrials,1);
 assert.equal(r.remainingTrials,5);
 assert.equal(r.windowStartDay,ds[60]);
});
test('cross-version overlapping holdout intervals cannot reset budget by accepting a new model',()=>{
 const ds=days(110);
 const a=record(ds,0,{parent:null,status:'shadow-updated'});
 const b={...record(ds,1,{parent:a.fingerprint}),lastObservationDay:ds[9],
  trialAudit:{...record(ds,1).trialAudit,
   firstHoldoutDay:ds[5],lastHoldoutDay:ds[9]}};
 assert.throws(()=>assessGlobalTrialBudget([a,b],ds,pack),
  /跨模型版本复用/);
});
test('malformed dates and incomplete candidate records fail closed',()=>{
 const ds=days(120),r=record(ds,0);
 assert.throws(()=>assessGlobalTrialBudget([{...r,trialAudit:{...r.trialAudit,
  candidateFingerprint:'bad'}}],ds,pack),/归档时间或候选血缘/);
 assert.throws(()=>assessGlobalTrialBudget([r],[...ds.slice(0,60),ds[59]],pack),
  /交易日缺失、重复或无效/);
 assert.throws(()=>assessGlobalTrialBudget([r],ds,'not-a-pack-hash'),/协议无效/);
});
