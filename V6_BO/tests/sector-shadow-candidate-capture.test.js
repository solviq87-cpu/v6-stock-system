'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {prepareSectorShadowCandidateCapture,hash}=
 require('../src/core/sector-shadow-candidate-capture');
const {inspectSectorH5DailyReadiness}=
 require('../src/core/sector-h5-evidence-readiness');
const {parse,runOnce,main}=
 require('../scripts/sector-shadow-candidate-capture');
const script=path.resolve(__dirname,'../scripts/sector-shadow-candidate-capture.js');
const tradeDate='2026-11-10',end=Date.parse(tradeDate+'T15:00:00+08:00');
const capturedAt=end+60000,late=end+6*60000;
const tradeDates=['2026-11-10','2026-11-11','2026-11-12',
 '2026-11-13','2026-11-16','2026-11-17'];
function source(){
 const stocks=[],sectors=[];
 for(let g=0;g<3;g++){
  const members=[];
  for(let j=0;j<5;j++){
   const code=String(600001+g*100+j);
   members.push(code);
   stocks.push({code,pctChange:[4,1,-2][g]+j*.03,
    vendorQuoteAt:end-5000});
  }
  sectors.push({category:'industry',code:'BS_'+g,name:'industry'+g,
   memberCount:members.length,members});
 }
 return {
  snapshot:{date:tradeDate,source:'eastmoney-clist-unverified-live',
   universeSize:stocks.length,stocks,
   startedAt:new Date(end-60000).toISOString(),
   retrievedAt:new Date(end).toISOString()},
  membership:{schemaVersion:1,source:'imported',
   provider:'baostock:query_stock_industry',
   classificationVersion:'operator-version-20261110',
   tradeDate,observedAt:end-120000,sectors}
 };
}
function files(t,s=source()){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-sector-candidate-freeze-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const snapshotFile=path.join(root,'raw-quote.json'),
  membershipFile=path.join(root,'industry.json'),
  outputDir=path.join(root,'sealed'),
  outputFile=path.join(outputDir,'candidate-'+tradeDate+'.json');
 fs.writeFileSync(snapshotFile,JSON.stringify(s.snapshot),{mode:0o600});
 fs.writeFileSync(membershipFile,JSON.stringify(s.membership),{mode:0o600});
 return {root,snapshotFile,membershipFile,outputDir,outputFile,
  args:['once',snapshotFile,membershipFile,outputDir]};
}
test('fresh same-day source prepares a nontrainable, full-member candidate snapshot',()=>{
 const s=source(),before=JSON.stringify(s);
 const out=prepareSectorShadowCandidateCapture(s.snapshot,s.membership,
  {now:capturedAt});
 assert.equal(out.status,'candidate-freeze-prepared-unverified');
 assert.equal(out.capture.candidateCapturedAt,capturedAt);
 assert.equal(out.capture.entry.preflightAsOf,end);
 assert.equal(out.capture.entry.preflight.status,'shadow-input-preview-unverified');
 assert.equal(out.capture.entry.industries.length,0);
 assert.equal(out.rankedIndustries,3);
 assert.equal(out.canCreatePriceCohort,false);
 assert.equal(out.capture.prospectiveCertified,false);
 assert.equal(out.canTrain,false);
 assert.equal(out.canTrade,false);
 assert.equal(JSON.stringify(s),before);
});
test('private capture creates exactly one write-once file, then reuses it unchanged after freshness expires',t=>{
 const f=files(t),conf=parse(f.args);
 const first=runOnce(conf,{now:capturedAt});
 assert.equal(first.status,'same-day-candidate-captured-unverified');
 assert.equal(first.changed,true);
 assert.equal(first.rankedIndustries,3);
 assert.equal(fs.readdirSync(f.outputDir).length,1);
 const bytes=fs.readFileSync(f.outputFile,'utf8');
 const record=JSON.parse(bytes);
 const {integrity,...body}=record;
 assert.equal(integrity,hash(body));
 assert.equal(integrity,first.captureIntegrity);
 assert.match(record.sourceDigests.snapshotSha256,/^[0-9a-f]{64}$/);
 assert.equal(record.entry.preflight.shadowSample.sectors.length,3);
 assert.equal(record.entry.industries.length,0);
 const readiness=inspectSectorH5DailyReadiness(record.entry,
  {tradeDates,asOf:capturedAt});
 assert.equal(readiness.status,'incomplete');
 assert.ok(readiness.sectorStatuses.every(s=>
  s.status==='needs-same-day-cohort-freeze'));
 const next=runOnce(conf,{now:late});
 assert.equal(next.status,'already-frozen-identical');
 assert.equal(next.changed,false);
 assert.equal(fs.readFileSync(f.outputFile,'utf8'),bytes);
 assert.equal(fs.readdirSync(f.outputDir).length,1);
 assert.equal(fs.statSync(f.outputFile).mode&0o777,0o600);
});
test('changed quote, new member version or tampered sealed file must never overwrite originals',t=>{
 const f=files(t);let r=main(f.args,{now:capturedAt});
 assert.equal(r.status,'same-day-candidate-captured-unverified');
 const original=fs.readFileSync(f.outputFile,'utf8');
 const snapshot=JSON.parse(fs.readFileSync(f.snapshotFile,'utf8'));
 snapshot.stocks[0].pctChange+=1;
 fs.writeFileSync(f.snapshotFile,JSON.stringify(snapshot));
 r=main(f.args,{now:late});
 assert.equal(r.status,'blocked');
 assert.equal(r.reason,'existing-candidate-conflicts-with-frozen-original-inputs');
 assert.equal(fs.readFileSync(f.outputFile,'utf8'),original);
 const altered=JSON.parse(original);
 altered.candidateCapturedAt+=1;
 fs.writeFileSync(f.outputFile,JSON.stringify(altered));
 r=main(f.args,{now:late});
 assert.equal(r.reason,'existing-candidate-file-corrupted-or-clock-inconsistent');
});
test('intraday and late-after-hours quote snapshots cannot masquerade as same-day EOD research',()=>{
 for(const hour of ['10:30','16:30']){
  const s=source(),at=Date.parse(tradeDate+'T'+hour+':00+08:00');
  s.snapshot.startedAt=new Date(at-60000).toISOString();
  s.snapshot.retrievedAt=new Date(at).toISOString();
  s.snapshot.stocks.forEach(x=>{x.vendorQuoteAt=at-5000;});
  s.membership.observedAt=at-120000;
  const result=prepareSectorShadowCandidateCapture(s.snapshot,s.membership,
   {now:at+60000});
  assert.equal(result.status,'blocked');
  assert.equal(result.capture,null);
  assert.equal(result.canTrain,false);
 }
});
test('late historical input without existing captured record never creates a faux same-day freeze',t=>{
 const f=files(t),r=main(f.args,{now:late});
 assert.equal(r.status,'blocked');
 assert.equal(r.reason,'requires-fresh-same-day-operator-observation-within-five-minutes');
 assert.equal(fs.existsSync(f.outputDir),false);
 assert.equal(r.canTrain,false);
});
test('stale/missing per-stock provider time, mismatched membership or impossible future clock blocks',t=>{
 for(const modify of [
  s=>{s.snapshot.stocks.slice(0,4).forEach(x=>{x.vendorQuoteAt=null;});},
  s=>{s.snapshot.stocks.forEach(x=>delete x.vendorQuoteAt);},
  s=>{s.membership.tradeDate='2026-11-11';},
  s=>{s.membership.sectors[0].members.push('600999');},
  s=>{s.membership.sectors[0].memberCount=501;},
 ]){
  const s=source();modify(s);
  const f=files(t,s);
  const r=runOnce(parse(f.args),{now:capturedAt});
  assert.equal(r.status,'blocked');
  assert.equal(r.changed,false);
  assert.equal(fs.existsSync(f.outputFile),false);
 }
 const f=files(t),r=runOnce(parse(f.args),{now:end-1000});
 assert.equal(r.status,'blocked');
 assert.equal(fs.existsSync(f.outputDir),false);
});
test('malformed modes, public outputs, symlinked input and duplicate path fail early',t=>{
 const f=files(t);
 for(const args of [
  [],['watch',f.snapshotFile,f.membershipFile,f.outputDir],
  ['once',f.snapshotFile,f.membershipFile,f.outputDir,'--unsafe'],
  ['once',f.snapshotFile,f.snapshotFile,f.outputDir],
  ['once','relative.json',f.membershipFile,f.outputDir],
  ['once',f.snapshotFile,f.membershipFile,path.join(f.root,'public','archive')]
 ])assert.throws(()=>parse(args));
 const alias=path.join(f.root,'quote-alias.json');
 fs.symlinkSync(f.snapshotFile,alias);
 assert.throws(()=>parse(['once',alias,f.membershipFile,f.outputDir]),/symlink/);
});
test('child CLI does not expose raw source or paths and rejects historic-only samples',t=>{
 const f=files(t);
 const result=spawnSync(process.execPath,[script,...f.args],
  {encoding:'utf8',timeout:12000});
 assert.equal(result.status,2);
 const message=JSON.parse(result.stdout.trim());
 assert.equal(message.status,'blocked');
 assert.equal(message.canTrain,false);
 assert.equal(message.canTrade,false);
 assert.equal(result.stdout.includes(f.snapshotFile),false);
 assert.equal(result.stdout.includes('600001'),false);
 assert.equal(fs.existsSync(f.outputDir),false);
 const bad=spawnSync(process.execPath,[script,'once','relative.json',
  f.membershipFile,f.outputDir],{encoding:'utf8',timeout:12000});
 assert.equal(bad.status,1);
 assert.equal(JSON.parse(bad.stderr.trim()).status,'failed-private-input-validation');
 assert.equal(bad.stderr.includes(f.outputDir),false);
});
