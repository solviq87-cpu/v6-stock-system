'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inspectSectorShadowEligibility:inspect}=require('../src/core/sector-shadow-learning-preflight');
const {freezeCohort}=require('../src/core/forward-signal-observer');
const {evaluateSectorShadowH5PriceLabels:priceH5}=require('../src/core/sector-shadow-h5-price-label');
const {replaySectorH5DailyEvidence:replay,
 evaluateReplayedSectorH5WalkForward:audit}=require('../src/core/sector-h5-raw-evidence-replay');
const days=[];
for(let ms=Date.parse('2026-01-05T00:00:00Z');days.length<160;ms+=86400000){
 const d=new Date(ms);if(d.getUTCDay()>0&&d.getUTCDay()<6)
  days.push(d.toISOString().slice(0,10));
}
const stamp=(d,time='17:00')=>Date.parse(d+'T'+time+':00+08:00');
const feed={source:'imported',provider:'audited-research-provider-unverified',
 datasetId:'fixed-source-dataset-v1',priceBasis:'unadjusted'};
function dayEvidence(i,performance=[5,2,-1]){
 const signalDay=days[i],targetDay=days[i+5],end=stamp(signalDay,'15:00'),
  signalAt=stamp(signalDay,'16:01'),frozenAt=stamp(signalDay,'16:02'),
  now=stamp(targetDay);
 const stocks=[],sectors=[];
 for(let g=0;g<3;g++){
  const members=[];
  for(let j=0;j<5;j++){
   const code=String(600001+g*100+j);
   members.push(code);stocks.push({code,pctChange:[4,1,-2][g]+j*.02,
    vendorQuoteAt:end-5000});
  }
  sectors.push({category:'industry',code:'BS_'+g,name:'industry'+g,
   memberCount:5,members});
 }
 const snapshot={date:signalDay,source:'eastmoney-clist-unverified-live',
  universeSize:15,startedAt:new Date(end-60000).toISOString(),
  retrievedAt:new Date(end).toISOString(),stocks};
 const membership={schemaVersion:1,source:'imported',
  provider:'baostock:query_stock_industry',classificationVersion:'frozen-csrc-same-version',
  tradeDate:signalDay,observedAt:end-120000,sectors};
 const preflight=inspect(snapshot,membership,{asOf:end});
 assert.equal(preflight.status,'shadow-input-preview-unverified');
 const industries=[];
 for(let g=0;g<3;g++){
  const signals=sectors[g].members.map((symbol,j)=>({
   signalId:signalDay+'-'+symbol,symbol,signalDate:signalDay,
   system:'manual',cohort:'sector-shadow/industry/BS_'+g,
   provenance:'same-day-captured-test-protocol',
   signalAt,baselineClose:10+j
  }));
  const cohort=freezeCohort({schemaVersion:1,feed,signals},{now:frozenAt});
  const market={schemaVersion:1,feed:{...feed},asOf:targetDay,
   observedAt:stamp(targetDay,'16:05'),calendar:days.slice(0,i+6),
   stocks:sectors[g].members.map((symbol,j)=>({
    symbol,corporateActions:[],
    bars:[{date:signalDay,close:10+j,volume:1000,suspended:false},
     {date:targetDay,close:(10+j)*(1+performance[g]/100),
      volume:1000,suspended:false}]
   }))
  };
  const label=priceH5(preflight,membership,cohort,market,{sectorCode:'BS_'+g,now});
  assert.equal(label.status,'gross-h5-label-observed-unverified');
  industries.push({sectorCode:'BS_'+g,cohort,market,label});
 }
 return {snapshot,membership,preflight,preflightAsOf:end,industries};
}
const opts={tradeDates:days,asOf:stamp(days.at(-1)),roundTripCostBps:30};
const sample=()=>Array.from({length:24},(_,i)=>
 dayEvidence(i*6,i<12?[5,2,-1]:i<18?[3,1,0]:[-2,1,3]));
