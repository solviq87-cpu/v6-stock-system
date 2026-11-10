'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {inspectSectorShadowEligibility}=require('../src/core/sector-shadow-learning-preflight');
const {freezeCohort}=require('../src/core/forward-signal-observer');
const {evaluateSectorShadowH5PriceLabels}=require('../src/core/sector-shadow-h5-price-label');
const {parse,safePath,readJson,runOnce,main}=require('../scripts/sector-h5-raw-replay-audit');
const script=path.resolve(__dirname,'../scripts/sector-h5-raw-replay-audit.js');
const days=[];
for(let t=Date.parse('2026-01-05T00:00:00Z');days.length<160;t+=86400000){
 const d=new Date(t);
 if(d.getUTCDay()>0&&d.getUTCDay()<6)days.push(d.toISOString().slice(0,10));
}
const time=(d,h='17:00')=>Date.parse(d+'T'+h+':00+08:00');
const feed={source:'imported',provider:'file-only-research-unverified',
 datasetId:'single-static-provider-v1',priceBasis:'unadjusted'};
function fixture(i,returns){
 const d=days[i],h5=days[i+5],end=time(d,'15:00'),
  signalAt=time(d,'16:01'),frozen=time(d,'16:02');
 const sectors=[],stocks=[];
 for(let group=0;group<3;group++){
  const members=[];
  for(let j=0;j<5;j++){
   const code=String(600001+group*100+j);
   members.push(code);stocks.push({code,
    pctChange:[4,1,-2][group]+j*.03,vendorQuoteAt:end-5000});
  }
  sectors.push({category:'industry',code:'BS_'+group,name:'sector'+group,
   memberCount:5,members});
 }
 const snapshot={date:d,source:'eastmoney-clist-unverified-live',
  universeSize:stocks.length,
  startedAt:new Date(end-60000).toISOString(),
  retrievedAt:new Date(end).toISOString(),stocks};
 const membership={schemaVersion:1,source:'imported',
  provider:'baostock:query_stock_industry',
  classificationVersion:'fixed-protocol-v1',
  tradeDate:d,observedAt:end-120000,sectors};
 const preflight=inspectSectorShadowEligibility(snapshot,membership,{asOf:end});
 assert.equal(preflight.status,'shadow-input-preview-unverified');
 const industries=sectors.map((sector,group)=>{
  const signals=sector.members.map((symbol,j)=>({
   signalId:d+'-'+symbol,symbol,signalDate:d,signalAt,
   system:'manual',cohort:'sector-shadow/industry/'+sector.code,
   provenance:'test-only-frozen-payload',
   baselineClose:10+j}));
  const cohort=freezeCohort({schemaVersion:1,feed,signals},{now:frozen});
  const market={schemaVersion:1,feed:{...feed},
   asOf:h5,observedAt:time(h5,'16:05'),
   calendar:days.slice(0,i+6),
   stocks:sector.members.map((symbol,j)=>({
    symbol,corporateActions:[],bars:[
     {date:d,close:10+j,volume:1000,suspended:false},
     {date:h5,close:(10+j)*(1+returns[group]/100),
      volume:1000,suspended:false}]}))};
  const label=evaluateSectorShadowH5PriceLabels(
   preflight,membership,cohort,market,{sectorCode:sector.code,now:time(h5)});
  assert.equal(label.status,'gross-h5-label-observed-unverified');
  return {sectorCode:sector.code,cohort,market,label};
 });
 return {snapshot,membership,preflight,preflightAsOf:end,industries};
}
const evidence=()=>Array.from({length:24},(_,i)=>
 fixture(i*6,i<12?[5,2,-1]:i<18?[3,1,0]:[-2,1,3]));
