'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {freezeCohort}=require('../src/core/forward-signal-observer');
const {registerRiskAudit,freezeRiskDay,evaluateRiskAudit}=require('../src/core/crowding-risk-replay-audit');
const calendar=Array.from({length:24},(_,i)=>new Date(Date.parse('2026-10-01')+i*86400000).toISOString().slice(0,10));
const at=(d,h='16:00:00')=>Date.parse(d+'T'+h+'+08:00'),now=at(calendar[23]),symbol='600000',policies=['original','fixed','conditional'];
function fixture(){
 const feed={source:'fixture',provider:'test-feed',datasetId:'path',priceBasis:'unadjusted'},registered=at(calendar[0],'09:00:00');
 const plan=registerRiskAudit({scope:'fixture',feed,population:'selected',horizon:5,lossPct:10,calendar,
 folds:{training:[calendar[0]],validation:[calendar[6]],holdout:[calendar[12],calendar[18]]},
 criteria:{minSamples:1,minDays:1,minTailWindows:1,tailConfidence:.5,maxFalseAlertRate:1,maxMissRate:1},
 policies:Object.fromEntries(policies.map((k,i)=>[k,{version:'v1',modelFingerprint:String(i+1).repeat(64),trainingEndedAt:registered-1}]))},{now:registered});
 const market={schemaVersion:1,feed,calendar,asOf:calendar[23],observedAt:now,stocks:[{symbol,corporateActions:[],bars:calendar.map((date,i)=>({date,close:i===14?85:100,volume:1000,suspended:false,knownAt:at(date)}))}]};
 const packets=Object.values(plan.folds).flat().map(day=>{
  const cohort=freezeCohort({schemaVersion:1,feed,signals:[{signalId:day+'/'+symbol,symbol,system:'fourteen',cohort:'selected',provenance:'fixture',signalDate:day,signalAt:at(day),baselineClose:100}]},{now:at(day)});
  const opinions=policies.map(k=>({signalId:day+'/'+symbol,policy:k,planFingerprint:plan.fingerprint,target:'forward-close-loss-event',horizon:5,lossPct:10,
   version:'v1',modelFingerprint:plan.policies[k].modelFingerprint,evidenceRef:k+'/'+day,knownAt:at(day),verdict:'clear',probability:null}));
  return {cohort,packet:freezeRiskDay(plan,cohort,opinions,{now:at(day,'16:01:00')})};
 });
 return {plan,market,packets};
}
const run=f=>evaluateRiskAudit(f.plan,f.packets,f.market,{now});
test('C15 integration: recovered terminal label and observed intermediate adverse close remain separate',()=>{
 const f=fixture(),r=run(f),row=r.rows.find(x=>x.day===calendar[12]);
 assert.equal(row.event,false);assert.equal(row.closePath.eventObserved,true);assert.equal(row.closePath.firstEventDate,calendar[14]);
 assert.equal(row.outcomeReceiptStatus,'explicit-daily-receipt-unverified');assert.equal(row.outcomeExplicitAvailableAt,at(calendar[17]));
 assert.equal(r.folds.holdout.closePaths.observedAdversePaths,1);assert.equal(r.maximumAdverseExcursion,null);assert.equal(r.eligibleForPromotion,false);
});
test('C15 integration: explicit future target receipt rejects original endpoint, not only new path',()=>{
 const f=fixture();f.market.stocks[0].bars[17].knownAt=now+1;
 const r=run(f),row=r.rows.find(x=>x.day===calendar[12]);assert.equal(row.event,null);assert.equal(row.status,'invalid-outcome');
 assert.equal(row.closePath.eventObserved,true);assert.equal(row.closePath.pathComplete,false);assert.equal(r.reviewCriteriaMet,false);
});
test('C15 integration: legacy missing clocks leave original descriptive endpoint but path stays unknown',()=>{
 const f=fixture();for(const b of f.market.stocks[0].bars)delete b.knownAt;const r=run(f),row=r.rows.find(x=>x.day===calendar[12]);
 assert.equal(row.event,false);assert.equal(row.outcomeReceiptStatus,'snapshot-only-unverified');assert.equal(row.outcomeExplicitAvailableAt,null);
 assert.equal(row.closePath.eventObserved,null);assert.equal(r.folds.holdout.registeredPopulationCoverage,null);assert.equal(r.eligibleForPromotion,false);
});
test('C15 integration: absent registered day lowers received-day coverage even when remaining paired endpoint coverage is one',()=>{
 const f=fixture();f.packets.pop();const h=run(f).folds.holdout;
 assert.equal(h.coverage,1);assert.equal(h.receivedDayCoverage,.5);assert.equal(h.closePaths.missingRegisteredDays,1);assert.equal(h.registeredPopulationCoverage,null);
});
