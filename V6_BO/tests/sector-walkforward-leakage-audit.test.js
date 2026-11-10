'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {freezeSectorPriceCohort:freeze,
 evaluateSectorForwardPrices:evaluate}=require('../src/core/sector-frozen-forward-prices');
const {auditSectorWalkForward:audit}=require('../src/core/sector-walkforward-leakage-audit');
const {main,parse}=require('../scripts/sector-walkforward-audit');
const days=[];
for(let i=0;days.length<80;i++){
 const d=new Date(Date.parse('2026-09-01T00:00:00Z')+i*86400000);
 if(d.getUTCDay()===0||d.getUTCDay()===6)continue;
 days.push(d.toISOString().slice(0,10));
}
const at=d=>Date.parse(d+'T10:30:00+08:00'),atIndex=i=>at(days[i]);
function make(index,ratio=1){
 const date=days[index],end=at(date),start=end-60000;
 const stocks=[],sectors=[];
 for(let j=0;j<3;j++){
  const members=[];
  for(let k=0;k<5;k++){
   const symbol=String(600001+100*j+k);
   members.push(symbol);
   stocks.push({code:symbol,pctChange:[4,1,-2][j],
    latestPrice:Number(((10+j+k*.1)*ratio).toFixed(6)),
    vendorQuoteAt:end-5000,volumeLots:50});
  }
  sectors.push({category:'industry',code:'BS_'+j,name:'sector'+j,
   memberCount:5,members});
 }
 return {
  snapshot:{date,source:'eastmoney-clist-unverified-live',universeSize:15,
   startedAt:new Date(start).toISOString(),retrievedAt:new Date(end).toISOString(),
   verifiedLive:false,stocks},
  membership:{schemaVersion:1,source:'imported',
   provider:'baostock:query_stock_industry',
   classificationVersion:'baostock-csrc-2026-09-01-frozen',
   tradeDate:date,observedAt:start-60000,sectors}
 };
}
const allSymbols=make(0).snapshot.stocks.map(x=>x.code);
function actions(targetIndex){
 return {schemaVersion:1,source:'imported',provider:'operator-action-audit',
  datasetId:'independent-license-unverified',completed:true,
  observedAt:atIndex(targetIndex)+1000,completeThrough:days[targetIndex],
  coveredSymbols:allSymbols,events:[]};
}
function episode(index,{evaluatedIndex=index+20,missing20=false}={}){
 const s=make(index),f=freeze(s.snapshot,s.membership,{now:atIndex(index)+2000});
 const future=[1,5,20].filter(h=>!missing20||h!==20)
  .map(h=>make(index+h,[1.02,1.08,.98][[1,5,20].indexOf(h)]).snapshot);
 const report=evaluate(f,future,{tradeDates:days,
  corporateActions:actions(Math.min(evaluatedIndex,index+20)),
  asOf:atIndex(evaluatedIndex)+3000});
 assert.equal(report.status,'research-observation-unverified');
 return {frozen:f,observation:report};
}
const option={tradeDates:days,trainEnd:days[37],
 validationStart:days[40],validationEnd:days[46],asOf:atIndex(70)};
