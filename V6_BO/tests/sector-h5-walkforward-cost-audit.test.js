'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inspectSectorShadowEligibility:inspect}=require('../src/core/sector-shadow-learning-preflight');
const {freezeCohort}=require('../src/core/forward-signal-observer');
const {evaluateSectorShadowH5PriceLabels:labelH5}=require('../src/core/sector-shadow-h5-price-label');
const {evaluateSectorH5WalkForward:evaluate}=require('../src/core/sector-h5-walkforward-cost-audit');
const tradeDates=[];
for(let day=Date.parse('2026-01-05T00:00:00Z');tradeDates.length<160;day+=86400000){
 const d=new Date(day);
 if(d.getUTCDay()!==0&&d.getUTCDay()!==6)tradeDates.push(d.toISOString().slice(0,10));
}
const after=d=>Date.parse(d+'T17:00:00+08:00');
const feed={source:'imported',provider:'operator-eod-research-unverified',
 datasetId:'research-fixed-dataset-v1',priceBasis:'unadjusted'};
function example(index,returnTiers=[5,2,-1]){
 const day=tradeDates[index],targetDate=tradeDates[index+5];
 const end=Date.parse(day+'T15:00:00+08:00'),signalsAt=Date.parse(day+'T16:01:00+08:00'),
  frozenAt=Date.parse(day+'T16:02:00+08:00');
 const sectors=[],stocks=[];
 for(let g=0;g<3;g++){
  const members=[];
  for(let j=0;j<5;j++){
   const code=String(600001+g*100+j);
   members.push(code);stocks.push({code,pctChange:[4,1,-2][g]+j*.02,
    vendorQuoteAt:end-5000});
  }
  sectors.push({category:'industry',code:'BS_'+g,
   name:'industry'+g,memberCount:5,members});
 }
 const snapshot={date:day,source:'eastmoney-clist-unverified-live',universeSize:15,
  startedAt:new Date(end-60000).toISOString(),retrievedAt:new Date(end).toISOString(),stocks};
 const membership={schemaVersion:1,source:'imported',
  provider:'baostock:query_stock_industry',classificationVersion:'fixed-csrc-v1',
  tradeDate:day,observedAt:end-120000,sectors};
 const preflight=inspect(snapshot,membership,{asOf:end});
 assert.equal(preflight.status,'shadow-input-preview-unverified');
 const labels=[];
 for(let g=0;g<3;g++){
  const members=sectors[g].members;
  const signals=members.map((symbol,j)=>({signalId:day+'-'+symbol,
   symbol,system:'manual',cohort:'sector-shadow/industry/BS_'+g,
   provenance:'timestamped-research-synthetic-protocol-only',
   signalDate:day,signalAt:signalsAt,baselineClose:10+j}));
  const cohort=freezeCohort({schemaVersion:1,feed,signals},{now:frozenAt});
  const market={schemaVersion:1,feed:{...feed},
   asOf:targetDate,observedAt:Date.parse(targetDate+'T16:05:00+08:00'),
   calendar:tradeDates.slice(0,index+6),
   stocks:members.map((symbol,j)=>({symbol,corporateActions:[],
    bars:[{date:day,close:10+j,volume:1000,suspended:false},
     {date:targetDate,close:(10+j)*(1+returnTiers[g]/100),
      volume:1000,suspended:false}]}))};
  const label=labelH5(preflight,membership,cohort,market,
   {sectorCode:'BS_'+g,now:after(targetDate)});
  assert.equal(label.status,'gross-h5-label-observed-unverified');
  labels.push(label);
 }
 return {preflight,labels};
}
const build=(step=6)=>Array.from({length:24},(_,i)=>
 example(i*step,i<12?[5,2,-1]:i<18?[3,1,0]:[-2,1,3]));
