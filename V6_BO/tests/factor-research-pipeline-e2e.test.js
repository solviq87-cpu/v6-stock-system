'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {normalizeBaoStockBundle}=require('../src/core/baostock-eod-research-bridge');
const {runOnce:normalizeOnce}=require('../scripts/baostock-eod-research');
const {runOnce:marketOnce}=require('../scripts/authorized-factor-market');
const {runOnce:captureOnce}=require('../scripts/factor-eod-capture');
const {runOnce:trackingOnce}=require('../scripts/factor-maturity-link');
const {runOnce:neutralOnce}=require('../scripts/factor-horizon-neutral');
const {runOnce:shadowOnce}=require('../scripts/factor-shadow-worker');
const {inspect:sourcePreflight}=require('../scripts/factor-source-preflight');
const {inspectResearchChain}=require('../src/core/factor-chain-readiness');
const {verifyCanonicalManifestLineage,hash}=require('../src/core/factor-maturity-manifest');
const {readSnapshot}=require('../src/core/forward-tracking-store');
const {verifyAndJoin}=require('../src/core/factor-shadow-evolution');
const at=(d,time='16:04:00')=>Date.parse(d+'T'+time+'+08:00');
function makeDays(n=47){
 const result=[];let time=Date.parse('2026-08-03T00:00:00Z');
 while(result.length<n){
  const d=new Date(time);
  if(d.getUTCDay()!==0&&d.getUTCDay()!==6)result.push(d.toISOString().slice(0,10));
  time+=86400000;
 }
 return result;
}
const calendar=makeDays(),firstIdx=35,fiveIdx=firstIdx+5,
 symbols=['600001','600002','600003','000001','000002'];