const asOf=time(days.at(-1));
function privateFiles(t,entries=evidence()){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'v6-sector-h5-private-'));
 t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const batchFile=path.join(folder,'batch.json'),calendarFile=path.join(folder,'calendar.json');
 const payload={schemaVersion:1,mode:'sector-h5-private-raw-batch-unverified',entries};
 const calendar={schemaVersion:1,source:'imported',
  mode:'a-share-explicit-trade-calendar-unverified',tradeDates:days};
 fs.writeFileSync(batchFile,JSON.stringify(payload),{mode:0o600});
 fs.writeFileSync(calendarFile,JSON.stringify(calendar),{mode:0o600});
 return {batchFile,calendarFile,payload,calendar};
}
test('operator private JSON CLI replays every industry then produces a bounded research summary',t=>{
 const p=privateFiles(t),argv=['once',p.batchFile,p.calendarFile,
  '--cost-bps','30','--as-of-ms',String(asOf)];
 const conf=parse(argv),originalBatch=fs.readFileSync(p.batchFile),
  originalCalendar=fs.readFileSync(p.calendarFile);
 const out=main(argv,{now:asOf});
 assert.equal(out.status,'private-raw-replayed-descriptive-unverified');
 assert.equal(out.rawEvidenceReplayed,true);
 assert.equal(out.signalDays,24);
 assert.equal(out.folds.train.signalDays,12);
 assert.equal(out.folds.validation.signalDays,6);
 assert.equal(out.folds.holdout.signalDays,6);
 assert.equal(out.folds.train.averageTopMinusAllAfterCostStressPct,2.7);
 assert.ok(out.folds.holdout.averageTopMinusAllAfterCostStressPct<0);
 assert.match(out.batchSha256,/^[0-9a-f]{64}$/);
 assert.match(out.calendarSha256,/^[0-9a-f]{64}$/);
 assert.match(out.evidenceFingerprint,/^[0-9a-f]{64}$/);
 for(const name of ['canTrain','canTrade','canNotify','autoPromotion',
  'outOfSampleValidated','providerLicenseIndependentlyVerified','weightsChanged'])
  assert.equal(out[name],false,name);
 assert.equal(fs.readFileSync(p.batchFile).toString(),originalBatch.toString());
 assert.equal(fs.readFileSync(p.calendarFile).toString(),originalCalendar.toString());
 assert.deepEqual(runOnce(conf,{now:asOf}),out);
});
test('self-consistent forged H5 label is blocked before any walkforward result appears',t=>{
 const rows=evidence(),l=rows[0].industries[0].label;
 for(const record of l.records)record.priceReturnPct=9;
 l.grossMeanReturnPct=9;l.grossMedianReturnPct=9;
 const p=privateFiles(t,rows);
 const out=main(['once',p.batchFile,p.calendarFile,'--as-of-ms',String(asOf)],{now:asOf});
 assert.equal(out.status,'blocked');
 assert.equal(out.rawEvidenceReplayed,false);
 assert.match(out.reason,/daily-replay-blocked:claimed-h5-label-differs/);
 assert.equal(out.folds,null);
 assert.equal(out.canTrain,false);
});
test('truncated daily materials and fake private calendar are blocked not repaired',t=>{
 const p=privateFiles(t),rows=JSON.parse(fs.readFileSync(p.batchFile,'utf8'));
 rows.entries[0].industries.pop();
 fs.writeFileSync(p.batchFile,JSON.stringify(rows));
 assert.equal(main(['once',p.batchFile,p.calendarFile],{now:asOf}).status,'blocked');
 const calendar=JSON.parse(fs.readFileSync(p.calendarFile,'utf8'));
 calendar.source='simulated';fs.writeFileSync(p.calendarFile,JSON.stringify(calendar));
 assert.equal(main(['once',p.batchFile,p.calendarFile],{now:asOf}).reason,
  'explicit-trading-calendar-contract-invalid');
});
test('private files are required to be bounded, real files, not symbolic links or public assets',t=>{
 const p=privateFiles(t,[]),folder=path.dirname(p.batchFile);
 assert.throws(()=>safePath('relative/batch.json'),/absolute/);
 assert.throws(()=>safePath(path.join(folder,'public','market.json')),/public/);
 const alias=path.join(folder,'alias.json');
 fs.symlinkSync(p.batchFile,alias);
 assert.throws(()=>safePath(alias),/symlink/);
 assert.throws(()=>readJson(alias,1024),/symlink/);
 const huge=path.join(folder,'huge.json');
 fs.writeFileSync(huge,'X'.repeat(1025));
 assert.throws(()=>readJson(huge,1024),/size/);
 assert.throws(()=>readJson(folder,1024),/size/);
 assert.throws(()=>parse(['once',p.batchFile,p.batchFile]),/distinct/);
});
test('invalid modes, unknown options, duplicate cost and future operator clocks fail closed',t=>{
 const p=privateFiles(t,[]);
 for(const argv of [
  [],['watch',p.batchFile,p.calendarFile],
  ['once',p.batchFile,p.calendarFile,'--output','/tmp/forbidden.json'],
  ['once',p.batchFile,p.calendarFile,'--cost-bps','-1'],
  ['once',p.batchFile,p.calendarFile,'--cost-bps','501'],
  ['once',p.batchFile,p.calendarFile,'--cost-bps','30','--cost-bps','50'],
  ['once',p.batchFile,p.calendarFile,'--as-of-ms','now']
 ]) assert.throws(()=>parse(argv));
 const conf=parse(['once',p.batchFile,p.calendarFile,'--as-of-ms',String(asOf+86400000)]);
 assert.equal(runOnce(conf,{now:asOf}).reason,'future-or-invalid-operator-research-clock');
});
test('child CLI emits a single JSON summary and no raw symbols, paths or private contents',t=>{
 const p=privateFiles(t,[]),run=spawnSync(process.execPath,
  [script,'once',p.batchFile,p.calendarFile],{encoding:'utf8',timeout:12000});
 assert.equal(run.status,2);
 const obj=JSON.parse(run.stdout.trim());
 assert.equal(obj.status,'blocked');
 assert.equal(obj.canTrain,false);
 assert.equal(run.stdout.includes(p.batchFile),false);
 assert.equal(run.stdout.includes('600001'),false);
 const wrong=spawnSync(process.execPath,[script,'once','relative.json',p.calendarFile],
  {encoding:'utf8',timeout:12000});
 assert.equal(wrong.status,1);
 assert.equal(JSON.parse(wrong.stderr.trim()).status,'failed-private-input-validation');
 assert.equal(wrong.stderr.includes(p.calendarFile),false);
});
