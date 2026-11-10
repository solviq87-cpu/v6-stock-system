'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inspectSectorShadowEligibility}=require('../src/core/sector-shadow-learning-preflight');
const {freezeCohort}=require('../src/core/forward-signal-observer');
const {evaluateSectorShadowH5PriceLabels}=require('../src/core/sector-shadow-h5-price-label');
const {inspectSectorH5DailyReadiness:inspect}=require('../src/core/sector-h5-evidence-readiness');
const tradeDates=['2026-11-09','2026-11-10','2026-11-11','2026-11-12',
 '2026-11-13','2026-11-16','2026-11-17'];
const d='2026-11-10';
const at=(date,h='17:00')=>Date.parse(date+'T'+h+':00+08:00');
const end=at(d,'15:00'),signalAt=at(d,'16:01'),frozenAt=at(d,'16:02'),
 now=at('2026-11-17');
const feed={source:'imported',provider:'operator-eod-research-unverified',
 datasetId:'sector-data-fixed-v1',priceBasis:'unadjusted'};
const opts={tradeDates,asOf:now};
function sample(){
 const sectors=[],stocks=[];
 for(let g=0;g<3;g++){
  const members=[];
  for(let j=0;j<5;j++){
   const code=String(600001+g*100+j);members.push(code);
   stocks.push({code,pctChange:[4,1,-2][g]+j*.04,vendorQuoteAt:end-5000});
  }
  sectors.push({category:'industry',code:'BS_'+g,name:'industry'+g,
   memberCount:5,members});
 }
 const snapshot={date:d,source:'eastmoney-clist-unverified-live',
  universeSize:15,startedAt:new Date(end-60000).toISOString(),
  retrievedAt:new Date(end).toISOString(),stocks};
 const membership={schemaVersion:1,source:'imported',
  provider:'baostock:query_stock_industry',tradeDate:d,
  classificationVersion:'2026-11-10-independent-freeze-v1',
  observedAt:end-120000,sectors};
 const preflight=inspectSectorShadowEligibility(snapshot,membership,{asOf:end});
 assert.equal(preflight.status,'shadow-input-preview-unverified');
 const industries=sectors.map((sector,g)=>{
  const signals=sector.members.map((symbol,j)=>({
   signalId:'sig-'+symbol,symbol,system:'manual',
   cohort:'sector-shadow/industry/'+sector.code,
   provenance:'same-day-input-unverified',signalDate:d,signalAt,baselineClose:10+j}));
  const cohort=freezeCohort({schemaVersion:1,feed,signals},{now:frozenAt});
  const market={schemaVersion:1,feed:{...feed},asOf:'2026-11-17',
   observedAt:at('2026-11-17','16:05'),calendar:[...tradeDates],
   stocks:sector.members.map((symbol,j)=>({
    symbol,corporateActions:[],
    bars:[{date:d,close:10+j,volume:1000,suspended:false},
     {date:'2026-11-17',close:(10+j)*(1+[5,2,-1][g]/100),
      volume:1000,suspended:false}]}))};
  const label=evaluateSectorShadowH5PriceLabels(preflight,membership,cohort,
   market,{sectorCode:sector.code,now});
  assert.equal(label.status,'gross-h5-label-observed-unverified');
  return {sectorCode:sector.code,cohort,market,label};
 });
 return {snapshot,membership,preflight,preflightAsOf:end,industries};
}
test('all frozen members with actual H5 raw price lineage are ready only for research history',()=>{
 const e=sample(),unchanged=JSON.stringify(e),out=inspect(e,opts);
 assert.equal(out.status,'ready-for-history-audit-unverified');
 assert.equal(out.targetDate,'2026-11-17');
 assert.equal(out.rankedIndustries,3);
 assert.equal(out.allLabelsReplayed,true);
 assert.ok(out.sectorStatuses.every(x=>x.status==='raw-h5-label-replayed'));
 for(const k of ['verifiedLive','providerLicenseIndependentlyVerified',
  'externallyTimestampCertified','prospectiveCertified','outOfSampleValidated',
  'canTrain','canTrade','canNotify','autoPromotion','weightsChanged',
  'productionWeightsChanged','canWrite','readyForTraining','readyForTrading'])
  assert.equal(out[k],false,k);
 assert.equal(JSON.stringify(e),unchanged);
});
test('missing original candidate is not silently recomputed to fake a past freeze',()=>{
 const e=sample();delete e.preflight;
 const today=inspect(e,{tradeDates,asOf:end});
 assert.equal(today.status,'incomplete');
 assert.equal(today.stage,'freeze-today-candidate-required');
 const historical=inspect(e,opts);
 assert.equal(historical.stage,'past-candidate-not-frozen');
 assert.equal(historical.allLabelsReplayed,false);
});
test('missing original frozen member cohort cannot be manufactured in retrospect',()=>{
 const e=sample();e.industries=[];
 const historical=inspect(e,opts);
 assert.equal(historical.status,'incomplete');
 assert.equal(historical.sectorStatuses.length,3);
 assert.ok(historical.sectorStatuses.every(s=>s.status==='missing-cohort-cannot-backfill'));
 const today=inspect(e,{tradeDates,asOf:at(d,'16:05')});
 assert.ok(today.sectorStatuses.every(s=>s.status==='needs-same-day-cohort-freeze'));
});
test('missing price evidence, pending future H5, and missing label are distinct unknowns',()=>{
 let e=sample();
 for(const item of e.industries){delete item.market;delete item.label;}
 let out=inspect(e,opts);
 assert.equal(out.status,'incomplete');
 assert.ok(out.sectorStatuses.every(s=>s.status==='h5-price-evidence-missing'));
 e=sample();
 for(const item of e.industries){
  item.market.asOf='2026-11-13';
  item.market.observedAt=at('2026-11-13','16:05');
  item.market.stocks.forEach(stock=>stock.bars.pop());
  delete item.label;
 }
 out=inspect(e,{tradeDates,asOf:at('2026-11-13')});
 assert.equal(out.status,'incomplete');
 assert.ok(out.sectorStatuses.every(s=>s.status==='pending-future-session'));
 e=sample();
 for(const item of e.industries)delete item.label;
 out=inspect(e,opts);
 assert.equal(out.status,'incomplete');
 assert.ok(out.sectorStatuses.every(s=>s.status==='needs-h5-label-review'));
});
test('internally consistent forged labels and changed market bars are blocked',()=>{
 for(const change of [
  e=>{const x=e.industries[0].label;
   x.records.forEach(r=>{r.priceReturnPct=9;});
   x.grossMeanReturnPct=9;x.grossMedianReturnPct=9;},
  e=>{e.industries[1].market.stocks[0].bars.at(-1).close+=10;},
  e=>{e.preflight.shadowSample.sectors[0].score+=1;},
  e=>{e.snapshot.stocks[0].vendorQuoteAt-=600000;},
  e=>{e.industries[0].cohort.frozenAt+=86400000;}
 ]){
  const e=sample();change(e);const out=inspect(e,opts);
  assert.equal(out.status,'blocked');
  assert.equal(out.canTrain,false);
 }
});
test('explicit calendar disagreement and mixed H5 providers are blocked',()=>{
 for(const change of [
  e=>{e.industries[0].market.calendar.splice(3,1);},
  e=>{e.industries[0].market.calendar[3]='2026-11-15';},
  e=>{e.industries[0].market.feed.datasetId='different';},
  e=>{e.industries[0].market.asOf='2026-11-18';}
 ]){
  const e=sample();change(e);
  assert.equal(inspect(e,opts).status,'blocked');
 }
});
test('cannot select a minority of industry winners, an over-cap group, or overlap stocks',()=>{
 for(const change of [
  e=>{e.industries.pop();},
  e=>{e.industries[1].sectorCode='BS_0';},
  e=>{e.membership.sectors[0].members.pop();},
  e=>{e.membership.sectors[0].memberCount=501;
   e.membership.sectors[0].members=Array.from({length:501},(_,i)=>String(601000+i));},
  e=>{e.membership.sectors[1].members[0]=e.membership.sectors[0].members[0];}
 ]){
  const e=sample();change(e);
  const out=inspect(e,opts);
  assert.notEqual(out.status,'ready-for-history-audit-unverified');
  assert.equal(out.canTrade,false);
 }
});
test('missing fifth explicit calendar day is pending; malformed/future clocks block',()=>{
 const e=sample();
 assert.equal(inspect(e,{tradeDates:tradeDates.slice(0,-1),asOf:now}).stage,
  'await-explicit-h5-calendar');
 assert.equal(inspect(e,{tradeDates:tradeDates.slice(0,-2),asOf:now}).status,'blocked');
 assert.equal(inspect(e,{tradeDates:[...tradeDates].reverse(),asOf:now}).status,'blocked');
 assert.equal(inspect(e,{tradeDates,asOf:end-1}).status,'blocked');
});
