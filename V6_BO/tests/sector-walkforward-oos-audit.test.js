'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {freezeSectorPriceCohort:freeze,evaluateSectorForwardPrices:evaluate}=
 require('../src/core/sector-frozen-forward-prices');
const {auditSectorWalkForward:audit}=
 require('../src/core/sector-walkforward-oos-audit');
const {main,parse}=require('../scripts/sector-walkforward-oos-audit');
const first='2026-11-10',clock=d=>Date.parse(d+'T10:30:00+08:00');
const dates=[];
for(let i=0;dates.length<85;i++){
 const date=new Date(Date.parse(first+'T00:00:00Z')+i*86400000);
 if(date.getUTCDay()===0||date.getUTCDay()===6)continue;
 dates.push(date.toISOString().slice(0,10));
}
const asOf=clock(dates[80])+2000;
const settings={tradeDates:dates,trainThrough:dates[35],testFrom:dates[50],
 asOf,minTrain:5,minTest:5};
function market(day,{ratios=[1,1,1],version='stable-csrc-classification'}={}){
 const end=clock(day),stocks=[],sectors=[];
 for(let j=0;j<3;j++){
  const members=[];
  for(let i=0;i<5;i++){
   const code=String(600001+j*100+i);
   members.push(code);
   stocks.push({code,pctChange:[4,1,-2][j],vendorQuoteAt:end-5000,
    latestPrice:Number(((10+j+i*.1)*ratios[j]).toFixed(8)),
    volumeLots:200,amount:100000});
  }
  sectors.push({code:'BS_'+j,name:'研究行业'+j,category:'industry',
   memberCount:5,members});
 }
 return {snapshot:{date:day,source:'eastmoney-clist-unverified-live',universeSize:15,
   startedAt:new Date(end-60000).toISOString(),
   retrievedAt:new Date(end).toISOString(),stocks,verifiedLive:false},
  membership:{schemaVersion:1,source:'imported',
   provider:'baostock:query_stock_industry',classificationVersion:version,
   tradeDate:day,observedAt:end-120000,sectors}};
}
function episode(index,{testPeriod=false,version='stable-csrc-classification',missing20=false}={}){
 const baseline=market(dates[index],{version});
 const cohort=freeze(baseline.snapshot,baseline.membership,
  {now:clock(dates[index])+1000});
 const positions=[1,5,20];
 const next=positions.filter(p=>!(missing20&&p===20)).map((p,i)=>{
  const leader=testPeriod?[.98,1.00,1.02][i]:[1.05,1.12,1.08][i];
  const peers=testPeriod?[1.03,1.04,1.05][i]:[1.01,1.02,1.03][i];
  return market(dates[index+p],{version,ratios:[leader,peers,peers]}).snapshot;
 });
 const covered=baseline.snapshot.stocks.map(s=>s.code);
 const corporateActions={schemaVersion:1,source:'imported',
  provider:'operator-unverified-actions',datasetId:'toy-fixture-not-real',
  completed:true,observedAt:asOf-1000,completeThrough:dates[80],
  coveredSymbols:covered,events:[]};
 const observation=evaluate(cohort,next,{
  tradeDates:dates,corporateActions,asOf});
 assert.equal(observation.status,'research-observation-unverified');
 return {cohort,observation};
}
const train=[2,3,4,5,6,34],holdout=[50,51,52,53,54];
const samples=()=>[
 ...train.map(i=>episode(i)),...holdout.map(i=>episode(i,{testPeriod:true}))
];
function run(episodes=samples(),extra={}){
 return audit({...settings,episodes,...extra});
}
test('1/5/20 strict frozen-date split reports reversed leader quality but never promotes raw returns',()=>{
 const episodes=samples(),snapshot=JSON.stringify(episodes),r=run(episodes);
 assert.equal(r.status,'temporal-partition-reviewed-unverified');
 assert.deepEqual(r.panels.map(p=>p.sessions),[1,5,20]);
 assert.deepEqual(r.panels.map(p=>p.testCount),[5,5,5]);
 assert.deepEqual(r.panels.map(p=>p.trainCount),[6,6,5]);
 assert.deepEqual(r.panels[2].purgedTrainDates,[dates[34]]);
 assert.ok(r.panels[0].trainLeaderMinusPeersGrossRawMeanPct>0);
 assert.ok(r.panels[0].testLeaderMinusPeersGrossRawMeanPct<0,
  'the OOS signal becomes worse, not cherry-picked as a win');
 assert.equal(r.panels[0].testPositiveSharePct,0);
 assert.equal(r.panels[0].netExecutionReturnPct,null);
 assert.equal(r.panels[2].marketBenchmarkExcessPct,null);
 assert.equal(r.outOfSampleValidated,false);assert.equal(r.canTrain,false);
 assert.equal(r.canTrade,false);assert.equal(r.weightsChanged,false);
 assert.equal(r.missingIndependentEvidence.length,6);
 assert.equal(JSON.stringify(episodes),snapshot,'pure audit does not mutate inputs');
});
test('purge applies to each horizon at exact test-start, not to unrelated labels',()=>{
 const r=run();
 assert.ok(!r.panels[0].purgedTrainDates.includes(dates[34]));
 assert.ok(!r.panels[1].purgedTrainDates.includes(dates[34]));
 assert.ok(r.panels[2].purgedTrainDates.includes(dates[34]));
 assert.equal(r.panels[0].excludedGapCount,0);
});
test('missing mature target and underpowered test never fabricate independent return observations',()=>{
 const items=samples();
 items[items.length-1]=episode(54,{testPeriod:true,missing20:true});
 const r=run(items);
 assert.equal(r.status,'insufficient-evidence');
 assert.equal(r.panels[0].status,'temporal-split-descriptive-unverified');
 assert.equal(r.panels[2].status,'insufficient-independent-samples');
 assert.equal(r.panels[2].testCount,4);
 assert.deepEqual(r.panels[2].pendingOrUnknownTest.map(x=>x.tradeDate),[dates[54]]);
 assert.equal(r.panels[2].testLeaderMinusPeersGrossRawMeanPct,null);
 assert.equal(r.panels[2].testPositiveSharePct,null);
 assert.equal(r.outOfSampleValidated,false);
});
test('overlapping concept memberships, ambiguous top industry and missing ranked peers cannot inflate samples',()=>{
 const list=samples();
 const bad=structuredClone(list[0]);
 // A concept cannot stand in for an independent industry comparison.
 bad.cohort.sectors[0].category='concept';
 assert.equal(run([bad,...list.slice(1)]).status,'blocked',
  'changing frozen sectors without updating original fingerprint is tampering');
 const unmatched=structuredClone(list);
 unmatched[0].observation.horizons[0].sectors[0].grossRawPriceReturnPct=null;
 assert.equal(run(unmatched).status,'blocked');
});
test('mixed industry versions/provider source and duplicate days cannot be pooled as independent events',()=>{
 const mixed=samples();
 mixed[mixed.length-1]=episode(54,{testPeriod:true,version:'new-bao-classification'});
 const one=run(mixed);
 assert.equal(one.status,'blocked');
 assert.equal(one.reason,'cross-provider-or-classification-version-not-comparable');
 const dup=samples();dup.push(structuredClone(dup[0]));
 assert.equal(run(dup).status,'blocked');
 assert.equal(run(dup).reason,'tampered-duplicate-or-unmatched-frozen-observation');
});
test('tampered cohort price, fingerprint, date or report source is rejected',()=>{
 const tweaks=[
  x=>x[0].cohort.sectors[0].members[0].baselinePrice=999,
  x=>x[0].cohort.sectors[0].rank=999,
  x=>x[0].cohort.frozenAt+=3600000,
  x=>x[0].observation.frozenFingerprint='not-original',
  x=>x[0].observation.source='provider-swap',
  x=>x[0].observation.priceBasis='adjusted-close',
  x=>x[0].observation.canTrain=true,
  x=>x[0].observation.horizons[0].targetDate=dates[4],
  x=>x[0].observation.horizons[0].sectors[0].netReturnPct=5,
  x=>x[0].observation.horizons[0].sectors[0].observedMembers=4
 ];
 for(const change of tweaks){
  const list=samples();change(list);
  const out=run(list);
  assert.equal(out.status,'blocked');
  assert.equal(out.canTrain,false);
 }
});
test('future calendar, reversed split, non-trading duplicates and forged mature outcomes are blocked',()=>{
 assert.equal(run(samples(),{testFrom:dates[34]}).status,'blocked');
 assert.equal(run(samples(),{tradeDates:[dates[0],...dates]}).status,'blocked');
 assert.equal(run(samples(),{testFrom:dates[82],asOf:clock(dates[80])}).status,'blocked');
 const forged=samples();
 forged[0].observation.asOf=clock(dates[2]);
 assert.equal(run(forged).status,'blocked');
 const unavailable=run(samples(),{minTrain:20});
 assert.equal(unavailable.status,'insufficient-evidence');
 assert.ok(unavailable.panels.every(p=>p.testLeaderMinusPeersGrossRawMeanPct===null));
});
test('CLI preview is completely read-only; publish seals immutable private report and blocks conflict',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-sector-oos-'));
 try{
  const input=path.join(dir,'episodes.json'),output=path.join(dir,'out','audit.json');
  fs.writeFileSync(input,JSON.stringify({schemaVersion:1,mode:'sector-walkforward-oos-input',
   episodes:samples(),...settings}));
  const before=fs.readdirSync(dir);
  const a=main(['preview',input]);
  assert.equal(a.status,'temporal-partition-reviewed-unverified');
  assert.equal(a.changed,false);
  assert.deepEqual(fs.readdirSync(dir),before);
  const first=main(['publish',input,output]);
  assert.equal(first.changed,true);
  assert.equal(main(['publish',input,output]).changed,false);
  assert.equal(fs.statSync(output).mode&0o777,0o600);
  const saved=JSON.parse(fs.readFileSync(output,'utf8'));
  assert.equal(saved.mode,'immutable-sector-walkforward-descriptive-audit');
  assert.equal(saved.report.outOfSampleValidated,false);
  assert.equal(saved.report.panels[2].purgedTrainDates[0],dates[34]);
  const edited=JSON.parse(fs.readFileSync(input,'utf8'));
  edited.minTest=8;
  fs.writeFileSync(input,JSON.stringify(edited));
  assert.throws(()=>main(['publish',input,output]),/拒绝覆盖/);
  assert.equal(JSON.parse(fs.readFileSync(output,'utf8')).report.minTest,5);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('CLI never writes blocked input and rejects symlink/public output paths',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-sector-oos-guard-'));
 try{
  const bad=path.join(dir,'bad.json'),out=path.join(dir,'out.json');
  fs.writeFileSync(bad,JSON.stringify({schemaVersion:1,mode:'sector-walkforward-oos-input',
   ...settings,episodes:[]}));
  const x=main(['publish',bad,out]);
  assert.equal(x.status,'blocked');
  assert.equal(fs.existsSync(out),false);
  const link=path.join(dir,'alias.json');fs.symlinkSync(bad,link);
  assert.throws(()=>parse(['preview',link]),/符号链接/);
  assert.throws(()=>parse(['publish',bad,path.join(dir,'public','new.json')]),/公开/);
  assert.throws(()=>parse(['publish',bad,bad]),/覆盖/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
