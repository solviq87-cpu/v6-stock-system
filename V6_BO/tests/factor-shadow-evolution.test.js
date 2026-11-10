'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),
 crypto=require('node:crypto');
const {freezeCohort,evaluateForward}=require('../src/core/forward-signal-observer');
const {freezeFeatureEpisode,evolveShadowFactors,
 selectNonOverlappingMaturedCrossSections}=require('../src/core/factor-shadow-evolution');
const {execute}=require('../scripts/factor-shadow-evolution');
const {runOnce:runShadowWorker,runRegister,runRegisterAuto,
 parse:parseShadowWorker,latestAccepted,latestCooldown,latestTrial,
 globalTrialBudget,latestCandidateRegistration}=require('../scripts/factor-shadow-worker');
const at=(d,clock='16:00:00')=>Date.parse(d+'T'+clock+'+08:00');
const factorIds=['sector_heat','leader_strength'];
const priceFeed={source:'imported',provider:'unverified-unit-only-eod',datasetId:'test-unadjusted',priceBasis:'unadjusted'};
const featureFeed={source:'imported',provider:'unverified-unit-only-factors',datasetId:'test-factors'};
const aScores=[10,25,40,55,70,85],jitter=[6,-4,3,-2,5,-1];
function weekdays(n){
 const result=[];let day=Date.parse('2026-05-04T00:00:00Z');
 while(result.length<n){
  const d=new Date(day),w=d.getUTCDay();
  if(w>0&&w<6)result.push(d.toISOString().slice(0,10));
  day+=86400000;
 }
 return result;
}
const dates=weekdays(100);
function episode(index,{reuseSymbols=false,reverseReturns=false,duplicateFactor=false}={}){
 const d=dates[index],future=dates.slice(index,index+6),signals=[],rows=[],stocks=[];
 for(let j=0;j<6;j++){
  const symbol=String(600000+(reuseSymbols?0:index%6*6)+j),id=d+'-'+symbol,score=aScores[j],
   reverse=100-score+jitter[j];
  signals.push({signalId:id,symbol,system:'manual',cohort:'research',
   provenance:'synthetic-protocol-test-not-market',signalDate:d,signalAt:at(d),
   baselineClose:10});
  rows.push({signalId:id,symbol,signalDate:d,values:{
   sector_heat:score,leader_strength:duplicateFactor?score:reverse
  },evidence:{
   sector_heat:{source:featureFeed.provider,observedAt:at(d)},
   leader_strength:{source:featureFeed.provider,observedAt:at(d)}
  }});
  const pct=(j-2.5)*(reverseReturns?-2:2);
  stocks.push({symbol,corporateActions:[],bars:[
   {date:d,close:10,volume:100,suspended:false},
   {date:future[5],close:10*(1+pct/100),volume:100,suspended:false}
  ]});
 }
 const cohort=freezeCohort({schemaVersion:1,feed:priceFeed,signals},
  {now:at(d,'16:01:00')});
 const features=freezeFeatureEpisode({cohort,feed:featureFeed,factorIds,rows},
  {now:at(d,'16:02:00')});
 const market={schemaVersion:1,feed:priceFeed,
  asOf:future[5],observedAt:at(future[5],'16:00:00'),
  calendar:future,stocks};
 const report=evaluateForward(cohort,market,{now:at(future[5],'16:01:00')});
 return {features,report,cohort,rows};
}
const finalClock=at('2026-11-10');
test('at signal time, feature snapshot stays frozen and its returns are not included',()=>{
 const r=episode(0);
 assert.equal(r.features.mode,'frozen-factor-feature-episode');
 assert.equal(r.features.features.length,6);
 assert.equal(r.features.prospectiveCertified,false);
 assert.equal(r.features.canTrade,false);
 assert.equal(r.features.factors.length,2);
 assert.ok(!JSON.stringify(r.features).includes('priceReturnPct'));
 assert.equal(r.report.records[0].windows[1].status,'observed');
});
test('no retrospective feature capture, simulated feed, future features or mismatched signals',()=>{
 const r=episode(0),input={cohort:r.cohort,feed:featureFeed,factorIds,rows:r.rows};
 assert.throws(()=>freezeFeatureEpisode(input,{now:at(dates[0],'16:07:00')}),/五分钟/);
 const spoof=structuredClone(input);
 spoof.rows[0].evidence.sector_heat.observedAt+=1000;
 assert.throws(()=>freezeFeatureEpisode(spoof,{now:at(dates[0],'16:02:00')}),/证据/);
 const sim=structuredClone(input);sim.feed.source='simulated';
 assert.throws(()=>freezeFeatureEpisode(sim,{now:at(dates[0],'16:02:00')}),/导入来源/);
 const duplicate=structuredClone(input);duplicate.rows[1].signalId=duplicate.rows[0].signalId;
 assert.throws(()=>freezeFeatureEpisode(duplicate,{now:at(dates[0],'16:02:00')}),/重复/);
});
test('autonomous shadow update uses training + purged validation + untouched holdout',()=>{
 const source=Array.from({length:56},(_,i)=>episode(i));
 const r=evolveShadowFactors(source,{now:finalClock});
 assert.equal(r.mode,'v6-factor-shadow-evolution-v1');
 assert.equal(r.status,'shadow-updated');
 assert.equal(r.version,1);
 assert.equal(r.productionWeightsChanged,false);
 assert.equal(r.productionStrategyChanged,false);
 assert.equal(r.canTrade,false);
 assert.equal(r.autoPromotion,false);
 assert.equal(r.shadowWeightsChanged,true);
 assert.equal(r.shadowWeights.sector_heat>1.3,true);
 assert.equal(r.shadowWeights.leader_strength<1.3,true);
 assert.equal(r.purgeSessions,5);
 assert.equal(r.factorLearning.sector_heat.reliable,true);
 assert.equal(r.factorLearning.leader_strength.reliable,true);
 assert.equal(r.factorMarginalContribution.evidenceBasis,
  'frozen-factor-training-and-time-isolated-forward-observation');
 assert.equal(r.factorMarginalContribution.changedFactorCount,2);
 assert.equal(r.factorMarginalContribution.blocksPromotion,false);
 assert.equal(r.factorMarginalContribution.harmfulFactorIds.length,0);
 assert.equal(r.factorMarginalContribution.factors[0].training.comparedDays,r.trainDays);
 assert.equal(r.factorMarginalContribution.factors[0].validation.comparedDays,r.validationDays);
 assert.equal(r.factorMarginalContribution.factors[0].holdout.comparedDays,r.testDays);
 assert.equal(r.factorMarginalContribution.productionWeightsChanged,false);
 assert.equal(r.factorRedundancy.trainingDays,r.trainDays);
 assert.equal(r.factorRedundancy.pairs.length,1);
 assert.equal(r.factorRedundancy.pairs[0].relationship,'strong-inverse');
 assert.deepEqual(r.factorRedundancy.suppressedFactorIds,[]);
 assert.equal(r.factorRedundancy.productionWeightsChanged,false);
 assert.equal(r.marketRegimeDays.unknown,r.trainDays);
 assert.equal(r.freshHoldoutOnly,false);
 assert.ok(r.holdout.stability.halfPeriodsConsistent);
 assert.equal(r.modelComparison.status,'paired-scorecard-unverified');
 assert.equal(r.modelComparison.originalGatePassed,true);
 assert.equal(r.modelComparison.assessedDays,r.testDays);
 assert.ok(r.modelComparison.proposedVsOriginal.meanDeltaIC>.002);
 assert.equal(r.modelComparison.canTrade,false);
 assert.ok(r.validation.deltaIC>0);
 assert.ok(r.holdout.deltaIC>0);
 assert.ok(r.trainDays>=15&&r.validationDays>=5&&r.testDays>=5);
 assert.notEqual(r.shadowWeights.sector_heat,r.proposedShadowWeights.leader_strength);
 // The same historical dataset must not endlessly manufacture new versions.
 assert.throws(()=>evolveShadowFactors(source,{now:finalClock,previous:r}),
  /未增加新的训练时间窗/);
});
test('modified market outcome, broken feature fingerprint and missing evidence are rejected',()=>{
 const source=Array.from({length:56},(_,i)=>episode(i));
 const corrupt=structuredClone(source);corrupt[0].features.features[0].values.sector_heat=99;
 assert.throws(()=>evolveShadowFactors(corrupt,{now:finalClock}),/指纹/);
 const lateCapture=structuredClone(source);lateCapture[0].features.originalCohortFrozenAt-=(6*60*1000);
 assert.throws(()=>evolveShadowFactors(lateCapture,{now:finalClock}),/指纹|时点/);
 const beforeClose=structuredClone(source);
 beforeClose[0].report.observedAt=at(beforeClose[0].report.asOf,'15:00:00');
 assert.throws(()=>evolveShadowFactors(beforeClose,{now:finalClock}),/来源或时间/);
 const changed=structuredClone(source);changed[0].report.cohortFingerprint='x'.repeat(64);
 assert.throws(()=>evolveShadowFactors(changed,{now:finalClock}),/来源/);
 const missing=structuredClone(source);
 missing[0].report.records[0].signalId='wrong';
 assert.throws(()=>evolveShadowFactors(missing,{now:finalClock}),/不一致/);
 const shorter=source.slice(0,20);
 assert.throws(()=>evolveShadowFactors(shorter,{now:finalClock}),/至少需要36/);
});
test('a crash or bad-market regime can retain the previous shadow model without formal promotion',()=>{
 const source=Array.from({length:56},(_,i)=>episode(i));
 const r=evolveShadowFactors(source,{now:finalClock,marketContext:{
  schemaVersion:1,source:'imported',simulated:false,provider:'market-test',tradeDate:'2026-11-10',
  observedAt:finalClock-30000,coverage:1,breadth:{
   source:'market-test',observedAt:finalClock-30000,upPct:10
  },indices:{
   shanghai:{source:'market-test',observedAt:finalClock-30000,changePct:-3.8},
   shenzhen:{source:'market-test',observedAt:finalClock-30000,changePct:-4.1}
  }
 }});
 assert.equal(r.status,'paused-market-shock');
 assert.equal(r.shadowWeightsChanged,false);
 assert.equal(r.shadowWeights.sector_heat,1.3);
 assert.equal(r.productionWeightsChanged,false);
});
test('explicit CLI writes immutable private 0600 factor evidence and refuses path aliases',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-factor-evolve-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const e=episode(0),cohortPath=path.join(dir,'cohort.json'),
  inputPath=path.join(dir,'input.json'),out=path.join(dir,'private','frozen.json');
 fs.writeFileSync(cohortPath,JSON.stringify(e.cohort));
 fs.writeFileSync(inputPath,JSON.stringify({factorIds,rows:e.rows,feed:featureFeed,
  token:'SECRET_DO_NOT_PERSIST'}));
 const r=execute(['freeze',cohortPath,inputPath,out],{now:at(dates[0],'16:02:00')});
 assert.equal(r.ok,true);assert.equal(r.features,6);
 assert.equal(fs.statSync(out).mode&0o777,0o600);
 assert.ok(!fs.readFileSync(out,'utf8').includes('SECRET_DO_NOT_PERSIST'));
 assert.throws(()=>execute(['freeze',cohortPath,inputPath,out],
  {now:at(dates[0],'16:02:00')}),/EEXIST/);
 const alias=path.join(dir,'alias');fs.symlinkSync(path.join(dir,'private'),alias);
 assert.throws(()=>execute(['freeze',cohortPath,inputPath,path.join(alias,'other.json')],
  {now:at(dates[0],'16:02:00')}),/符号链接/);
 assert.throws(()=>execute(['freeze',cohortPath,inputPath,path.join(dir,'public','file.json')],
  {now:at(dates[0],'16:02:00')}),/公开/);
});