test('daily price lineage exactly replays frozen industry, cohort and future raw bars',()=>{
 const source=dayEvidence(0),before=JSON.stringify(source),out=replay(source,{asOf:opts.asOf});
 assert.equal(out.status,'raw-replay-complete-unverified');
 assert.equal(out.rawEvidenceReplayed,true);
 assert.equal(out.sectorCount,3);
 assert.equal(out.entry.labels.length,3);
 assert.equal(out.entry.labels[0].grossMeanReturnPct,5);
 assert.equal(out.entry.labels[2].grossMeanReturnPct,-1);
 assert.equal(out.canTrain,false);
 assert.equal(out.outOfSampleValidated,false);
 assert.equal(out.externallyTimestampCertified,false);
 assert.equal(out.providerLicenseIndependentlyVerified,false);
 assert.equal(JSON.stringify(source),before,'replay must not change source artifacts');
});
test('full 24-session replay enters fixed walk-forward only after raw label checks',()=>{
 const data=sample(),original=JSON.stringify(data);
 const x=audit(data,opts);
 assert.equal(x.status,'raw-replayed-descriptive-audit-unverified');
 assert.equal(x.mode,'sector-h5-raw-evidence-replay-audit');
 assert.equal(x.rawEvidenceReplayed,true);
 assert.equal(x.folds.train.signalDays,12);
 assert.equal(x.folds.validation.signalDays,6);
 assert.equal(x.folds.holdout.signalDays,6);
 assert.equal(x.folds.train.averageTopMinusAllGrossPct,3);
 assert.equal(x.folds.train.averageTopMinusAllAfterCostStressPct,2.7);
 assert.ok(x.folds.holdout.averageTopMinusAllAfterCostStressPct<0);
 assert.equal(x.eligibleForResearchPromotion,false);
 assert.equal(x.canTrain,false);assert.equal(x.canTrade,false);
 assert.equal(x.weightsChanged,false);assert.equal(x.outOfSampleValidated,false);
 assert.equal(JSON.stringify(data),original);
 assert.deepEqual(x,audit([...data].reverse(),opts),'different input order cannot change fixed folds');
});
test('a fabricated yet numerically self-consistent H5 sector report is rejected',()=>{
 const day=dayEvidence(0),label=day.industries[0].label;
 // Even internally consistent fabricated 9% returns must not pass raw replay.
 label.records.forEach(s=>{s.priceReturnPct=9;});
 label.grossMeanReturnPct=9;label.grossMedianReturnPct=9;
 assert.equal(replay(day,{asOf:opts.asOf}).reason,
  'claimed-h5-label-differs-from-replayed-raw-prices');
});
test('candidate re-ranking or changed frozen stock quote invalidates historical provenance',()=>{
 for(const mutate of [
  e=>{e.preflight.shadowSample.sectors[0].score+=1;},
  e=>{e.preflight.quality.tally.fresh-=1;},
  e=>{e.snapshot.stocks[0].pctChange=-10;},
  e=>{e.snapshot.stocks[0].vendorQuoteAt-=900000;},
  e=>{e.membership.sectors[0].members[0]='699999';},
  e=>{e.membership.classificationVersion='changed-after-the-event';}
 ]){
  const e=dayEvidence(0);mutate(e);
  const result=replay(e,{asOf:opts.asOf});
  assert.equal(result.status,'blocked');
  assert.equal(result.rawEvidenceReplayed,false);
  assert.equal(result.canTrain,false);
 }
});
test('missing raw industry, duplicated episode or reused stock identity blocks the day',()=>{
 for(const mutate of [
  e=>{e.industries.pop();},
  e=>{e.industries[2].sectorCode='BS_0';},
  e=>{e.industries[2].sectorCode='BS_5';},
  e=>{e.membership.sectors[2].members[0]=e.membership.sectors[0].members[0];},
  e=>{e.industries[1].cohort=e.industries[0].cohort;},
  e=>{e.industries[0].market.stocks.pop();},
  e=>{e.industries[0].market.feed.provider='different-feed';}
 ]){
  const e=dayEvidence(0);mutate(e);
  assert.equal(replay(e,{asOf:opts.asOf}).status,'blocked');
 }
});
test('corporate action or missing H5 future session blocks full-sector scoring',()=>{
 for(const mutate of [
  m=>{m.stocks[0].corporateActions.push(days[2]);},
  m=>{m.stocks[0].bars.pop();},
  m=>{m.asOf=days[3];m.observedAt=stamp(days[3],'16:05');},
  m=>{m.stocks[0].bars[0].close+=1;}
 ]){
  const e=dayEvidence(0);mutate(e.industries[0].market);
  const x=replay(e,{asOf:opts.asOf});
  assert.equal(x.status,'blocked');
  assert.equal(x.canTrain,false);
 }
});
test('missing or repeated days and overlapping 5-session windows cannot reach scorecard',()=>{
 const shorter=sample().slice(1);
 assert.equal(audit(shorter,opts).status,'blocked');
 const duplicate=sample();duplicate[5]=duplicate[4];
 assert.equal(audit(duplicate,opts).status,'blocked');
 assert.match(audit(duplicate,opts).reason,/fixed-walkforward-blocked/);
 const overlapping=Array.from({length:24},(_,i)=>dayEvidence(i*5));
 assert.equal(audit(overlapping,opts).status,'blocked');
});
test('cost stress or high historical success never grants training/promotion',()=>{
 const items=Array.from({length:24},(_,i)=>dayEvidence(i*6,[5,2,-1]));
 const score=audit(items,{...opts,roundTripCostBps:500});
 assert.equal(score.status,'raw-replayed-descriptive-audit-unverified');
 assert.ok(score.folds.holdout.averageTopMinusAllAfterCostStressPct<0);
 assert.equal(score.canTrain,false);assert.equal(score.autoPromotion,false);
 assert.equal(score.externallyTimestampCertified,false);
 assert.equal(score.providerLicenseIndependentlyVerified,false);
});
