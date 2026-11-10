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
  candidateFingerprint:'bad'}}],ds,pack),/试验预算归档时间或候选血缘无效/);
 assert.throws(()=>assessGlobalTrialBudget([r],[...ds.slice(0,60),ds[59]],pack),
  /交易日缺失、重复或无效/);
 assert.throws(()=>assessGlobalTrialBudget([r],ds,'not-a-pack-hash'),/协议无效/);
});

test('a new factor pack cannot reset the global inspected-holdout budget',()=>{
 const ds=days(100);
 // Both experiments must fall INSIDE the newest 90 research signal days.
 const earlierPack=record(ds,2);
 earlierPack.packFingerprint='c'.repeat(64);
 const currentPack=record(ds,3);
 const report=assessGlobalTrialBudget([earlierPack,currentPack],ds,pack);
 assert.equal(report.usedTrials,2);
 assert.equal(report.remainingTrials,4);
 assert.equal(report.allTimeTrialCount,2);
 assert.throws(()=>assessGlobalTrialBudget([
  {...earlierPack,packFingerprint:'invalid'}],ds,pack),
  /历史因子包指纹无效/);
});

test('restoring a shorter manifest cannot silently ignore trials sealed in its future',()=>{
 const ds=days(130),current=ds.slice(0,42);
 const archived=record(ds,8); // spent holdout ends at day[45], after manifest day[41]
 assert.equal(archived.trialAudit.lastHoldoutDay,ds[45]);
 assert.throws(()=>assessGlobalTrialBudget([archived],current,pack),
  /全局试验档案晚于当前研究清单，历史交易日倒退/);
 // Even when the apparent old budget is already full, do not hide a
 // rollback behind a normal budget-exhausted skip.
 const older=Array.from({length:6},(_,i)=>record(ds,i));
 assert.throws(()=>assessGlobalTrialBudget([...older,archived],current,pack),
  /全局试验档案晚于当前研究清单，历史交易日倒退/);
 // An archive completed on the latest known signal day remains valid.
 const atBoundary=record(ds,7);
 assert.equal(atBoundary.lastObservationDay,ds[40]);
 const valid=assessGlobalTrialBudget([atBoundary],current,pack);
 assert.equal(valid.usedTrials,1);
 assert.equal(valid.asOfDay,ds[41]);
});

test('an inspected holdout cannot disappear from the global budget through a mislabeled trial status',()=>{
 const ds=days(100),inspected=record(ds,10);
 const altered={...inspected,trialAudit:{...inspected.trialAudit,status:'not-evaluated'}};
 assert.throws(()=>assessGlobalTrialBudget([altered],ds,pack),
  /全局试验审计状态与报告状态不一致/);
 assert.throws(()=>assessGlobalTrialBudget([{
  ...inspected,trialAudit:{...inspected.trialAudit,status:'unexpected-state'}
 }],ds,pack),/全局试验审计状态与报告状态不一致/);
 assert.throws(()=>assessGlobalTrialBudget([{
  ...inspected,trialAudit:null
 }],ds,pack),/全局试验审计状态与报告状态不一致/);
 assert.throws(()=>assessGlobalTrialBudget([{
  ...inspected,status:'unknown-shadow-state'
 }],ds,pack),/全局试验历史报告状态无效/);
 assert.throws(()=>assessGlobalTrialBudget([{
  ...inspected,mode:'another-model'
 }],ds,pack),/全局试验历史档案模式无效/);
});

test('valid cooldown-only evidence never spends trial slots but cannot hide an inspected trial',()=>{
 const ds=days(100);
 const monitored={...record(ds,0),status:'paused-shadow-cooldown',
  trialAudit:{schemaVersion:1,status:'not-evaluated'}};
 const r=assessGlobalTrialBudget([monitored,record(ds,10)],ds,pack);
 assert.equal(r.usedTrials,1);
 assert.equal(r.remainingTrials,5);
 assert.throws(()=>assessGlobalTrialBudget([{
  ...monitored,trialAudit:{schemaVersion:1,status:'consumed'}
 }],ds,pack),/全局试验审计状态与报告状态不一致/);
 const legacyMonitor={...monitored};delete legacyMonitor.trialAudit;
 assert.equal(assessGlobalTrialBudget([legacyMonitor],ds,pack).usedTrials,0);
});

test('cooldown and recovered monitor-only archives cannot be newer than the restored manifest',()=>{
 const ds=days(110),restored=ds.slice(0,50);
 for(const status of ['paused-shadow-decay','paused-shadow-cooldown','shadow-recovered']){
  const monitor={...record(ds,10),status,
   trialAudit:{schemaVersion:1,status:'not-evaluated'}};
  assert.equal(monitor.lastObservationDay,ds[55]);
  assert.throws(()=>assessGlobalTrialBudget([monitor],restored,pack),
   /全局监控档案晚于当前研究清单，历史交易日倒退/);
  assert.throws(()=>assessGlobalTrialBudget([{
   ...monitor,lastObservationDay:'2026-02-30'
  }],ds,pack),/全局研究档案最后观察日期无效/);
  // Monitoring still consumes no attempts when its date is legitimate.
  const inBounds={...monitor,lastObservationDay:ds[49]};
  const valid=assessGlobalTrialBudget([inBounds],restored,pack);
  assert.equal(valid.usedTrials,0);
  assert.equal(valid.remainingTrials,6);
 }
 // A legacy cooldown warning without trialAudit remains monitoring-only,
 // but it cannot bypass the same chronology gate.
 const legacy={...record(ds,10),status:'paused-shadow-decay'};
 delete legacy.trialAudit;
 assert.throws(()=>assessGlobalTrialBudget([legacy],restored,pack),
  /全局监控档案晚于当前研究清单，历史交易日倒退/);
});
