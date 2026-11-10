'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {freezeSectorPriceCohort:freeze,
 evaluateSectorForwardPrices:evaluate}=require('../src/core/sector-frozen-forward-prices');
const {reconcileSectorAdjusted:reconcile}=
 require('../src/core/sector-adjusted-benchmark-reconcile');
const {main,parse}=require('../scripts/sector-adjusted-benchmark-audit');
const days=['2026-11-10'];
for(let i=1;days.length<=22;i++){
 const d=new Date(Date.parse(days[0]+'T00:00:00Z')+i*86400000);
 if(d.getUTCDay()!==0&&d.getUTCDay()!==6)
  days.push(d.toISOString().slice(0,10));
}
const time=d=>Date.parse(d+'T10:30:00+08:00');
const last=time(days[20])+3000,windows=[1,5,20];
function snapshot(day,ratio=1){
 const stocks=[],sectors=[],end=time(day);
 for(let j=0;j<3;j++){
  const members=[];
  for(let k=0;k<5;k++){
   const symbol=String(600001+j*100+k),price=10+j+k*.1;
   members.push(symbol);
   stocks.push({code:symbol,pctChange:[4,2,-1][j],
    latestPrice:Number((price*ratio).toFixed(6)),
    vendorQuoteAt:end-5000,volumeLots:20});
  }
  sectors.push({category:'industry',code:'BS_'+j,name:'行业'+j,
   memberCount:5,members});
 }
 return {
  market:{date:day,source:'eastmoney-clist-unverified-live',
   universeSize:15,stocks,
   startedAt:new Date(end-60000).toISOString(),
   retrievedAt:new Date(end).toISOString(),verifiedLive:false},
  membership:{schemaVersion:1,source:'imported',
   provider:'baostock:query_stock_industry',
   classificationVersion:'baostock-csrc-2026-11-09-frozen',
   tradeDate:day,observedAt:end-120000,sectors}
 };
}
function fixture(){
 const base=snapshot(days[0]);
 const cohort=freeze(base.market,base.membership,{now:time(days[0])+1000});
 const ratios=[1.04,1.09,.96];
 const rawSnapshots=windows.map((h,i)=>snapshot(days[h],ratios[i]).market);
 const corporateActions={schemaVersion:1,source:'imported',
  provider:'licensed-corporate-actions',datasetId:'action-bundle-202611',
  observedAt:last,completeThrough:days[20],completed:true,
  coveredSymbols:base.market.stocks.map(x=>x.code),events:[]};
 const observation=evaluate(cohort,rawSnapshots,{tradeDates:days,
  corporateActions,asOf:last});
 assert.equal(observation.status,'research-observation-unverified');
 const adjustedRows=[];
 for(const row of base.market.stocks){
  const dates=[{day:days[0],raw:row}];
  for(const snap of rawSnapshots)
   dates.push({day:snap.date,raw:snap.stocks.find(x=>x.code===row.code)});
  for(const d of dates)adjustedRows.push({symbol:row.code,date:d.day,
   rawQuoteAt:d.raw.vendorQuoteAt,rawPrice:d.raw.latestPrice,
   adjustedLevel:Number((d.raw.latestPrice*2).toFixed(6)),
   basisId:'ret-inclusive-202612',currency:'CNY'});
 }
 const adjustedFeed={schemaVersion:1,source:'imported',
  provider:'licensed-adjustment-supplier',
  datasetId:'adj-bundle-202612',basisId:'ret-inclusive-202612',
  priceBasis:'provider-total-return-adjusted-intraday-level',
  observedAt:last,completed:true,upstreamLicenseIndependentlyVerified:false,
  rows:adjustedRows};
 const benchmarkFeed={schemaVersion:1,source:'imported',
  provider:'licensed-index-provider',datasetId:'index-202612',indexCode:'000300',
  basisId:'total-return-index-202612',currency:'CNY',
  priceBasis:'provider-total-return-index-intraday-level',
  observedAt:last,completed:true,upstreamLicenseIndependentlyVerified:false,
  rows:[{date:days[0],quoteAt:time(days[0]),level:100,
   basisId:'total-return-index-202612'},...windows.map((h,i)=>({
    date:days[h],quoteAt:time(days[h]),level:[103,108,95][i],
    basisId:'total-return-index-202612'}))]};
 const costAssumptions={schemaVersion:1,source:'operator-assumed',
  scheme:'fixed-round-trip-bps-no-rebalance',assumptionId:'pre-signal-20bps',
  observedAt:cohort.frozenAt,roundTripBps:20};
 return {cohort,observation,rawSnapshots,tradeDates:days,
  corporateActions,adjustedFeed,benchmarkFeed,costAssumptions,asOf:last};
}
test('reconciles frozen raw quote identity with supplier-reported adjusted levels and independent index',()=>{
 const f=fixture(),unchanged=JSON.stringify(f),r=reconcile(f);
 assert.equal(r.status,'supplier-adjusted-reconciliation-unverified');
 assert.deepEqual(r.horizons.map(x=>x.targetDate),windows.map(h=>days[h]));
 assert.deepEqual(r.horizons.map(x=>x.observedSectorCount),[3,3,3]);
 assert.deepEqual(r.horizons.map(x=>x.benchmarkTotalReturnPct),[3,8,-5]);
 assert.deepEqual(r.horizons.map(x=>x.sectors[0].providerAdjustedGrossPct),[4,9,-4]);
 assert.deepEqual(r.horizons.map(x=>x.sectors[0].providerAdjustedExcessPct),[1,1,1]);
 assert.deepEqual(r.horizons.map(x=>x.sectors[0].illustrativeAfterAssumedCostExcessPct),[.8,.8,.8]);
 for(const flag of ['canTrain','canTrade','canNotify','autoPromotion',
  'outOfSampleValidated','labelsAvailable','netReturnsAvailable',
  'sourceLicenseIndependentlyVerified','independentlyAudited']){
  assert.equal(r[flag],false,flag);
 }
 assert.equal(r.retrospectiveAdjustment,true);
 assert.equal(JSON.stringify(f),unchanged,'research must not mutate evidence');
});
test('missing supplier price for one frozen member does not silently calculate survivors-only sector return',()=>{
 const f=fixture();
 f.adjustedFeed.rows=f.adjustedFeed.rows.filter(x=>
  !(x.symbol==='600001'&&x.date===days[5]));
 const r=reconcile(f);
 assert.equal(r.horizons[1].status,'partial-or-unknown');
 assert.equal(r.horizons[1].observedSectorCount,2);
 assert.equal(r.horizons[1].sectors[0].status,'unknown');
 assert.equal(r.horizons[1].sectors[0].reason,'matched-adjusted-level-missing');
 assert.equal(r.horizons[1].sectors[0].observedMembers,0);
 assert.equal(r.horizons[1].sectors[0].providerAdjustedGrossPct,null);
});
test('supplier backadjustment can describe cash-dividend interval but never certifies adjustment math',()=>{
 const f=fixture();
 f.corporateActions.events=[{symbol:'600001',date:days[3],type:'cash-dividend'}];
 f.observation=evaluate(f.cohort,f.rawSnapshots,{
  tradeDates:days,corporateActions:f.corporateActions,asOf:last});
 assert.equal(f.observation.horizons[1].sectors[0].status,'unknown');
 const entry=f.adjustedFeed.rows.find(x=>x.symbol==='600001'&&x.date===days[5]);
 entry.adjustedLevel*=1.02;
 const r=reconcile(f);
 assert.equal(r.horizons[1].sectors[0].status,'provider-adjusted-reconciled-unverified');
 assert.equal(r.sourceLicenseIndependentlyVerified,false);
 assert.equal(r.canTrain,false);
 assert.equal(r.netReturnsAvailable,false);
});
test('raw quote price or timestamp misalignment is flagged, never silently reassigned',()=>{
 for(const mutate of [
  f=>f.adjustedFeed.rows.find(r=>r.symbol==='600001'&&r.date===days[5]).rawPrice*=1.1,
  f=>f.adjustedFeed.rows.find(r=>r.symbol==='600001'&&r.date===days[5]).rawQuoteAt+=1000
 ]){
  const f=fixture();mutate(f);
  const r=reconcile(f);
  assert.equal(r.horizons[1].sectors[0].reason,'adjusted-raw-provenance-mismatch');
  assert.equal(r.horizons[1].sectors[0].providerAdjustedGrossPct,null);
 }
});
test('benchmark time, basis version and missing index evidence never become zero benchmark',()=>{
 const f=fixture();
 f.benchmarkFeed.rows.find(x=>x.date===days[5]).quoteAt+=3600000;
 const r=reconcile(f);
 assert.equal(r.horizons[1].status,'partial-or-unknown');
 assert.equal(r.horizons[1].benchmarkTotalReturnPct,null);
 assert.equal(r.horizons[1].sectors[0].reason,'benchmark-or-corporate-action-time-unmatched');
 const g=fixture();
 g.benchmarkFeed.rows.find(x=>x.date===days[1]).basisId='different';
 const r2=reconcile(g);
 assert.equal(r2.status,'insufficient-evidence');
 assert.equal(r2.horizons[0].sectors[0].reason,'adjusted-index-or-action-evidence-missing');
 const absent=fixture();delete absent.benchmarkFeed;
 const r3=reconcile(absent);
 assert.equal(r3.status,'insufficient-evidence');
 assert.equal(r3.horizons[0].benchmarkTotalReturnPct,null);
});
test('invalid supplier claim, duplicate adjusted rows or mixed currency block descriptive comparison',()=>{
 for(const mutate of [
  f=>f.adjustedFeed.upstreamLicenseIndependentlyVerified=true,
  f=>f.adjustedFeed.rows.push({...f.adjustedFeed.rows[0]}),
  f=>f.adjustedFeed.rows[0].currency='USD',
  f=>f.adjustedFeed.priceBasis='unadjusted',
  f=>f.adjustedFeed.observedAt=last+60000
 ]){
  const f=fixture();mutate(f);
  const r=reconcile(f);
  assert.equal(r.status,'insufficient-evidence');
  assert.equal(r.horizons[0].sectors[0].providerAdjustedGrossPct,null);
  assert.equal(r.canTrain,false);
 }
});
test('missing/late corporate action audit and uncovered frozen stock block returns',()=>{
 const f=fixture();f.corporateActions.coveredSymbols=f.corporateActions.coveredSymbols.slice(1);
 f.observation=evaluate(f.cohort,f.rawSnapshots,{
  tradeDates:days,corporateActions:f.corporateActions,asOf:last});
 const r=reconcile(f);
 assert.equal(r.horizons[0].sectors[0].reason,'corporate-action-symbol-coverage-missing');
 const g=fixture();g.corporateActions.completeThrough=days[5];
 g.observation=evaluate(g.cohort,g.rawSnapshots,{
  tradeDates:days,corporateActions:g.corporateActions,asOf:last});
 const r2=reconcile(g);
 assert.equal(r2.horizons[2].sectors[0].reason,'benchmark-or-corporate-action-time-unmatched');
});
test('post-signal fee assumptions, prices changed in frozen cohort, fabricated prior outcome block research',()=>{
 const later=fixture();later.costAssumptions.observedAt=last;
 assert.equal(reconcile(later).reason,'post-signal-or-invalid-cost-assumptions');
 const tamper=fixture();tamper.cohort.sectors[0].members[0].baselinePrice*=2;
 assert.equal(reconcile(tamper).reason,'upstream-frozen-observation-replay-mismatch');
 const fabricated=fixture();fabricated.observation.horizons[0].sectors[0].grossRawPriceReturnPct=200;
 assert.equal(reconcile(fabricated).reason,'upstream-frozen-observation-replay-mismatch');
});
test('explicit 1/5/20 target date gaps remain pending without backfilling natural days',()=>{
 const f=fixture();
 f.rawSnapshots=f.rawSnapshots.filter(s=>s.date!==days[5]);
 f.observation=evaluate(f.cohort,f.rawSnapshots,{
  tradeDates:days,corporateActions:f.corporateActions,asOf:last});
 const r=reconcile(f);
 assert.equal(r.horizons[1].status,'pending');
 assert.equal(r.horizons[1].reason,'target-snapshot-missing');
 assert.equal(r.horizons[1].benchmarkTotalReturnPct,null);
 assert.equal(r.horizons[2].observedSectorCount,3);
});
test('offline CLI preview stays read-only, publish writes 0600 immutable and rejects conflict/symlink/public',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-adjusted-reconcile-'));
 try{
  const f=fixture();
  const input=path.join(dir,'input.json'),output=path.join(dir,'reports','audit.json');
  fs.writeFileSync(input,JSON.stringify({
   schemaVersion:1,mode:'imported-sector-adjusted-benchmark-bundle',
   source:'imported',...f}));
  const preview=main(['preview',input],{now:last});
  assert.equal(preview.status,'supplier-adjusted-reconciliation-unverified');
  assert.equal(preview.changed,false);
  assert.equal(fs.existsSync(path.dirname(output)),false);
  const one=main(['publish',input,output],{now:last});
  const repeat=main(['publish',input,output],{now:last});
  assert.equal(one.changed,true);assert.equal(repeat.changed,false);
  const saved=JSON.parse(fs.readFileSync(output,'utf8'));
  assert.equal(saved.report.canTrade,false);
  assert.equal(saved.report.canTrain,false);
  assert.equal(fs.statSync(output).mode&0o777,0o600);
  const modified=JSON.parse(fs.readFileSync(input,'utf8'));
  modified.costAssumptions.roundTripBps=30;
  fs.writeFileSync(input,JSON.stringify(modified));
  assert.throws(()=>main(['publish',input,output],{now:last}),/拒绝覆盖/);
  const alias=path.join(dir,'alias.json');fs.symlinkSync(input,alias);
  assert.throws(()=>parse(['preview',alias]),/符号链接/);
  assert.throws(()=>parse(['publish',input,path.join(dir,'public','x.json')]),/公开/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