const opts={tradeDates,asOf:after(tradeDates.at(-1)),roundTripCostBps:30};
test('real upstream label contracts produce deterministic split and cost stress, not promotion',()=>{
 const input=build(),before=JSON.stringify(input);
 const out=evaluate(input,opts);
 assert.equal(out.status,'descriptive-walk-forward-unverified');
 assert.equal(out.signalDays,24);
 assert.equal(out.folds.train.signalDays,12);
 assert.equal(out.folds.validation.signalDays,6);
 assert.equal(out.folds.holdout.signalDays,6);
 assert.equal(out.folds.train.averageTopMinusAllGrossPct,3);
 assert.equal(out.folds.train.averageTopMinusAllAfterCostStressPct,2.7);
 assert.ok(out.folds.holdout.averageTopMinusAllAfterCostStressPct<0);
 assert.equal(out.folds.holdout.costStressPositiveDays,0);
 assert.equal(out.costStress.roundTripCostBps,30);
 assert.equal(out.eligibleForResearchPromotion,false);
 assert.equal(out.outOfSampleValidated,false);
 assert.equal(out.canTrain,false);assert.equal(out.canTrade,false);
 assert.equal(out.autoPromotion,false);assert.equal(out.weightsChanged,false);
 assert.match(out.evidenceFingerprint,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(input),before,'audit must not mutate immutable source observations');
 assert.deepEqual(out,evaluate([...input].reverse(),opts),'input order must not alter split');
});
test('changing price or cost assumption is visible, not an opaque model update',()=>{
 const input=build();
 const low=evaluate(input,{...opts,roundTripCostBps:0});
 const high=evaluate(input,{...opts,roundTripCostBps:100});
 assert.equal(low.folds.train.averageTopMinusAllAfterCostStressPct,3);
 assert.equal(high.folds.train.averageTopMinusAllAfterCostStressPct,2);
 assert.equal(high.costStress.roundTripCostPct,1);
 assert.equal(high.canTrain,false);
});
test('duplicate days, too few days, and overlapping 5-session outcomes fail closed',()=>{
 const input=build();
 assert.equal(evaluate(input.slice(1),opts).status,'blocked');
 const duplicate=[...input];duplicate[3]=input[2];
 assert.equal(evaluate(duplicate,opts).reason,'repeated-signal-day');
 const overlap=build(5);
 assert.equal(evaluate(overlap,opts).reason,'overlapping-h5-outcome-windows');
});
test('holdout cannot be peeked into before its maturity timestamp',()=>{
 const input=build();
 const earlier={...opts,asOf:Date.parse(tradeDates[143]+'T12:00:00+08:00')};
 assert.equal(evaluate(input,earlier).status,'blocked');
});
test('an industry cannot be cherry-picked, relabeled or silently dropped',()=>{
 const modifications=[
  x=>{x.labels.pop();},
  x=>{x.labels[0].sectorCode='BK_MADEUP';},
  x=>{x.labels[0].scoreAtFreeze+=1;},
  x=>{x.labels[0].records.pop();},
  x=>{x.labels[0].records[0].symbol=x.labels[1].records[0].symbol;},
  x=>{x.labels[0].grossMeanReturnPct+=20;},
  x=>{x.labels[0].grossMedianReturnPct+=20;},
  x=>{x.labels[0].records[0].priceReturnPct=90000;},
  x=>{x.labels[0].canTrain=true;},
  x=>{x.preflight.shadowSample.sectors[0].rank=3;},
  x=>{x.preflight.canTrain=true;}
 ];
 for(const change of modifications){
  const entries=build();change(entries[0]);
  const result=evaluate(entries,opts);
  assert.equal(result.status,'blocked');
  assert.equal(result.canTrain,false);
  assert.equal(result.eligibleForResearchPromotion,false);
 }
});
test('cross-day dataset identity or intraday mixed price providers reject comparison',()=>{
 for(const mutate of [
  e=>{e[3].labels[0].priceFeed.provider='another-feed';},
  e=>{e[3].labels.forEach(l=>l.priceFeed.datasetId='another-version');},
  e=>{e[3].preflight.shadowSample.quoteSource='changed-source';},
  e=>{e[3].labels[2].featureQuoteSource='other-quote';}
 ]){
  const items=build();mutate(items);
  const r=evaluate(items,opts);
  assert.equal(r.status,'blocked');
 }
});
test('future target dates, missing calendars and bad costs never get an OOS green light',()=>{
 const entries=build();
 assert.equal(evaluate(entries,{...opts,tradeDates:tradeDates.slice(0,130)}).status,'blocked');
 assert.equal(evaluate(entries,{...opts,roundTripCostBps:-1}).status,'blocked');
 assert.equal(evaluate(entries,{...opts,roundTripCostBps:501}).status,'blocked');
 const reversed=[...tradeDates];reversed[1]=reversed[0];
 assert.equal(evaluate(entries,{...opts,tradeDates:reversed}).status,'blocked');
});
test('even strong positive held-out history stays unverified and prohibited to train',()=>{
 const allPositive=Array.from({length:24},(_,i)=>example(i*6,[5,2,-1]));
 const result=evaluate(allPositive,opts);
 assert.equal(result.status,'descriptive-walk-forward-unverified');
 assert.ok(result.folds.holdout.averageTopMinusAllAfterCostStressPct>0);
 assert.equal(result.outOfSampleValidated,false);
 assert.equal(result.eligibleForResearchPromotion,false);
 assert.equal(result.canTrain,false);
});