test('unattended research worker appends immutable model versions only when new evidence can change training',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-shadow-worker-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const manifestFile=path.join(dir,'manifest.json'),outputDir=path.join(dir,'private','models');
 const records=[];
 const append=(from,until)=>{
  for(let i=from;i<until;i++){
   const e=episode(i),featuresFile=path.join(dir,'factor-'+i+'.json'),
    reportFile=path.join(dir,'report-'+i+'.json');
   fs.writeFileSync(featuresFile,JSON.stringify(e.features));
   fs.writeFileSync(reportFile,JSON.stringify(e.report));
   records.push({featuresFile,reportFile});
  }
  fs.writeFileSync(manifestFile,JSON.stringify({schemaVersion:1,episodes:records}));
 };
 append(0,56);
 const options={manifestFile,outputDir,now:finalClock};
 const first=runShadowWorker(options);
 assert.equal(first.status,'shadow-updated');
 assert.equal(first.version,1);
 assert.equal(fs.readdirSync(outputDir).length,1);
 assert.equal(fs.statSync(path.join(outputDir,fs.readdirSync(outputDir)[0])).mode&0o777,0o600);
 const same=runShadowWorker(options);
 assert.equal(same.status,'skipped-no-new-training');
 assert.equal(fs.readdirSync(outputDir).length,1);
 append(56,61);
 const second=runShadowWorker(options);
 assert.ok(['shadow-updated','shadow-retained'].includes(second.status),
  'new evidence is evaluated, but not forced into a new active version');
 assert.equal(fs.readdirSync(outputDir).length,2);
 const names=fs.readdirSync(outputDir);
 assert.ok(names.every(x=>/^shadow-\d{4}-\d{2}-\d{2}-[a-f0-9]{12}\.json$/.test(x)));
 const reports=names.map(n=>JSON.parse(fs.readFileSync(path.join(outputDir,n),'utf8')));
 const latest=reports.find(x=>x.fingerprint===second.fingerprint);
 assert.ok(latest.previousFingerprint);
 assert.equal(latest.productionWeightsChanged,false);
 assert.equal(second.version,second.status==='shadow-updated'?2:1,
  'holdout failure retains the last accepted shadow version');
 const replay=runShadowWorker(options);
 assert.ok(['skipped-no-new-training','skipped-identical-evidence'].includes(replay.status));
 assert.equal(fs.readdirSync(outputDir).length,2);
 assert.equal(parseShadowWorker(['watch',manifestFile,outputDir,'--interval','60000']).interval,60000);
 assert.throws(()=>parseShadowWorker(['watch',manifestFile,outputDir,'--interval','100']),/轮询/);
});
test('corrupt research model archive stops unattended learning instead of silently resetting version',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-shadow-bad-model-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const manifestFile=path.join(dir,'manifest.json'),outputDir=path.join(dir,'private');
 fs.mkdirSync(outputDir,{recursive:true});
 fs.writeFileSync(path.join(outputDir,'shadow-2026-07-01-aaaaaaaaaaaa.json'),'{"bad":"content"}');
 fs.writeFileSync(manifestFile,JSON.stringify({schemaVersion:1,episodes:[]}));
 assert.throws(()=>require('../scripts/factor-shadow-worker').latestAccepted(outputDir),/结构无效/);
});

