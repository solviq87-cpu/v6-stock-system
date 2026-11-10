'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {inspectSectorShadowEligibility}=require('../src/core/sector-shadow-learning-preflight');
const {parse,main,runOnce}=require('../scripts/sector-h5-evidence-readiness');
const script=path.resolve(__dirname,'../scripts/sector-h5-evidence-readiness.js');
const day='2026-10-30',end=Date.parse(day+'T15:00:00+08:00');
const tradeDates=['2026-10-29','2026-10-30','2026-11-02',
 '2026-11-03','2026-11-04','2026-11-05','2026-11-06'];
function specimen(){
 const stocks=[],sectors=[];
 for(let g=0;g<3;g++){
  const members=[];
  for(let j=0;j<5;j++){
   const code=String(600001+g*100+j);members.push(code);
   stocks.push({code,pctChange:[5,1,-2][g]+j*.02,
    vendorQuoteAt:end-5000});
  }
  sectors.push({category:'industry',code:'BS_'+g,name:'ind'+g,
   memberCount:5,members});
 }
 const snapshot={date:day,source:'eastmoney-clist-unverified-live',
  universeSize:15,startedAt:new Date(end-60000).toISOString(),
  retrievedAt:new Date(end).toISOString(),stocks};
 const membership={schemaVersion:1,source:'imported',
  provider:'baostock:query_stock_industry',
  classificationVersion:'freeze-2026-10-30-v1',tradeDate:day,
  observedAt:end-120000,sectors};
 const preflight=inspectSectorShadowEligibility(snapshot,membership,{asOf:end});
 assert.equal(preflight.status,'shadow-input-preview-unverified');
 return {snapshot,membership,preflightAsOf:end,preflight,industries:[]};
}
function makePrivate(t,entry=specimen()){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-h5-readiness-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const evidenceFile=path.join(dir,'day.json'),calendarFile=path.join(dir,'calendar.json');
 const evidence={schemaVersion:1,mode:'sector-h5-single-day-readiness-input-unverified',entry};
 const calendar={schemaVersion:1,mode:'a-share-explicit-trade-calendar-unverified',
  source:'imported',tradeDates};
 fs.writeFileSync(evidenceFile,JSON.stringify(evidence),{mode:0o600});
 fs.writeFileSync(calendarFile,JSON.stringify(calendar),{mode:0o600});
 return {evidenceFile,calendarFile,evidence,calendar,dir};
}
test('single-day private CLI reports the frozen cohort gap without inventing H5',t=>{
 const f=makePrivate(t),time=Date.parse('2026-11-10T12:00:00+08:00');
 const options=['once',f.evidenceFile,f.calendarFile,'--as-of-ms',String(time)];
 const result=main(options,{now:time});
 assert.equal(result.status,'incomplete');
 assert.equal(result.stage,'evidence-incomplete-or-future-pending');
 assert.equal(result.sectorStatuses.length,3);
 assert.ok(result.sectorStatuses.every(x=>x.status==='missing-cohort-cannot-backfill'));
 assert.match(result.evidenceSha256,/^[a-f0-9]{64}$/);
 assert.match(result.calendarSha256,/^[a-f0-9]{64}$/);
 for(const key of ['canTrain','canTrade','canWrite','weightsChanged',
  'outOfSampleValidated'])assert.equal(result[key],false);
 assert.equal(result.allLabelsReplayed,false);
});
test('candidate missing in past cannot be replaced by fresh historical scan',t=>{
 const entry=specimen();delete entry.preflight;
 const f=makePrivate(t,entry);
 const result=runOnce(parse(['once',f.evidenceFile,f.calendarFile]),{
  now:Date.parse('2026-11-10T12:00:00+08:00')});
 assert.equal(result.status,'incomplete');
 assert.equal(result.stage,'past-candidate-not-frozen');
 assert.equal(result.canTrain,false);
});
test('future research clock rejected before opening any private files',t=>{
 const f=makePrivate(t);
 const now=Date.parse('2026-11-10T12:00:00+08:00');
 const conf=parse(['once',f.evidenceFile,f.calendarFile,
  '--as-of-ms',String(now+86400000)]);
 const r=runOnce(conf,{now});
 assert.equal(r.status,'blocked');
 assert.equal(r.reason,'future-research-clock');
});
test('unknown options, symlinks and public paths are not permitted',t=>{
 const f=makePrivate(t);
 for(const opts of [
  ['watch',f.evidenceFile,f.calendarFile],
  ['once',f.evidenceFile,f.calendarFile,'--output','/tmp/out.json'],
  ['once',f.evidenceFile,f.calendarFile,'--as-of-ms','now'],
  ['once',f.evidenceFile,f.evidenceFile],
  ['once','relative/day.json',f.calendarFile],
 ]){
  assert.throws(()=>parse(opts));
 }
 const alias=path.join(f.dir,'alias.json');
 fs.symlinkSync(f.evidenceFile,alias);
 assert.throws(()=>parse(['once',alias,f.calendarFile]),/symlink/);
 const publicDir=path.join(f.dir,'public'),publicFile=path.join(publicDir,'input.json');
 fs.mkdirSync(publicDir);fs.writeFileSync(publicFile,'{}');
 assert.throws(()=>parse(['once',publicFile,f.calendarFile]),/public/);
});
test('real child process gives one bounded JSON status without revealing private input',t=>{
 const f=makePrivate(t),p=spawnSync(process.execPath,
  [script,'once',f.evidenceFile,f.calendarFile],{
   encoding:'utf8',timeout:12000});
 assert.equal(p.status,2);
 const output=JSON.parse(p.stdout.trim());
 assert.equal(output.status,'incomplete');
 assert.equal(output.canTrade,false);
 assert.equal(output.canTrain,false);
 assert.equal(p.stdout.includes(f.evidenceFile),false);
 assert.equal(p.stdout.includes('600001'),false);
 const bad=spawnSync(process.execPath,[script,'once','relative.json',f.calendarFile],{
  encoding:'utf8',timeout:12000});
 assert.equal(bad.status,1);
 assert.equal(JSON.parse(bad.stderr.trim()).status,'failed-private-input-validation');
 assert.equal(bad.stderr.includes(f.calendarFile),false);
});
test('calendar changed to untrusted source and input mode mismatch fail closed',t=>{
 const f=makePrivate(t),time=Date.parse('2026-11-10T12:00:00+08:00');
 let c=JSON.parse(fs.readFileSync(f.calendarFile,'utf8'));
 c.source='simulated';fs.writeFileSync(f.calendarFile,JSON.stringify(c));
 let r=main(['once',f.evidenceFile,f.calendarFile],{now:time});
 assert.equal(r.status,'blocked');
 assert.equal(r.reason,'input-or-calendar-contract-invalid');
 c.source='imported';fs.writeFileSync(f.calendarFile,JSON.stringify(c));
 let d=JSON.parse(fs.readFileSync(f.evidenceFile,'utf8'));
 d.mode='user-claimed-certified';fs.writeFileSync(f.evidenceFile,JSON.stringify(d));
 r=main(['once',f.evidenceFile,f.calendarFile],{now:time});
 assert.equal(r.status,'blocked');
});
