'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {freezeSectorPriceCohort:freeze,evaluateSectorForwardPrices:evaluate}=
 require('../src/core/sector-frozen-forward-prices');
const {auditSectorDualSource:audit}=require('../src/core/sector-dual-adjusted-source-audit');
const {main,parse}=require('../scripts/sector-dual-source-audit');
const dates=['2026-11-10'];
for(let i=1;dates.length<22;i++){
 const day=new Date(Date.parse(dates[0]+'T00:00:00Z')+86400000*i);
 if(day.getUTCDay()!==0&&day.getUTCDay()!==6)dates.push(day.toISOString().slice(0,10));
}
const t=d=>Date.parse(d+'T10:30:00+08:00');
const last=t(dates[20])+3000,windows=[1,5,20];
function sample(day,ratio=1){
 const stocks=[],sectors=[],end=t(day);
 for(let j=0;j<3;j++){
  const members=[];
  for(let k=0;k<5;k++){
   const sym=String(600001+100*j+k),p=10+j+.1*k;
   stocks.push({code:sym,pctChange:[4,1,-2][j],volumeLots:50,
    latestPrice:Number((p*ratio).toFixed(6)),vendorQuoteAt:end-5000});
   members.push(sym);
  }
  sectors.push({code:'BS_'+j,category:'industry',name:'行业'+j,memberCount:5,members});
 }
 return {snapshot:{date:day,source:'eastmoney-clist-unverified-live',
  universeSize:15,stocks,startedAt:new Date(end-60000).toISOString(),
  retrievedAt:new Date(end).toISOString(),verifiedLive:false},
 membership:{schemaVersion:1,source:'imported',
  provider:'baostock:query_stock_industry',
  classificationVersion:'baostock-csrc-2026-11-09',
  tradeDate:day,observedAt:end-120000,sectors}};
}
function fixture(){
 const base=sample(dates[0]);
 const cohort=freeze(base.snapshot,base.membership,{now:t(dates[0])+1000});
 const futures=windows.map((h,i)=>sample(dates[h],[1.04,1.08,.95][i]).snapshot);
 const corporateActions={schemaVersion:1,source:'imported',
  provider:'licensed-corporate-events',datasetId:'corp-actions-202611',
  observedAt:last,completed:true,completeThrough:dates[20],
  coveredSymbols:base.snapshot.stocks.map(x=>x.code),events:[]};
 const observation=evaluate(cohort,futures,{tradeDates:dates,
  corporateActions,asOf:last});
 assert.equal(observation.status,'research-observation-unverified');
 const adjustedRows=[];
 for(const baseline of base.snapshot.stocks){
  for(const d of [{day:dates[0],s:baseline},
   ...futures.map(x=>({day:x.date,s:x.stocks.find(y=>y.code===baseline.code)}))]){
   adjustedRows.push({symbol:baseline.code,date:d.day,rawQuoteAt:d.s.vendorQuoteAt,
    rawPrice:d.s.latestPrice,adjustedLevel:d.s.latestPrice*2,
    basisId:'supplier-total-return-v1',currency:'CNY'});
  }
 }
 const feed={schemaVersion:1,source:'imported',
  provider:'provider-a-adjusted',datasetId:'provider-a-202611',
  basisId:'supplier-total-return-v1',
  priceBasis:'provider-total-return-adjusted-intraday-level',
  observedAt:last,completed:true,upstreamLicenseIndependentlyVerified:false,
  rows:adjustedRows};
 const index={schemaVersion:1,source:'imported',
  provider:'provider-a-index',datasetId:'provider-a-index-202611',
  indexCode:'000300',basisId:'provider-a-tr-index',
  currency:'CNY',priceBasis:'provider-total-return-index-intraday-level',
  observedAt:last,completed:true,upstreamLicenseIndependentlyVerified:false,
  rows:[{date:dates[0],quoteAt:t(dates[0]),level:100,basisId:'provider-a-tr-index'},
    ...windows.map((h,i)=>({date:dates[h],quoteAt:t(dates[h]),
     level:[103,106,96][i],basisId:'provider-a-tr-index'}))]};
 const common={cohort,observation,rawSnapshots:futures,
  tradeDates:dates,corporateActions,asOf:last};
 const primary={...common,adjustedFeed:feed,benchmarkFeed:index};
 const secondary=structuredClone(primary);
 secondary.adjustedFeed.provider='provider-b-adjusted';
 secondary.adjustedFeed.datasetId='provider-b-202611';
 secondary.adjustedFeed.basisId='provider-b-tr';
 for(const r of secondary.adjustedFeed.rows){
  r.basisId='provider-b-tr';r.adjustedLevel*=3;
 }
 secondary.benchmarkFeed.provider='provider-b-index';
 secondary.benchmarkFeed.datasetId='provider-b-index-202611';
 secondary.benchmarkFeed.basisId='provider-b-tr-index';
 for(const r of secondary.benchmarkFeed.rows){
  r.basisId='provider-b-tr-index';r.level*=10;
 }
 const policy={schemaVersion:1,mode:'operator-dual-source-tolerance',
  declaredAt:cohort.frozenAt,maxStockReturnDifferenceBps:20,
  maxIndexReturnDifferenceBps:10};
 return {primary,secondary,policy,asOf:last};
}
test('two independently labelled suppliers agree on returns despite different adjustment scales',()=>{
 const f=fixture(),before=JSON.stringify(f),r=audit(f);
 assert.equal(r.status,'supplier-agreement-unverified');
 assert.deepEqual(r.horizons.map(x=>x.status),
  Array(3).fill('supplier-agreement-unverified'));
 assert.deepEqual(r.horizons.map(x=>x.agreedSectors),[3,3,3]);
 assert.equal(r.horizons[0].sectors[0].comparedStocks,5);
 assert.equal(r.horizons[0].sectors[0].maxStockReturnDifferenceBps,0);
 assert.equal(r.horizons[0].indexReturnDifferenceBps,0);
 for(const key of ['canTrain','canTrade','canNotify','outOfSampleValidated',
  'sourceLicenseIndependentlyVerified','providersIndependentlyVerified','independentlyAudited']){
  assert.equal(r[key],false,key);
 }
 assert.equal(JSON.stringify(f),before);
});
test('one frozen member differing by 2pct blocks sector consensus despite matching average-ish return',()=>{
 const f=fixture();
 const changed=f.secondary.adjustedFeed.rows.find(x=>x.symbol==='600001'&&x.date===dates[5]);
 changed.adjustedLevel*=1.02;
 const r=audit(f);
 assert.equal(r.status,'supplier-disagreement');
 assert.equal(r.horizons[1].status,'disagreement');
 assert.equal(r.horizons[1].disagreeingSectors,1);
 assert.equal(r.horizons[1].agreedSectors,2);
 assert.equal(r.horizons[1].sectors[0].status,'disagreement');
 assert.equal(r.horizons[1].sectors[0].reason,'one-or-more-frozen-stocks-disagree');
 assert.ok(r.horizons[1].sectors[0].maxStockReturnDifferenceBps>200);
 assert.equal(r.canTrain,false);
});
test('independent index providers disagree even when stock adjusted sources agree',()=>{
 const f=fixture();
 f.secondary.benchmarkFeed.rows.find(x=>x.date===dates[20]).level*=1.02;
 const r=audit(f);
 assert.equal(r.status,'supplier-disagreement');
 assert.equal(r.horizons[2].disagreeingSectors,3);
 assert.equal(r.horizons[2].sectors[0].reason,'index-benchmark-providers-disagree');
 assert.ok(r.horizons[2].indexReturnDifferenceBps>10);
});
test('one missing adjusted stock blocks that whole sector; never infer missing as zero',()=>{
 const f=fixture();
 f.secondary.adjustedFeed.rows=f.secondary.adjustedFeed.rows.filter(x=>
  !(x.symbol==='600001'&&x.date===dates[1]));
 const r=audit(f);
 assert.equal(r.horizons[0].status,'partial-or-unknown');
 assert.equal(r.horizons[0].unknownSectors,1);
 assert.equal(r.horizons[0].agreedSectors,2);
 assert.equal(r.horizons[0].sectors[0].comparedStocks,0);
 assert.equal(r.horizons[0].sectors[0].primaryAdjustedReturnPct,null);
});
test('raw-quote mismatch in secondary adjusted feed blocks that sector',()=>{
 const f=fixture();
 const bad=f.secondary.adjustedFeed.rows.find(x=>x.symbol==='600001'&&x.date===dates[5]);
 bad.rawQuoteAt+=1000;
 const r=audit(f);
 assert.equal(r.horizons[1].sectors[0].reason,'incomplete-or-incomparable-supplier-adjusted-sector');
 assert.equal(r.horizons[1].agreedSectors,2);
});
test('future observations remain pending; no nearby day can fill exact target',()=>{
 const f=fixture();
 f.primary.rawSnapshots=f.primary.rawSnapshots.filter(s=>s.date!==dates[5]);
 f.primary.observation=evaluate(f.primary.cohort,f.primary.rawSnapshots,{
  tradeDates:dates,corporateActions:f.primary.corporateActions,asOf:last});
 f.secondary.rawSnapshots=structuredClone(f.primary.rawSnapshots);
 f.secondary.observation=structuredClone(f.primary.observation);
 const r=audit(f);
 assert.equal(r.horizons[1].status,'pending');
 assert.equal(r.horizons[1].reason,'one-or-both-future-windows-pending');
 assert.equal(r.horizons[1].agreedSectors,0);
});
test('different original cohort, calendar, corporate-actions, costs or original study is blocked',()=>{
 const edits=[
  f=>f.secondary.cohort.fingerprint='tamper',
  f=>f.secondary.rawSnapshots[0].stocks[0].latestPrice*=1.1,
  f=>f.secondary.tradeDates.splice(3,1),
  f=>f.secondary.corporateActions.completeThrough=dates[5],
  f=>f.secondary.observation.horizons[0].sectors[0].grossRawPriceReturnPct=999,
  f=>f.secondary.costAssumptions={roundTripBps:0}
 ];
 for(const mutate of edits){
  const f=fixture();mutate(f);
  const r=audit(f);
  assert.equal(r.status,'blocked');assert.equal(r.canTrade,false);
 }
});
test('same provider labels, index codes, dataset IDs or nonpreregistered thresholds block',()=>{
 const edits=[
  f=>f.secondary.adjustedFeed.provider=f.primary.adjustedFeed.provider,
  f=>f.secondary.adjustedFeed.datasetId=f.primary.adjustedFeed.datasetId,
  f=>f.secondary.benchmarkFeed.provider=f.primary.benchmarkFeed.provider,
  f=>f.secondary.benchmarkFeed.indexCode='399006',
  f=>f.policy.declaredAt=f.primary.cohort.frozenAt+1,
  f=>f.policy.maxStockReturnDifferenceBps=200,
  f=>f.policy.maxIndexReturnDifferenceBps=-1
 ];
 for(const edit of edits){
  const f=fixture();edit(f);
  assert.equal(audit(f).status,'blocked');
 }
});
test('preview never creates files; publish is 0600, immutable, idempotent and disagreement is retained',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-dual-adjust-'));
 try{
  const input=path.join(dir,'bundle.json'),output=path.join(dir,'reports','agreement.json');
  const f=fixture();
  fs.writeFileSync(input,JSON.stringify({schemaVersion:1,
   mode:'sector-dual-source-imported-evidence',source:'imported',...f}));
  const a=main(['preview',input],{now:last});
  assert.equal(a.status,'supplier-agreement-unverified');
  assert.equal(a.changed,false);
  assert.equal(fs.existsSync(path.dirname(output)),false);
  const first=main(['publish',input,output],{now:last});
  const twice=main(['publish',input,output],{now:last});
  assert.equal(first.changed,true);assert.equal(twice.changed,false);
  const saved=JSON.parse(fs.readFileSync(output,'utf8'));
  assert.equal(saved.report.canTrain,false);
  assert.equal(saved.report.horizons[2].status,'supplier-agreement-unverified');
  assert.equal(fs.statSync(output).mode&0o777,0o600);
  const bad=JSON.parse(fs.readFileSync(input,'utf8'));
  bad.secondary.adjustedFeed.rows.find(r=>r.symbol==='600001'&&r.date===dates[5]).adjustedLevel*=1.02;
  fs.writeFileSync(input,JSON.stringify(bad));
  assert.throws(()=>main(['publish',input,output],{now:last}),/拒绝覆盖/);
  assert.throws(()=>parse(['publish',input,path.join(dir,'public','output.json')]),/公开/);
  const symlink=path.join(dir,'alias.json');fs.symlinkSync(input,symlink);
  assert.throws(()=>parse(['preview',symlink]),/符号链接/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