test('market regime is frozen using contemporaneous multi-index evidence, never a future label',()=>{
 const e=episode(0),d=dates[0],marketTime=at(d);
 const context={
  schemaVersion:1,source:'imported',simulated:false,
  provider:'unverified-regime-unit-only',tradeDate:d,observedAt:marketTime,
  coverage:1,breadth:{source:'unverified-regime-unit-only',
   observedAt:marketTime,upPct:10},
  indices:{
   shanghai:{source:'unverified-regime-unit-only',
    observedAt:marketTime,changePct:-3.5},
   chinext:{source:'unverified-regime-unit-only',
    observedAt:marketTime,changePct:-3.9}
  }
 };
 const input={cohort:e.cohort,factorIds,rows:e.rows,feed:featureFeed,
  marketContext:context};
 const frozen=freezeFeatureEpisode(input,{now:at(d,'16:02:00')});
 assert.equal(frozen.marketRegime.regime,'systemic-selloff');
 assert.equal(frozen.marketRegime.status,'observed-unverified');
 const wrong=structuredClone(context);
 wrong.observedAt=at(d,'16:03:00');
 const unknown=freezeFeatureEpisode({...input,marketContext:wrong},
  {now:at(d,'16:02:00')});
 assert.equal(unknown.marketRegime.regime,'unknown');
 assert.equal(unknown.marketRegime.status,'unavailable');
});
test('future shadow upgrades require at least five genuinely unseen holdout days',()=>{
 const original=Array.from({length:56},(_,i)=>episode(i));
 const old=evolveShadowFactors(original,{now:finalClock});
 assert.equal(old.status,'shadow-updated');
 assert.throws(()=>evolveShadowFactors(Array.from({length:60},(_,i)=>episode(i)),
  {now:finalClock,previous:old}),/新增独立样本外交易日不足/);
 const next=evolveShadowFactors(Array.from({length:61},(_,i)=>episode(i)),
  {now:finalClock,previous:old});
 assert.equal(next.freshHoldoutOnly,true);
 assert.equal(next.testDays,5);
 assert.ok(next.holdout.firstFreshDay>old.lastObservationDay);
 assert.equal(next.factorMarginalContribution.factors[0].holdout.firstDay,next.holdout.firstFreshDay);
 assert.equal(next.factorMarginalContribution.factors[0].holdout.comparedDays,5);
 assert.equal(next.modelComparison.status,'paired-scorecard-unverified');
 assert.equal(next.modelComparison.assessedDays,5);
 assert.ok(next.modelComparison.firstDay>old.lastObservationDay);
 assert.equal(next.modelComparison.perDay.length,5);
 assert.equal(next.productionWeightsChanged,false);
});
test('already reviewed historic episode fingerprints cannot be changed during self-learning',()=>{
 const original=Array.from({length:56},(_,i)=>episode(i));
 const old=evolveShadowFactors(original,{now:finalClock});
 const next=Array.from({length:61},(_,i)=>episode(i));
 next[1].report.marketFingerprint='a'.repeat(64);
 assert.throws(()=>evolveShadowFactors(next,{now:finalClock,previous:old}),
  /历史冻结证据被替换或回写/);
});

test('shadow learning excludes a symbol until its previously used 5-day outcome matures, without deleting observations',()=>{
 const section=(signalIndex,symbols,targetIndex)=>({
  day:dates[signalIndex],features:{marketRegime:{regime:'unknown'}},
  rows:symbols.map(symbol=>({symbol,returnPct:1,targetDate:dates[targetIndex]}))
 });
 const first=Array.from({length:6},(_,i)=>String(600000+i));
 const second=Array.from({length:5},(_,i)=>String(600100+i));
 const result=selectNonOverlappingMaturedCrossSections([
  section(0,first,5),
  section(1,first,6), // All six outcomes reuse overlapping same-stock windows.
  section(2,[first[0],...second],7), // Only five fresh rows can be used.
  section(6,first,11) // All six become eligible after their prior target day.
 ]);
 assert.equal(result.observed.length,3);
 assert.deepEqual([...result.used],[dates[0],dates[2],dates[6]]);
 assert.equal(result.excludedOverlappingRows,7);
 assert.equal(result.excludedDuplicateSameDayRows,0);
 assert.equal(result.observed[1].rows.length,5);
 assert.equal(result.observed[2].rows.length,6);
});
test('same-day duplicate symbols still do not count as two independent stocks',()=>{
 const rows=Array.from({length:5},(_,j)=>({
  symbol:String(601000+j),returnPct:j,targetDate:dates[5]
 }));
 const result=selectNonOverlappingMaturedCrossSections([{
  day:dates[0],rows:[...rows,
   {symbol:rows[0].symbol,returnPct:2,targetDate:dates[5]}],
  features:{marketRegime:{regime:'unknown'}}
 }]);
 assert.equal(result.observed.length,0); // Only four distinct admissible symbols remain.
 assert.equal(result.excludedDuplicateSameDayRows,2);
});
test('replaying the same six stocks every day cannot fabricate 15 independent training days',()=>{
 const source=Array.from({length:56},(_,i)=>episode(i,{reuseSymbols:true}));
 assert.throws(()=>evolveShadowFactors(source,{now:finalClock}),
  /样本不足或未来收益窗口重叠/);
});
test('rotating symbol cohorts preserve original immutable signals and sufficient nonoverlapping shadow training',()=>{
 const source=Array.from({length:56},(_,i)=>episode(i));
 const result=evolveShadowFactors(source,{now:finalClock});
 assert.ok(result.sampleIndependence.eligibleCrossSectionDays>=50);
 assert.equal(result.sampleIndependence.excludedOverlappingRows,0);
 assert.equal(result.sampleIndependence.excludedDuplicateSameDayRows,0);
 assert.equal(result.sampleIndependence.overlappingOriginalSignalsPreserved,true);
 assert.equal(result.canTrade,false);
 assert.equal(result.productionWeightsChanged,false);
});

test('fresh forward reversals mark previously accepted shadow decay without changing formal or accepted research weights',()=>{
 const history=Array.from({length:56},(_,i)=>episode(i));
 const accepted=evolveShadowFactors(history,{now:finalClock});
 assert.equal(accepted.status,'shadow-updated');
 const later=[...history,...Array.from({length:5},(_,i)=>episode(56+i,{reverseReturns:true}))];
 const result=evolveShadowFactors(later,{now:finalClock,previous:accepted});
 assert.equal(result.status,'paused-shadow-decay');
 assert.equal(result.shadowWeightsChanged,false);
 assert.deepEqual(result.shadowWeights,accepted.shadowWeights);
 assert.equal(result.pausedForShadowDecay,true);
 assert.equal(result.rollbackReviewSuggested,true);
 assert.equal(result.shadowDecay.status,'decay-alert-unverified');
 assert.equal(result.shadowDecay.assessedDays,5);
 assert.equal(result.shadowDecay.negativeDeltaPct,100);
 assert.equal(result.canTrade,false);
 assert.equal(result.productionWeightsChanged,false);
 assert.equal(result.productionStrategyChanged,false);
 assert.equal(result.autoPromotion,false);
});
test('new mature holdouts without decay cannot trigger false rollback alerts',()=>{
 const history=Array.from({length:56},(_,i)=>episode(i));
 const accepted=evolveShadowFactors(history,{now:finalClock});
 const next=evolveShadowFactors(Array.from({length:61},(_,i)=>episode(i)),
  {now:finalClock,previous:accepted});
 assert.equal(next.shadowDecay.alert,false);
 assert.equal(next.pausedForShadowDecay,false);
 assert.equal(next.rollbackReviewSuggested,false);
 assert.equal(next.productionWeightsChanged,false);
});

