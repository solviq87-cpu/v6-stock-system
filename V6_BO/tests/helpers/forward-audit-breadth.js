'use strict';
const {freezeCohort,evaluateForward}=require('../../src/core/forward-signal-observer');
const at=d=>Date.parse(d+'T16:00:00+08:00');
// Thirty independent IDs on one symbol plus nine later signals on other symbols.
// Only the first symbol has reached H1/H5; the complete cohort has ten symbols.
function breadthFixture(){
 const calendar=['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-09','2026-11-10'];
 const feed={source:'imported',provider:'synthetic-offline-test',datasetId:'breadth-test',priceBasis:'unadjusted'};
 const signals=Array.from({length:39},(_,i)=>{
  const start=i<30?0:5;
  return {signalId:'signal-'+i,symbol:i<30?'600001':String(600002+i-30),system:'fourteen',
   cohort:'breadth',provenance:'synthetic-test-only',signalDate:calendar[start],signalAt:at(calendar[start]),baselineClose:10+start};
 });
 const cohort=freezeCohort({schemaVersion:1,feed,signals},{now:at(calendar[5])});
 const market={schemaVersion:1,feed,asOf:calendar[5],observedAt:at(calendar[5]),calendar,
  stocks:[...new Set(signals.map(s=>s.symbol))].map(symbol=>({symbol,corporateActions:[],
   bars:calendar.slice(0,6).map((date,i)=>({date,close:10+i,volume:100,suspended:false}))}))};
 const now=at(calendar[5])+1000;
 return {cohort,market,now,report:evaluateForward(cohort,market,{now})};
}
module.exports={breadthFixture};