function dataset(index,mutate){
 const asOf=calendar[index],days=calendar.slice(0,index+1);
 const native={
  schemaVersion:1,mode:'baostock-eod-research-export-v1',
  source:'baostock',completed:true,datasetId:'unit-baostock-eod-e2e',
  asOf,observedAt:at(asOf,'16:03:00'),canTrade:false,
  calendar:{source:'baostock:query_trade_dates',errorCode:'0',complete:true,
   startDate:calendar[0],endDate:asOf,observedAt:at(asOf,'16:00:01'),
   tradeDates:days},
  stocks:symbols.map((symbol,j)=>{
   const code=(symbol.startsWith('6')?'sh.':'sz.')+symbol;
   return {code,
    kline:{source:'baostock:query_history_k_data_plus',
     errorCode:'0',complete:true,frequency:'d',adjustflag:'3',
     startDate:calendar[0],endDate:asOf,observedAt:at(asOf,'16:02:00'),
     rows:days.map((date,i)=>{
      const close=(9+j*.25+i*.035+j*i*.0006).toFixed(4);
      return {date,code,open:close,
       high:(Number(close)+.05).toFixed(4),
       low:(Number(close)-.05).toFixed(4),
       close,volume:String(200+i+j),amount:(Number(close)*(200+i+j)).toFixed(4),
       adjustflag:'3',tradestatus:'1'};
     })},
    adjust:{source:'baostock:query_adjust_factor',
     errorCode:'0',complete:true,startDate:calendar[0],endDate:asOf,
     observedAt:at(asOf,'16:02:50'),rows:[]}
   };
  })
 };
 mutate?.(native);
 return native;
}
function candidatesAndFactors(){
 const day=calendar[firstIdx],provider='synthetic-at-signal-factor-source',
  signalTime=at(day,'16:01:15'),sourceTime=at(day,'15:00:00');
 return {
  picks:{asOf:signalTime,board:'all',totalScanned:4000,count:5,
   items:symbols.map(code=>({code,hit:[{id:1,text:'synthetic signal evidence'}],hitIds:[1]}))},
  factors:{schemaVersion:1,feed:{source:'imported',provider,
   datasetId:'synthetic-point-in-time-factors'},
   asOf:at(day,'16:01:10'),
   rows:symbols.map((code,i)=>({
    code,feed:{source:provider,timestamp:sourceTime},
    sectorHeatScore:25+i*10,leaderStrengthScore:80-i*8,
    industryCode:i<3?'SW_A':'SW_B',
    industryEvidence:{source:provider,timestamp:sourceTime,
     classificationVersion:'synthetic-2026',code},
    factorEvidence:{
     sectorHeatScore:{source:provider,timestamp:sourceTime,code},
     leaderStrengthScore:{source:provider,timestamp:sourceTime,code}
    }
   }))}
 };
}
function setup(t){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'v6-research-pipeline-e2e-'));
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const dir=path.join(base,'private'),day=calendar[firstIdx];
 fs.mkdirSync(dir,{recursive:true});
 const files={
  raw:path.join(dir,'baostock-raw.json'),
  history:path.join(dir,'authorized-history.json'),
  market:path.join(dir,'market-current.json'),
  picks:path.join(dir,'picks-current.json'),
  factors:path.join(dir,'factors-current.json'),
  captureDir:path.join(dir,'captures'),
  trackingDir:path.join(dir,'tracking'),
  manifestFile:path.join(dir,'manifest.json'),
  neutralDir:path.join(dir,'neutral'),
  modelDir:path.join(dir,'shadow-models')
 };
 const original=dataset(firstIdx);
 fs.writeFileSync(files.raw,JSON.stringify(original));
 normalizeOnce({file:files.raw,out:files.history,now:at(day)});
 const {picks,factors}=candidatesAndFactors();
 fs.writeFileSync(files.picks,JSON.stringify(picks));
 fs.writeFileSync(files.factors,JSON.stringify(factors));
 const preflight=sourcePreflight({historyFile:files.history,
  picksFile:files.picks,factorsFile:files.factors,now:at(day)});
 assert.equal(preflight.contractReady,true);
 assert.equal(preflight.providerCertified,false);
 marketOnce({sourceFile:files.history,outputFile:files.market,mode:'once',
  now:at(day)});
 return files;
}
const readinessArgs=f=>({
 captureDir:f.captureDir,trackingDir:f.trackingDir,
 manifestFile:f.manifestFile,modelDir:f.modelDir
});
test('real code path: BaoStock source -> normalized history -> preflight -> frozen cohort -> H5 -> immutable manifest -> diagnostic',t=>{
 const f=setup(t),firstDay=calendar[firstIdx],matureDay=calendar[fiveIdx];
 const pre=inspectResearchChain(readinessArgs(f),{now:at(firstDay)});
 assert.equal(pre.status,'no-captured-evidence');
 assert.equal(pre.shadowModelProfitabilityVerified,false);
 assert.equal(pre.authorizedProviderIndependentlyVerified,false);
 assert.equal(pre.readOnly,true);
 const initial=captureOnce({picksFile:f.picks,marketFile:f.market,
  factorFile:f.factors,outputDir:f.captureDir,now:at(firstDay)});
 assert.equal(initial.status,'new-frozen-evidence');
 assert.equal(initial.signals,5);
 assert.deepEqual(initial.selectedFactors,['sector_heat','leader_strength']);
 const noFuture=trackingOnce({captureDir:f.captureDir,marketFile:f.market,
  trackingDir:f.trackingDir,manifestFile:f.manifestFile,now:at(firstDay)});
 assert.equal(noFuture.status,'no-matured-5day-observations');
 assert.equal(fs.existsSync(f.manifestFile),false);
 const pending=inspectResearchChain(readinessArgs(f),{now:at(firstDay)});
 assert.equal(pending.status,'awaiting-h5-observations');
 assert.equal(pending.signalDays,1);
 assert.equal(pending.maturedH5Days,0);
 assert.equal(pending.independentTradingDaysNeeded,36);
 // A later source snapshot must carry same original prices, same market feed
 // and newly observed trading days, never fabricate an old signal.
 const future=dataset(fiveIdx);
 fs.writeFileSync(f.raw,JSON.stringify(future));
 const nextHistory=path.join(path.dirname(f.history),'updated-history.json');
 normalizeOnce({file:f.raw,out:nextHistory,now:at(matureDay)});
 const updated=marketOnce({sourceFile:nextHistory,outputFile:f.market,
  mode:'sync',now:at(matureDay)});
 assert.equal(updated.status,'authorized-contract-adapted');
 const mature=trackingOnce({captureDir:f.captureDir,marketFile:f.market,
  trackingDir:f.trackingDir,manifestFile:f.manifestFile,now:at(matureDay)});
 assert.equal(mature.status,'manifest-advanced');
 assert.equal(mature.maturedDays,1);
 assert.equal(mature.trainingReady,false);
 const archive=JSON.parse(fs.readFileSync(f.manifestFile,'utf8'));
 assert.equal(archive.episodes.length,1);
 assert.ok(archive.episodes[0].reportFile.includes('forward-tracking-history'));
 const saved=readSnapshot(archive.episodes[0].reportFile);
 assert.ok(saved);
 assert.ok(saved.report.records.every(x=>x.windows[1].status==='observed'));
 const features=JSON.parse(fs.readFileSync(archive.episodes[0].featuresFile,'utf8'));
 assert.equal(verifyAndJoin(features,saved.report,at(matureDay)).length,5);
 const lineage=verifyCanonicalManifestLineage(archive,{now:at(matureDay)});
 assert.equal(lineage.status,'canonical-lineage-verified-local-only');
 assert.equal(lineage.verifiedEpisodes,1);
 assert.equal(lineage.authorizedProviderIndependentlyVerified,false);
 assert.equal(lineage.canTrade,false);
 const ready=inspectResearchChain(readinessArgs(f),{now:at(matureDay)});
 assert.equal(ready.status,'insufficient-independent-h5-days');
 assert.equal(ready.signalDays,1);
 assert.equal(ready.maturedH5Days,1);
 assert.equal(ready.manifestDays,1);
 assert.equal(ready.independentTradingDaysNeeded,35);
 assert.equal(ready.eligibleForTraining,false);
 const neutral=neutralOnce({captureDir:f.captureDir,
  trackingDir:f.trackingDir,outDir:f.neutralDir,now:at(matureDay)});
 assert.equal(neutral.status,'research-audit-written');
 assert.equal(neutral.periods.find(x=>x.tradingDays===5).observedSignals,5);
 assert.equal(neutral.periods.find(x=>x.tradingDays===20).observedSignals,0);
 assert.throws(()=>shadowOnce({manifestFile:f.manifestFile,
  outputDir:f.modelDir,now:at(matureDay)}),/完整时间排序/);
 assert.equal(fs.existsSync(f.modelDir),false);
 assert.equal(inspectResearchChain(readinessArgs(f),{now:at(matureDay)}).manifestDays,1);
 // No studied outcome can retroactively modify the frozen signal/features.
 // A day-old signal cannot be re-frozen using a newer, mismatched market.
 // The existing immutable receipt also cannot be silently rewritten.
 assert.throws(()=>captureOnce({picksFile:f.picks,marketFile:f.market,
  factorFile:f.factors,outputDir:f.captureDir,now:at(matureDay)}),
  /回执发生变化|冻结研究证据/);
});
test('a still-valid OHLCV revision is rejected by the market append guard without losing frozen evidence',t=>{
 const f=setup(t),firstDay=calendar[firstIdx],nextDay=calendar[fiveIdx];
 captureOnce({picksFile:f.picks,marketFile:f.market,
  factorFile:f.factors,outputDir:f.captureDir,now:at(firstDay)});
 const original=fs.readFileSync(f.market,'utf8');
 const tampered=dataset(fiveIdx,b=>{
  const row=b.stocks[0].kline.rows[3];
  row.close=(Number(row.close)+.0001).toFixed(4); // still inside OHLC
 });
 fs.writeFileSync(f.raw,JSON.stringify(tampered));
 const evil=path.join(path.dirname(f.history),'evil.json');
 normalizeOnce({file:f.raw,out:evil,now:at(nextDay)});
 assert.throws(()=>marketOnce({sourceFile:evil,outputFile:f.market,mode:'sync',
  now:at(nextDay)}),/回写|改价/);
 assert.equal(fs.readFileSync(f.market,'utf8'),original);
 const state=inspectResearchChain(readinessArgs(f),{now:at(nextDay)});
 assert.equal(state.signalDays,1);
 assert.equal(state.maturedH5Days,0);
 assert.equal(state.manifestDays,0);
});
test('corrupted receipt/manifest and symlink paths never pass the read-only readiness audit',t=>{
 const f=setup(t),d=calendar[firstIdx];
 captureOnce({picksFile:f.picks,marketFile:f.market,
  factorFile:f.factors,outputDir:f.captureDir,now:at(d)});
 const receiptFile=path.join(f.captureDir,'receipt-'+d+'.json'),
  receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
 receipt.inputFingerprint='a'.repeat(64);
 fs.writeFileSync(receiptFile,JSON.stringify(receipt));
 assert.throws(()=>inspectResearchChain(readinessArgs(f),{now:at(d)}),
  /回执无效|回执发生变化/);
 const alias=path.join(path.dirname(f.captureDir),'capture-alias');
 fs.symlinkSync(f.captureDir,alias);
 assert.throws(()=>inspectResearchChain({...readinessArgs(f),captureDir:alias},
  {now:at(d)}),/符号链接/);
});