test('decay cooldown persists, needs ten subsequent recovered days, then five unseen days before another promotion attempt',()=>{
 const previous=evolveShadowFactors(Array.from({length:56},(_,i)=>episode(i)),
  {now:finalClock});
 assert.equal(previous.status,'shadow-updated');
 const history=[
  ...Array.from({length:56},(_,i)=>episode(i)),
  ...Array.from({length:5},(_,i)=>episode(56+i,{reverseReturns:true}))
 ];
 const alert=evolveShadowFactors(history,{now:finalClock,previous});
 assert.equal(alert.status,'paused-shadow-decay');
 assert.equal(alert.cooldown.phase,'active');
 assert.equal(alert.cooldown.alertDay,dates[60]);
 assert.equal(alert.productionWeightsChanged,false);
 const nine=[...history,...Array.from({length:9},(_,i)=>episode(61+i))];
 const cooling=evolveShadowFactors(nine,{now:finalClock,previous,previousCooldown:alert});
 assert.equal(cooling.status,'paused-shadow-cooldown');
 assert.equal(cooling.cooldown.phase,'active');
 assert.equal(cooling.cooldown.recovery.assessedDays,9);
 assert.equal(cooling.rollbackReviewSuggested,true);
 assert.deepEqual(cooling.shadowWeights,previous.shadowWeights);
 const ten=[...nine,episode(70)];
 const recovered=evolveShadowFactors(ten,{now:finalClock,previous,previousCooldown:cooling});
 assert.equal(recovered.status,'shadow-recovered');
 assert.equal(recovered.cooldown.phase,'recovered');
 assert.equal(recovered.cooldown.recoveryDay,dates[70]);
 assert.equal(recovered.shadowWeightsChanged,false);
 assert.deepEqual(recovered.shadowWeights,previous.shadowWeights);
 assert.equal(recovered.rollbackReviewSuggested,false);
 // Exactly the same evidence is not a new evolution iteration.
 assert.equal(evolveShadowFactors(ten,
  {now:finalClock,previous,previousCooldown:recovered}).fingerprint,recovered.fingerprint);
 const four=[...ten,...Array.from({length:4},(_,i)=>episode(71+i))];
 const waiting=evolveShadowFactors(four,{now:finalClock,previous,previousCooldown:recovered});
 assert.equal(waiting.status,'paused-shadow-cooldown');
 assert.equal(waiting.postRecoveryHoldoutDays,4);
 assert.equal(waiting.factorMarginalContribution.factors[0].holdout.status,'insufficient');
 assert.equal(waiting.factorMarginalContribution.blocksPromotion,true);
 assert.equal(waiting.shadowWeightsChanged,false);
 const five=[...four,episode(75)];
 const tested=evolveShadowFactors(five,{now:finalClock,previous,previousCooldown:waiting});
 assert.ok(['shadow-updated','shadow-retained'].includes(tested.status));
 assert.equal(tested.postRecoveryHoldoutDays,5);
 assert.equal(tested.pausedForShadowDecay,false);
 assert.equal(tested.productionWeightsChanged,false);
});
test('old archived cooldown cannot be replayed with rewritten frozen evidence or another accepted model',()=>{
 const historical=Array.from({length:56},(_,i)=>episode(i));
 const previous=evolveShadowFactors(historical,{now:finalClock});
 const history=[...historical,...Array.from({length:5},(_,i)=>episode(56+i,{reverseReturns:true}))];
 const alert=evolveShadowFactors(history,{now:finalClock,previous});
 const next=[...history,episode(61)];
 const changed=structuredClone(next);
 changed[58].report.marketFingerprint='c'.repeat(64);
 assert.throws(()=>evolveShadowFactors(changed,{now:finalClock,previous,previousCooldown:alert}),
  /冷却证据或血缘无效|冻结|来源/);
 const forged={...alert,previousFingerprint:'wrong'};
 assert.throws(()=>evolveShadowFactors(next,{now:finalClock,previous,previousCooldown:forged}),
  /冷却证据或血缘无效/);
});
test('worker rereads private cooldown after restart rather than forgetting the last decay warning',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-cooldown-resume-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const manifestFile=path.join(dir,'manifest.json'),outputDir=path.join(dir,'models');
 const saved=[];
 const append=(from,to,reversed=false)=>{
  for(let i=from;i<to;i++){
   const e=episode(i,{reverseReturns:reversed});
   const featuresFile=path.join(dir,'f'+i+'.json');
   const reportFile=path.join(dir,'r'+i+'.json');
   fs.writeFileSync(featuresFile,JSON.stringify(e.features));
   fs.writeFileSync(reportFile,JSON.stringify(e.report));
   saved.push({featuresFile,reportFile});
  }
  fs.writeFileSync(manifestFile,JSON.stringify({schemaVersion:1,episodes:saved}));
 };
 append(0,56);
 const options={manifestFile,outputDir,now:finalClock};
 const accepted=runShadowWorker(options);
 assert.equal(accepted.status,'shadow-updated');
 append(56,61,true);
 const paused=runShadowWorker(options);
 assert.equal(paused.status,'paused-shadow-decay');
 const previous=require('../scripts/factor-shadow-worker').latestAccepted(outputDir);
 const state=latestCooldown(outputDir,previous);
 assert.equal(state.cooldown.phase,'active');
 assert.equal(state.cooldown.alertDay,dates[60]);
 const again=runShadowWorker(options);
 assert.equal(again.status,'skipped-identical-evidence');
 assert.equal(latestCooldown(outputDir,previous).fingerprint,state.fingerprint);
 append(61,71);
 const recovered=runShadowWorker(options);
 assert.equal(recovered.status,'shadow-recovered');
 assert.equal(latestCooldown(outputDir,previous).cooldown.phase,'recovered');
 assert.equal(require('../scripts/factor-shadow-worker').latestAccepted(outputDir).fingerprint,
  previous.fingerprint);
});

test('sealed historical decay alerts without a cooldown field still force an active cooldown after restart',t=>{
 const historical=Array.from({length:56},(_,i)=>episode(i));
 const previous=evolveShadowFactors(historical,{now:finalClock});
 const source=[...historical,
  ...Array.from({length:5},(_,i)=>episode(56+i,{reverseReturns:true}))];
 const alert=evolveShadowFactors(source,{now:finalClock,previous});
 assert.equal(alert.status,'paused-shadow-decay');
 const {fingerprint,cooldown,postRecoveryHoldoutDays,postRecoveryGainIC,...payload}=alert;
 const legacy={...payload,fingerprint:crypto.createHash('sha256')
  .update(JSON.stringify(payload)).digest('hex')};
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-legacy-cooldown-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file='shadow-'+legacy.trainingEnd+'-'+legacy.fingerprint.slice(0,12)+'.json';
 fs.writeFileSync(path.join(dir,file),JSON.stringify(legacy));
 const restored=latestCooldown(dir,previous);
 assert.equal(restored.fingerprint,legacy.fingerprint);
 assert.equal(restored.cooldown,undefined);
 const resumed=evolveShadowFactors([...source,episode(61)],
  {now:finalClock,previous,previousCooldown:restored});
 assert.equal(resumed.status,'paused-shadow-cooldown');
 assert.equal(resumed.cooldown.phase,'active');
 assert.equal(resumed.cooldown.alertDay,dates[60]);
 assert.equal(resumed.shadowWeightsChanged,false);
});

test('truly duplicate positively predictive frozen factor scores shrink the weaker shadow-only proposal, but cannot invent a promotion',()=>{
 const history=Array.from({length:56},(_,i)=>episode(i,{duplicateFactor:true}));
 const r=evolveShadowFactors(history,{now:finalClock});
 assert.equal(r.factorRedundancy.status,'screened');
 assert.equal(r.factorRedundancy.pairs[0].relationship,'strong-positive');
 assert.equal(r.factorRedundancy.pairs[0].eligibleForSuppression,true);
 assert.deepEqual(r.factorRedundancy.suppressedFactorIds,['sector_heat']);
 assert.ok(r.proposedShadowWeights.sector_heat<1.3);
 assert.ok(r.proposedShadowWeights.leader_strength>1.3);
 assert.equal(r.status,'shadow-retained');
 assert.equal(r.shadowWeightsChanged,false);
 assert.equal(r.productionWeightsChanged,false);
 assert.equal(r.autoPromotion,false);
 assert.equal(r.canTrade,false);
});

