'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {freezeSectorPriceCohort:freeze,evaluateSectorForwardPrices:evaluate}
 =require('../src/core/sector-frozen-forward-prices');
const {main,parse}=require('../scripts/sector-forward-price-research');
const day0='2026-11-10';
const at=d=>Date.parse(d+'T10:30:00+08:00');
const days=[day0];
for(let i=1;days.length<23;i++){
 const d=new Date(Date.parse(day0+'T00:00:00Z')+i*86400000);
 if(d.getUTCDay()===0||d.getUTCDay()===6)continue;
 days.push(d.toISOString().slice(0,10));
}
const asOf=at(days[20])+2000;
function make(day,{ratio=1,omit=null,wrongSource=false,stale=null,actions=false}={}){
 const end=at(day),start=end-60000,stocks=[],sectors=[];
 for(let j=0;j<3;j++){
  const members=[];
  for(let i=0;i<5;i++){
   const symbol=String(600001+j*100+i);
   members.push(symbol);
   if(symbol!==omit)stocks.push({
    code:symbol,pctChange:j===0?5:j===1?1:-2,
    latestPrice:10+j+i*.1,
    vendorQuoteAt:symbol===stale?end-360001:end-5000,
    volumeLots:30,amount:10000
   });
  }
  sectors.push({code:'BS_'+j,category:'industry',name:'研究行业'+j,
   memberCount:5,members});
 }
 // Future raw price is expressed as a fixed ratio to the baseline,
 // without changing the original member set or price identity.
 for(const s of stocks)s.latestPrice=Number((s.latestPrice*ratio).toFixed(6));
 const snapshot={source:wrongSource?'unrelated-feed':'eastmoney-clist-unverified-live',
  date:day,universeSize:15,stocks,
  startedAt:new Date(start).toISOString(),retrievedAt:new Date(end).toISOString(),
  verifiedLive:false};
 const membership={schemaVersion:1,source:'imported',provider:'baostock:query_stock_industry',
  classificationVersion:'baostock-csrc-2026-11-09-frozen',
  tradeDate:day,observedAt:start-60000,sectors};
 return {snapshot,membership};
}
const original=()=>make(day0);
const frozen=()=>{const a=original();return freeze(a.snapshot,a.membership,{now:at(day0)+1000});};
function actions(through=days[20]){
 return {schemaVersion:1,source:'imported',provider:'operator-corporate-action-audit',
  datasetId:'provenance-not-independently-certified',completed:true,
  observedAt:at(through)+1000,completeThrough:through,
  coveredSymbols:original().snapshot.stocks.map(s=>s.code),
  events:[]};
}
const snaps=()=>[
 make(days[1],{ratio:1.05}).snapshot,
 make(days[5],{ratio:1.12}).snapshot,
 make(days[20],{ratio:.91}).snapshot
];
const assess=(s=snaps(),opts={})=>evaluate(frozen(),s,{tradeDates:days,
 corporateActions:actions(),asOf,...opts});
