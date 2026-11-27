'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {closeReceipt,indexStocks,buildCloseRiskPath,summarizeClosePaths,labelSensitivity}=require('../src/core/crowding-close-path-evidence');
const calendar=['2026-11-16','2026-11-17','2026-11-18','2026-11-19','2026-11-20','2026-11-23'];
const at=(d,t='16:00:00')=>Date.parse(d+'T'+t+'+08:00');
const signal={symbol:'600000',signalDate:calendar[0],baselineClose:100};
const now=at(calendar[5]);
function fixture(){
 const bars=calendar.map((date,i)=>({date,close:[100,98,85,105,92,101][i],volume:1000,suspended:false,knownAt:at(date)}));
 return {calendar,asOf:calendar[5],observedAt:now,feed:{source:'fixture'},stocks:[{symbol:signal.symbol,bars,corporateActions:[]}]};
}
function run(m,extra={}){
 return buildCloseRiskPath({signal,market:m,stock:indexStocks(m).get(signal.symbol),calendarIndex:0,horizon:5,lossPct:10,validated:true,...extra});
}
test('C15.1 explicit future, reversed, unknown or preclose receipt cannot be replaced with wrapper time',()=>{
 for(const patch of [{knownAt:now+1},{knownAt:null},{knownAt:at(calendar[2],'14:59:59')},{knownAt:at(calendar[2]),availableAt:at(calendar[2],'15:59:59')},{firstKnownAt:at(calendar[2],'16:00:01')}]){
  const m=fixture(),b=m.stocks[0].bars[2];Object.assign(b,patch);assert.equal(closeReceipt(b,signal.symbol,m).status,'invalid-or-missing');
  const p=run(m);assert.equal(p.eventObserved,null);assert.equal(p.completeCloseAdverseExcursionPct,null);
 }
});
test('C15.1 explicit suspension, duplicate bar, wrong security, basis and withdrawal cannot become complete path',()=>{
 for(const patch of [{suspended:true},{volume:0},{symbol:'600001'},{priceBasis:'hfq'},{final:false},{sourceConflict:true},{withdrawn:true}]){
  const m=fixture();Object.assign(m.stocks[0].bars[2],patch);assert.equal(run(m).pathComplete,false);assert.equal(run(m).eventObserved,null);
 }
 const m=fixture();m.stocks[0].bars.push({...m.stocks[0].bars[2]});assert.equal(run(m).eventObserved,null);
});
test('C15.1 missing individual clocks stay snapshot-only, never invented original time',()=>{
 const m=fixture(),b=m.stocks[0].bars[2];delete b.knownAt;assert.deepEqual(closeReceipt(b,signal.symbol,m),{status:'snapshot-only-unverified',knownAt:null});
 const p=run(m);assert.equal(p.snapshotOnlySessions,1);assert.equal(p.eventObserved,null);
});
test('C15.2 recovered endpoint does not erase earlier close event or actual availability',()=>{
 const m=fixture(),before=JSON.stringify(m),r=run(m);
 assert.equal(r.pathComplete,true);assert.equal(r.eventObserved,true);assert.equal(r.terminalCloseEvent,false);
 assert.equal(r.firstEventDate,calendar[2]);assert.equal(r.firstObservedAdverseAvailableAt,at(calendar[2]));assert.equal(r.completeCloseAdverseExcursionPct,15);
 assert.equal(r.actualIntradayMaximumAdverseExcursion,null);assert.equal(r.actualExitEvidence,null);assert.equal(JSON.stringify(m),before);
});
test('C15.2 earlier gap prevents certification of first trigger date, but actual later adverse close survives',()=>{
 const m=fixture();m.stocks[0].bars.splice(1,1);const r=run(m);
 assert.equal(r.eventObserved,true);assert.equal(r.firstEventDate,null);assert.equal(r.firstObservedAdverseDate,calendar[2]);assert.equal(r.firstGapDate,calendar[1]);
 assert.equal(r.observedCloseAdverseExcursionPct,15);assert.equal(r.completeCloseAdverseExcursionPct,null);
});
test('C15.2 later gap does not erase previously observed event, and no known event is not false risk',()=>{
 let m=fixture();m.stocks[0].bars.splice(3,1);let r=run(m);assert.equal(r.eventObserved,true);assert.equal(r.firstEventDate,calendar[2]);assert.equal(r.pathComplete,false);
 m=fixture();m.stocks[0].bars[2].close=99;m.stocks[0].bars.splice(3,1);r=run(m);assert.equal(r.eventObserved,null);assert.equal(r.firstObservedAdverseDate,null);
});
test('C15.3 corporate action invalidates subsequent unadjusted return path, never manufactures a sellable loss',()=>{
 let m=fixture();m.stocks[0].corporateActions=[calendar[1]];let r=run(m);assert.equal(r.eventObserved,null);assert.equal(r.corporateActionSessions,5);assert.equal(r.observedCloseAdverseExcursionPct,null);
 m=fixture();m.stocks[0].corporateActions=[calendar[3]];r=run(m);assert.equal(r.eventObserved,true);assert.equal(r.firstEventDate,calendar[2]);assert.equal(r.completeCloseAdverseExcursionPct,null);
});
test('C15.3 before maturity and purged folds cannot certify a complete clear path or leak future labels',()=>{
 const m=fixture();m.asOf=calendar[1];m.observedAt=at(calendar[1]);const r=run(m);
 assert.equal(r.status,'pending');assert.equal(r.pendingSessions,4);assert.equal(r.eventObserved,null);
 const p=run(fixture(),{purged:true});assert.equal(p.status,'purged-overlapping-fold');assert.equal(p.explicitObservedSessions,0);assert.equal(p.eventObserved,null);
 assert.equal(run(fixture(),{validated:false}).eventObserved,null);
});
test('C15.3 only every eligible close observed with no adverse event certifies a clear close path',()=>{
 const m=fixture();m.stocks[0].bars[2].close=91;const r=run(m);
 assert.equal(r.pathComplete,true);assert.equal(r.eventObserved,false);assert.equal(r.completeCloseAdverseExcursionPct,9);
 assert.equal(r.trainingEligible,false);assert.equal(r.actualNotificationLeadTime,null);
});
test('C15.4 same-day co-occurrences are not independent risk trials and missing days stay visible',()=>{
 const a=run(fixture()),m=fixture();m.stocks[0].bars[2].close=98;const b=run(m);
 const s=summarizeClosePaths([{day:calendar[0],closePath:a},{day:calendar[0],closePath:a},{day:calendar[1],closePath:b}],3,2);
 assert.equal(s.completePaths,3);assert.equal(s.completeReceivedDays,2);assert.equal(s.completeDaysWithMultipleAdverse,1);
 assert.equal(s.completeDaysWithAdverse,1);assert.equal(s.missingRegisteredDays,1);assert.equal(s.independenceCertified,false);assert.equal(s.fullRegisteredPopulationCertified,false);
});
test('C15.4 incomplete event remains in unknown denominator rather than clear',()=>{
 const m=fixture();m.stocks[0].bars[2].knownAt=null;const a=run(m),s=summarizeClosePaths([{day:calendar[0],closePath:a}],1,1);
 assert.equal(s.completePaths,0);assert.equal(s.unknownEventPaths,1);assert.equal(s.completeNoAdversePaths,0);assert.equal(s.completeReceivedDays,0);
});
test('C15.5 same paired sample changes labels only, never chooses a new production cutoff',()=>{
 const rows=[{priceReturnPct:-9.5,event:false},{priceReturnPct:-10,event:true},{priceReturnPct:-11,event:true},{priceReturnPct:1,event:false}];
 const s=labelSensitivity(rows,10);assert.deepEqual(s.rows.map(x=>x.eventCount),[3,2,1]);assert.deepEqual(s.rows.map(x=>x.changedLabels),[1,0,1]);
 assert.ok(s.rows.every(x=>x.pairedCount===4));assert.equal(s.selectedThreshold,null);assert.equal(s.decisionThresholdSensitivity,null);assert.equal(s.productionThresholdChanged,false);
});
test('C15.5 absent or malformed paired outcome and invalid neighboring target remain unknown',()=>{
 assert.ok(labelSensitivity([],10).rows.every(x=>x.eventCount===null));
 assert.ok(labelSensitivity([{priceReturnPct:null,event:false}],10).rows.every(x=>x.eventCount===null));
 assert.equal(labelSensitivity([{priceReturnPct:-99,event:true}],95).rows[2].eventCount,null);
});

test('C15.2 late original receipt separates event date, prefix proof time and earliest available adverse close',()=>{
 const m=fixture(),b=m.stocks[0].bars;
 b[1].knownAt=at(calendar[5]);b[2].knownAt=at(calendar[4]);b[3].close=80;
 const r=run(m);
 assert.equal(r.firstEventDate,calendar[2]);
 assert.equal(r.firstObservedAdverseAvailableAt,at(calendar[4]));
 assert.equal(r.earliestAvailableAdverseCloseDate,calendar[3]);
 assert.equal(r.earliestAvailableAdverseAt,at(calendar[3]));
 assert.equal(r.firstEventPrefixAvailableAt,at(calendar[5]));
 assert.equal(r.actualNotificationLeadTime,null);
});
test('C15.5 central label uses exact registered threshold, without rounding it to a different event',()=>{
 const threshold=10.0000000049,ret=-10.000000001;
 const x=labelSensitivity([{priceReturnPct:ret,event:false}],threshold);
 assert.equal(x.rows[1].changedLabels,0);assert.equal(x.rows[1].eventCount,0);
});