test('rejected candidate consumes its holdout; a further trial needs five new mature independent days',()=>{
 const original=Array.from({length:56},(_,i)=>episode(i,{duplicateFactor:true}));
 const trial1=evolveShadowFactors(original,{now:finalClock});
 assert.equal(trial1.status,'shadow-retained');
 assert.equal(trial1.trialAudit.status,'consumed');
 assert.equal(trial1.trialAudit.trialNumber,1);
 assert.equal(trial1.trialAudit.firstHoldoutDay,dates[49]);
 assert.equal(trial1.trialAudit.lastHoldoutDay,dates[55]);
 assert.equal(trial1.trialAudit.holdoutDays,7);
 assert.equal(trial1.canTrade,false);
 assert.equal(trial1.productionWeightsChanged,false);
 assert.throws(()=>evolveShadowFactors(original,{now:finalClock,previousTrial:trial1}),
  /新增独立试验保留日不足/);
 const partial=Array.from({length:60},(_,i)=>episode(i,{duplicateFactor:true}));
 assert.throws(()=>evolveShadowFactors(partial,{now:finalClock,previousTrial:trial1}),
  /新增独立试验保留日不足/);
 const next=Array.from({length:61},(_,i)=>episode(i,{duplicateFactor:true}));
 const trial2=evolveShadowFactors(next,{now:finalClock,previousTrial:trial1});
 assert.equal(trial2.trialAudit.status,'consumed');
 assert.equal(trial2.trialAudit.trialNumber,2);
 assert.equal(trial2.trialAudit.previousTrialFingerprint,trial1.fingerprint);
 assert.equal(trial2.trialAudit.firstHoldoutDay,dates[56]);
 assert.equal(trial2.trialAudit.lastHoldoutDay,dates[60]);
 assert.equal(trial2.trialAudit.holdoutDays,5);
 assert.equal(trial2.holdout.firstFreshDay,dates[56]);
 assert.equal(trial2.testDays,5);
 assert.equal(trial2.productionWeightsChanged,false);
 const thirdEvidence=Array.from({length:66},(_,i)=>episode(i,{duplicateFactor:true}));
 const trial3=evolveShadowFactors(thirdEvidence,{now:finalClock,previousTrial:trial2});
 assert.equal(trial3.trialAudit.trialNumber,3);
 assert.equal(trial3.trialAudit.firstHoldoutDay,dates[61]);
 assert.equal(trial3.trialAudit.previousTrialFingerprint,trial2.fingerprint);
});
test('tampered or unrelated rejected model evidence cannot reset a spent-holdout ledger',()=>{
 const original=Array.from({length:56},(_,i)=>episode(i,{duplicateFactor:true}));
 const trial=evolveShadowFactors(original,{now:finalClock});
 const next=Array.from({length:61},(_,i)=>episode(i,{duplicateFactor:true}));
 assert.throws(()=>evolveShadowFactors(next,{now:finalClock,
  previousTrial:{...trial,trialAudit:{...trial.trialAudit,trialNumber:999}}}),
  /历史试验账本完整性或样本血缘无效/);
 const changed=structuredClone(next);
 changed[1].features.features[0].values.sector_heat=9;
 assert.throws(()=>evolveShadowFactors(changed,{now:finalClock,previousTrial:trial}),
  /指纹|冻结|来源/);
 const unrelated=evolveShadowFactors(Array.from({length:56},(_,i)=>episode(i)),
  {now:finalClock});
 assert.throws(()=>evolveShadowFactors(next,{now:finalClock,previousTrial:unrelated}),
  /历史试验账本完整性或样本血缘无效/);
});
test('worker persists rejected-trial audit across restart and refuses overlapping holdout replay',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-shadow-trial-ledger-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const manifestFile=path.join(dir,'manifest.json'),outputDir=path.join(dir,'private');
 const saved=[];
 const append=(start,end)=>{
  for(let i=start;i<end;i++){
   const e=episode(i,{duplicateFactor:true});
   const featuresFile=path.join(dir,'f'+i+'.json'),reportFile=path.join(dir,'r'+i+'.json');
   fs.writeFileSync(featuresFile,JSON.stringify(e.features));
   fs.writeFileSync(reportFile,JSON.stringify(e.report));
   saved.push({featuresFile,reportFile});
  }
  fs.writeFileSync(manifestFile,JSON.stringify({schemaVersion:1,episodes:saved}));
 };
 append(0,56);
 const opts={manifestFile,outputDir,now:finalClock};
 const first=runShadowWorker(opts);
 assert.equal(first.status,'shadow-retained');
 const start=latestTrial(outputDir,null);
 assert.equal(start.trialAudit.trialNumber,1);
 assert.equal(start.trialAudit.lastHoldoutDay,dates[55]);
 assert.equal(fs.statSync(path.join(outputDir,fs.readdirSync(outputDir)[0])).mode&0o777,0o600);
 const replay=runShadowWorker(opts);
 assert.equal(replay.status,'skipped-no-new-trial-holdout');
 assert.equal(fs.readdirSync(outputDir).length,1);
 append(56,60);
 const tooSoon=runShadowWorker(opts);
 assert.equal(tooSoon.status,'skipped-no-new-trial-holdout');
 assert.equal(fs.readdirSync(outputDir).length,1);
 append(60,61);
 const second=runShadowWorker(opts);
 assert.equal(second.status,'shadow-retained');
 assert.equal(fs.readdirSync(outputDir).length,2);
 const latest=latestTrial(outputDir,null);
 assert.equal(latest.trialAudit.trialNumber,2);
 assert.equal(latest.trialAudit.previousTrialFingerprint,start.fingerprint);
 assert.equal(latest.trialAudit.firstHoldoutDay,dates[56]);
 assert.equal(latest.trialAudit.lastHoldoutDay,dates[60]);
 const oldFile=fs.readdirSync(outputDir).find(x=>x.includes(start.fingerprint.slice(0,12)));
 fs.writeFileSync(path.join(outputDir,oldFile),'{"corrupt":true}');
 assert.throws(()=>latestTrial(outputDir,null),/档案结构无效|被篡改/);
});

test('market-shock pause still spends an inspected holdout and a later context toggle cannot replay it',()=>{
 const initial=Array.from({length:56},(_,i)=>episode(i));
 const marketContext={
  schemaVersion:1,source:'imported',simulated:false,provider:'market-test',
  tradeDate:'2026-11-10',observedAt:finalClock-30000,coverage:1,
  breadth:{source:'market-test',observedAt:finalClock-30000,upPct:10},
  indices:{
   shanghai:{source:'market-test',observedAt:finalClock-30000,changePct:-3.8},
   shenzhen:{source:'market-test',observedAt:finalClock-30000,changePct:-4.1}
  }
 };
 const paused=evolveShadowFactors(initial,{now:finalClock,marketContext});
 assert.equal(paused.status,'paused-market-shock');
 assert.equal(paused.trialAudit.status,'consumed');
 assert.equal(paused.trialAudit.trialNumber,1);
 assert.equal(paused.productionWeightsChanged,false);
 assert.throws(()=>evolveShadowFactors(initial,{now:finalClock,previousTrial:paused}),
  /新增独立试验保留日不足/);
 const later=evolveShadowFactors(Array.from({length:61},(_,i)=>episode(i)),
  {now:finalClock,previousTrial:paused});
 assert.equal(later.trialAudit.trialNumber,2);
 assert.equal(later.trialAudit.previousTrialFingerprint,paused.fingerprint);
 assert.equal(later.trialAudit.firstHoldoutDay,dates[56]);
 assert.equal(later.productionWeightsChanged,false);
});

test('shadow worker single-writer lock refuses competing writers and cleans up after errors',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-shadow-single-writer-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const outputDir=path.join(dir,'research-models'),manifestFile=path.join(dir,'manifest.json');
 const lockFile=path.join(outputDir,'.shadow-worker.lock');
 fs.mkdirSync(outputDir,{recursive:true});
 fs.writeFileSync(manifestFile,JSON.stringify({schemaVersion:1,
  episodes:Array.from({length:36},()=>({
   featuresFile:path.join(dir,'missing-f.json'),
   reportFile:path.join(dir,'missing-r.json')
  }))}));
 fs.writeFileSync(lockFile,'other-worker-still-active', {mode:0o600});
 assert.throws(()=>runShadowWorker({manifestFile,outputDir,now:finalClock}),
  /独占锁/);
 assert.equal(fs.readFileSync(lockFile,'utf8'),'other-worker-still-active');
 fs.unlinkSync(lockFile);
 assert.throws(()=>runShadowWorker({manifestFile,outputDir,now:finalClock}),
  /ENOENT/);
 assert.equal(fs.existsSync(lockFile),false);
 // Existing end-to-end regression: a truly invalid manifest must not even
 // create the research model directory or its lock.
 fs.rmSync(outputDir,{recursive:true});
 fs.writeFileSync(manifestFile,JSON.stringify({schemaVersion:1,episodes:[]}));
 assert.throws(()=>runShadowWorker({manifestFile,outputDir,now:finalClock}),
  /需要完整时间排序研究批次目录/);
 assert.equal(fs.existsSync(outputDir),false);
});

