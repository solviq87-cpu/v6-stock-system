'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inspectSectorShadowEligibility:inspect}=require('../src/core/sector-shadow-learning-preflight');
const {freezeCohort}=require('../src/core/forward-signal-observer');
const {evaluateSectorShadowH5PriceLabels:h5}=require('../src/core/sector-shadow-h5-price-label');
const {auditSectorH5MarketRegime:audit}=require('../src/core/sector-h5-market-regime-stress');
const dates=[];
for(let ms=Date.parse('2026-01-05T00:00:00Z');dates.length<160;ms+=86400000){
 const d=new Date(ms);if(d.getUTCDay()!==0&&d.getUTCDay()!==6)dates.push(d.toISOString().slice(0,10));
}
const sh=x=>Date.parse(x+'T15:00:00+08:00');
const asOf=Date.parse(dates.at(-1)+'T17:00:00+08:00');
const feed={source:'imported',provider:'operator-eod-dataset-unverified',
 datasetId:'fixed-h5-eod-unverified-v1',priceBasis:'unadjusted'};
function episode(i){
 const day=dates[6*i],end=sh(day),target=dates[6*i+5];
 const sectors=[],stocks=[];
 for(let g=0;g<3;g++){
  const members=[];
  for(let j=0;j<5;j++){
   const code=String(600001+g*100+j);
   members.push(code);
   stocks.push({code,pctChange:[4,1,-2][g]+.03*j,vendorQuoteAt:end-5000});
  }
  sectors.push({category:'industry',code:'BS_'+g,name:'industry'+g,
   memberCount:5,members});
 }
 const snapshot={date:day,source:'eastmoney-clist-unverified-live',
  startedAt:new Date(end-60000).toISOString(),retrievedAt:new Date(end).toISOString(),
  universeSize:15,stocks};
 const membership={schemaVersion:1,source:'imported',
  provider:'baostock:query_stock_industry',classificationVersion:'stable-market-sector-version-v1',
  tradeDate:day,observedAt:end-120000,sectors};
 const preflight=inspect(snapshot,membership,{asOf:end});
 assert.equal(preflight.status,'shadow-input-preview-unverified');
 const returns=i<12?[5,2,-1]:i<18?[3,1,0]:i%2===0?[4,1,-1]:[-2,1,3];
 const labels=sectors.map((sector,g)=>{
  const signals=sector.members.map((symbol,j)=>({signalId:day+'-'+symbol,symbol,
   system:'manual',cohort:'sector-shadow/industry/'+sector.code,
   provenance:'operator-unverified-at-signal',signalDate:day,
   signalAt:Date.parse(day+'T16:01:00+08:00'),baselineClose:10+j}));
  const cohort=freezeCohort({schemaVersion:1,feed,signals},
   {now:Date.parse(day+'T16:02:00+08:00')});
  const market={schemaVersion:1,feed:{...feed},asOf:target,
   observedAt:Date.parse(target+'T16:05:00+08:00'),
   calendar:dates.slice(0,i*6+6),
   stocks:sector.members.map((symbol,j)=>({symbol,corporateActions:[],
    bars:[{date:day,close:10+j,volume:1000,suspended:false},
     {date:target,close:(10+j)*(1+returns[g]/100),volume:1000,suspended:false}]}))};
  const result=h5(preflight,membership,cohort,market,
   {sectorCode:sector.code,now:Date.parse(target+'T17:00:00+08:00')});
  assert.equal(result.status,'gross-h5-label-observed-unverified');
  return result;
 });
 const up=i%2===0;
 const index={schemaVersion:1,source:'imported',
  indexCode:'000001.SH',provider:'operator-sse-index-unverified',tradeDate:day,
  quoteAt:end-10000,observedAt:end,previousClose:3000,
  close:up?3015:2985};
 return {entry:{preflight,labels},index};
}
const samples=Array.from({length:24},(_,i)=>episode(i));
const entries=samples.map(s=>s.entry),indexEvidence=samples.map(s=>s.index);
const options={tradeDates:dates,asOf,roundTripCostBps:30};
const copy=x=>structuredClone(x);
test('regime stress reuses existing validated 24-day H5 folds without enabling model training',()=>{
 const original=JSON.stringify({entries,indexEvidence});
 const r=audit(entries,indexEvidence,options);
 assert.equal(r.status,'regime-stratification-descriptive-unverified');
 assert.equal(r.observedEpisodes,24);
 assert.equal(r.indexInstrument,'000001.SH');
 assert.equal(r.marketRegimeRule,'same-day-index-close-versus-previous-close-sign-only');
 assert.equal(r.folds.train.signalDays,12);
 assert.equal(r.folds.validation.signalDays,6);
 assert.equal(r.folds.holdout.signalDays,6);
 assert.equal(r.folds.holdout.regimes.up.observedDays,3);
 assert.equal(r.folds.holdout.regimes.down.observedDays,3);
 assert.ok(r.folds.holdout.regimes.up.meanTopMinusAllAfterCostStressPct>0);
 assert.ok(r.folds.holdout.regimes.down.meanTopMinusAllAfterCostStressPct<0);
 assert.equal(r.folds.holdout.regimes.flat.status,'insufficient-regime-samples');
 assert.equal(r.folds.holdout.regimes.flat.meanTopMinusAllGrossPct,null);
 assert.equal(r.outOfSampleValidated,false);
 assert.equal(r.eligibleForResearchPromotion,false);
 assert.equal(r.canTrain,false);assert.equal(r.canTrade,false);
 assert.equal(r.weightsChanged,false);assert.equal(r.autoPromotion,false);
 assert.match(r.underlyingEvidenceFingerprint,/^[0-9a-f]{64}$/);
 assert.equal(JSON.stringify({entries,indexEvidence}),original);
 assert.deepEqual(audit([...entries].reverse(),[...indexEvidence].reverse(),options),r);
});
test('explicit cost assumption must affect every regime, never smuggle net P&L',()=>{
 const low=audit(entries,indexEvidence,{...options,roundTripCostBps:0});
 const high=audit(entries,indexEvidence,{...options,roundTripCostBps:100});
 assert.equal(low.status,'regime-stratification-descriptive-unverified');
 assert.equal(high.status,'regime-stratification-descriptive-unverified');
 assert.equal(high.folds.holdout.regimes.up.meanTopMinusAllAfterCostStressPct,
  Number((low.folds.holdout.regimes.up.meanTopMinusAllAfterCostStressPct-1).toFixed(6)));
 assert.equal(high.costStress.notBrokerFeeOrRealizedNet,true);
 assert.equal(high.canTrain,false);
});
test('no market-down observations means no invented down-market mean',()=>{
 const changed=copy(indexEvidence);
 for(const i of changed)i.close=i.previousClose+15;
 const r=audit(entries,changed,options);
 assert.equal(r.status,'regime-stratification-descriptive-unverified');
 assert.equal(r.folds.holdout.regimes.down.status,'insufficient-regime-samples');
 assert.equal(r.folds.holdout.regimes.down.observedDays,0);
 assert.equal(r.folds.holdout.regimes.down.meanTopMinusAllAfterCostStressPct,null);
});
test('post-signal index observations, stale quote times and mismatched dates are rejected',()=>{
 const mutators=[
  r=>{r.observedAt+=60000;},
  r=>{r.quoteAt-=360000;},
  r=>{r.quoteAt+=60000;},
  r=>{r.tradeDate=dates[4];},
  r=>{r.quoteAt=Date.parse('2026-11-10T15:00:00+08:00');}
 ];
 for(const mutate of mutators){
  const contexts=copy(indexEvidence);mutate(contexts[0]);
  const r=audit(entries,contexts,options);
  assert.equal(r.status,'blocked');
  assert.equal(r.canTrain,false);
 }
});
test('missing, duplicate or mixed provider/index instruments never pass',()=>{
 const badCases=[
  rows=>rows.pop(),
  rows=>{rows[0]=copy(rows[1]);},
  rows=>{rows[3].provider='different-source';},
  rows=>{rows[3].indexCode='399001.SZ';},
  rows=>{rows[3].indexCode='A50_UNREVIEWED';},
  rows=>{rows[3].source='simulated';}
 ];
 for(const change of badCases){
  const contexts=copy(indexEvidence);change(contexts);
  const r=audit(entries,contexts,options);
  assert.equal(r.status,'blocked');
 }
});
test('impossible or malformed index prices cannot construct apparent market regimes',()=>{
 const cases=[
  row=>row.previousClose=0,
  row=>row.close=-1,
  row=>row.close=5000,
  row=>row.indexCode='unknown',
  row=>row.observedAt=Number.NaN,
  row=>row.source='market-close-future'
 ];
 for(const f of cases){
  const rows=copy(indexEvidence);f(rows[0]);
  const r=audit(entries,rows,options);
  assert.equal(r.status,'blocked');
  assert.equal(r.outOfSampleValidated,false);
 }
});
test('tampered future H5 label cannot be disguised by apparently valid index evidence',()=>{
 const altered=copy(entries);
 altered[0].labels[0].grossMeanReturnPct+=20;
 const r=audit(altered,indexEvidence,options);
 assert.equal(r.status,'blocked');
 assert.equal(r.reason,'underlying-h5-evidence-not-eligible');
 assert.equal(r.canTrade,false);
});
test('insufficient H5 episodes and invalid cost settings always fail closed',()=>{
 assert.equal(audit(entries.slice(1),indexEvidence.slice(1),options).status,'blocked');
 assert.equal(audit(entries,indexEvidence,{...options,roundTripCostBps:-1}).status,'blocked');
 assert.equal(audit(entries,indexEvidence,{...options,roundTripCostBps:501}).status,'blocked');
});