test('canonical training manifest cannot select a later valid self-sealed H5 file or bypass receipts',t=>{
 const f=setup(t),signalDay=calendar[firstIdx],matureDay=calendar[fiveIdx];
 captureOnce({picksFile:f.picks,marketFile:f.market,
  factorFile:f.factors,outputDir:f.captureDir,now:at(signalDay)});
 const laterRaw=dataset(fiveIdx);
 fs.writeFileSync(f.raw,JSON.stringify(laterRaw));
 const nextHistory=path.join(path.dirname(f.history),'canonical-later-history.json');
 normalizeOnce({file:f.raw,out:nextHistory,now:at(matureDay)});
 marketOnce({sourceFile:nextHistory,outputFile:f.market,mode:'sync',
  now:at(matureDay)});
 trackingOnce({captureDir:f.captureDir,marketFile:f.market,
  trackingDir:f.trackingDir,manifestFile:f.manifestFile,now:at(matureDay)});
 const manifest=JSON.parse(fs.readFileSync(f.manifestFile,'utf8'));
 assert.equal(verifyCanonicalManifestLineage(manifest,{now:at(matureDay)}).verifiedEpisodes,1);
 const signed=episode=>{
  const copy={...manifest,episodes:[episode]};
  delete copy.integrity;
  return {...copy,integrity:hash(copy)};
 };
 const original=manifest.episodes[0];
 const later=path.join(path.dirname(original.reportFile),'99999999-9999-99-99.json');
 fs.copyFileSync(original.reportFile,later);
 const swapped=signed({...original,reportFile:later});
 assert.throws(()=>verifyCanonicalManifestLineage(swapped,{now:at(matureDay)}),
  /最早封存|归档/);
 const current=path.join(f.trackingDir,signalDay,'current.json');
 assert.throws(()=>verifyCanonicalManifestLineage(signed({...original,reportFile:current}),
  {now:at(matureDay)}),/不可变H5|归档/);
 const fakeDir=path.join(path.dirname(f.captureDir),'fake-captures');
 fs.mkdirSync(fakeDir);
 const forged=path.join(fakeDir,'features-'+signalDay+'.json');
 fs.copyFileSync(original.featuresFile,forged);
 assert.throws(()=>verifyCanonicalManifestLineage(signed({...original,featuresFile:forged}),
  {now:at(matureDay)}),/ENOENT|回执|冻结/);
 // Re-hashing a manifest does not repair a changed original receipt.
 const receiptFile=path.join(f.captureDir,'receipt-'+signalDay+'.json');
 const receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
 receipt.inputFingerprint='a'.repeat(64);
 fs.writeFileSync(receiptFile,JSON.stringify(receipt));
 assert.throws(()=>verifyCanonicalManifestLineage(manifest,{now:at(matureDay)}),
  /回执无效|回执发生变化/);
});