test('strict candidate preregistration seals exact bounded weights before NEXT signal and preserves them in restarted shadow evaluations',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-precommitted-trial-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const manifestFile=path.join(dir,'manifest.json'),
  outputDir=path.join(dir,'private'),candidateFile=path.join(dir,'candidate.json');
 const saved=[];
 const append=(from,to)=>{
  for(let i=from;i<to;i++){
   const e=episode(i),featuresFile=path.join(dir,'f'+i+'.json'),
    reportFile=path.join(dir,'r'+i+'.json');
   fs.writeFileSync(featuresFile,JSON.stringify(e.features));
   fs.writeFileSync(reportFile,JSON.stringify(e.report));
   saved.push({featuresFile,reportFile});
  }
  fs.writeFileSync(manifestFile,JSON.stringify({schemaVersion:1,episodes:saved}));
 };
 append(0,56);
 const nowAfterPriorMaturity=at(dates[60],'16:05:00');
 const initial=runShadowWorker({manifestFile,outputDir,now:nowAfterPriorMaturity});
 assert.equal(initial.status,'shadow-updated');
 const accepted=latestAccepted(outputDir);
 assert.ok(accepted&&accepted.fingerprint===initial.fingerprint);
 const proposed={sector_heat:+(accepted.shadowWeights.sector_heat*1.02).toFixed(8),
  leader_strength:+(accepted.shadowWeights.leader_strength*.98).toFixed(8)};
 fs.writeFileSync(candidateFile,JSON.stringify(proposed));
 const registered=runRegister({manifestFile,outputDir,candidateWeightsFile:candidateFile,
  now:nowAfterPriorMaturity});
 assert.equal(registered.status,'candidate-preregistered');
 assert.equal(fs.readdirSync(outputDir).filter(x=>x.startsWith('prereg-')).length,1);
 assert.equal(latestCandidateRegistration(outputDir,accepted,null).fingerprint,
  registered.fingerprint);
 assert.throws(()=>runRegister({manifestFile,outputDir,candidateWeightsFile:candidateFile,
  now:nowAfterPriorMaturity}),/已存在预注册候选/);
 assert.equal(parseShadowWorker(['once',manifestFile,outputDir,
  '--require-prereg']).requirePreRegistration,true);
 append(61,66); // New signal days strictly AFTER registration (days 56-60 are not reused).
 const checked=runShadowWorker({manifestFile,outputDir,
  now:at(dates[70],'16:05:00'),requirePreRegistration:true});
 assert.ok(['shadow-retained','shadow-updated','paused-shadow-decay'].includes(checked.status));
 const archived=JSON.parse(fs.readFileSync(path.join(outputDir,
  fs.readdirSync(outputDir).find(x=>x.includes(checked.fingerprint.slice(0,12)))), 'utf8'));
 assert.equal(archived.preregistration.status,'candidate-committed-before-new-signal');
 assert.equal(archived.preregistration.registrationFingerprint,registered.fingerprint);
 assert.equal(archived.preregistration.holdoutFirstDay,dates[61]);
 assert.deepEqual(archived.proposedShadowWeights,proposed);
 assert.equal(archived.globalTrialBudget.status,'budget-available');
 assert.equal(archived.globalTrialBudget.consumedThisRun,true);
 assert.equal(archived.productionWeightsChanged,false);
 assert.equal(archived.canTrade,false);
});
test('strict worker refuses unregistered candidate before reading its forward reports',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-prereg-required-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const manifestFile=path.join(dir,'manifest.json'),outputDir=path.join(dir,'private');
 const episodes=Array.from({length:56},(_,i)=>{
  const e=episode(i),ff=path.join(dir,'f'+i+'.json'),
   rf=path.join(dir,'missing-unreadable-report-'+i+'.json');
  fs.writeFileSync(ff,JSON.stringify(e.features));
  return {featuresFile:ff,reportFile:rf};
 });
 fs.writeFileSync(manifestFile,JSON.stringify({schemaVersion:1,episodes}));
 assert.throws(()=>runShadowWorker({manifestFile,outputDir,now:finalClock,
  requirePreRegistration:true}),/候选预注册缺失/);
 assert.equal(fs.existsSync(path.join(outputDir,'.shadow-worker.lock')),false);
 assert.deepEqual(fs.readdirSync(outputDir),[]);
});
test('worker global trial scanner checks hash integrity and sums across different shadow parents',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-global-budget-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const pack=require('../strategies/extended-factor-pack.json');
 const packFingerprint=crypto.createHash('sha256').update(JSON.stringify(pack)).digest('hex');
 const signalDays=dates.slice(0,95);
 for(let i=0;i<6;i++){
  const payload={mode:'v6-factor-shadow-evolution-v1',
   packFingerprint,status:i%2?'shadow-updated':'shadow-retained',
   previousFingerprint:i%2?'unrelated-parent'+i:null,
   trainingEnd:dates[i*5+1],
   lastObservationDay:dates[i*5+6],trialAudit:{
    schemaVersion:1,status:'consumed',trialNumber:i+1,
    firstHoldoutDay:dates[i*5+2],lastHoldoutDay:dates[i*5+6],
    holdoutDays:5,candidateFingerprint:'a'.repeat(64)
   }};
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  fs.writeFileSync(path.join(dir,'shadow-'+dates[i*5+1]+'-'+fingerprint.slice(0,12)+'.json'),
   JSON.stringify({...payload,fingerprint}));
 }
 const budget=globalTrialBudget(dir,signalDays);
 assert.equal(budget.status,'budget-exhausted');
 assert.equal(budget.usedTrials,6);
 assert.equal(budget.remainingTrials,0);
 const file=fs.readdirSync(dir)[0];fs.writeFileSync(path.join(dir,file),'{"bad":true}');
 assert.throws(()=>globalTrialBudget(dir,signalDays),/档案结构无效|完整性无效/);
});

test('invalid sealed accepted parent fails closed and cannot become normal no-new-training skip',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-factor-invalid-parent-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=Array.from({length:61},(_,i)=>episode(i));
 const accepted=evolveShadowFactors(source.slice(0,56),{now:finalClock});
 assert.equal(accepted.status,'shadow-updated');
 const reseal=change=>{
  const {fingerprint,...payload}={...accepted,...change};
  return {...payload,fingerprint:crypto.createHash('sha256')
   .update(JSON.stringify(payload)).digest('hex')};
 };
 const altered=reseal({packFingerprint:'f'.repeat(64)});
 assert.throws(()=>evolveShadowFactors(source,{now:finalClock,previous:altered}),
  /血缘无效/);
 const rewound=reseal({lastObservationDay:dates[72]});
 assert.throws(()=>evolveShadowFactors(source,{now:finalClock,previous:rewound}),
  /时间倒退/);
 assert.throws(()=>evolveShadowFactors(source.slice(0,56),
  {now:finalClock,previous:accepted}),/未增加新的训练时间窗/);
 const manifestFile=path.join(dir,'manifest.json');
 const modelDir=path.join(dir,'models');
 fs.mkdirSync(modelDir,{recursive:true});
 const episodes=source.map((e,i)=>{
  const featuresFile=path.join(dir,'f'+i+'.json');
  const reportFile=path.join(dir,'r'+i+'.json');
  fs.writeFileSync(featuresFile,JSON.stringify(e.features));
  fs.writeFileSync(reportFile,JSON.stringify(e.report));
  return {featuresFile,reportFile};
 });
 fs.writeFileSync(manifestFile,JSON.stringify({schemaVersion:1,episodes}));
 const archiveName='shadow-'+altered.trainingEnd+'-'+altered.fingerprint.slice(0,12)+'.json';
 fs.writeFileSync(path.join(modelDir,archiveName),JSON.stringify(altered));
 assert.throws(()=>runShadowWorker({
  manifestFile,outputDir:modelDir,now:finalClock}),/血缘无效/);
 assert.equal(fs.existsSync(path.join(modelDir,'.shadow-worker.lock')),false);
 assert.deepEqual(fs.readdirSync(modelDir),[archiveName]);
});