test('freeze locks original sectors and original per-stock f124/price without any future lookups',()=>{
 const {snapshot,membership}=original(),before=JSON.stringify({snapshot,membership});
 const f=freeze(snapshot,membership,{now:at(day0)+1000});
 assert.equal(f.sectors.length,3);
 assert.equal(f.sectors[0].members.length,5);
 assert.equal(f.sectors[0].baselinePriceCoveragePct,100);
 assert.equal(f.sectors[0].members[0].baselineQuoteAt,at(day0)-5000);
 assert.match(f.fingerprint,/^[a-f0-9]{64}$/);
 assert.equal(f.priceBasis,'unadjusted-intraday-provider-raw-quote');
 assert.equal(f.canTrain,false);assert.equal(f.outOfSampleValidated,false);
 assert.equal(JSON.stringify({snapshot,membership}),before);
 assert.throws(()=>freeze(snapshot,membership,{now:at(day0)+600001}),/10分钟/);
});
test('1/5/20 explicit trading days mature gross unadjusted observation, never alpha',()=>{
 const f=frozen(),before=JSON.stringify({f,s:snaps(),a:actions()});
 const result=evaluate(f,snaps(),{tradeDates:days,corporateActions:actions(),asOf});
 assert.equal(result.status,'research-observation-unverified');
 assert.deepEqual(result.horizons.map(h=>h.targetDate),[days[1],days[5],days[20]]);
 assert.deepEqual(result.horizons.map(h=>h.status),
  Array(3).fill('descriptive-raw-price-observed-unverified'));
 assert.deepEqual(result.horizons.map(h=>h.sectors[0].grossRawPriceReturnPct),[5,12,-9]);
 assert.equal(result.horizons[2].sectors[0].observedMembers,5);
 assert.equal(result.horizons[2].sectors[0].benchmarkReturnPct,null);
 assert.equal(result.horizons[2].sectors[0].netReturnPct,null);
 assert.equal(result.labelsAvailable,false);assert.equal(result.canTrain,false);
 assert.equal(result.canNotify,false);assert.equal(result.canTrade,false);
 assert.equal(result.outOfSampleValidated,false);
 assert.equal(JSON.stringify({f,s:snaps(),a:actions()}),before);
});
test('future observations cannot mature until exact trading sessions exist',()=>{
 const r=evaluate(frozen(),snaps().slice(0,1),{
  tradeDates:days,corporateActions:actions(),asOf:at(days[1])+2000});
 assert.equal(r.horizons[0].status,'partial-or-unknown',
  'as-of corporate-action attestation comes from the future and is unusable');
 assert.equal(r.horizons[0].sectors[0].reason,'corporate-action-evidence-incomplete');
 assert.equal(r.horizons[1].status,'pending');
 assert.equal(r.horizons[2].status,'pending');
 const early=evaluate(frozen(),[],{tradeDates:days.slice(0,3),asOf:at(days[1])+2000,
  corporateActions:actions(days[1])});
 assert.equal(early.horizons[1].reason,'explicit-future-calendar-too-short');
 assert.equal(early.horizons[0].reason,'target-day-snapshot-missing');
});
test('missing baseline original price, target suspension or a stale quote never becomes a zero-return stock',()=>{
 const src=original();
 delete src.snapshot.stocks[0].latestPrice;
 const incomplete=freeze(src.snapshot,src.membership,{now:at(day0)+1000});
 const a=evaluate(incomplete,snaps(),{tradeDates:days,corporateActions:actions(),asOf});
 assert.equal(a.horizons[0].sectors[0].status,'unknown');
 assert.equal(a.horizons[0].sectors[0].reason,'frozen-baseline-price-or-original-quote-missing');
 const missing=snaps();
 missing[1]=make(days[5],{ratio:1.1,omit:'600001'}).snapshot;
 const m=assess(missing);
 assert.equal(m.horizons[1].sectors[0].reason,'missing-suspended-or-stale-target-quote');
 assert.equal(m.horizons[1].sectors[0].observedMembers,0,'no survivorship-only average');
 const stale=snaps();
 stale[0]=make(days[1],{ratio:1.05,stale:'600001'}).snapshot;
 assert.equal(assess(stale).horizons[0].sectors[0].reason,'missing-suspended-or-stale-target-quote');
 const suspended=snaps();suspended[0].stocks[0].volumeLots=0;
 assert.equal(assess(suspended).horizons[0].sectors[0].status,'unknown');
});
test('an unadjusted corporate action or an uncovered constituent prevents false return math',()=>{
 const action=actions();
 action.events=[{symbol:'600001',date:days[3],type:'cash-dividend'}];
 const r=evaluate(frozen(),snaps(),{tradeDates:days,corporateActions:action,asOf});
 assert.equal(r.horizons[0].sectors[0].grossRawPriceReturnPct,5);
 for(const i of [1,2]){
  assert.equal(r.horizons[i].sectors[0].grossRawPriceReturnPct,null);
  assert.equal(r.horizons[i].sectors[0].reason,'corporate-action-requires-adjusted-price');
 }
 const fewer=actions();fewer.coveredSymbols=fewer.coveredSymbols.slice(1);
 const b=evaluate(frozen(),snaps(),{tradeDates:days,corporateActions:fewer,asOf});
 assert.equal(b.horizons[0].sectors[0].status,'unknown');
 assert.equal(b.horizons[0].sectors[0].reason,'corporate-action-evidence-incomplete');
 assert.equal(assess(snaps(),{corporateActions:null}).horizons[0].sectors[0].status,'unknown');
});
test('classification or quote source drift, day mismatch and unaligned snapshots never earn labels',()=>{
 const mismatch=snaps();mismatch[0]=make(days[1],{ratio:1.1,wrongSource:true}).snapshot;
 assert.equal(assess(mismatch).horizons[0].status,'unknown');
 const wrongTime=snaps();
 wrongTime[0].retrievedAt=new Date(at(days[1])+3600000).toISOString();
 assert.equal(assess(wrongTime).horizons[0].status,'unknown');
 const badPrice=snaps();
 badPrice[0].stocks[0].latestPrice=badPrice[0].stocks[0].latestPrice*50;
 assert.equal(assess(badPrice).horizons[0].sectors[0].reason,
  'raw-price-discontinuity-or-unresolved-corporate-action');
 const dup=assess([snaps()[0],snaps()[0]]);
 assert.equal(dup.status,'blocked');
 assert.equal(dup.reason,'duplicate-unknown-or-future-snapshot');
});
test('tampered frozen sector score, rank, price or identity is rejected even if fingerprint remains',()=>{
 for(const modify of [
  f=>f.sectors[0].score=99,
  f=>f.sectors[0].members[0].baselinePrice=1,
  f=>f.sectors[0].members[0].symbol='999999',
  f=>f.frozenAt=asOf+3600000,
  f=>f.canTrain=true
 ]){
  const f=frozen();modify(f);
  const r=evaluate(f,snaps(),{tradeDates:days,corporateActions:actions(),asOf});
  assert.equal(r.status,'blocked');assert.equal(r.canTrain,false);
 }
});
test('non-trading natural-day gaps, duplicate calendar dates and future timestamps reject mature results',()=>{
 const invalid=days.slice();invalid.splice(2,0,days[1]);
 assert.equal(assess(snaps(),{tradeDates:invalid}).status,'blocked');
 const d=snaps();d.push(make('2027-01-05').snapshot);
 assert.equal(assess(d).status,'blocked');
 const shifted=days.slice();shifted.splice(0,1,'2026-11-09');
 assert.equal(evaluate(frozen(),snaps(),{tradeDates:shifted,
  corporateActions:actions(),asOf}).status,'blocked');
});
test('CLI freeze and evaluate write immutable private cohorts and idempotent dated 1/5/20 reports',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-sector-price-'));
 try{
  const {snapshot,membership}=original(),files=[
   path.join(dir,'base.json'),path.join(dir,'member.json'),path.join(dir,'cohort.json'),
   path.join(dir,'calendar.json'),path.join(dir,'actions.json'),path.join(dir,'snapshots'),
   path.join(dir,'out')
  ];
  fs.writeFileSync(files[0],JSON.stringify(snapshot));
  fs.writeFileSync(files[1],JSON.stringify(membership));
  fs.writeFileSync(files[3],JSON.stringify({source:'imported',tradeDates:days}));
  fs.writeFileSync(files[4],JSON.stringify(actions()));
  const f=main(['freeze',files[0],files[1],files[2]],{now:at(day0)+1000});
  assert.equal(f.status,'frozen-unverified');
  assert.equal(f.changed,true);
  assert.equal(main(['freeze',files[0],files[1],files[2]],{now:at(day0)+1000}).changed,false);
  for(const snap of snaps()){
   const p=path.join(files[5],snap.date);fs.mkdirSync(p,{recursive:true});
   fs.writeFileSync(path.join(p,String(Date.parse(snap.retrievedAt))+'.json'),JSON.stringify(snap));
  }
  const args=['evaluate',files[2],files[5],files[3],files[4],files[6],'--raw-intraday-only'];
  const one=main(args,{now:asOf}),two=main(args,{now:asOf});
  assert.equal(one.changed,true);assert.equal(two.changed,false);
  assert.equal(one.horizons[2].observedSectorCount,3);
  const outfile=path.join(files[6],day0,f.fingerprint,String(asOf)+'.json');
  const saved=JSON.parse(fs.readFileSync(outfile,'utf8'));
  assert.equal(saved.report.canTrain,false);
  assert.equal(saved.report.horizons[2].sectors[0].grossRawPriceReturnPct,-9);
  assert.equal(fs.statSync(files[2]).mode&0o777,0o600);
  assert.equal(fs.statSync(outfile).mode&0o777,0o600);
  const corrupted=snaps()[0];corrupted.stocks[0].latestPrice*=1.1;
  fs.writeFileSync(path.join(files[5],days[1],String(at(days[1]))+'.json'),JSON.stringify(corrupted));
  assert.throws(()=>main(args,{now:asOf}),/拒绝覆盖/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('CLI rejects symlink paths, public paths and wrong price basis before output',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-sector-price-guard-'));
 try{
  const first=path.join(dir,'base.json'),second=path.join(dir,'member.json'),
   out=path.join(dir,'cohort.json'),link=path.join(dir,'alias.json');
  fs.writeFileSync(first,'{}');fs.writeFileSync(second,'{}');fs.symlinkSync(first,link);
  assert.throws(()=>parse(['freeze',link,second,out]),/符号链接/);
  assert.throws(()=>parse(['freeze',first,second,path.join(dir,'public','new.json')]),/公开/);
  assert.throws(()=>parse(['evaluate',out,dir,first,second,path.join(dir,'out'),'--adjusted']),/未复权/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
