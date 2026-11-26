'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {evaluateSectorForwardPrices:evaluate}=require('../src/core/sector-frozen-forward-prices');
const at=day=>Date.parse(day+'T10:30:00+08:00');
const days=['2026-11-10'];
for(let i=1;days.length<23;i++){
 const d=new Date(Date.parse(days[0]+'T00:00:00Z')+i*86400000);
 if(d.getUTCDay()!==0&&d.getUTCDay()!==6)days.push(d.toISOString().slice(0,10));
}
const source='eastmoney-clist-unverified-live';
function fixture(){
 const sectors=Array.from({length:3},(_,j)=>({category:'industry',code:'BS_'+j,
  name:'sector'+j,rank:j+1,score:80-j,state:'observed',baselinePriceCoveragePct:100,
  members:Array.from({length:5},(_,i)=>({symbol:String(600001+j*100+i),baselinePrice:10,
   baselineQuoteAt:at(days[0])-5000}))}));
 const payload={schemaVersion:1,mode:'sector-frozen-raw-quote-price-cohort',tradeDate:days[0],
  observedAt:at(days[0]),frozenAt:at(days[0])+1000,source,
  classificationVersion:'test-frozen-members',membershipProvider:'operator-import',
  memberSourceObservedAt:at(days[0])-120000,snapshotFingerprint:'a'.repeat(64),membershipFingerprint:'b'.repeat(64),
  priceBasis:'unadjusted-intraday-provider-raw-quote',benchmarkMethod:null,
  sectorReturnMethod:'equal-weight-frozen-constituent-gross-price-change',sectors,
  verifiedLive:false,outOfSampleValidated:false,canTrain:false,canTrade:false,canNotify:false,
  weightsChanged:false,autoPromotion:false,labelsAvailable:false,netReturnsAvailable:false,prospectiveCertified:false};
 const cohort={...payload,fingerprint:crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')};
 const symbols=sectors.flatMap(s=>s.members.map(m=>m.symbol));
 const snapshots=[1,5,20].map(i=>({date:days[i],source,universeSize:symbols.length,
  startedAt:new Date(at(days[i])-60000).toISOString(),retrievedAt:new Date(at(days[i])).toISOString(),
  stocks:symbols.map(code=>({code,latestPrice:11,vendorQuoteAt:at(days[i])-5000,volumeLots:50}))}));
 const corporateActions={schemaVersion:1,source:'imported',provider:'operator-action-audit',
  datasetId:'test-unverified',completed:true,observedAt:at(days[20])+1000,completeThrough:days[20],coveredSymbols:symbols,events:[]};
 return {cohort,snapshots,options:{tradeDates:days,corporateActions,asOf:at(days[20])+2000}};
}
const assess=f=>evaluate(f.cohort,f.snapshots,f.options);
test('a declared different per-stock source cannot borrow the snapshot source for a return',()=>{
 for(const badSource of ['other-provider',null,'']){
  const f=fixture();f.snapshots[0].stocks[0].source=badSource;
  const r=assess(f);
  assert.equal(r.horizons[0].status,'unknown');
  assert.equal(r.horizons[0].observedSectorCount,0);
  assert.equal(r.horizons[0].reason,'different-source-time-intraday-or-coverage');
  assert.equal(r.horizons[1].observedSectorCount,3,'unaffected horizons remain available');
 }
});
test('a corporate-action receipt cannot attest complete coverage after its own observed day',()=>{
 const f=fixture();f.options.corporateActions.observedAt=at(days[1])+1000;
 const r=assess(f);
 for(const h of r.horizons){
  assert.equal(h.status,'partial-or-unknown');
  assert.equal(h.observedSectorCount,0);
  assert.ok(h.sectors.every(s=>s.grossRawPriceReturnPct===null&&s.reason==='corporate-action-evidence-incomplete'));
 }
 assert.equal(r.canTrain,false);
});
test('a legitimately earlier complete-through receipt covers only its own target dates',()=>{
 const f=fixture();f.options.corporateActions.completeThrough=days[1];
 f.options.corporateActions.observedAt=at(days[1])+1000;
 const r=assess(f);
 assert.equal(r.horizons[0].observedSectorCount,3);
 for(const h of r.horizons.slice(1))assert.equal(h.observedSectorCount,0);
});
test('legacy rows without a source and explicitly matching source rows retain normal descriptive returns',()=>{
 const f=fixture();f.snapshots[1].stocks.forEach(s=>{s.source=source;});
 const before=JSON.stringify(f),r=assess(f);
 assert.equal(r.status,'research-observation-unverified');
 assert.deepEqual(r.horizons.map(h=>h.observedSectorCount),[3,3,3]);
 assert.ok(r.horizons.every(h=>h.sectors.every(s=>s.grossRawPriceReturnPct===10)));
 assert.equal(r.canTrain,false);assert.equal(r.canTrade,false);assert.equal(r.canNotify,false);
 assert.equal(JSON.stringify(f),before);
});
