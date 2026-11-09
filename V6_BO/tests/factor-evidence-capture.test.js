'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {captureFactorEpisode}=require('../src/core/factor-evidence-capture');
const {verifyAndJoin}=require('../src/core/factor-shadow-evolution');
const {evaluateForward}=require('../src/core/forward-signal-observer');
const {runOnce,parse,filesFor}=require('../scripts/factor-eod-capture');
const at=(d,time)=>Date.parse(d+'T'+time+'+08:00');
const day='2026-11-09',now=at(day,'16:04:00');
const symbols=Array.from({length:5},(_,i)=>'60000'+(i+1));
function inputs(){
 const priceFeed={source:'imported',provider:'test-not-certified',
  datasetId:'synthetic-eod-market',priceBasis:'unadjusted'};
 const candidates={asOf:at(day,'16:02:45'),board:'all',
  totalScanned:4000,count:5,
  items:symbols.map(code=>({code,name:code,price:999,
   hit:[{id:1,text:'条件1：当时缓存命中证明'}],hitIds:[1]}))};
 const market={schemaVersion:1,feed:priceFeed,asOf:day,
  observedAt:at(day,'16:03:30'),calendar:['2026-11-06',day],
  stocks:symbols.map((symbol,i)=>({symbol,corporateActions:[],
   bars:[{date:'2026-11-06',close:10+i,volume:100,suspended:false},
    {date:day,close:10+i,volume:300,suspended:false}]}))};
 const factorSnapshot={schemaVersion:1,
  feed:{source:'imported',provider:'test-factor-evidence-not-certified',
   datasetId:'synthetic-at-signal'},
  asOf:at(day,'16:02:00'),
  rows:symbols.map((code,i)=>({
   code,feed:{source:'test-factor-evidence-not-certified',
    timestamp:at(day,'15:00:00')},
   sectorHeatScore:20+10*i,leaderStrengthScore:80-10*i,
   cashflowQualityScore:null,
   factorEvidence:{
    sectorHeatScore:{source:'test-factor-evidence-not-certified',
     timestamp:at(day,'15:00:00'),code},
    leaderStrengthScore:{source:'test-factor-evidence-not-certified',
     timestamp:at(day,'15:00:00'),symbol:code}
   }
  })),token:'SECRET_RAW_TOKEN_MUST_NEVER_PUBLISH'};
 return {candidates,market,factorSnapshot};
}
function temp(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-factor-eod-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return dir;
}
test('existing per-stock timestamps and factor scores freeze into a coherent cohort and feature episode',()=>{
 const input=inputs(),r=captureFactorEpisode({...input,now});
 assert.equal(r.cohort.signals.length,5);
 assert.equal(r.features.features.length,5);
 assert.deepEqual(r.features.factors.map(f=>f.id),
  ['sector_heat','leader_strength']);
 assert.equal(r.features.features[0].values.sector_heat,20);
 assert.equal(r.features.features[0].values.leader_strength,80);
 assert.equal(r.features.originalCohortFrozenAt,r.cohort.frozenAt);
 assert.equal(r.features.cohortFingerprint,r.cohort.fingerprint);
 assert.equal(r.eligibleFactorCount,2);
 assert.equal(r.withheldFactorCount,13);
 assert.equal(r.cohort.canTrade,false);
 assert.equal(r.features.canTrade,false);
 assert.ok(!JSON.stringify(r).includes(input.factorSnapshot.token));
 const report=evaluateForward(r.cohort,input.market,{now});
 assert.equal(verifyAndJoin(r.features,report,now).length,5);
});
test('source-mismatch, simulated, future and stale factors never become neutral scores',()=>{
 const base=inputs();
 const mutate=[
  x=>x.factorSnapshot.rows[0].factorEvidence.sectorHeatScore.source='other-vendor',
  x=>x.factorSnapshot.rows[0].factorEvidence.sectorHeatScore.simulated=true,
  x=>x.factorSnapshot.rows[0].factorEvidence.sectorHeatScore.timestamp=at(day,'16:03:10'),
  x=>x.factorSnapshot.rows[0].factorEvidence.sectorHeatScore.timestamp=at('2026-11-06','15:00:00'),
  x=>x.factorSnapshot.rows[0].factorEvidence.leaderStrengthScore.code='000001',
  x=>x.factorSnapshot.rows[0].leaderStrengthScore=null,
  x=>x.factorSnapshot.rows[0].feed.source='simulated',
  x=>x.factorSnapshot.rows[0].feed.timestamp=at(day,'16:03:30'),
  x=>x.factorSnapshot.feed.source='simulated',
  x=>x.factorSnapshot.asOf=at(day,'16:03:00')
 ];
 for(const change of mutate){
  const x=structuredClone(base);change(x);
  assert.throws(()=>captureFactorEpisode({...x,now}),
   undefined, 'invalid evidence must never be silently scored');
 }
});
test('explicit factor list cannot add unavailable factors or mix symbols',()=>{
 const a=inputs();
 a.factorSnapshot.factorIds=['sector_heat','cashflow_quality'];
 assert.throws(()=>captureFactorEpisode({...a,now}),/全覆盖/);
 const b=inputs();b.factorSnapshot.rows[1].code=b.factorSnapshot.rows[0].code;
 assert.throws(()=>captureFactorEpisode({...b,now}),/重复/);
 const c=inputs();c.factorSnapshot.rows.pop();
 assert.throws(()=>captureFactorEpisode({...c,now}),/没有对应/);
 const d=inputs();d.factorSnapshot.rows[0].factorEvidence.leaderStrengthScore.timestamp=now+1000;
 assert.throws(()=>captureFactorEpisode({...d,now}));
});
test('CLI captures an immutable private receipt and repeated watch retries do not retroactively freeze',t=>{
 const dir=temp(t),input=inputs(),files={};
 for(const [name,value] of Object.entries(input)){
  files[name]=path.join(dir,name+'.json');
  fs.writeFileSync(files[name],JSON.stringify(value));
 }
 const outputDir=path.join(dir,'private','records');
 const args={picksFile:files.candidates,marketFile:files.market,
  factorFile:files.factorSnapshot,outputDir,now};
 const first=runOnce(args);
 assert.equal(first.status,'new-frozen-evidence');
 assert.equal(first.signals,5);
 assert.equal(first.withheldFactorCount,13);
 const paths=filesFor(outputDir,day);
 for(const file of Object.values(paths))
  assert.equal(fs.statSync(file).mode&0o777,0o600);
 const content=fs.readFileSync(paths.featuresFile,'utf8');
 assert.ok(!content.includes(input.factorSnapshot.token));
 assert.equal(fs.readdirSync(outputDir).filter(x=>x.endsWith('.json')).length,3);
 const skipped=runOnce({...args,now:now+600000});
 assert.equal(skipped.status,'already-frozen-identical');
 assert.equal(fs.readFileSync(paths.featuresFile,'utf8'),content);
 const changed=structuredClone(input.factorSnapshot);
 changed.rows[0].sectorHeatScore=50;
 fs.writeFileSync(files.factorSnapshot,JSON.stringify(changed));
 assert.throws(()=>runOnce({...args,now:now+600000}),/回执发生变化/);
 assert.equal(fs.readFileSync(paths.featuresFile,'utf8'),content);
});
test('operator must repair partial/corrupt archive, no overwrite or public/symlink output',t=>{
 const dir=temp(t),x=inputs();
 const candidatesFile=path.join(dir,'candidates.json'),
  marketFile=path.join(dir,'market.json'),factorFile=path.join(dir,'factors.json'),
  outputDir=path.join(dir,'protected');
 fs.writeFileSync(candidatesFile,JSON.stringify(x.candidates));
 fs.writeFileSync(marketFile,JSON.stringify(x.market));
 fs.writeFileSync(factorFile,JSON.stringify(x.factorSnapshot));
 const args={picksFile:candidatesFile,marketFile,factorFile,outputDir,now};
 runOnce(args);
 const out=filesFor(outputDir,day);
 fs.unlinkSync(out.receiptFile);
 fs.unlinkSync(out.featuresFile);
 const recovered=runOnce(args);
 assert.equal(recovered.status,'new-frozen-evidence');
 assert.equal(fs.existsSync(out.receiptFile),true);
 fs.appendFileSync(out.cohortFile,'CORRUPT');
 assert.throws(()=>runOnce(args));
 const publicDir=path.join(dir,'public','private');
 assert.throws(()=>runOnce({...args,outputDir:publicDir}),/公开/);
 const alias=path.join(dir,'alias');
 fs.symlinkSync(outputDir,alias,'dir');
 assert.throws(()=>runOnce({...args,outputDir:alias}),/符号链接/);
 assert.equal(parse(['watch',candidatesFile,marketFile,factorFile,outputDir,
  '--interval','15000']).interval,15000);
 assert.throws(()=>parse(['watch',candidatesFile,marketFile,factorFile,outputDir,
  '--interval','500']),/轮询/);
});