test('exhausted global budget denies the next challenger before opening absent holdout price reports',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-budget-before-prices-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const outputDir=path.join(dir,'private'),manifestFile=path.join(dir,'manifest.json');
 fs.mkdirSync(outputDir,{recursive:true});
 const frozen=Array.from({length:56},(_,i)=>{
  const e=episode(i),featuresFile=path.join(dir,'f'+i+'.json');
  fs.writeFileSync(featuresFile,JSON.stringify(e.features));
  return {featuresFile,reportFile:path.join(dir,'UNAVAILABLE-H5-'+i+'.json')};
 });
 fs.writeFileSync(manifestFile,JSON.stringify({schemaVersion:1,episodes:frozen}));
 const pack=require('../strategies/extended-factor-pack.json');
 const packFingerprint=crypto.createHash('sha256')
  .update(JSON.stringify(pack)).digest('hex');
 for(let i=0;i<6;i++){
  const payload={mode:'v6-factor-shadow-evolution-v1',
   packFingerprint,status:'shadow-retained',
   previousFingerprint:'unrelated-accepted-version-'+i,
   trainingEnd:dates[i*5+1],
   lastObservationDay:dates[i*5+6],trialAudit:{
    schemaVersion:1,status:'consumed',trialNumber:i+1,
    firstHoldoutDay:dates[i*5+2],lastHoldoutDay:dates[i*5+6],
    holdoutDays:5,candidateFingerprint:'b'.repeat(64)
   }};
  const fingerprint=crypto.createHash('sha256')
   .update(JSON.stringify(payload)).digest('hex');
  fs.writeFileSync(path.join(outputDir,
   'shadow-'+dates[i*5+1]+'-'+fingerprint.slice(0,12)+'.json'),
   JSON.stringify({...payload,fingerprint}));
 }
 // Read of ANY forward reportFile above would throw ENOENT. Successful
 // budget skip therefore proves the gate runs before outcome access.
 const denied=runShadowWorker({manifestFile,outputDir,now:finalClock});
 assert.equal(denied.status,'skipped-global-trial-budget-exhausted');
 assert.equal(denied.usedTrials,6);
 assert.equal(denied.canTrade,false);
 assert.equal(denied.productionWeightsChanged,false);
 assert.equal(fs.existsSync(path.join(outputDir,'.shadow-worker.lock')),false);
 assert.equal(fs.readdirSync(outputDir).filter(x=>x.startsWith('shadow-')).length,6);
});

test('unchanged calendar must audit historical accepted evidence before returning a no-op skip',t=>{
 const original=Array.from({length:56},(_,i)=>episode(i));
 const accepted=evolveShadowFactors(original,{now:finalClock});
 assert.equal(accepted.status,'shadow-updated');
 // The new report is separately valid and re-fingerprinted, not a broken
 // checksum. Only the accepted model's historical chain reveals the drift.
 const revised=original.slice();
 revised[1]=episode(1,{reverseReturns:true});
 assert.notEqual(revised[1].report.marketFingerprint,
  original[1].report.marketFingerprint);
 assert.throws(()=>evolveShadowFactors(revised,{now:finalClock,previous:accepted}),
  /已有因子模型的历史冻结证据被替换或回写/);
 assert.throws(()=>evolveShadowFactors(original,{now:finalClock,previous:accepted}),
  /未增加新的训练时间窗/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-shadow-same-date-replay-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const manifestFile=path.join(dir,'manifest.json'),outputDir=path.join(dir,'models');
 const entries=original.map((e,i)=>{
  const featuresFile=path.join(dir,'f'+i+'.json');
  const reportFile=path.join(dir,'r'+i+'.json');
  fs.writeFileSync(featuresFile,JSON.stringify(e.features));
  fs.writeFileSync(reportFile,JSON.stringify(e.report));
  return {featuresFile,reportFile};
 });
 fs.writeFileSync(manifestFile,JSON.stringify({schemaVersion:1,episodes:entries}));
 const initial=runShadowWorker({manifestFile,outputDir,now:finalClock});
 assert.equal(initial.status,'shadow-updated');
 const beforeFiles=fs.readdirSync(outputDir);
 const same=runShadowWorker({manifestFile,outputDir,now:finalClock});
 assert.equal(same.status,'skipped-no-new-training');
 assert.deepEqual(fs.readdirSync(outputDir),beforeFiles);
 fs.writeFileSync(entries[1].reportFile,JSON.stringify(revised[1].report));
 assert.throws(()=>runShadowWorker({manifestFile,outputDir,now:finalClock}),
  /已有因子模型的历史冻结证据被替换或回写/);
 assert.deepEqual(fs.readdirSync(outputDir),beforeFiles);
 assert.equal(fs.existsSync(path.join(outputDir,'.shadow-worker.lock')),false);
});

test('a reverted input calendar cannot hide spent trials or active cooldown as a no-op',()=>{
 const base=Array.from({length:56},(_,i)=>episode(i));
 const accepted=evolveShadowFactors(base,{now:finalClock});
 assert.equal(accepted.status,'shadow-updated');
 const withFive=[...base,...Array.from({length:5},(_,i)=>episode(56+i))];
 const marketContext={
  schemaVersion:1,source:'imported',simulated:false,provider:'market-test',
  tradeDate:'2026-11-10',observedAt:finalClock-30000,coverage:1,
  breadth:{source:'market-test',observedAt:finalClock-30000,upPct:10},
  indices:{
   shanghai:{source:'market-test',observedAt:finalClock-30000,changePct:-3.8},
   shenzhen:{source:'market-test',observedAt:finalClock-30000,changePct:-4.1}
  }
 };
 const spent=evolveShadowFactors(withFive,{now:finalClock,previous:accepted,marketContext});
 assert.equal(spent.status,'paused-market-shock');
 assert.equal(spent.trialAudit.status,'consumed');
 // Accidentally restore a shorter manifest after a failed shadow trial.
 // Its train end stays identical to the accepted 56-day model, but the
 // sealed spent-holdout trial proves the research calendar advanced farther.
 const rolledBack=[...base,episode(56)];
 assert.equal(Math.floor(56*.56),Math.floor(57*.56));
 assert.throws(()=>evolveShadowFactors(rolledBack,{now:finalClock,
  previous:accepted}),/未增加新的训练时间窗/);
 assert.throws(()=>evolveShadowFactors(rolledBack,{now:finalClock,
  previous:accepted,previousTrial:spent}),/历史试验账本完整性或样本血缘无效/);
 const corrupt={...spent,trialAudit:{...spent.trialAudit,trialNumber:999}};
 assert.throws(()=>evolveShadowFactors(rolledBack,{now:finalClock,
  previous:accepted,previousTrial:corrupt}),/历史试验账本完整性或样本血缘无效/);
 const decayed=[
  ...base,...Array.from({length:5},(_,i)=>episode(56+i,{reverseReturns:true}))
 ];
 const cooldown=evolveShadowFactors(decayed,{now:finalClock,previous:accepted});
 assert.equal(cooldown.status,'paused-shadow-decay');
 assert.throws(()=>evolveShadowFactors(rolledBack,{now:finalClock,
  previous:accepted,previousCooldown:cooldown}),/历史衰减冷却证据或血缘无效/);
});

test('invalid sealed preregistration is rejected before any future holdout report is opened',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-prereg-preprice-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const outputDir=path.join(dir,'private'),manifestFile=path.join(dir,'manifest.json'),
  candidateWeightsFile=path.join(dir,'weights.json'),records=[];
 const append=(from,to,withReports)=>{
  for(let i=from;i<to;i++){
   const e=episode(i),featuresFile=path.join(dir,'f'+i+'.json'),
    reportFile=path.join(dir,'r'+i+'.json');
   fs.writeFileSync(featuresFile,JSON.stringify(e.features));
   if(withReports)fs.writeFileSync(reportFile,JSON.stringify(e.report));
   records.push({featuresFile,reportFile});
  }
  fs.writeFileSync(manifestFile,JSON.stringify({schemaVersion:1,episodes:records}));
 };
 append(0,56,true);
 const registeredAt=at(dates[60],'16:05:00');
 const accepted=runShadowWorker({manifestFile,outputDir,now:registeredAt});
 assert.equal(accepted.status,'shadow-updated');
 const parent=latestAccepted(outputDir);
 fs.writeFileSync(candidateWeightsFile,JSON.stringify(parent.shadowWeights));
 const registered=runRegister({manifestFile,outputDir,candidateWeightsFile,
  now:registeredAt});
 assert.equal(registered.status,'candidate-preregistered');
 // Subsequent features are frozen, but their forward-price reports are
 // deliberately absent. An invalid commitment must fail BEFORE ENOENT.
 append(61,66,false);
 const preregFile=path.join(outputDir,fs.readdirSync(outputDir)
  .find(x=>x.startsWith('prereg-')));
 const sealed=JSON.parse(fs.readFileSync(preregFile,'utf8'));
 const {fingerprint:_removed,...payload}=sealed;
 payload.algorithmFingerprint='f'.repeat(64);
 const resealed={...payload,fingerprint:crypto.createHash('sha256')
  .update(JSON.stringify(payload)).digest('hex')};
 fs.unlinkSync(preregFile); // adversarial mutation fixture, never production recovery
 fs.writeFileSync(path.join(outputDir,
  'prereg-'+resealed.fingerprint.slice(0,12)+'.json'),JSON.stringify(resealed));
 assert.throws(()=>runShadowWorker({manifestFile,outputDir,
  now:at(dates[70],'16:05:00'),requirePreRegistration:true}),
  /候选预注册时点、冻结前缀或模型血缘不一致/);
 assert.equal(fs.existsSync(path.join(outputDir,'.shadow-worker.lock')),false);
 assert.equal(fs.readdirSync(outputDir).filter(x=>x.startsWith('shadow-')).length,1);
});
test('strict worker treats recovered cooldown as requiring a new prereg before report access',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-recovered-prereg-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const outputDir=path.join(dir,'private'),manifestFile=path.join(dir,'manifest.json');
 fs.mkdirSync(outputDir,{recursive:true});
 const original=Array.from({length:56},(_,i)=>episode(i));
 const accepted=evolveShadowFactors(original,{now:finalClock});
 assert.equal(accepted.status,'shadow-updated');
 const seal=payload=>({...payload,fingerprint:crypto.createHash('sha256')
  .update(JSON.stringify(payload)).digest('hex')});
 const archive=result=>path.join(outputDir,'shadow-'+result.trainingEnd+'-'+
  result.fingerprint.slice(0,12)+'.json');
 fs.writeFileSync(archive(accepted),JSON.stringify(accepted));
 const recovered=seal({
  schemaVersion:1,mode:'v6-factor-shadow-evolution-v1',status:'shadow-recovered',
  trainingEnd:accepted.trainingEnd,lastObservationDay:dates[65],
  previousFingerprint:accepted.fingerprint,
  cooldown:{phase:'recovered',alertDay:dates[60],recoveryDay:dates[65],
   sourceAcceptedFingerprint:accepted.fingerprint},
  canTrade:false,productionWeightsChanged:false
 });
 fs.writeFileSync(archive(recovered),JSON.stringify(recovered));
 const entries=original.map((e,i)=>{
  const featuresFile=path.join(dir,'f'+i+'.json');
  fs.writeFileSync(featuresFile,JSON.stringify(e.features));
  return {featuresFile,reportFile:path.join(dir,'UNREADABLE-H5-'+i+'.json')};
 });
 fs.writeFileSync(manifestFile,JSON.stringify({schemaVersion:1,episodes:entries}));
 assert.throws(()=>runShadowWorker({manifestFile,outputDir,now:finalClock,
  requirePreRegistration:true}),/候选预注册缺失/);
 assert.equal(fs.existsSync(path.join(outputDir,'.shadow-worker.lock')),false);
 assert.equal(fs.readdirSync(outputDir).filter(x=>x.startsWith('shadow-')).length,2);
});

