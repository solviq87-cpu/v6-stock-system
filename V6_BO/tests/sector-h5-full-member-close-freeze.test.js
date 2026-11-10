'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {prepareSectorShadowCandidateCapture,hash}=
 require('../src/core/sector-shadow-candidate-capture');
const {freezeSectorH5MemberCloses:freeze}=
 require('../src/core/sector-h5-full-member-close-freeze');
const {evaluateSectorShadowH5PriceLabels:labelH5}=
 require('../src/core/sector-shadow-h5-price-label');
const {inspectSectorH5DailyReadiness:readiness}=
 require('../src/core/sector-h5-evidence-readiness');
const {parse,runOnce,main}=
 require('../scripts/sector-h5-full-member-close-freeze');
const script=path.resolve(__dirname,'../scripts/sector-h5-full-member-close-freeze.js');
const day='2026-11-10',end=Date.parse(day+'T15:00:00+08:00');
const candidateAt=Date.parse(day+'T15:01:00+08:00');
const freezeAt=Date.parse(day+'T16:02:00+08:00');
const future=Date.parse('2026-11-17T17:00:00+08:00');
const dates=['2026-11-10','2026-11-11','2026-11-12',
 '2026-11-13','2026-11-16','2026-11-17'];
const feed={source:'imported',provider:'operator-eod-research-unverified',
 datasetId:'fixed-raw-close-source-v1',priceBasis:'unadjusted'};