const sample=()=>[episode(0),episode(12),episode(28),episode(40)];
test('train and validation are time isolated with strict 20-session horizon purge',()=>{
 const episodes=sample(),copy=JSON.stringify({episodes,option});
 const result=audit(episodes,option);
 assert.equal(result.status,'chronological-audit-unverified');
 assert.equal(result.chronologicalSeparationAudited,true);
 assert.equal(result.train.episodes,2);
 assert.equal(result.validation.episodes,1);
 assert.equal(result.exclusion.purgedTwentyDayOverlap,1);
 assert.equal(result.train.fullTwentyDayEpisodes,2);
 assert.equal(result.validation.fullTwentyDayEpisodes,1);
 assert.equal(result.train.horizonStats[0].descriptiveGrossRawReturnMeanPct,2);
 assert.equal(result.validation.horizonStats[1].descriptiveGrossRawReturnMeanPct,8);
 assert.equal(result.validation.horizonStats[2].descriptiveGrossRawReturnMeanPct,-2);
 assert.equal(result.readyForIndependentBenchmarkAndAdjustedPriceReview,true);
 for(const flag of ['canTrain','canTrade','canNotify','autoPromotion',
  'weightsChanged','outOfSampleValidated','labelsAvailable',
  'netReturnsAvailable','statisticalSignificanceCertified']){
  assert.equal(result[flag],false,flag);
 }
 assert.equal(JSON.stringify({episodes,option}),copy);
});
test('exactly 20 sessions before validation start is excluded; no casual overlap',()=>{
 const episodes=[episode(20),episode(21),episode(39),episode(40)];
 const r=audit(episodes,{...option,trainEnd:days[39]});
 assert.equal(r.train.episodes,0);
 assert.equal(r.exclusion.purgedTwentyDayOverlap,3);
 assert.equal(r.validation.episodes,1);
 assert.equal(r.canTrain,false);
});
test('training label created only after validation begins is excluded, not backfilled',()=>{
 const episodes=[episode(0,{evaluatedIndex:50}),episode(40)];
 const r=audit(episodes,option);
 assert.equal(r.status,'chronological-audit-unverified');
 assert.equal(r.exclusion.trainObservedTooLate,1);
 assert.equal(r.train.episodes,0);
 assert.equal(r.validation.episodes,1);
 assert.equal(r.readyForIndependentBenchmarkAndAdjustedPriceReview,false);
});
test('train sample with missing 20-day target is not evidence; validation remains partial',()=>{
 const episodes=[episode(0,{missing20:true}),episode(40,{evaluatedIndex:45,missing20:true})];
 const r=audit(episodes,option);
 assert.equal(r.train.episodes,0);
 assert.equal(r.exclusion.pendingOrIncompleteTrainTwentyDay,1);
 assert.equal(r.validation.episodes,1);
 assert.equal(r.validation.fullTwentyDayEpisodes,0);
 assert.equal(r.exclusion.validationNotYetMature,1);
 assert.equal(r.validation.horizonStats[2].descriptiveGrossRawReturnMeanPct,null);
 assert.equal(r.canTrain,false);
});
test('tampered frozen signal, altered returns, new training claims and fabricated future are blocked',()=>{
 const mutators=[
  e=>e.frozen.sectors[0].members[0].baselinePrice*=2,
  e=>e.frozen.fingerprint='0'.repeat(64),
  e=>e.observation.frozenFingerprint='changed',
  e=>e.observation.horizons[2].sectors[0].grossRawPriceReturnPct=1000,
  e=>e.observation.canTrain=true,
  e=>e.observation.outOfSampleValidated=true,
  e=>e.observation.horizons[2].targetDate=days[79],
  e=>e.observation.horizons[2].sectors[0].netReturnPct=8
 ];
 for(const mutate of mutators){
  const e=episode(0);mutate(e);
  const r=audit([e],option);
  assert.equal(r.status,'blocked');
  assert.equal(r.canTrade,false);
  assert.equal(r.outOfSampleValidated,false);
 }
});
test('duplicate frozen episode, non-calendar signal and invalid split dates block all analysis',()=>{
 const e=episode(0);
 assert.equal(audit([e,e],option).reason,'duplicate-or-unlisted-frozen-signal-day');
 assert.equal(audit([e],{...option,validationStart:days[30],
  trainEnd:days[40]}).status,'blocked');
 assert.equal(audit([e],{...option,tradeDates:[...days.slice(0,20),days[19],
  ...days.slice(20)]}).status,'blocked');
 assert.equal(audit([e],{...option,asOf:atIndex(25)}).status,'blocked',
  'future report must not be used as current evidence');
});
test('upstream corporate-action gaps cannot be promoted as complete outcomes',()=>{
 const e=episode(40);
 e.observation.horizons[1].sectors[0].status='unknown';
 e.observation.horizons[1].sectors[0].reason='corporate-action-evidence-incomplete';
 e.observation.horizons[1].sectors[0].grossRawPriceReturnPct=null;
 e.observation.horizons[1].sectors[0].observedMembers=0;
 e.observation.horizons[1].observedSectorCount=2;
 e.observation.horizons[1].status='partial-or-unknown';
 const r=audit([e],option);
 assert.equal(r.status,'chronological-audit-unverified');
 assert.equal(r.validation.horizonStats[1].unknownEpisodes,1);
 assert.equal(r.validation.horizonStats[1].observedSectors,2);
 assert.equal(r.outOfSampleValidated,false);
});
test('private CLI creates immutable diagnostic, rerun idempotent, conflicts refuse rewriting',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-sector-walk-'));
 try{
  const episodes=path.join(dir,'episodes.json'),split=path.join(dir,'split.json'),
    out=path.join(dir,'diagnostic.json');
  fs.writeFileSync(episodes,JSON.stringify({schemaVersion:1,source:'imported',
   episodes:sample()}));
  fs.writeFileSync(split,JSON.stringify({schemaVersion:1,source:'imported',
   ...option,asOf:undefined}));
  const args=['audit',episodes,split,out];
  const a=main(args,{now:atIndex(70)}),b=main(args,{now:atIndex(70)});
  assert.equal(a.status,'chronological-audit-unverified');
  assert.equal(a.changed,true);assert.equal(b.changed,false);
  const saved=JSON.parse(fs.readFileSync(out,'utf8'));
  assert.equal(saved.audit.canTrain,false);assert.equal(saved.audit.train.episodes,2);
  assert.equal(fs.statSync(out).mode&0o777,0o600);
  const changed=JSON.parse(fs.readFileSync(split,'utf8'));changed.validationEnd=days[50];
  fs.writeFileSync(split,JSON.stringify(changed));
  assert.throws(()=>main(args,{now:atIndex(70)}),/拒绝覆盖/);
  assert.throws(()=>parse(['audit',episodes,split,path.join(dir,'public','out')]),/公开/);
  const alias=path.join(dir,'alias');fs.symlinkSync(split,alias);
  assert.throws(()=>parse(['audit',episodes,alias,out]),/符号链接/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
