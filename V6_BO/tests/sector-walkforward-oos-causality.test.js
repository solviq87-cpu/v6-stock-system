'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {evaluateSectorForwardPrices:evaluate}=require('../src/core/sector-frozen-forward-prices');
const {auditSectorWalkForward:audit}=require('../src/core/sector-walkforward-oos-audit');
const dates=[];
for(let i=0;dates.length<80;i++){
 const d=new Date(Date.parse('2026-09-01T00:00:00Z')+i*86400000);
 if(d.getUTCDay()!==0&&d.getUTCDay()!==6)dates.push(d.toISOString().slice(0,10));
}
const at=i=>Date.parse(dates[i]+'T10:30:00+08:00');
const cutoff=Date.parse(dates[40]+'T00:00:00+08:00');
const options={tradeDates:dates,trainThrough:dates[38],testFrom:dates[40],asOf:at(75)+2000,minTrain:2,minTest:2};
const source='eastmoney-clist-unverified-live';
function episode(i,receiptAt=at(i+20)+2000){
 const sectors=Array.from({length:3},(_,j)=>({category:'industry',code:'BS_'+j,
  name:'sector'+j,rank:j+1,score:80-j,state:'observed',baselinePriceCoveragePct:100,
  members:Array.from({length:5},(_,k)=>({symbol:String(600001+j*100+k),baselinePrice:10,baselineQuoteAt:at(i)-5000}))}));
 const body={schemaVersion:1,mode:'sector-frozen-raw-quote-price-cohort',tradeDate:dates[i],
  observedAt:at(i),frozenAt:at(i)+1000,source,classificationVersion:'frozen-test',membershipProvider:'operator-import',
  memberSourceObservedAt:at(i)-120000,snapshotFingerprint:'a'.repeat(64),membershipFingerprint:'b'.repeat(64),
  priceBasis:'unadjusted-intraday-provider-raw-quote',benchmarkMethod:null,
  sectorReturnMethod:'equal-weight-frozen-constituent-gross-price-change',sectors,
  verifiedLive:false,outOfSampleValidated:false,canTrain:false,canTrade:false,canNotify:false,
  weightsChanged:false,autoPromotion:false,labelsAvailable:false,netReturnsAvailable:false,prospectiveCertified:false};
 const cohort={...body,fingerprint:crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')};
 const symbols=sectors.flatMap(s=>s.members.map(m=>m.symbol));
 const targets=[1,5,20].map(h=>i+h).filter(j=>at(j)<=receiptAt);
 const snapshots=targets.map(j=>({date:dates[j],source,universeSize:symbols.length,
  startedAt:new Date(at(j)-60000).toISOString(),retrievedAt:new Date(at(j)).toISOString(),
  stocks:symbols.map((code,k)=>({code,latestPrice:k<5?11:10,vendorQuoteAt:at(j)-5000,volumeLots:50}))}));
 const corporateActions={schemaVersion:1,source:'imported',provider:'operator-action-audit',
  datasetId:'test-unverified',completed:true,observedAt:receiptAt,completeThrough:dates[targets.at(-1)??i],
  coveredSymbols:symbols,events:[]};
 const observation=evaluate(cohort,snapshots,{tradeDates:dates,corporateActions,asOf:receiptAt});
 assert.equal(observation.status,'research-observation-unverified');
 return {cohort,observation};
}
const samples=()=>[episode(1),episode(2),episode(40),episode(41)];
const run=episodes=>audit({...options,episodes});
test('valid reports known before the test cutoff preserve all three descriptive horizons',()=>{
 const list=samples(),before=JSON.stringify(list),r=run(list);
 assert.equal(r.status,'temporal-partition-reviewed-unverified');
 assert.deepEqual(r.panels.map(p=>p.trainCount),[2,2,2]);
 assert.deepEqual(r.panels.map(p=>p.testCount),[2,2,2]);
 assert.equal(r.canTrain,false);assert.equal(r.outOfSampleValidated,false);
 assert.equal(JSON.stringify(list),before);
});
test('training reports observed at or after the start of the holdout never count as pre-split evidence',()=>{
 for(const receiptAt of [cutoff,cutoff+1,at(50)]){
  const list=samples();list[0]=episode(1,receiptAt);
  const r=run(list);
  assert.equal(r.status,'insufficient-evidence');
  for(const p of r.panels){
   assert.equal(p.trainCount,1);assert.equal(p.testCount,2);
   assert.deepEqual(p.pendingOrUnknownTrain,[{tradeDate:dates[1],reason:'training-observation-not-known-before-test'}]);
   assert.equal(p.trainLeaderMinusPeersGrossRawMeanPct,null);
  }
 }
});
test('pre-cutoff reports keep horizon-specific purging and do not discard an eligible short window',()=>{
 const list=[...samples(),episode(35,cutoff-1)];
 const r=run(list);
 assert.deepEqual(r.panels.map(p=>p.trainCount),[3,2,2]);
 assert.deepEqual(r.panels.map(p=>p.purgedTrainDates),[[],[dates[35]],[dates[35]]]);
 assert.equal(r.status,'temporal-partition-reviewed-unverified');
});
test('a report must preserve the original company-action evidence status',()=>{
 for(const value of [undefined,null,'verified','not-checked']){
  const list=samples();list[0].observation.corporateActionEvidence=value;
  const r=run(list);
  assert.equal(r.status,'blocked');assert.equal(r.canTrain,false);
 }
});
