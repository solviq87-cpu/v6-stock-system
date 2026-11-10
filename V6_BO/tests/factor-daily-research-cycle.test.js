'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {runDailyCycle,validatePaths}=
 require('../src/core/factor-daily-research-cycle');
const {main,parse}=require('../scripts/factor-daily-research');
const {inspectResearchChain}=require('../src/core/factor-chain-readiness');
const at=(day,time='16:04:00')=>Date.parse(day+'T'+time+'+08:00');
const days=(()=>{
 const values=[];let t=Date.parse('2026-08-03T00:00:00Z');
 while(values.length<44){
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
function initialSignals(){
 const d=days[currentIndex],provider='unit-point-in-time',
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