function input(){
 const stocks=[],sectors=[],closeStocks=[];
 for(let group=0;group<3;group++){
  const members=[];
  for(let j=0;j<5;j++){
   const symbol=String(600001+group*100+j);
   members.push(symbol);
   stocks.push({code:symbol,pctChange:[4,2,-1][group]+j*.02,
    vendorQuoteAt:end-5000});
   closeStocks.push({symbol,tradeDate:day,close:10+group+j,
    volume:12000,suspended:false,vendorQuoteAt:end+60000});
  }
  sectors.push({category:'industry',code:'BS_'+group,name:'industry'+group,
   memberCount:5,members});
 }
 const snapshot={date:day,source:'eastmoney-clist-unverified-live',
  universeSize:15,startedAt:new Date(end-60000).toISOString(),
  retrievedAt:new Date(end).toISOString(),stocks};
 const membership={schemaVersion:1,source:'imported',
  provider:'baostock:query_stock_industry',tradeDate:day,
  classificationVersion:'frozen-industry-members-20261110-v1',
  observedAt:end-120000,sectors};
 const prepared=prepareSectorShadowCandidateCapture(snapshot,membership,
  {now:candidateAt});
 assert.equal(prepared.status,'candidate-freeze-prepared-unverified');
 const original={...prepared.capture,
  sourceDigests:{snapshotSha256:hash(snapshot),membershipSha256:hash(membership)}};
 const candidate={...original,integrity:hash(original)};
 const prices={schemaVersion:1,mode:'sector-h5-imported-signal-day-eod-closes-unverified',
  tradeDate:day,observedAt:Date.parse(day+'T16:01:30+08:00'),
  feed:{...feed},stocks:closeStocks};
 return {snapshot,membership,candidate,prices};
}
function files(t,data=input()){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-sector-eod-cohort-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const candidateFile=path.join(root,'candidate-'+day+'.json');
 const closeFile=path.join(root,'eod-close.json');
 const outputDir=path.join(root,'archive');
 const outputFile=path.join(outputDir,'cohorts-'+day+'.json');
 fs.writeFileSync(candidateFile,JSON.stringify(data.candidate),{mode:0o600});
 fs.writeFileSync(closeFile,JSON.stringify(data.prices),{mode:0o600});
 return {root,candidateFile,closeFile,outputDir,outputFile,
  args:['once',candidateFile,closeFile,outputDir]};
}
test('all ranked industries and all stocks are frozen on same signal date, without any future return',()=>{
 const data=input(),before=JSON.stringify(data);
 const r=freeze(data.candidate,data.prices,{now:freezeAt});
 assert.equal(r.status,'full-member-close-cohorts-frozen-unverified');
 assert.equal(r.totalMemberCount,15);
 assert.equal(r.rankedIndustryCount,3);
 assert.equal(r.freeze.industries.length,3);
 assert.equal(r.freeze.originalCandidateIntegrity,data.candidate.integrity);
 for(let group=0;group<3;group++){
  const i=r.freeze.industries[group],cohort=i.cohort;
  assert.equal(cohort.mode,'frozen-forward-signal-cohort');
  assert.equal(cohort.frozenAt,freezeAt);
  assert.equal(i.memberCount,5);
  assert.equal(cohort.signals.length,5);
  assert.equal(cohort.signals[0].system,'manual');
  assert.ok(cohort.signals.every(s=>s.signalAt===freezeAt&&
   s.signalDate===day&&s.cohort==='sector-shadow/industry/BS_'+group));
  assert.ok(cohort.signals.every(s=>!Object.hasOwn(s,'priceReturnPct')&&
   !Object.hasOwn(s,'futureBars')));
 }
 assert.equal(r.canTrade,false);assert.equal(r.canTrain,false);
 assert.equal(r.outOfSampleValidated,false);
 assert.equal(r.externallyTimestampCertified,false);
 assert.equal(JSON.stringify(data),before);
});
test('frozen cohorts can be directly used by the existing H5 price label and daily readiness gates',()=>{
 const {candidate,prices,membership,snapshot}=input();
 const result=freeze(candidate,prices,{now:freezeAt});
 const industries=result.freeze.industries.map((rec,g)=>{
  const market={schemaVersion:1,feed:{...feed},asOf:'2026-11-17',
   observedAt:Date.parse('2026-11-17T16:05:00+08:00'),
   calendar:dates,
   stocks:rec.cohort.signals.map(s=>({
    symbol:s.symbol,corporateActions:[],
    bars:[{date:day,close:s.baselineClose,volume:12000,suspended:false},
     {date:'2026-11-17',close:s.baselineClose*(1+[8,2,-3][g]/100),
      volume:12000,suspended:false}]}))};
  const label=labelH5(candidate.entry.preflight,membership,rec.cohort,market,
   {sectorCode:rec.sectorCode,now:future});
  assert.equal(label.status,'gross-h5-label-observed-unverified');
  assert.equal(label.grossMeanReturnPct,[8,2,-3][g]);
  return {sectorCode:rec.sectorCode,cohort:rec.cohort,market,label};
 });
 const entry={snapshot,membership,
  preflightAsOf:candidate.entry.preflightAsOf,
  preflight:candidate.entry.preflight,industries};
 const audit=readiness(entry,{tradeDates:dates,asOf:future});
 assert.equal(audit.status,'ready-for-history-audit-unverified');
 assert.equal(audit.allLabelsReplayed,true);
 assert.equal(audit.rankedIndustries,3);
 assert.equal(audit.canTrain,false);assert.equal(audit.canTrade,false);
});
test('new private archive is 0600, write-once, and retry only verifies identical original freeze',t=>{
 const f=files(t),conf=parse(f.args),initial=runOnce(conf,{now:freezeAt});
 assert.equal(initial.status,'full-industry-close-cohorts-captured-unverified');
 assert.equal(initial.changed,true);
 assert.equal(initial.totalMemberCount,15);
 assert.equal(fs.statSync(f.outputFile).mode&0o777,0o600);
 assert.equal(fs.readdirSync(f.outputDir).length,1);
 const bytes=fs.readFileSync(f.outputFile,'utf8');
 const record=JSON.parse(bytes),{integrity,...payload}=record;
 assert.equal(integrity,hash(payload));
 assert.equal(integrity,initial.archiveIntegrity);
 assert.match(record.candidateFileSha256,/^[a-f0-9]{64}$/);
 const retry=runOnce(conf,{now:freezeAt+24*3600000});
 assert.equal(retry.status,'already-frozen-identical');
 assert.equal(retry.changed,false);
 assert.equal(fs.readFileSync(f.outputFile,'utf8'),bytes);
});
test('changed raw closes and tampered archive cannot replace a previously frozen cohort',t=>{
 const f=files(t),first=main(f.args,{now:freezeAt});
 assert.equal(first.status,'full-industry-close-cohorts-captured-unverified');
 const saved=fs.readFileSync(f.outputFile,'utf8');
 const changed=JSON.parse(fs.readFileSync(f.closeFile,'utf8'));
 changed.stocks[0].close+=0.2;
 fs.writeFileSync(f.closeFile,JSON.stringify(changed));
 const conflict=main(f.args,{now:freezeAt+86400000});
 assert.equal(conflict.status,'blocked');
 assert.equal(conflict.reason,'conflicting-frozen-cohort-or-price-source-cannot-overwrite');
 assert.equal(fs.readFileSync(f.outputFile,'utf8'),saved);
 const modified=JSON.parse(saved);modified.industries[0].cohort.signals[0].baselineClose=99;
 fs.writeFileSync(f.outputFile,JSON.stringify(modified));
 assert.equal(main(f.args,{now:freezeAt+86400000}).reason,
  'corrupted-or-future-frozen-eod-close-archive');
});
test('no historical, pre-16 or late-after-17 new price cohort may be fabricated',t=>{
 for(const now of [freezeAt-4*3600000,freezeAt+2*3600000,
  freezeAt+86400000]){
  const f=files(t),r=main(f.args,{now});
  assert.equal(r.status,'blocked');
  assert.equal(r.changed,false);
  assert.equal(fs.existsSync(f.outputFile),false);
 }
});
test('missing, extra, duplicate, stale, suspended or malformed closes block all sectors',()=>{
 const changes=[
  x=>{x.prices.stocks.pop();},
  x=>{x.prices.stocks.push({...x.prices.stocks[0],symbol:'609999'});},
  x=>{x.prices.stocks[0].symbol=x.prices.stocks[1].symbol;},
  x=>{x.prices.stocks[0].vendorQuoteAt=end-3600000;},
  x=>{x.prices.stocks[0].volume=0;},
  x=>{x.prices.stocks[0].close=0;},
  x=>{x.prices.stocks[0].suspended=true;},
  x=>{x.prices.stocks[0].tradeDate='2026-11-11';},
  x=>{x.prices.stocks[0].bars=[{date:'2026-11-17',close:999}];},
  x=>{x.prices.stocks[0].futureReturnPct=100;},
  x=>{x.prices.futureBars=[];},
  x=>{x.prices.feed.source='simulated';},
  x=>{x.prices.feed.priceBasis='qfq';},
  x=>{x.prices.observedAt=freezeAt-10*60000;},
  x=>{x.prices.observedAt=freezeAt+3600000;},
  x=>{x.candidate.entry.snapshot.stocks[0].pctChange+=0.1;},
  x=>{x.candidate.entry.membership.sectors[0].members[0]='699999';},
  x=>{x.candidate.integrity='a'.repeat(64);},
  x=>{x.candidate.entry.industries.push({sectorCode:'BS_0'});}
 ];
 for(const change of changes){
  const x=input();change(x);
  const r=freeze(x.candidate,x.prices,{now:freezeAt});
  assert.equal(r.status,'blocked',String(change));
  assert.equal(r.freeze,null);
  assert.equal(r.canTrain,false);assert.equal(r.canTrade,false);
 }
});
test('safe CLI refuses public/symlink/duplicate paths and does not leak private filename',t=>{
 const f=files(t);
 assert.throws(()=>parse(['once',f.candidateFile,f.candidateFile,f.outputDir]));
 assert.throws(()=>parse(['watch',f.candidateFile,f.closeFile,f.outputDir]));
 assert.throws(()=>parse(['once','relative.json',f.closeFile,f.outputDir]));
 const alias=path.join(f.root,'close-alias.json');
 fs.symlinkSync(f.closeFile,alias);
 assert.throws(()=>parse(['once',f.candidateFile,alias,f.outputDir]),/symlink/);
 assert.throws(()=>parse(['once',f.candidateFile,f.closeFile,
  path.join(f.root,'public','archive')]),/public/);
 const past=JSON.parse(fs.readFileSync(f.candidateFile,'utf8'));
 past.candidateCapturedAt=Date.parse('2026-10-30T15:01:00+08:00');
 fs.writeFileSync(f.candidateFile,JSON.stringify(past));
 const subprocess=spawnSync(process.execPath,[script,...f.args],
  {encoding:'utf8',timeout:12000});
 assert.equal(subprocess.status,2);
 assert.equal(JSON.parse(subprocess.stdout).status,'blocked');
 assert.equal(subprocess.stdout.includes(f.candidateFile),false);
 assert.equal(subprocess.stdout.includes('600001'),false);
 const invalid=spawnSync(process.execPath,[script,'once','relative.json',
  f.closeFile,f.outputDir],{encoding:'utf8',timeout:12000});
 assert.equal(invalid.status,1);
 assert.equal(JSON.parse(invalid.stderr).status,'failed-private-input-validation');
 assert.equal(invalid.stderr.includes(f.closeFile),false);
});
