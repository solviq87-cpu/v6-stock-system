'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {preregisterSeedCandidate,verifySeedRegistrationMetadata,verifyPreregisteredCandidate,
 preregisterCandidate,SEED_MODE,SEED_POLICY}=require('../src/core/factor-candidate-prereg');
const {runRegisterSeed,runOnce:shadowOnce,globalTrialBudget}=require('../scripts/factor-shadow-worker');
const {runOnce:marketOnce}=require('../scripts/authorized-factor-market');
const {runOnce:captureOnce}=require('../scripts/factor-eod-capture');
const {runOnce:maturityOnce}=require('../scripts/factor-maturity-link');
const {createManifest,hash}=require('../src/core/factor-maturity-manifest');
const pack=require('../strategies/extended-factor-pack.json');
const seedConfig={schemaVersion:1,mode:'v6-fixed-shadow-seed-config-v1',
 researchOnly:true,canTrade:false,seedPolicy:SEED_POLICY,
 factorIds:['sector_heat','leader_strength']};
const dates=[];
for(let time=Date.parse('2026-01-05T00:00:00Z');dates.length<120;time+=86400000){
 const d=new Date(time);if(![0,6].includes(d.getUTCDay()))dates.push(d.toISOString().slice(0,10));
}
const at=(d,clock='16:04:00')=>Date.parse(d+'T'+clock+'+08:00');
const defs=pack.factors.filter(f=>seedConfig.factorIds.includes(f.id))
 .map(f=>({id:f.id,field:f.field,baseWeight:f.weight,group:f.group}));
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-seed-prereg-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const p={dir,captureDir:path.join(dir,'captures'),outputDir:path.join(dir,'models'),
  seedConfigFile:path.join(dir,'seed.json'),manifestFile:path.join(dir,'manifest.json'),
  marketFile:path.join(dir,'market.json'),historyFile:path.join(dir,'history.json'),
  picksFile:path.join(dir,'picks.json'),factorFile:path.join(dir,'factors.json'),
  trackingDir:path.join(dir,'tracking')};
 fs.mkdirSync(p.captureDir,{mode:0o700});
 fs.writeFileSync(p.seedConfigFile,JSON.stringify(seedConfig),{mode:0o600});
 return p;
}
function registration(p){
 const name=fs.readdirSync(p.outputDir).find(n=>n.startsWith('prereg-'));
 return JSON.parse(fs.readFileSync(path.join(p.outputDir,name),'utf8'));
}
function context(reg,n=2){
 const sorted=Array.from({length:n},(_,i)=>({day:dates[i],
  featureCapturedAt:at(dates[i]),featureFingerprint:hash(i)}));
 return {sorted,ids:reg.factorIds,packFingerprint:hash(pack),oldWeights:reg.acceptedWeights,
  previousFingerprint:null,previousTrialFingerprint:null,freshTest:sorted};
}
const reseal=value=>{const {fingerprint,...payload}=value;return {...payload,fingerprint:hash(payload)};};
test('zero-history seed records real empty prefix and fixed bounded weights; ordinary prereg still needs 36',t=>{
 const p=setup(t),now=at(dates[0],'15:00:00');
 t.mock.method(Date,'now',()=>now);
 const result=runRegisterSeed({...p,now}),reg=registration(p);
 assert.equal(result.status,'candidate-seed-preregistered');assert.equal(reg.mode,SEED_MODE);
 assert.deepEqual(reg.frozenPrefixFingerprints,[]);assert.equal(reg.latestFrozenSignalDay,null);
 assert.equal(reg.lastFrozenCapturedAt,null);assert.equal(reg.registeredAt,now);assert.equal(reg.recordedAt,now);
 assert.deepEqual(reg.candidateWeights,Object.fromEntries(defs.map((f,i)=>
  [f.id,+(f.baseWeight*(i%2===0?1.02:.98)).toFixed(8)])));
 assert.equal(fs.statSync(path.join(p.outputDir,fs.readdirSync(p.outputDir)[0])).mode&0o777,0o600);
 assert.equal(verifyPreregisteredCandidate(reg,context(reg)).frozenPrefixDays,0);
 assert.throws(()=>preregisterCandidate({features:[],candidateWeights:reg.candidateWeights,
  acceptedWeights:reg.acceptedWeights,registeredAt:now,packFingerprint:hash(pack)}),/输入协议无效/);
 assert.throws(()=>runRegisterSeed({...p,now}),/禁止重置旧试验或重复登记/);
});
test('seed tampering, result fields, old captures, code/pack mismatch and foreign parents fail closed',t=>{
 t.mock.method(Date,'now',()=>at(dates[0],'15:00:00'));
 const reg=preregisterSeedCandidate({seedConfig,registeredAt:at(dates[0],'15:00:00')});
 for(const patch of [{candidateWeights:{...reg.candidateWeights,sector_heat:1.4}},
  {packFingerprint:'a'.repeat(64)},{seedConfig:{...seedConfig,reportFile:'/private/h5.json'}},
  {latestFrozenSignalDay:dates[0]},{parentTrialFingerprint:'b'.repeat(64)},
  {recordedAt:undefined},{recordedAt:reg.registeredAt-1},{recordedAt:reg.registeredAt+60001}])
  assert.throws(()=>verifySeedRegistrationMetadata(reseal({...reg,...patch})));
 const changed=reseal({...reg,algorithmFingerprint:'f'.repeat(64)});
 assert.throws(()=>verifyPreregisteredCandidate(changed,context(reg)),/固定种子预注册时点/);
 const c=context(reg);c.sorted[0].featureCapturedAt=reg.registeredAt;
 assert.throws(()=>verifyPreregisteredCandidate(reg,c),/固定种子预注册时点/);
 assert.throws(()=>verifyPreregisteredCandidate(reg,{...context(reg),previousFingerprint:hash('parent')}));
});
test('actual registration today cannot be backdated through the injected worker clock',t=>{
 const p=setup(t),actualNow=Date.now();
 assert.throws(()=>runRegisterSeed({...p,now:actualNow-60001}),/固定种子预注册输入协议无效/);
 assert.equal(fs.readdirSync(p.outputDir).some(name=>name.startsWith('prereg-')),false);
 assert.throws(()=>preregisterSeedCandidate({seedConfig,registeredAt:actualNow-60001}),/输入协议无效/);
 assert.throws(()=>preregisterSeedCandidate({seedConfig,registeredAt:Date.now()+60000}),/输入协议无效/);
});
test('future signals must follow the actual recorded seal as well as the declared registration',t=>{
 const registeredAt=at(dates[0],'15:00:00'),recordedAt=registeredAt+30000;
 t.mock.method(Date,'now',()=>recordedAt);
 const reg=preregisterSeedCandidate({seedConfig,registeredAt});
 assert.equal(reg.recordedAt,recordedAt);
 assert.throws(()=>verifySeedRegistrationMetadata({...reg,recordedAt:recordedAt+1}),/完整性无效/);
 for(const capturedAt of [registeredAt+1,recordedAt]){
  const c=context(reg);c.sorted[0].featureCapturedAt=capturedAt;
  assert.throws(()=>verifyPreregisteredCandidate(reg,c),/固定种子预注册时点/);
 }
 const valid=context(reg);valid.sorted[0].featureCapturedAt=recordedAt+1;
 assert.equal(verifyPreregisteredCandidate(reg,valid).recordedAt,recordedAt);
});
test('register-seed CLI requires explicit private config and rejects old archive filenames without reading them',t=>{
 const p=setup(t),script=path.resolve(__dirname,'../scripts/factor-shadow-worker.js');
 const missing=spawnSync(process.execPath,[script,'register-seed',p.captureDir,p.outputDir],{encoding:'utf8'});
 assert.notEqual(missing.status,0);assert.match(missing.stderr,/固定种子配置/);
 fs.mkdirSync(p.outputDir,{mode:0o700});
 const old=path.join(p.outputDir,'shadow-old.json');fs.writeFileSync(old,'DO NOT READ INVALID OLD RESULT');
 assert.throws(()=>runRegisterSeed({...p,now:at(dates[0])}),/禁止重置旧试验或重复登记/);
 assert.equal(fs.readFileSync(old,'utf8'),'DO NOT READ INVALID OLD RESULT');
 assert.deepEqual(fs.readdirSync(p.outputDir),['shadow-old.json']);
 const clean=setup(t),created=spawnSync(process.execPath,[script,'register-seed',
  clean.captureDir,clean.outputDir,clean.seedConfigFile],{encoding:'utf8'});
 assert.equal(created.status,0,created.stderr);
 assert.equal(JSON.parse(created.stdout).status,'candidate-seed-preregistered');
 assert.equal(registration(clean).frozenPrefixFingerprints.length,0);
});
function market(p,index){
 const day=dates[index],symbols=Array.from({length:36},(_,j)=>String(600000+j));
 const history={schemaVersion:1,source:'imported',provider:'synthetic-canonical-seed-price',
  datasetId:'unit-seed-prereg-only',priceBasis:'unadjusted',asOf:day,
  observedAt:at(day,'16:03:00'),stocks:symbols.map((symbol,j)=>({symbol,corporateActions:[],
   bars:dates.slice(0,index+1).map((date,i)=>{
    const close=+(10*Math.pow(1+(j%6-2.5)*.001,i)).toFixed(6);
    return {date,open:close,high:close+.05,low:close-.05,close,
     volume:200+i,priceBasis:'unadjusted',suspended:false};
   })}))};
 fs.writeFileSync(p.historyFile,JSON.stringify(history));
 marketOnce({sourceFile:p.historyFile,outputFile:p.marketFile,mode:'sync',now:at(day)});
 return symbols;
}
function capture(p,index){
 const symbols=market(p,index).slice((index%6)*6,(index%6+1)*6),day=dates[index],
  provider='synthetic-canonical-seed-factors',stamp=at(day,'15:00:00');
 const picks={asOf:at(day,'16:01:15'),board:'all',totalScanned:3200,count:6,
  items:symbols.map(code=>({code,hit:[{id:1,text:'synthetic protocol test'}],hitIds:[1]}))};
 const factors={schemaVersion:1,feed:{source:'imported',provider,datasetId:'unit-seed-factors'},
  asOf:at(day,'16:01:00'),rows:symbols.map((code,j)=>({code,
   feed:{source:provider,timestamp:stamp},sectorHeatScore:10+j*15,
   leaderStrengthScore:90-j*15+[6,-4,3,-2,5,-1][j],factorEvidence:{
    sectorHeatScore:{code,source:provider,timestamp:stamp},
    leaderStrengthScore:{code,source:provider,timestamp:stamp}}}))};
 fs.writeFileSync(p.picksFile,JSON.stringify(picks));fs.writeFileSync(p.factorFile,JSON.stringify(factors));
 return captureOnce({...p,outputDir:p.captureDir,now:at(day)});
}
test('seed seals every visible receipt even below 36 and never opens an H5 report',t=>{
 const p=setup(t);let actualNow=at(dates[35]);t.mock.method(Date,'now',()=>actualNow);
 capture(p,35);actualNow=at(dates[36]);capture(p,36);
 fs.writeFileSync(path.join(p.captureDir,'unrelated-H5.json'),'NOT JSON: MUST STAY UNOPENED');
 actualNow=at(dates[36],'16:05:00');
 runRegisterSeed({...p,now:at(dates[36],'16:05:00')});
 const reg=registration(p);assert.equal(reg.frozenPrefixFingerprints.length,2);
 assert.equal(reg.latestFrozenSignalDay,dates[36]);assert.equal(reg.lastFrozenCapturedAt,at(dates[36]));
});
test('seed still waits for five post-registration matured days before opening any H5 result',t=>{
 const p=setup(t),start=35;
 let actualNow=at(dates[start]);t.mock.method(Date,'now',()=>actualNow);
 for(let i=start;i<start+36;i++){actualNow=at(dates[i]);capture(p,i);}
 actualNow=at(dates[start+35],'16:05:00');
 runRegisterSeed({...p,now:at(dates[start+35],'16:05:00')});
 for(let i=start+36;i<start+40;i++){actualNow=at(dates[i]);capture(p,i);}
 const index=start+44;actualNow=at(dates[index]);market(p,index);maturityOnce({...p,now:at(dates[index])});
 const manifest=JSON.parse(fs.readFileSync(p.manifestFile,'utf8'));
 for(const entry of manifest.episodes)fs.writeFileSync(entry.reportFile,'H5 MUST NOT BE OPENED WITH ONLY FOUR FRESH DAYS');
 const result=shadowOnce({...p,now:at(dates[index]),operatorMode:true,
  requirePreRegistration:true,autoRegisterCandidate:true});
 assert.equal(result.status,'skipped-awaiting-post-prereg-matured-days');
 assert.equal(result.maturedPostRegistrationDays,4);assert.equal(result.requiredPostRegistrationDays,5);
 assert.equal(fs.readdirSync(p.outputDir).filter(n=>n.startsWith('shadow-')).length,0);
});
test('zero seed -> actual capture/maturity canonical pipeline -> gated first trial -> restart auto handoff',t=>{
 const p=setup(t),start=35,count=61;
 let actualNow=at(dates[start],'15:00:00');t.mock.method(Date,'now',()=>actualNow);
 const seed=runRegisterSeed({...p,now:at(dates[start],'15:00:00')});
 for(let i=start;i<start+count;i++){actualNow=at(dates[i]);capture(p,i);}
 const end=start+count-1,matureIndex=end+5;actualNow=at(dates[matureIndex]);market(p,matureIndex);
 const mature=maturityOnce({...p,now:at(dates[matureIndex])});
 assert.equal(mature.maturedDays,count);
 const manifest=JSON.parse(fs.readFileSync(p.manifestFile,'utf8'));
 const conf={...p,now:at(dates[matureIndex]),operatorMode:true,
  requirePreRegistration:true,autoRegisterCandidate:true};
 const trim=n=>{
  const episodes=manifest.episodes.slice(0,n).map((entry,i)=>({...entry,day:dates[start+i]}));
  fs.writeFileSync(p.manifestFile,JSON.stringify(createManifest(episodes)));
 };
 trim(35);assert.throws(()=>shadowOnce(conf),/完整时间排序研究批次目录/);
 trim(36);assert.equal(shadowOnce(conf).status,'skipped-insufficient-independent-h5-days');
 assert.equal(fs.readdirSync(p.outputDir).filter(n=>n.startsWith('shadow-')).length,0);
 fs.writeFileSync(p.manifestFile,JSON.stringify(manifest));
 const result=shadowOnce(conf);assert.ok(['shadow-retained','shadow-updated'].includes(result.status));
 const filename=fs.readdirSync(p.outputDir).find(n=>n.startsWith('shadow-')),
  file=path.join(p.outputDir,filename),bytes=fs.readFileSync(file),report=JSON.parse(bytes);
 assert.equal(report.preregistration.registrationFingerprint,seed.fingerprint);
 assert.equal(report.preregistration.frozenPrefixDays,0);assert.equal(report.trialAudit.status,'consumed');
 assert.ok(report.testDays>=5);assert.ok(report.trainDays>=15);assert.ok(report.validationDays>=5);
 assert.equal(report.globalTrialBudget.remainingAfterRun,5);
 const budget=globalTrialBudget(p.outputDir,Array.from({length:count},(_,i)=>dates[start+i]));
 assert.equal(budget.usedTrials,1);
 const oldRead=fs.readFileSync,reportPaths=new Set(manifest.episodes.map(e=>e.reportFile));
 fs.readFileSync=function(file,...args){if(reportPaths.has(String(file)))throw Error('H5 must remain unopened on handoff');
  return oldRead.call(this,file,...args);};
 try{
  const key=require.resolve('../scripts/factor-shadow-worker');delete require.cache[key];
  const next=require(key).runOnce({...conf,now:conf.now+1000});
  assert.equal(next.status,'candidate-auto-preregistered');
 }finally{fs.readFileSync=oldRead;}
 assert.deepEqual(fs.readFileSync(file),bytes);
 assert.equal(fs.readdirSync(p.outputDir).filter(n=>n.startsWith('prereg-')).length,2);
 assert.equal(globalTrialBudget(p.outputDir,Array.from({length:count},(_,i)=>dates[start+i])).usedTrials,1);
 assert.throws(()=>runRegisterSeed({...p,now:conf.now+2000}),/禁止重置旧试验或重复登记/);
});
