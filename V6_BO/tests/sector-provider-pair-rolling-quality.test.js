'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {freezeSectorPriceCohort:freeze,evaluateSectorForwardPrices:evaluate}=
 require('../src/core/sector-frozen-forward-prices');
const {auditSectorPairQuality:audit}=
 require('../src/core/sector-provider-pair-rolling-quality');
const {parse,main}=require('../scripts/sector-provider-pair-quality');
const days=[];
for(let i=0;days.length<110;i++){
 const d=new Date(Date.parse('2026-08-03T00:00:00Z')+i*86400000);
 if(d.getUTCDay()!==0&&d.getUTCDay()!==6)days.push(d.toISOString().slice(0,10));
}
const t=d=>Date.parse(d+'T10:30:00+08:00'),at=i=>t(days[i]);
const asOf=at(75)+3000;
function sample(day,ratio=1){
 const stock=[],sectors=[],end=t(day);
 for(let group=0;group<3;group++){
  const members=[];
  for(let j=0;j<5;j++){
   const sym=String(600001+group*100+j),price=10+group+j*.1;
   members.push(sym);stock.push({code:sym,
    latestPrice:Number((price*ratio).toFixed(6)),volumeLots:50,
    pctChange:[4,1,-2][group],vendorQuoteAt:end-5000});
  }
  sectors.push({category:'industry',code:'BS_'+group,
   name:'行业'+group,members,memberCount:5});
 }
 return {snapshot:{date:day,source:'eastmoney-clist-unverified-live',
  universeSize:15,stocks:stock,startedAt:new Date(end-60000).toISOString(),
  retrievedAt:new Date(end).toISOString(),verifiedLive:false},
  membership:{schemaVersion:1,source:'imported',
   provider:'baostock:query_stock_industry',
   classificationVersion:'baostock-csrc-2026-08-frozen',
   tradeDate:day,observedAt:end-120000,sectors}};
}
const firstRegistered=at(0)-3600000;
function episode(idx){
 const base=sample(days[idx]),frozen=freeze(base.snapshot,base.membership,{now:at(idx)+1000});
 const ratios=[1.04,1.08,.95],horizons=[1,5,20];
 const raws=horizons.map((h,i)=>sample(days[idx+h],ratios[i]).snapshot);
 const observationAt=at(idx+20)+3000;
 const actions={schemaVersion:1,source:'imported',
  provider:'corp-action-supplier',datasetId:'corp-actions-'+idx,
  completed:true,observedAt:observationAt,completeThrough:days[idx+20],
  coveredSymbols:base.snapshot.stocks.map(s=>s.code),events:[]};
 const observation=evaluate(frozen,raws,{tradeDates:days,
  corporateActions:actions,asOf:observationAt});
 assert.equal(observation.status,'research-observation-unverified');
 const adj=[];
 for(const stock of base.snapshot.stocks){
  for(const snap of [base.snapshot,...raws]){
   const row=snap.stocks.find(s=>s.code===stock.code);
   adj.push({symbol:row.code,date:snap.date,rawQuoteAt:row.vendorQuoteAt,
    rawPrice:row.latestPrice,adjustedLevel:row.latestPrice*2,
    basisId:'adjustment-v1',currency:'CNY'});
  }
 }
 const feed={schemaVersion:1,source:'imported',provider:'feed-alpha',
  datasetId:'alpha-'+idx,basisId:'adjustment-v1',
  priceBasis:'provider-total-return-adjusted-intraday-level',
  observedAt:observationAt,completed:true,
  upstreamLicenseIndependentlyVerified:false,rows:adj};
 const index={schemaVersion:1,source:'imported',
  provider:'index-alpha',datasetId:'index-a-'+idx,
  indexCode:'000300',basisId:'index-alpha-v1',currency:'CNY',
  priceBasis:'provider-total-return-index-intraday-level',
  observedAt:observationAt,completed:true,
  upstreamLicenseIndependentlyVerified:false,
  rows:[{date:days[idx],quoteAt:at(idx),level:100,basisId:'index-alpha-v1'},
   ...horizons.map((h,i)=>({date:days[idx+h],quoteAt:at(idx+h),
    level:[103,106,96][i],basisId:'index-alpha-v1'}))]};
 const common={cohort:frozen,observation,rawSnapshots:raws,
  tradeDates:days,corporateActions:actions,asOf:observationAt};
 const primary={...common,adjustedFeed:feed,benchmarkFeed:index};
 const secondary=structuredClone(primary);
 secondary.adjustedFeed.provider='feed-beta';
 secondary.adjustedFeed.datasetId='beta-'+idx;
 secondary.adjustedFeed.basisId='adjustment-beta-v1';
 for(const row of secondary.adjustedFeed.rows){
  row.basisId='adjustment-beta-v1';row.adjustedLevel*=3;
 }
 secondary.benchmarkFeed.provider='index-beta';
 secondary.benchmarkFeed.datasetId='index-b-'+idx;
 secondary.benchmarkFeed.basisId='index-beta-v1';
 for(const row of secondary.benchmarkFeed.rows){
  row.basisId='index-beta-v1';row.level*=10;
 }
 return {primary,secondary,policy:{schemaVersion:1,
  mode:'operator-dual-source-tolerance',declaredAt:firstRegistered,
  maxStockReturnDifferenceBps:20,maxIndexReturnDifferenceBps:10},
  asOf:observationAt};
}
const indices=[0,1,2,3,4];
function fixture(){
 return {episodes:indices.map(episode),
  expectedSignalDates:indices.map(i=>days[i]),tradeDates:days.slice(),
  policy:{schemaVersion:1,mode:'preregistered-sector-provider-pair-quality',
   registeredAt:firstRegistered,minMaturedSessions:3,
   maxDisagreementRatePct:10,maxNonComparableRatePct:20},
  asOf};
}
test('five preregistered historical episodes and three explicit horizons have comparable stats',()=>{
 const f=fixture(),before=JSON.stringify(f),report=audit(f);
 assert.equal(report.status,'pair-quality-reviewed-unverified');
 assert.equal(report.expectedSignalDayCount,5);
 assert.equal(report.receivedEpisodeCount,5);
 for(const h of report.horizons){
  assert.equal(h.status,'descriptive-low-disagreement-unverified');
  assert.equal(h.maturedSignalDays,5);
  assert.equal(h.comparableRatePct,100);
  assert.equal(h.disagreementRatePct,0);
  assert.equal(h.nonComparableRatePct,0);
  assert.equal(h.agreeDays.length,5);
  assert.equal(h.maxObservedIndexGapBps,0);
  assert.equal(h.maxObservedStockGapBps,0);
  assert.equal(h.comparedSectorCount,15);
 }
 assert.equal(report.identity.indexCode,'000300');
 for(const flag of ['canTrain','canTrade','canNotify','autoPromotion',
  'outOfSampleValidated','netReturnsAvailable','sourceLicenseIndependentlyVerified',
  'providersIndependentlyVerified']){
  assert.equal(report[flag],false,flag);
 }
 assert.equal(JSON.stringify(f),before,'audit must be read-only');
});
test('one real disagreement day is never diluted by agreement days',()=>{
 const f=fixture(),bad=f.episodes[2].secondary.adjustedFeed.rows
  .find(x=>x.symbol==='600001'&&x.date===days[7]);
 bad.adjustedLevel*=1.04;
 const r=audit(f);
 assert.equal(r.status,'pair-quality-watch-unverified');
 assert.equal(r.horizons[1].disagreementDays.length,1);
 assert.equal(r.horizons[1].disagreementRatePct,20);
 assert.equal(r.horizons[1].status,'watch-cross-source-disagreement');
 assert.equal(r.horizons[0].status,'descriptive-low-disagreement-unverified');
 assert.equal(r.horizons[1].agreedSectors,undefined);
 assert.equal(r.canTrade,false);
});
test('missing scheduled signal-day archives count against coverage rather than cherry-picked samples',()=>{
 const f=fixture();f.episodes=f.episodes.filter(x=>
  x.primary.cohort.tradeDate!==days[2]&&x.primary.cohort.tradeDate!==days[4]);
 const r=audit(f);
 assert.equal(r.status,'pair-quality-watch-unverified');
 assert.equal(r.horizons[2].missingEpisodeDays.length,2);
 assert.deepEqual(r.horizons[2].missingEpisodeDays,[days[2],days[4]]);
 assert.equal(r.horizons[2].comparableRatePct,60);
 assert.equal(r.horizons[2].nonComparableRatePct,40);
 assert.equal(r.horizons[2].disagreementRatePct,0);
 assert.equal(r.horizons[2].status,'watch-coverage-or-stale-data');
});
test('one unknown or partial later window is a noncomparable signal-day episode',()=>{
 const f=fixture(),e=f.episodes[0];
 e.secondary.adjustedFeed.rows=e.secondary.adjustedFeed.rows.filter(x=>
  !(x.symbol==='600001'&&x.date===days[20]));
 const r=audit(f);
 assert.equal(r.status,'pair-quality-reviewed-unverified',
  '20pct missing is allowed at policy threshold; not mislabeled full coverage');
 assert.equal(r.horizons[2].unknownOrPartialDays.length,1);
 assert.equal(r.horizons[2].nonComparableRatePct,20);
 assert.equal(r.horizons[2].comparableRatePct,80);
 assert.equal(r.horizons[2].status,'descriptive-low-disagreement-unverified');
});
test('the as-of date matures only explicit trading days; future samples are pending, not failures',()=>{
 const f=fixture();
 f.expectedSignalDates.push(days[67]);
 f.expectedSignalDates.sort();
 const r=audit(f);
 assert.equal(r.status,'pair-quality-reviewed-unverified');
 assert.equal(r.horizons[20===20?2:0].notMaturedSignalDays,1);
 assert.equal(r.horizons[2].maturedSignalDays,5);
 assert.equal(r.horizons[2].missingEpisodeDays.length,0);
});
test('insufficient number of mature signals does not generate favorable pair quality',()=>{
 const f=fixture();f.policy.minMaturedSessions=6;
 const r=audit(f);
 assert.equal(r.status,'insufficient-evidence');
 assert.equal(r.horizons[2].status,'insufficient-matured-signal-days');
 assert.equal(r.outOfSampleValidated,false);
});
test('tampered inputs, duplicate/unknown dates, provider drift or changed tolerance block',()=>{
 const cases=[
  f=>f.episodes.push(f.episodes[0]),
  f=>f.episodes[1].primary.cohort.fingerprint='0'.repeat(64),
  f=>f.episodes[1].secondary.benchmarkFeed.provider='other-index-provider',
  f=>f.episodes[1].policy.maxStockReturnDifferenceBps=40,
  f=>f.policy.registeredAt=at(0)+1000,
  f=>f.tradeDates.splice(3,0,f.tradeDates[2]),
  f=>f.expectedSignalDates.push('2026-08-04'),
  f=>f.episodes[2].asOf=asOf+600000,
  f=>f.episodes[3].secondary.rawSnapshots[0].stocks[0].latestPrice*=1.1
 ];
 for(const modify of cases){
  const f=fixture();modify(f);
  assert.equal(audit(f).status,'blocked',String(modify));
 }
});
test('pair agreement cannot certify each vendor as independently correct or allow self-upgrading',()=>{
 const f=fixture(),r=audit(f);
 assert.equal(r.status,'pair-quality-reviewed-unverified');
 assert.equal(r.approvedSourceForTrading,null);
 assert.equal(r.canTrain,false);
 assert.equal(r.providersIndependentlyVerified,false);
 assert.match(r.note,/不判断哪一家有错/);
});
test('CLI preview is read-only, immutable publication is idempotent, changed report refuses overwrite',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-provider-quality-'));
 try{
  const input=path.join(dir,'manifest.json'),output=path.join(dir,'reports','quality.json');
  const f=fixture();
  fs.writeFileSync(input,JSON.stringify({schemaVersion:1,
   mode:'sector-provider-pair-quality-imported-input',source:'imported',...f}));
  const preview=main(['preview',input],{now:asOf});
  assert.equal(preview.status,'pair-quality-reviewed-unverified');
  assert.equal(preview.changed,false);
  assert.equal(fs.existsSync(path.dirname(output)),false);
  const once=main(['publish',input,output],{now:asOf}),
   twice=main(['publish',input,output],{now:asOf});
  assert.equal(once.changed,true);assert.equal(twice.changed,false);
  const archived=JSON.parse(fs.readFileSync(output,'utf8'));
  assert.equal(archived.report.canTrain,false);
  assert.equal(archived.report.horizons[2].maturedSignalDays,5);
  assert.equal(fs.statSync(output).mode&0o777,0o600);
  const corrupted=JSON.parse(fs.readFileSync(input,'utf8'));
  corrupted.policy.maxDisagreementRatePct=15;
  fs.writeFileSync(input,JSON.stringify(corrupted));
  assert.throws(()=>main(['publish',input,output],{now:asOf}),/拒绝覆盖/);
  assert.throws(()=>parse(['publish',input,path.join(dir,'public','audit.json')]),/公开/);
  const alias=path.join(dir,'alias');fs.symlinkSync(input,alias);
  assert.throws(()=>parse(['preview',alias]),/符号链接/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});


test('partial provider disagreement is an alarm AND non-comparable day, never inflated coverage',()=>{
 const f=fixture(),e=f.episodes[2];
 e.secondary.adjustedFeed.rows=e.secondary.adjustedFeed.rows.filter(x=>
  !(x.symbol==='600001'&&x.date===days[7]));
 e.secondary.adjustedFeed.rows.find(x=>
  x.symbol==='600101'&&x.date===days[7]).adjustedLevel*=1.04;
 const r=audit(f),h=r.horizons[1];
 assert.equal(r.status,'pair-quality-watch-unverified');
 assert.equal(h.status,'watch-partial-evidence-with-observed-disagreement');
 assert.deepEqual(h.partialDisagreementDays,[days[2]]);
 assert.deepEqual(h.unknownOrPartialDays,[days[2]]);
 assert.deepEqual(h.disagreementDays,[],'partial day must not inflate fully comparable disagreement cases');
 assert.equal(h.comparableRatePct,80,'4/5 days are fully comparable');
 assert.equal(h.nonComparableRatePct,20);
 assert.equal(h.disagreementRatePct,0,'disagreement rate uses fully comparable days only');
 assert.equal(h.disagreeingSectorCount,1,'known conflict must be recorded');
 assert.equal(h.unknownSectorCount,1,'missing member must remain unknown');
 assert.equal(r.canTrade,false);
 assert.equal(r.canTrain,false);
});
test('same-session target must wait until 15:15 China time before counting missing coverage',()=>{
 const e=episode(0),policy=fixture().policy;
 const input={episodes:[e],expectedSignalDates:[days[0]],
  tradeDates:days.slice(),policy};
 const morning=audit({...input,asOf:at(20)+3000}).horizons[2];
 assert.equal(morning.notMaturedSignalDays,1);
 assert.equal(morning.maturedSignalDays,0);
 assert.equal(morning.nonComparableRatePct,null);
 const beforeCutoff=audit({...input,asOf:
  Date.parse(days[20]+'T15:14:59+08:00')}).horizons[2];
 assert.equal(beforeCutoff.notMaturedSignalDays,1);
 const afterCutoff=audit({...input,asOf:
  Date.parse(days[20]+'T15:15:00+08:00')}).horizons[2];
 assert.equal(afterCutoff.maturedSignalDays,1);
 assert.equal(afterCutoff.agreeDays.length,1);
 assert.equal(afterCutoff.nonComparableRatePct,0);
});


const {prepareSectorPairRegistration,verifySectorPairRegistration,
 verifyRegisteredSectorPairEvidence}=
 require('../src/core/sector-provider-pair-registration');
const {main:registrationMain,parse:registrationParse}=
 require('../scripts/sector-provider-pair-register');
function registeredPlan(evidence){
 const first=evidence.episodes[0],c=first.primary.cohort;
 const a=first.primary.adjustedFeed,b=first.secondary.adjustedFeed;
 const ia=first.primary.benchmarkFeed,ib=first.secondary.benchmarkFeed;
 return {schemaVersion:1,mode:'sector-pair-prospective-registration-plan',
  source:'operator-declared',studyId:'local-prospective-sector-study-2026-08',
  tradeDates:evidence.tradeDates.slice(),
  expectedSignalDates:evidence.expectedSignalDates.slice(),
  identity:{source:c.source,membershipProvider:c.membershipProvider,
   classificationVersion:c.classificationVersion,
   primaryAdjustedProvider:a.provider,secondaryAdjustedProvider:b.provider,
   primaryIndexProvider:ia.provider,secondaryIndexProvider:ib.provider,
   indexCode:ia.indexCode,
   maxStockReturnDifferenceBps:first.policy.maxStockReturnDifferenceBps,
   maxIndexReturnDifferenceBps:first.policy.maxIndexReturnDifferenceBps},
  policy:{schemaVersion:1,mode:'preregistered-sector-provider-pair-quality',
   minMaturedSessions:evidence.policy.minMaturedSessions,
   maxDisagreementRatePct:evidence.policy.maxDisagreementRatePct,
   maxNonComparableRatePct:evidence.policy.maxNonComparableRatePct}};
}
const registerNow=firstRegistered-1000;
test('registered private output refuses exposed directories and preserves write-once contents',t=>{
 const {immutable,read}=require('../scripts/sector-provider-pair-register');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-register-private-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const exposed=path.join(dir,'exposed');fs.mkdirSync(exposed,{mode:0o755});
 fs.chmodSync(exposed,0o755); // Do not let the runner's private umask hide this fixture.
 const file=path.join(exposed,'receipt.json');
 assert.throws(()=>immutable(file,'{}\n'),/0700私有/);
 assert.equal(fs.existsSync(file),false);
 fs.chmodSync(exposed,0o700);
 assert.equal(immutable(file,'{}\n'),true);
 assert.equal(immutable(file,'{}\n'),false);
 assert.throws(()=>immutable(file,'{"changed":true}\n'),/不可覆盖/);
 assert.deepEqual(read(file),{});
 assert.equal(fs.statSync(file).mode&0o777,0o600);
 const alias=path.join(dir,'alias');fs.symlinkSync(file,alias);
 assert.throws(()=>read(alias),/符号链接/);
});
function registeredFixture(){
 const evidence=fixture(),plan=registeredPlan(evidence);
 const result=prepareSectorPairRegistration(plan,{now:registerNow});
 assert.equal(result.status,'locally-registered-unverified');
 evidence.policy={...result.receipt.policy};
 return {plan,receipt:result.receipt,evidence};
}
test('locally prospective receipt binds complete dates, pair identity and thresholds',()=>{
 const {plan,receipt,evidence}=registeredFixture();
 const check=verifySectorPairRegistration(receipt,{asOf});
 assert.equal(check.status,'local-receipt-integrity-only');
 const result=verifyRegisteredSectorPairEvidence(receipt,{
  schemaVersion:1,mode:'sector-provider-pair-quality-imported-input',
  source:'imported',...evidence},{now:asOf+1000});
 assert.equal(result.status,'pair-quality-reviewed-unverified');
 assert.equal(result.localReceiptMatched,true);
 assert.equal(result.expectedSignalDays,5);
 assert.equal(result.receivedEpisodeCount,5);
 assert.equal(result.quality.horizons[2].comparableRatePct,100);
 assert.equal(result.receiptIntegrity,receipt.integrity);
 assert.equal(result.canTrain,false);
 assert.equal(result.canTrade,false);
 assert.equal(result.externallyTimestampCertified,false);
 assert.equal(result.prospectiveCertified,false);
 assert.equal(plan.policy.registeredAt,undefined,'source plan cannot choose an arbitrary timestamp');
});
test('prospective local receipt rejects registration at 09:30 or later, not backdated',()=>{
 const plan=registeredPlan(fixture());
 for(const now of [firstRegistered,firstRegistered+1,at(3)]){
  const r=prepareSectorPairRegistration(plan,{now});
  assert.equal(r.status,'blocked');
  assert.equal(r.reason,'registration-must-precede-first-expected-session-09-30');
 }
 const forged=structuredClone(plan);
 forged.policy.registeredAt=firstRegistered-86400000;
 assert.equal(prepareSectorPairRegistration(forged,{now:registerNow}).status,'blocked');
});
test('tampering with an already issued receipt or its local clock cannot be accepted',()=>{
 const {receipt}=registeredFixture();
 const edits=[
  r=>r.expectedSignalDates.splice(2,1),
  r=>r.tradeDates.splice(2,1),
  r=>r.policy.maxNonComparableRatePct=30,
  r=>r.identity.secondaryAdjustedProvider='feed-gamma',
  r=>r.registeredAt=at(0),
  r=>r.externallyTimestampCertified=true,
  r=>r.integrity='0'.repeat(64),
  r=>r.unknownRiskApproval=true
 ];
 for(const edit of edits){
  const r=structuredClone(receipt);edit(r);
  assert.equal(verifySectorPairRegistration(r,{asOf}).status,'blocked',String(edit));
 }
});
test('future evidence cannot replace the registered calendar, policy or vendor identity',()=>{
 const {receipt,evidence}=registeredFixture();
 const edits=[
  e=>e.expectedSignalDates.splice(2,1),
  e=>e.tradeDates.splice(2,1),
  e=>e.policy.maxDisagreementRatePct=11,
  e=>e.policy.registeredAt=firstRegistered,
  e=>e.episodes[0].secondary.adjustedFeed.provider='feed-gamma',
  e=>e.episodes[1].policy.maxStockReturnDifferenceBps=30,
  e=>e.episodes[2].primary.cohort.frozenAt=registerNow-1,
  e=>e.asOf=asOf+200000,
  e=>e.episodes.push(e.episodes[0])
 ];
 for(const edit of edits){
  const e=structuredClone(evidence);edit(e);
  const r=verifyRegisteredSectorPairEvidence(receipt,{
   schemaVersion:1,mode:'sector-provider-pair-quality-imported-input',
   source:'imported',...e},{now:asOf+1000});
  assert.equal(r.status,'blocked',String(edit));
 }
});
test('a registered missing signal day remains a coverage loss, not a cherry-picked success',()=>{
 const {receipt,evidence}=registeredFixture();
 evidence.episodes.splice(4,1);
 evidence.episodes.splice(2,1);
 const r=verifyRegisteredSectorPairEvidence(receipt,{
  schemaVersion:1,mode:'sector-provider-pair-quality-imported-input',
  source:'imported',...evidence},{now:asOf+1000});
 assert.equal(r.status,'pair-quality-watch-unverified');
 assert.deepEqual(r.quality.horizons[2].missingEpisodeDays,[days[2],days[4]]);
 assert.equal(r.quality.horizons[2].comparableRatePct,60);
 assert.equal(r.quality.horizons[2].nonComparableRatePct,40);
 assert.equal(r.expectedSignalDays,5);
 assert.equal(r.receivedEpisodeCount,3);
});
test('missing policy, explicit null policy or injected promotion fields fail closed without exceptions',()=>{
 const {receipt,evidence}=registeredFixture();
 const opts={now:asOf+1000};
 for(const modify of [
  e=>delete e.policy,
  e=>e.policy=null,
  e=>e.policy=[],
  e=>e.canTrain=true,
  e=>e.externalVerificationClaim='trusted'
 ]){
  const data={schemaVersion:1,
   mode:'sector-provider-pair-quality-imported-input',
   source:'imported',...structuredClone(evidence)};
  modify(data);
  let result;
  assert.doesNotThrow(()=>{
   result=verifyRegisteredSectorPairEvidence(receipt,data,opts);
  });
  assert.equal(result.status,'blocked');
  assert.equal(result.canTrain,false);
  assert.equal(result.canTrade,false);
 }
});

test('registration CLI writes one 0600 receipt; registered reports are immutable and reproducible',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-registered-pair-'));
 try{
  const {plan,evidence}=registeredFixture();
  const p=path.join(dir,'plan.json'),receipt=path.join(dir,'locked','receipt.json'),
   ev=path.join(dir,'evidence.json'),out=path.join(dir,'research','report.json');
  fs.writeFileSync(p,JSON.stringify(plan));
  fs.writeFileSync(ev,JSON.stringify({schemaVersion:1,
   mode:'sector-provider-pair-quality-imported-input',source:'imported',...evidence}));
  const registered=registrationMain(['register',p,receipt],{now:registerNow});
  assert.equal(registered.status,'locally-registered-unverified');
  assert.equal(registered.changed,true);
  assert.equal(fs.statSync(receipt).mode&0o777,0o600);
  const again=registrationMain(['register',p,receipt],{now:registerNow+3600000});
  assert.equal(again.status,'already-registered-identical');
  assert.equal(again.changed,false);
  const changedPlan=structuredClone(plan);
  changedPlan.expectedSignalDates.splice(1,1);
  fs.writeFileSync(p,JSON.stringify(changedPlan));
  assert.equal(registrationMain(['register',p,receipt],{now:registerNow+3600000}).status,
   'blocked-conflicting-existing-registration');
  assert.equal(registered.receiptIntegrity,JSON.parse(fs.readFileSync(receipt)).integrity);
  const preview=registrationMain(['preview',receipt,ev],{now:asOf+1000});
  assert.equal(preview.status,'pair-quality-reviewed-unverified');
  assert.equal(preview.changed,false);
  assert.equal(fs.existsSync(path.dirname(out)),false);
  const published=registrationMain(['publish',receipt,ev,out],{now:asOf+1000});
  assert.equal(published.changed,true);
  const later=registrationMain(['publish',receipt,ev,out],{now:asOf+86000000});
  assert.equal(later.changed,false,'same evidence cannot rewrite first publication clock');
  const archive=JSON.parse(fs.readFileSync(out,'utf8'));
  assert.equal(archive.report.canTrain,false);
  assert.equal(archive.report.localReceiptMatched,true);
  assert.equal(fs.statSync(out).mode&0o777,0o600);
  const e=JSON.parse(fs.readFileSync(ev,'utf8'));
  e.episodes.pop();
  fs.writeFileSync(ev,JSON.stringify(e));
  assert.throws(()=>registrationMain(['publish',receipt,ev,out],
   {now:asOf+86000000}),/existing-published-quality-evidence-conflicts/);
  assert.throws(()=>registrationParse(['publish',receipt,ev,
   path.join(dir,'public','report.json')]),/公开/);
  const symlink=path.join(dir,'alias.json');
  fs.symlinkSync(receipt,symlink);
  assert.throws(()=>registrationParse(['preview',symlink,ev]),/符号链接/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
