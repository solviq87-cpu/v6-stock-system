'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {runDailyCycle,validatePaths,runProspectiveShadowResearch}=
 require('../src/core/factor-daily-research-cycle');
const {main,parse}=require('../scripts/factor-daily-research');
const {inspectResearchChain}=require('../src/core/factor-chain-readiness');
const {runOnce:marketOnce}=require('../scripts/authorized-factor-market');
const {runOnce:captureOnce}=require('../scripts/factor-eod-capture');
const {runRegister}=require('../scripts/factor-shadow-worker');
const at=(day,time='16:04:00')=>Date.parse(day+'T'+time+'+08:00');
const days=(()=>{
 const values=[];let t=Date.parse('2026-08-03T00:00:00Z');
 while(values.length<86){
  const d=new Date(t);
  if(d.getUTCDay()!==0&&d.getUTCDay()!==6)
   values.push(d.toISOString().slice(0,10));
  t+=86400000;
 }
 return values;
})();
const currentIndex=35,nextIndex=currentIndex+5;
const stocks=['600001','600002','600003','000001','000002'];
function history(index,{rewriteOld=false}={}){
 const rows=days.slice(0,index+1),asOf=days[index];
 return {schemaVersion:1,source:'imported',provider:'unit-research-only',
  datasetId:'frozen-test-daily',priceBasis:'unadjusted',asOf,
  observedAt:at(asOf,'16:03:00'),
  stocks:stocks.map((symbol,j)=>({symbol,corporateActions:[],
   bars:rows.map((date,i)=>{
    const close=Number((10+j*.2+i*.04+j*i*.0005).toFixed(4));
    const adjusted=rewriteOld&&j===0&&i===3?close+.0001:close;
    return {date,open:close,high:close+.08,low:close-.08,
     close:adjusted,volume:200+i,priceBasis:'unadjusted',
     suspended:false};
   })}))};
}
function initialSignals(index=currentIndex){
 const d=days[index],provider='unit-point-in-time',
  stamp=at(d,'15:00:00');
 return {
  picks:{asOf:at(d,'16:01:15'),board:'all',totalScanned:3200,
   count:stocks.length,items:stocks.map(code=>({
    code,hit:[{id:1,text:'unit synthetic factor probe'}],hitIds:[1]}))},
  factors:{schemaVersion:1,feed:{source:'imported',provider,
    datasetId:'unit-factor-snapshot'},asOf:at(d,'16:01:00'),
   rows:stocks.map((code,j)=>({code,
    feed:{source:provider,timestamp:stamp},
    sectorHeatScore:25+j*10,leaderStrengthScore:80-j*7,
    industryCode:j<3?'SW_A':'SW_B',
    industryEvidence:{code,source:provider,timestamp:stamp,
     classificationVersion:'synthetic-taxonomy-v1'},
    factorEvidence:{
     sectorHeatScore:{code,source:provider,timestamp:stamp},
     leaderStrengthScore:{code,source:provider,timestamp:stamp}
    }
   }))}}
}
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-factor-daily-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const privateDir=path.join(root,'private');
 fs.mkdirSync(privateDir,{recursive:true,mode:0o700});
 const config={
  schemaVersion:1,mode:'v6-factor-daily-research-cycle',
  researchOnly:true,canTrade:false,
  historyFile:path.join(privateDir,'source-history.json'),
  picksFile:path.join(privateDir,'picks.json'),
  factorsFile:path.join(privateDir,'factors.json'),
  marketFile:path.join(privateDir,'market-current.json'),
  captureDir:path.join(privateDir,'captures'),
  trackingDir:path.join(privateDir,'tracking'),
  manifestFile:path.join(privateDir,'manifest-current.json'),
  neutralDir:path.join(privateDir,'neutral'),
  modelDir:path.join(privateDir,'shadow')
 };
 const {picks,factors}=initialSignals();
 fs.writeFileSync(config.historyFile,JSON.stringify(history(currentIndex)));
 fs.writeFileSync(config.picksFile,JSON.stringify(picks));
 fs.writeFileSync(config.factorsFile,JSON.stringify(factors));
 const configFile=path.join(privateDir,'research-config.json');
 fs.writeFileSync(configFile,JSON.stringify(config),{mode:0o600});
 return {root,config,configFile};
}
function freezeDay(config,index){
 const {picks,factors}=initialSignals(index);
 fs.writeFileSync(config.historyFile,JSON.stringify(history(index)));
 fs.writeFileSync(config.picksFile,JSON.stringify(picks));
 fs.writeFileSync(config.factorsFile,JSON.stringify(factors));
 marketOnce({sourceFile:config.historyFile,outputFile:config.marketFile,
  mode:'sync',now:at(days[index])});
 captureOnce({picksFile:config.picksFile,marketFile:config.marketFile,
  factorFile:config.factorsFile,outputDir:config.captureDir,
  now:at(days[index])});
}
function candidateFile(config,manifest){
 const frozen=JSON.parse(fs.readFileSync(manifest.episodes[0].featuresFile,'utf8'));
 const file=path.join(path.dirname(config.historyFile),'candidate.json');
 fs.writeFileSync(file,JSON.stringify(Object.fromEntries(
  frozen.factors.map(f=>[f.id,f.baseWeight*1.02]))));
 return file;
}
test('default preview is completely zero-write, no network or factor state',t=>{
 const {config,configFile}=setup(t),stamp=at(days[currentIndex]);
 const before=fs.readdirSync(path.dirname(configFile)).sort();
 const preview=runDailyCycle(config,{mode:'capture',now:stamp});
 assert.equal(preview.status,'preview-capture-ready');
 assert.equal(preview.applied,false);
 assert.equal(preview.signals,5);
 assert.deepEqual(preview.selectedFactors,['sector_heat','leader_strength']);
 assert.equal(preview.providerRightsIndependentlyVerified,false);
 assert.equal(preview.canTrade,false);
 const viaCLI=main(['capture',configFile],{now:stamp});
 assert.equal(viaCLI.status,'preview-capture-ready');
 assert.deepEqual(fs.readdirSync(path.dirname(configFile)).sort(),before);
 assert.equal(fs.existsSync(config.marketFile),false);
 assert.equal(fs.existsSync(config.captureDir),false);
});
test('operator apply: closed same-day data -> immutable cohort -> H5 pending -> H5 matured -> stable report',t=>{
 const {config}=setup(t),stamp=at(days[currentIndex]);
 const first=runDailyCycle(config,{mode:'capture',apply:true,now:stamp});
 assert.equal(first.status,'research-cycle-completed-not-certified');
 assert.equal(first.applied,true);
 assert.equal(first.stages[0].stage,'authorized-market-sync');
 assert.equal(first.stages[1].stage,'immutable-eod-capture');
 assert.equal(first.stages.at(-1).stage,'read-only-chain-audit');
 assert.equal(first.archivedSignalDays,1);
 assert.equal(first.maturedH5Days,0);
 assert.equal(first.manifestDays,0);
 assert.equal(first.independentTradingDaysNeeded,36);
 assert.equal(first.shadowModelVersion,null);
 assert.equal(fs.statSync(config.marketFile).mode&0o777,0o600);
 assert.equal(fs.readdirSync(config.captureDir).filter(x=>x.startsWith('receipt-')).length,1);
 assert.equal(fs.existsSync(config.manifestFile),false);
 const later=history(nextIndex),matureStamp=at(days[nextIndex]);
 fs.writeFileSync(config.historyFile,JSON.stringify(later));
 const second=runDailyCycle(config,{mode:'observe',apply:true,now:matureStamp});
 assert.equal(second.status,'research-cycle-completed-not-certified');
 assert.equal(second.archivedSignalDays,1);
 assert.equal(second.maturedH5Days,1);
 assert.equal(second.manifestDays,1);
 assert.equal(second.independentTradingDaysNeeded,35);
 assert.ok(second.stages.some(s=>s.stage==='maturity-pinned-history'&&
  s.status==='manifest-advanced'));
 assert.ok(second.stages.some(s=>s.stage==='independent-shadow-model'&&
  s.status==='skipped-insufficient-matured-h5-days'));
 assert.equal(fs.existsSync(config.modelDir),false);
 assert.equal(JSON.parse(fs.readFileSync(config.manifestFile,'utf8')).episodes.length,1);
 const prev=fs.readFileSync(config.manifestFile,'utf8');
 const repeat=runDailyCycle(config,{mode:'observe',apply:true,now:matureStamp});
 assert.equal(repeat.stages[0].status,'unchanged');
 assert.equal(repeat.stages[1].status,'manifest-unchanged');
 assert.equal(repeat.stages[2].status,'unchanged');
 assert.equal(fs.readFileSync(config.manifestFile,'utf8'),prev);
 const audit=inspectResearchChain({
  captureDir:config.captureDir,trackingDir:config.trackingDir,
  manifestFile:config.manifestFile,modelDir:config.modelDir
 },{now:matureStamp});
 assert.equal(audit.status,'insufficient-independent-h5-days');
 assert.equal(audit.eligibleForTraining,false);
});
test('daily cycle requires prospective research even with 36 real matured cohorts; waits survive retry',t=>{
 const {config}=setup(t);
 // Produce real receipt-backed daily captures through the existing writers.
 // Stop freezing signals while the final H5 matures, so an explicit candidate
 // can reserve a clean boundary before any next research signal is frozen.
 for(let i=currentIndex;i<currentIndex+36;i++)freezeDay(config,i);
 const matureIndex=currentIndex+40,now=at(days[matureIndex]);
 fs.writeFileSync(config.historyFile,JSON.stringify(history(matureIndex)));
 const first=runDailyCycle(config,{mode:'observe',apply:true,now});
 assert.equal(first.manifestDays,36);
 const shadow=first.stages.find(s=>s.stage==='independent-shadow-model');
 assert.deepEqual(shadow,{stage:'independent-shadow-model',
  status:'skipped-auto-prereg-needs-sealed-history',
  nextAction:'provide-sealed-prior-research-or-explicit-preregistration'});
 assert.equal(first.shadowModelVersion,null);
 assert.deepEqual(fs.readdirSync(config.modelDir),[]);
 const repeat=runDailyCycle(config,{mode:'observe',apply:true,now:now+1});
 assert.deepEqual(repeat.stages.find(s=>s.stage==='independent-shadow-model'),shadow);
 assert.deepEqual(fs.readdirSync(config.modelDir),[]);
 const manifest=JSON.parse(fs.readFileSync(config.manifestFile,'utf8'));
 const weightsFile=candidateFile(config,manifest);
 const prereg=runRegister({manifestFile:config.manifestFile,
  outputDir:config.modelDir,candidateWeightsFile:weightsFile,now:now+2});
 assert.equal(prereg.status,'candidate-preregistered');
 const before=fs.readdirSync(config.modelDir);
 const waiting=runDailyCycle(config,{mode:'observe',apply:true,now:now+3});
 assert.deepEqual(waiting.stages.find(s=>s.stage==='independent-shadow-model'),{
  stage:'independent-shadow-model',status:'skipped-awaiting-post-prereg-signals',
  nextAction:'await-signals-frozen-after-preregistration'});
 assert.deepEqual(fs.readdirSync(config.modelDir),before);
 assert.equal(waiting.shadowModelVersion,null);
 assert.equal(waiting.canTrade,false);
 assert.equal(waiting.productionWeightsChanged,false);
 assert.equal(fs.existsSync(path.join(config.modelDir,'.shadow-worker.lock')),false);
});
test('canonical registration seals pending captures without opening H5 and waits until true post-registration signals',t=>{
 const {config}=setup(t);
 for(let i=currentIndex;i<currentIndex+41;i++)freezeDay(config,i);
 const lastCapture=currentIndex+40,now=at(days[lastCapture]);
 const initial=runDailyCycle(config,{mode:'observe',apply:true,now});
 assert.equal(initial.archivedSignalDays,41);
 assert.equal(initial.manifestDays,36);
 const manifest=JSON.parse(fs.readFileSync(config.manifestFile,'utf8'));
 const candidateWeightsFile=candidateFile(config,manifest);
 // Invalid actual H5 bytes make any accidental outcome read fail. The
 // registration and early worker wait may inspect only frozen features.
 const h5File=manifest.episodes[0].reportFile,h5Bytes=fs.readFileSync(h5File);
 let registered;
 try{
  fs.writeFileSync(h5File,'H5 must not be opened before prospective eligibility');
  registered=runRegister({manifestFile:config.manifestFile,
   outputDir:config.modelDir,candidateWeightsFile,now:now+1});
  const waiting=runProspectiveShadowResearch(config,now+2);
  assert.equal(waiting.status,'skipped-awaiting-preregistered-prefix-maturity');
  assert.equal(waiting.pendingPrefixDays,5);
  assert.equal(waiting.preregistrationFingerprint,registered.fingerprint);
 }finally{fs.writeFileSync(h5File,h5Bytes);}
 const preregFile=path.join(config.modelDir,
  'prereg-'+registered.fingerprint.slice(0,12)+'.json');
 const prereg=JSON.parse(fs.readFileSync(preregFile,'utf8'));
 assert.equal(prereg.frozenPrefixFingerprints.length,41);
 assert.equal(prereg.latestFrozenSignalDay,days[lastCapture]);
 const before=fs.readdirSync(config.modelDir);
 const cycle=runDailyCycle(config,{mode:'observe',apply:true,now:now+3});
 assert.deepEqual(cycle.stages.find(s=>s.stage==='independent-shadow-model'),{
  stage:'independent-shadow-model',status:'skipped-awaiting-preregistered-prefix-maturity',
  nextAction:'await-preregistered-prefix-h5-maturity',pendingPrefixDays:5});
 assert.deepEqual(fs.readdirSync(config.modelDir),before);
 assert.throws(()=>runProspectiveShadowResearch({...config,
  captureDir:path.join(path.dirname(config.captureDir),'different-capture-dir')},now+4),
  /捕获目录与成熟清单血缘不一致/);
 const receiptFile=path.join(config.captureDir,'receipt-'+days[lastCapture]+'.json');
 const receiptBytes=fs.readFileSync(receiptFile);
 try{
  const corrupt=JSON.parse(receiptBytes);
  corrupt.inputFingerprint='0'.repeat(64);
  fs.writeFileSync(receiptFile,JSON.stringify(corrupt));
  assert.throws(()=>runProspectiveShadowResearch(config,now+4),/捕获回执无效/);
 }finally{fs.writeFileSync(receiptFile,receiptBytes);}
 assert.deepEqual(fs.readdirSync(config.modelDir),before);
 // These five old captures remain part of the registered historical prefix
 // when their H5 matures; they cannot become this candidate's fresh test.
 const matureIndex=lastCapture+5,matureNow=at(days[matureIndex]);
 fs.writeFileSync(config.historyFile,JSON.stringify(history(matureIndex)));
 const matured=runDailyCycle(config,{mode:'observe',apply:true,now:matureNow});
 assert.equal(matured.manifestDays,41);
 assert.deepEqual(matured.stages.find(s=>s.stage==='independent-shadow-model'),{
  stage:'independent-shadow-model',status:'skipped-awaiting-post-prereg-signals',
  nextAction:'await-signals-frozen-after-preregistration'});
 assert.deepEqual(fs.readdirSync(config.modelDir),before);
 assert.equal(matured.shadowModelVersion,null);
 assert.equal(matured.canTrade,false);
 assert.equal(fs.existsSync(path.join(config.modelDir,'.shadow-worker.lock')),false);
});
test('daily shadow handoff rejects a legacy manifest before opening any frozen or H5 input',t=>{
 const {config}=setup(t);
 fs.writeFileSync(config.manifestFile,JSON.stringify({schemaVersion:1,
  episodes:Array.from({length:36},(_,i)=>({
   featuresFile:path.join(config.captureDir,'missing-feature-'+i+'.json'),
   reportFile:path.join(config.trackingDir,'missing-h5-'+i+'.json')}))}));
 assert.throws(()=>runProspectiveShadowResearch(config,at(days[75])),
  /仅接受冻结回执与首份成熟H5绑定/);
 assert.equal(fs.existsSync(config.modelDir),false);
});
test('old EOD data on next calendar day is never presented as today, nor permitted to freeze',t=>{
 const {config}=setup(t),today=days[currentIndex],
  tomorrow=days[currentIndex+1],old=fs.readFileSync(config.historyFile,'utf8');
 const preview=runDailyCycle(config,{mode:'capture',now:at(tomorrow)});
 assert.equal(preview.status,'skip-no-closed-session-today');
 const apply=runDailyCycle(config,{mode:'observe',apply:true,now:at(tomorrow)});
 assert.equal(apply.status,'skip-no-closed-session-today');
 assert.equal(apply.applied,false);
 assert.equal(fs.readFileSync(config.historyFile,'utf8'),old);
 assert.equal(fs.existsSync(config.marketFile),false);
});
test('stale same-day source and expired factor/pick snapshot block before any write',t=>{
 const {config}=setup(t),day=days[currentIndex];
 const stale=runDailyCycle(config,{mode:'capture',apply:true,
  now:at(day,'16:35:00')});
 assert.equal(stale.status,'skip-source-observation-too-old');
 assert.equal(fs.existsSync(config.marketFile),false);
 const factors=JSON.parse(fs.readFileSync(config.factorsFile,'utf8'));
 factors.rows[0].factorEvidence.sectorHeatScore.source='wrong-provider';
 fs.writeFileSync(config.factorsFile,JSON.stringify(factors));
 const bad=runDailyCycle(config,{mode:'capture',apply:true,now:at(day)});
 assert.equal(bad.status,'blocked-source-or-signal-evidence');
 assert.deepEqual(bad.blockedStages,['signal-time-factor-freeze-contract']);
 assert.equal(fs.existsSync(config.captureDir),false);
 assert.equal(fs.existsSync(config.marketFile),false);
});
test('old valid price rewrite is blocked at sync; prior cohort and market are not damaged',t=>{
 const {config}=setup(t),stamp=at(days[currentIndex]);
 runDailyCycle(config,{mode:'capture',apply:true,now:stamp});
 const before=fs.readFileSync(config.marketFile,'utf8'),
  receipts=fs.readdirSync(config.captureDir);
 fs.writeFileSync(config.historyFile,JSON.stringify(history(nextIndex,{rewriteOld:true})));
 assert.throws(()=>runDailyCycle(config,{mode:'observe',apply:true,
  now:at(days[nextIndex])}),/authorized-market-sync|历史股票价格/);
 assert.equal(fs.readFileSync(config.marketFile,'utf8'),before);
 assert.deepEqual(fs.readdirSync(config.captureDir),receipts);
 assert.equal(fs.existsSync(path.join(path.dirname(config.manifestFile),
  '.factor-research-cycle.lock')),false);
});
test('concurrent runner lock and unsafe config paths fail closed',t=>{
 const {config}=setup(t),stamp=at(days[currentIndex]);
 const lock=path.join(path.dirname(config.manifestFile),'.factor-research-cycle.lock');
 fs.writeFileSync(lock,'someone-active');
 assert.throws(()=>runDailyCycle(config,{mode:'capture',apply:true,now:stamp}),
  /运行尚未结束|残留锁/);
 assert.equal(fs.readFileSync(lock,'utf8'),'someone-active');
 const broken={...config,modelDir:path.join(config.captureDir,'models')};
 assert.throws(()=>validatePaths(broken),/不能嵌套/);
 assert.throws(()=>validatePaths({...config,marketFile:config.historyFile}),/重合/);
 assert.throws(()=>validatePaths({...config,accountToken:'should-not-appear'}),/未批准字段/);
 const sym=path.join(path.dirname(config.historyFile),'alias');
 fs.symlinkSync(path.dirname(config.historyFile),sym);
 assert.throws(()=>validatePaths({...config,neutralDir:path.join(sym,'neutral')}),/符号链接/);
 assert.throws(()=>validatePaths({...config,modelDir:path.join(t.root||path.dirname(config.historyFile),'public','models')}),/公开/);
});
test('CLI only accepts explicit mode and absolute private config and opt-in apply',()=>{
 assert.deepEqual(parse(['capture','/private/config.json']),
  {mode:'capture',configFile:'/private/config.json',apply:false});
 assert.deepEqual(parse(['observe','/private/config.json','--apply']),
  {mode:'observe',configFile:'/private/config.json',apply:true});
 assert.throws(()=>parse(['capture','config.json']),/绝对路径/);
 assert.throws(()=>parse(['watch','/private/config.json']),/用法/);
 assert.throws(()=>parse(['capture','/private/config.json','--force']),/用法/);
});
