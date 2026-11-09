'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {runOnce:captureOnce}=require('../scripts/factor-eod-capture');
const {runOnce:linkOnce,parse}=require('../scripts/factor-maturity-link');
const {readEpisodeReport,runOnce:shadowOnce}=require('../scripts/factor-shadow-worker');
const {discoverCaptures,firstMaturedArchive,createManifest,hash}=
 require('../src/core/factor-maturity-manifest');
const {readSnapshot}=require('../src/core/forward-tracking-store');
const {verifyAndJoin}=require('../src/core/factor-shadow-evolution');
const dates=['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-09','2026-11-10'];
const at=(d,time='16:04:00')=>Date.parse(d+'T'+time+'+08:00');
const symbols=Array.from({length:5},(_,i)=>'60000'+(i+1));
const feed={source:'imported',provider:'unit-test-only-not-certified',
 datasetId:'same-approved-unadjusted-dataset',priceBasis:'unadjusted'};
const factorSource='unit-feature-only-not-certified';
function market(end){
 return {schemaVersion:1,feed,calendar:dates,asOf:dates[end],
  observedAt:at(dates[end],'16:03:30'),
  stocks:symbols.map((symbol,j)=>({symbol,corporateActions:[],
   bars:dates.slice(0,end+1).map((date,i)=>({
    date,close:10+j+i*.1,volume:100,suspended:false
   }))}))};
}
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-factor-linkage-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const candidates={asOf:at(dates[0],'16:02:45'),board:'all',
  totalScanned:3000,count:5,
  items:symbols.map(code=>({code,hit:[{id:1,text:'EOD provenance rule'}],hitIds:[1]}))};
 const scores={schemaVersion:1,feed:{source:'imported',provider:factorSource,
  datasetId:'unit-signal-features'},
  asOf:at(dates[0],'16:02:00'),
  rows:symbols.map((code,i)=>({code,
   feed:{source:factorSource,timestamp:at(dates[0],'15:00:00')},
   sectorHeatScore:20+i*10,leaderStrengthScore:80-i*10,
   factorEvidence:{
    sectorHeatScore:{source:factorSource,timestamp:at(dates[0],'15:00:00'),code},
    leaderStrengthScore:{source:factorSource,timestamp:at(dates[0],'15:00:00'),code}
   }
  }))};
 const picksFile=path.join(dir,'picks.json'),marketFile=path.join(dir,'market.json'),
  factorFile=path.join(dir,'factors.json'),captureDir=path.join(dir,'private','captures'),
  trackingDir=path.join(dir,'private','tracking'),
  manifestFile=path.join(dir,'private','manifest-current.json');
 fs.writeFileSync(picksFile,JSON.stringify(candidates));
 fs.writeFileSync(marketFile,JSON.stringify(market(0)));
 fs.writeFileSync(factorFile,JSON.stringify(scores));
 const capture=captureOnce({picksFile,marketFile,factorFile,
  outputDir:captureDir,now:at(dates[0])});
 assert.equal(capture.status,'new-frozen-evidence');
 const args={captureDir,marketFile,trackingDir,manifestFile};
 return {dir,args,picksFile,marketFile,factorFile,captureDir,trackingDir,manifestFile};
}
test('capture receipt is individually verified and cannot be substituted for a different day',t=>{
 const f=fixture(t),rows=discoverCaptures(f.captureDir,{now:at(dates[5])});
 assert.equal(rows.length,1);assert.equal(rows[0].date,dates[0]);
 assert.equal(rows[0].features.cohortFingerprint,rows[0].cohort.fingerprint);
 const receipt=path.join(f.captureDir,'receipt-'+dates[0]+'.json');
 const file=JSON.parse(fs.readFileSync(receipt,'utf8'));
 file.cohortFingerprint='a'.repeat(64);
 fs.writeFileSync(receipt,JSON.stringify(file));
 assert.throws(()=>discoverCaptures(f.captureDir,{now:at(dates[5])}),/回执无效/);
});
test('pending H5 is never trained; first sealed mature history is pinned despite later prices',t=>{
 const f=fixture(t),args=f.args;
 fs.writeFileSync(f.marketFile,JSON.stringify(market(1)));
 const early=linkOnce({...args,now:at(dates[1])});
 assert.equal(early.status,'no-matured-5day-observations');
 assert.equal(early.maturedDays,0);
 assert.equal(fs.existsSync(f.manifestFile),false);
 fs.writeFileSync(f.marketFile,JSON.stringify(market(5)));
 const ready=linkOnce({...args,now:at(dates[5])});
 assert.equal(ready.status,'manifest-advanced');
 assert.equal(ready.maturedDays,1);
 assert.equal(ready.trainingReady,false,'one real day cannot train an autonomous factor model');
 const manifest=JSON.parse(fs.readFileSync(f.manifestFile,'utf8'));
 const {integrity,...body}=manifest;
 assert.equal(integrity,hash(body));
 assert.equal(manifest.episodes.length,1);
 const pinned=manifest.episodes[0].reportFile;
 assert.ok(pinned.includes('forward-tracking-history'));
 assert.ok(pinned.includes('00000002-'+dates[5]));
 const sealed=readSnapshot(pinned);
 assert.ok(sealed);
 const feature=JSON.parse(fs.readFileSync(manifest.episodes[0].featuresFile,'utf8'));
 assert.deepEqual(readEpisodeReport(pinned),sealed.report);
 assert.equal(verifyAndJoin(feature,sealed.report,at(dates[5])).length,5);
 assert.ok(verifyAndJoin(feature,sealed.report,at(dates[5]))
  .every(r=>r.returnPct!==null));
 const repeat=linkOnce({...args,now:at(dates[5])});
 assert.equal(repeat.status,'manifest-unchanged');
 assert.equal(fs.readdirSync(path.join(f.dir,'private','factor-manifest-history')).length,1);
 fs.writeFileSync(f.marketFile,JSON.stringify(market(6)));
 const newMarket=linkOnce({...args,now:at(dates[6])});
 assert.equal(newMarket.status,'manifest-unchanged');
 assert.equal(JSON.parse(fs.readFileSync(f.manifestFile,'utf8')).episodes[0].reportFile,pinned);
 assert.equal(fs.readdirSync(path.join(f.trackingDir,dates[0],'forward-tracking-history')).length,3);
 assert.equal(fs.statSync(f.manifestFile).mode&0o777,0o600);
 assert.throws(()=>shadowOnce({manifestFile:f.manifestFile,
  outputDir:path.join(f.dir,'private','models'),now:at(dates[6])}),/完整时间排序研究批次目录/);
});
test('missing authorized symbol or source mismatch blocks manifest refresh and preserves previous version',t=>{
 const f=fixture(t),args=f.args;
 fs.writeFileSync(f.marketFile,JSON.stringify(market(5)));
 linkOnce({...args,now:at(dates[5])});
 const baseline=fs.readFileSync(f.manifestFile,'utf8');
 const incomplete=market(6);incomplete.stocks.pop();
 fs.writeFileSync(f.marketFile,JSON.stringify(incomplete));
 assert.throws(()=>linkOnce({...args,now:at(dates[6])}),/缺少同源授权历史行情/);
 assert.equal(fs.readFileSync(f.manifestFile,'utf8'),baseline);
 const changed=market(6);changed.feed.provider='different-source';
 fs.writeFileSync(f.marketFile,JSON.stringify(changed));
 assert.throws(()=>linkOnce({...args,now:at(dates[6])}),/来源/);
 assert.equal(fs.readFileSync(f.manifestFile,'utf8'),baseline);
});
test('corrupt sealed immutable archive and tampered manifest cannot silently enter shadow training',t=>{
 const f=fixture(t),args=f.args;
 fs.writeFileSync(f.marketFile,JSON.stringify(market(5)));
 linkOnce({...args,now:at(dates[5])});
 const current=JSON.parse(fs.readFileSync(f.manifestFile,'utf8')),history=current.episodes[0].reportFile;
 const corrupted=JSON.parse(fs.readFileSync(history,'utf8'));
 corrupted.report.records[0].windows[1].priceReturnPct=99;
 fs.writeFileSync(history,JSON.stringify(corrupted));
 assert.throws(()=>linkOnce({...args,now:at(dates[5])}),/完整性/);
 const invalid=structuredClone(current);invalid.canTrade=true;
 fs.writeFileSync(f.manifestFile,JSON.stringify(invalid));
 assert.throws(()=>shadowOnce({manifestFile:f.manifestFile,
  outputDir:path.join(f.dir,'private','models'),now:at(dates[5])}),/完整性/);
});
test('manifest contract rejects duplicate days and output cannot be public/symlink or concurrently locked',t=>{
 const f=fixture(t);
 assert.throws(()=>createManifest([
  {day:dates[0],featuresFile:'/private/f1',reportFile:'/private/r1'},
  {day:dates[0],featuresFile:'/private/f2',reportFile:'/private/r2'}
 ]),/重复/);
 const publicFile=path.join(f.dir,'public','training.json');
 assert.throws(()=>parse(['once',f.captureDir,f.marketFile,f.trackingDir,publicFile]),/公开/);
 const alias=path.join(f.dir,'alias');
 fs.symlinkSync(path.join(f.dir,'private'),alias,'dir');
 assert.throws(()=>parse(['once',f.captureDir,f.marketFile,f.trackingDir,
  path.join(alias,'manifest.json')]),/符号链接/);
 assert.equal(parse(['watch',f.captureDir,f.marketFile,f.trackingDir,f.manifestFile,
  '--interval','60000']).interval,60000);
 assert.throws(()=>parse(['watch',f.captureDir,f.marketFile,f.trackingDir,f.manifestFile,
  '--interval','1000']),/轮询/);
 fs.mkdirSync(f.trackingDir,{recursive:true});
 fs.writeFileSync(path.join(f.trackingDir,'.factor-maturity-link.lock'),'active');
 assert.throws(()=>linkOnce({...f.args,now:at(dates[1])}),/禁止并发/);
});
