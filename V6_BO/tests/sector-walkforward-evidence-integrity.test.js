'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {auditSectorWalkForward:audit}=require('../src/core/sector-walkforward-leakage-audit');
const days=[];
for(let i=0;days.length<70;i++){
 const d=new Date(Date.parse('2026-07-01T00:00:00Z')+i*86400000);
 if(d.getUTCDay()!==0&&d.getUTCDay()!==6)days.push(d.toISOString().slice(0,10));
}
const at=i=>Date.parse(days[i]+'T10:30:00+08:00');
const options={tradeDates:days,trainEnd:days[24],validationStart:days[30],
 validationEnd:days[40],asOf:at(65)};
const flags={verifiedLive:false,outOfSampleValidated:false,canTrain:false,
 canTrade:false,canNotify:false,weightsChanged:false,autoPromotion:false,
 labelsAvailable:false,netReturnsAvailable:false};
const complete='descriptive-raw-price-observed-unverified';
function rebind(e){
 const {fingerprint,...payload}=e.frozen;
 e.frozen.fingerprint=crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 e.observation.frozenFingerprint=e.frozen.fingerprint;
 return e;
}
// Deliberately construct imported protocol records, not real market observations.
// Rehash mutations so a rejection must come from semantic checks, not a stale hash.
function episode(index=0){
 const frozen={schemaVersion:1,mode:'sector-frozen-raw-quote-price-cohort',
  tradeDate:days[index],observedAt:at(index),frozenAt:at(index)+2000,
  source:'eastmoney-clist-unverified-live',classificationVersion:'fixture-frozen-v1',
  membershipProvider:'baostock:query_stock_industry',memberSourceObservedAt:at(index)-60000,
  snapshotFingerprint:'a'.repeat(64),membershipFingerprint:'b'.repeat(64),
  priceBasis:'unadjusted-intraday-provider-raw-quote',benchmarkMethod:null,
  sectorReturnMethod:'equal-weight-frozen-constituent-gross-price-change',
  sectors:[0,1,2].map(g=>({category:'industry',code:'BS_'+g,rank:g+1,score:90-g*10,
   baselinePriceCoveragePct:100,members:Array.from({length:5},(_,i)=>({
    symbol:String(600001+g*100+i),baselinePrice:10+i,baselineQuoteAt:at(index)-5000}))})),
  ...flags,prospectiveCertified:false};
 const observation={schemaVersion:1,mode:'sector-frozen-forward-gross-price-observation',
  status:'research-observation-unverified',tradeDate:frozen.tradeDate,
  classificationVersion:frozen.classificationVersion,source:frozen.source,asOf:at(index+20)+3000,
  priceBasis:frozen.priceBasis,returnMethod:frozen.sectorReturnMethod,
  corporateActionEvidence:'operator-imported-unverified',
  horizons:[1,5,20].map(h=>({sessions:h,targetDate:days[index+h],status:complete,
   observedSectorCount:3,sectors:frozen.sectors.map(s=>({category:s.category,code:s.code,
    baselineRank:s.rank,memberCount:s.members.length,observedMembers:s.members.length,
    status:complete,grossRawPriceReturnPct:2,benchmarkReturnPct:null,netReturnPct:null}))})),...flags};
 return rebind({frozen,observation});
}
function omitBaseline(e){
 const s=e.frozen.sectors[0];
 s.members[0].baselinePrice=null;s.members[0].baselineQuoteAt=null;
 s.baselinePriceCoveragePct=80;
 return e;
}
function omitOutcome(e){
 for(const h of e.observation.horizons){
  Object.assign(h.sectors[0],{status:'unknown',grossRawPriceReturnPct:null,observedMembers:0});
  h.status='partial-or-unknown';h.observedSectorCount=2;
 }
 return e;
}
const reject=e=>{
 const r=audit([rebind(e)],options);
 assert.equal(r.status,'blocked');
 assert.equal(r.reason,'unverified-tampered-or-uncomparable-price-episode');
 assert.equal(r.canTrain,false);assert.equal(r.canTrade,false);
};
test('frozen coverage cannot disagree with the exact member baselines even when rehashed',()=>{
 const e=omitOutcome(omitBaseline(episode()));
 e.frozen.sectors[0].baselinePriceCoveragePct=100;
 reject(e);
 const other=episode();other.frozen.sectors[0].baselinePriceCoveragePct=80;reject(other);
});
test('a sector with a missing frozen baseline cannot have a complete future price outcome',()=>{
 for(const index of [0,30])reject(omitBaseline(episode(index)));
});
test('shared members may overlap sectors but conflicting baseline price or clock is impossible',()=>{
 for(const key of ['baselinePrice','baselineQuoteAt']){
  const e=episode(),m=e.frozen.sectors[0].members[0];
  e.frozen.sectors[1].members[0]={...m,[key]:m[key]+1};
  reject(e);
 }
 const e=episode();e.frozen.sectors[1].members[0]={...e.frozen.sectors[0].members[0]};
 const r=audit([rebind(e)],options);
 assert.equal(r.status,'chronological-audit-unverified');assert.equal(r.train.episodes,1);
});
test('all original frozen nonproduction flags must remain false',()=>{
 for(const key of ['verifiedLive','canNotify','autoPromotion']){
  for(const value of [true,undefined]){
   const e=episode();e.frozen[key]=value;reject(e);
  }
 }
});
test('legitimate missing baselines retain unknown outcomes and stay outside full train counts',()=>{
 const train=rebind(omitOutcome(omitBaseline(episode())));
 const validation=rebind(omitOutcome(omitBaseline(episode(30))));
 const r=audit([train,validation],options);
 assert.equal(r.status,'chronological-audit-unverified');
 assert.equal(r.train.episodes,0);assert.equal(r.exclusion.pendingOrIncompleteTrainTwentyDay,1);
 assert.equal(r.validation.episodes,1);assert.equal(r.validation.fullTwentyDayEpisodes,0);
 assert.equal(r.validation.horizonStats[2].observedSectors,2);
 assert.equal(r.readyForIndependentBenchmarkAndAdjustedPriceReview,false);
});
test('complete and duplicate-day episodes retain the original chronological audit and no training permission',()=>{
 const train=episode(),validation=episode(30),before=JSON.stringify([train,validation]);
 const r=audit([train,validation],options);
 assert.equal(r.status,'chronological-audit-unverified');
 assert.equal(r.train.fullTwentyDayEpisodes,1);assert.equal(r.validation.fullTwentyDayEpisodes,1);
 assert.equal(r.readyForIndependentBenchmarkAndAdjustedPriceReview,true);
 assert.equal(r.canTrain,false);assert.equal(r.canTrade,false);assert.equal(r.outOfSampleValidated,false);
 assert.equal(JSON.stringify([train,validation]),before);
 assert.equal(audit([train,train],options).reason,'duplicate-or-unlisted-frozen-signal-day');
});
