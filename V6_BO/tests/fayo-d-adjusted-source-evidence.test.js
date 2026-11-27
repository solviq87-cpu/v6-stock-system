'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {freezeSectorPriceCohort:freeze,evaluateSectorForwardPrices:evaluate}=require('../src/core/sector-frozen-forward-prices');
const {auditSectorDualSource:audit}=require('../src/core/sector-dual-adjusted-source-audit');
// The original dual-source study fixture is retained as an independently run regression.
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

test('legitimate differently scaled returns still agree without trading authority',()=>{const r=audit(fixture());assert.equal(r.status,'supplier-agreement-unverified');assert.equal(r.canTrade,false);});
test('registered Eastmoney wrappers cannot manufacture two adjusted source votes',()=>{const f=fixture();f.primary.adjustedFeed.provider='eastmoney-public-history';f.secondary.adjustedFeed.provider='efinance';assert.equal(audit(f).reason,'same-or-ambiguous-declared-upstream');});
test('ambiguous multipublisher route does not establish distinct upstream',()=>{const f=fixture();f.primary.adjustedFeed.provider='ashare';assert.equal(audit(f).reason,'same-or-ambiguous-declared-upstream');});
test('index labels sharing a catalogued publisher are refused',()=>{const f=fixture();f.primary.benchmarkFeed.provider='tencent';f.secondary.benchmarkFeed.provider='easyquotation-tencent';assert.equal(audit(f).reason,'same-or-ambiguous-declared-upstream');});
test('different exact index observation instants cannot be compared as one benchmark',()=>{const f=fixture();f.secondary.benchmarkFeed.rows.find(x=>x.date===dates[5]).quoteAt-=1000;const r=audit(f);assert.equal(r.horizons[1].status,'unknown');assert.equal(r.horizons[1].reason,'two-provider-index-observation-times-differ');assert.equal(r.horizons[1].indexReturnDifferenceBps,null);assert.equal(r.horizons[0].status,'supplier-agreement-unverified');});
test('case variants and contradictory explicit registered upstream cannot split votes',()=>{const a=fixture();a.secondary.adjustedFeed.provider=a.primary.adjustedFeed.provider.toUpperCase();assert.equal(audit(a).reason,'same-or-ambiguous-declared-upstream');const b=fixture();b.primary.adjustedFeed.provider='efinance';b.primary.adjustedFeed.upstreamGroup='tencent';assert.equal(audit(b).reason,'same-or-ambiguous-declared-upstream');});
test('real disagreements still block the affected sector',()=>{const f=fixture();f.secondary.adjustedFeed.rows.find(x=>x.symbol==='600001'&&x.date===dates[5]).adjustedLevel*=1.02;const r=audit(f);assert.equal(r.horizons[1].status,'disagreement');assert.equal(r.horizons[1].disagreeingSectors,1);});