test('automatic registration uses only the last sealed research model and truly precedes future H5 holdouts',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-shadow-auto-prereg-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const manifestFile=path.join(dir,'manifest.json'),outputDir=path.join(dir,'private');
 const saved=[];
 function append(start,end,{missingReports=false}={}){
  for(let i=start;i<end;i++){
   const e=episode(i),ff=path.join(dir,'features-'+i+'.json'),
    rf=path.join(dir,'report-'+i+'.json');
   fs.writeFileSync(ff,JSON.stringify(e.features));
   if(!missingReports)fs.writeFileSync(rf,JSON.stringify(e.report));
   saved.push({featuresFile:ff,reportFile:rf});
  }
  fs.writeFileSync(manifestFile,JSON.stringify({schemaVersion:1,episodes:saved}));
 }
 append(0,56);
 const now=at(dates[60],'16:05:00');
 assert.equal(parseShadowWorker(['register-auto',manifestFile,outputDir]).mode,'register-auto');
 assert.throws(()=>parseShadowWorker(['register-auto',manifestFile,outputDir,
  '--interval','60000']),/不接受外部权重/);
 assert.throws(()=>runRegisterAuto({manifestFile,outputDir,now}),
  /尚无已封存历史研究报告/);
 assert.equal(fs.readdirSync(outputDir).filter(x=>x.startsWith('prereg-')).length,0);
 const prior=runShadowWorker({manifestFile,outputDir,now});
 assert.equal(prior.status,'shadow-updated');
 const accepted=latestAccepted(outputDir);
 assert.equal(accepted.fingerprint,prior.fingerprint);
 const precommit=runRegisterAuto({manifestFile,outputDir,now});
 assert.equal(precommit.status,'candidate-auto-preregistered');
 assert.equal(precommit.sourceFingerprint,prior.fingerprint);
 const pre=latestCandidateRegistration(outputDir,accepted,null);
 assert.equal(pre.candidateOrigin,'sealed-historical-training-reliability-v1');
 assert.equal(pre.autoSourceFingerprint,prior.fingerprint);
 assert.ok(Object.keys(pre.candidateWeights).every(id=>
  Math.abs(pre.candidateWeights[id]/pre.acceptedWeights[id]-1)<=.0800001));
 assert.throws(()=>runRegisterAuto({manifestFile,outputDir,now}),
  /已存在预注册候选/);
 append(61,66);
 const output=runShadowWorker({manifestFile,outputDir,
  now:at(dates[70],'16:05:00'),requirePreRegistration:true});
 assert.ok(['shadow-updated','shadow-retained','paused-shadow-decay'].includes(output.status));
 const stored=JSON.parse(fs.readFileSync(path.join(outputDir,
  fs.readdirSync(outputDir).find(x=>x.includes(output.fingerprint.slice(0,12)))), 'utf8'));
 assert.equal(stored.preregistration.status,'candidate-committed-before-new-signal');
 assert.equal(stored.preregistration.registrationFingerprint,precommit.fingerprint);
 assert.deepEqual(stored.proposedShadowWeights,pre.candidateWeights);
 assert.equal(stored.canTrade,false);
 assert.equal(stored.productionWeightsChanged,false);
 assert.equal(fs.existsSync(path.join(outputDir,'.shadow-worker.lock')),false);
});
test('auto registration fails before opening any forward label when prior sealed model is missing',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-auto-prereg-no-price-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const manifestFile=path.join(dir,'manifest.json'),outputDir=path.join(dir,'research');
 const records=Array.from({length:36},(_,i)=>{
  const e=episode(i),featuresFile=path.join(dir,'f'+i+'.json');
  fs.writeFileSync(featuresFile,JSON.stringify(e.features));
  return {featuresFile,reportFile:path.join(dir,'never-created-'+i+'.json')};
 });
 fs.writeFileSync(manifestFile,JSON.stringify({schemaVersion:1,episodes:records}));
 assert.throws(()=>runRegisterAuto({manifestFile,outputDir,now:finalClock}),
  /尚无已封存历史研究报告/);
 assert.equal(fs.readdirSync(outputDir).length,0);
});
