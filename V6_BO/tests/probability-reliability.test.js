'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {register,freezePrediction,evaluate}=require('../src/core/probability-reliability');
// Artificial calendar/labels are explicitly test-scope; never formal evidence.
const dates=Array.from({length:80},(_,i)=>new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10));
const time=(i,h='15:10')=>Date.parse(dates[i]+'T'+h+':00+08:00');
const calendar={schemaVersion:1,exchange:'SSE',source:'test-fixture',from:dates[0],to:dates.at(-1),sessions:dates.map(date=>({date,open:true}))};
const modelFingerprint='a'.repeat(64),sourceFingerprint='b'.repeat(64);
const spec={scope:'test',source:'test-fixture',target:'ztNext',modelVersion:'test-v1',modelFingerprint,trainingEndedAt:time(0),calibrationStartAt:time(1,'09:00'),validationStartAt:time(30,'09:00'),validationEndAt:time(60,'16:00'),horizonTradingDays:1};
const plan=register(spec,{now:time(0,'16:00')});
function prediction(i,j=0,patch={}){const t=time(i,'10:00');return freezePrediction(plan,{scope:'test',source:'test-fixture',id:String(i)+"-"+j,code:String(j+1).padStart(6,'0'),sourceFingerprint,target:spec.target,modelVersion:spec.modelVersion,modelFingerprint,value:.55,predictedAt:t,observedAt:t,...patch},calendar,{now:t});}
function label(f,value=true,patch={}){return {scope:'test',source:'test-fixture',sourceFingerprint,predictionId:f.id,predictionFingerprint:f.fingerprint,target:f.target,targetDay:f.targetDay,value,quality:'standard',availableAt:Date.parse(f.targetDay+'T15:10:00+08:00'),...patch};}
test('empty, immature and missing labels stay unknown',()=>{const f=prediction(31);const r=evaluate(plan,[f],[label(f)],calendar,{now:time(31)});assert.equal(r.validationRaw.brier,null);assert.equal(r.exclusions['invalid-or-unmatured-label'],1);assert.equal(r.calibrationCertified,false);assert.equal(r.status,'fixture-only');});
test('target, model, late input and repeat signal cannot cross the contract',()=>{assert.throws(()=>prediction(5,0,{target:'upNext'}),/不匹配/);assert.throws(()=>prediction(5,0,{modelVersion:'v2'}),/不匹配/);assert.throws(()=>prediction(5,0,{observedAt:time(6)}),/未来/);const f=prediction(5);assert.throws(()=>evaluate(plan,[f,f],[],calendar,{now:time(70)}),/重复/);assert.throws(()=>evaluate(plan,[{...f,value:.9}],[],calendar,{now:time(70)}),/指纹/);});
test('labels overlapping the split or arriving late are purged',()=>{const a=prediction(29),b=prediction(28);const r=evaluate(plan,[a,b],[label(a),label(b,true,{availableAt:time(30)})],calendar,{now:time(70)});assert.equal(r.exclusions['purged-overlapping-or-late-calibration-label'],2);assert.equal(r.calibration.samples,0);});
test('calibration uses earlier labels only; metrics compare identical holdout rows',()=>{const fs=[];for(const start of [2,32])for(let i=start;i<start+20;i++)for(let j=0;j<5;j++)fs.push(prediction(i,j));const ys=fs.map(f=>label(f,f.phase==='calibration'?f.code!=='000005':f.code==='000001'));const r=evaluate(plan,fs,ys,calendar,{now:time(70)});assert.equal(r.calibration.samples,100);assert.equal(r.validationRaw.samples,100);assert.equal(r.validationCalibrated.samples,100);assert.equal(r.comparisonOnIdenticalRows,true);assert.ok(r.validationCalibrated.brier>r.validationRaw.brier);assert.equal(r.calibrationCertified,false);assert.equal(r.canApprove,false);const altered=evaluate(plan,fs,ys.map(y=>y.predictionId.startsWith('32-')?{...y,value:!y.value}:y),calendar,{now:time(70)});assert.deepEqual(altered.calibration,r.calibration);});
test('test labels cannot become formal or net settlement labels',()=>{assert.throws(()=>register({...spec,scope:'formal'},{now:time(0,'16:00')}),/登记/);const f=prediction(31);const r=evaluate(plan,[f],[label(f,true,{scope:'formal'})],calendar,{now:time(70)});assert.equal(r.validationRaw.samples,0);assert.equal(r.exclusions['invalid-or-unmatured-label'],1);});

test('missing eligible calibration labels cannot be hidden by a sufficient holdout or by scheduled purge',()=>{
 const formal=register({...spec,scope:'formal',source:'unit-research-source'},{now:time(0,'16:00')});
 const fs=[];
 for(const [start,count] of [[2,21],[32,20],[29,1]])for(let i=start;i<start+count;i++)for(let j=0;j<5;j++){
  const t=time(i,'10:00');fs.push(freezePrediction(formal,{scope:'formal',source:'unit-research-source',id:i+'-'+j,
   code:String(j+1).padStart(6,'0'),sourceFingerprint,target:spec.target,modelVersion:spec.modelVersion,
   modelFingerprint,value:.55,predictedAt:t,observedAt:t},calendar,{now:t}));
 }
 const labels=fs.map(f=>label(f,f.phase==='calibration'?f.code!=='000005':f.code==='000001',
   {scope:'formal',source:'unit-research-source'}));
 const complete=evaluate(formal,fs,labels,calendar,{now:time(70)});
 assert.equal(complete.expectedCalibration,105);assert.equal(complete.scheduledPurgedCalibration,5);
 assert.equal(complete.completeCalibrationEvidence,true);assert.equal(complete.calibrationCoverage,1);
 assert.equal(complete.status,'descriptive-holdout-evaluated');
 const partial=evaluate(formal,fs,labels.filter(y=>y.predictionId!=='2-0'),calendar,{now:time(70)});
 assert.equal(partial.calibration.samples,104);assert.equal(partial.expectedCalibration,105);
 assert.equal(partial.validationRaw.samples,100);assert.equal(partial.comparisonOnIdenticalRows,true);
 assert.equal(partial.completeCalibrationEvidence,false);assert.equal(partial.calibrationCoverage,104/105);
 assert.equal(partial.status,'insufficient-or-incomplete-evidence');assert.equal(partial.canApprove,false);
});

test('a probability cannot be a declared score or a numeric security identifier',()=>{
 for(const patch of [{kind:'ranking-score'},{valueKind:'score'},{probKind:'frequency'},{code:600001}])
  assert.throws(()=>prediction(5,0,patch),/预测证据无效/);
 assert.equal(prediction(5,0,{kind:'model-estimate',value:0}).value,0);
 assert.equal(prediction(5,0,{value:1}).value,1);
});
test('direct core freeze rejects a target whose maturity crosses the registered end',()=>{
 assert.throws(()=>prediction(60),/标签成熟窗口超出/);
 assert.equal(prediction(59).targetDay,dates[60]);
});
test('mature partial validation labels stay hidden until the registered window closes',()=>{
 const f=prediction(31),y=label(f,true);
 const before=evaluate(plan,[f],[y],calendar,{now:time(33)});
 assert.equal(before.validationWindowClosed,false);assert.equal(before.validationRaw.samples,0);
 assert.equal(before.validationRaw.brier,null);assert.equal(before.validationCalibrated.brier,null);
 assert.equal(before.pairedComparison.status,'withheld-until-window-close');
 const after=evaluate(plan,[f],[y],calendar,{now:time(61)});
 assert.equal(after.validationWindowClosed,true);assert.equal(after.validationRaw.samples,1);
 assert.ok(after.validationRaw.brier>0);assert.equal(after.canApprove,false);
});
test('original label receipt cannot be invalid, immature or later than actual study availability',()=>{
 const f=prediction(31),closeAt=time(32,'15:00');
 for(const sourceAvailableAt of [null,0,NaN,closeAt-1,time(35)])
  assert.equal(evaluate(plan,[f],[label(f,true,{sourceAvailableAt})],calendar,{now:time(70)}).exclusions['invalid-or-unmatured-label'],1);
 assert.equal(evaluate(plan,[f],[label(f,true,{sourceAvailableAt:closeAt})],calendar,{now:time(70)}).validationRaw.samples,1);
});
test('explicit simulated or nonstandard declarations cannot enter the formal core API',()=>{
 const formalSpec={...spec,scope:'formal',source:'unit-research-source'};
 const markers=[{simulated:true},{sampleSet:'demo'},{sampleSet:'test'},{synthetic:'是'},{blackSwan:true},{extremeMarket:true},{repeatable:false},{quality:'教学样本'}];
 for(const patch of markers)assert.throws(()=>register({...formalSpec,...patch},{now:time(0,'16:00')}),/登记/);
 const formal=register(formalSpec,{now:time(0,'16:00')});
 const t=time(31,'10:00'),input={scope:'formal',source:formalSpec.source,id:'31-0',code:'600001',sourceFingerprint,target:spec.target,
 modelVersion:spec.modelVersion,modelFingerprint,value:.5,predictedAt:t,observedAt:t};
 for(const patch of markers)assert.throws(()=>freezePrediction(formal,{...input,...patch},calendar,{now:t}),/预测证据/);
 const f=freezePrediction(formal,input,calendar,{now:t});
 for(const patch of markers){
  const r=evaluate(formal,[f],[label(f,true,{scope:'formal',source:formalSpec.source,...patch})],calendar,{now:time(70)});
  assert.equal(r.validationRaw.samples,0);
 }
});
function pairedFixture({partial=false,missingCalibration=false}={}){
 const fs=[];
 for(const start of [2,32])for(let i=start;i<start+20;i++)for(let j=0;j<5;j++)
  fs.push(prediction(i,j,{value:partial&&i>=32&&j===4?.95:.55}));
 const ys=fs.map(f=>label(f,f.phase==='calibration'?f.code!=='000005':f.code==='000001'));
 return {fs,ys:missingCalibration?ys.slice(1):ys};
}
test('unmapped bins use exactly the same comparison rows and a calibration-only baseline',()=>{
 const {fs,ys}=pairedFixture({partial:true}),r=evaluate(plan,fs,ys,calendar,{now:time(70)}),p=r.pairedComparison;
 assert.equal(r.validationRaw.samples,100);assert.equal(r.validationCalibrated.samples,80);
 assert.equal(r.comparisonOnIdenticalRows,false);assert.equal(r.calibratedCoverage,.8);
 assert.equal(p.status,'partial-descriptive');assert.equal(p.raw.samples,80);
 assert.equal(p.calibrated.samples,80);assert.equal(p.baseline.samples,80);
 assert.equal(p.calibrationBaseRate,.8);assert.equal(p.improvedBrierOnCompleteHoldout,null);
 assert.equal(p.pairedBrierDelta,p.calibrated.brier-p.raw.brier);
 assert.equal(p.pairedBaselineBrierDelta,p.calibrated.brier-p.baseline.brier);
 assert.equal(p.calibrationCertified,false);
});
test('complete comparison distinguishes worsening calibration from a true improvement',()=>{
 const {fs,ys}=pairedFixture(),r=evaluate(plan,fs,ys,calendar,{now:time(70)}),p=r.pairedComparison;
 assert.equal(p.status,'complete-descriptive');assert.equal(p.samples,100);
 assert.equal(p.raw.brier,r.validationRaw.brier);assert.equal(p.calibrated.brier,r.validationCalibrated.brier);
 assert.equal(p.improvedBrierOnCompleteHoldout,false);
 assert.equal(p.pairedBaselineBrierDelta,0);assert.equal(r.calibrationCertified,false);
});
test('incomplete calibration never becomes a complete improvement claim',()=>{
 const {fs,ys}=pairedFixture({missingCalibration:true});
 const r=evaluate(plan,fs,ys,calendar,{now:time(70)});
 assert.equal(r.completeCalibrationEvidence,false);
 assert.equal(r.pairedComparison.improvedBrierOnCompleteHoldout,null);
 assert.equal(r.canTrade,false);assert.equal(r.canApprove,false);
});

test('labels cannot contradict the original frozen security, model, calendar or horizon identity',()=>{
 const f=prediction(31),identity={code:f.code,symbol:f.code,signalDay:f.signalDay,predictedAt:f.predictedAt,
  modelVersion:f.modelVersion,modelFingerprint:f.modelFingerprint,planFingerprint:f.planFingerprint,
  calendarFingerprint:f.calendarFingerprint,horizonTradingDays:spec.horizonTradingDays};
 const patches=[{code:'600000'},{symbol:'600000'},{code:null},{signalDay:dates[30]},
  {predictedAt:f.predictedAt+1},{modelVersion:'v2'},{modelFingerprint:'c'.repeat(64)},
  {planFingerprint:'d'.repeat(64)},{calendarFingerprint:'e'.repeat(64)},{horizonTradingDays:5}];
 for(const patch of patches){
  const r=evaluate(plan,[f],[label(f,true,{...identity,...patch})],calendar,{now:time(70)});
  assert.equal(r.validationRaw.samples,0);assert.equal(r.exclusions['invalid-or-unmatured-label'],1);
 }
 assert.equal(evaluate(plan,[f],[label(f,true,identity)],calendar,{now:time(70)}).validationRaw.samples,1);
 assert.equal(evaluate(plan,[f],[label(f)],calendar,{now:time(70)}).validationRaw.samples,1);
});

test('unlabeled frozen holdout forecasts stay in the full-population coverage denominator',()=>{
 const {fs,ys}=pairedFixture();
 for(let i=32;i<52;i++)fs.push(prediction(i,5));
 const r=evaluate(plan,fs,ys,calendar,{now:time(70)});
 assert.equal(r.calibratedCoverage,1);
 assert.deepEqual(r.holdoutCoverage,{frozen:120,eligible:100,calibrated:100,
  eligibleFraction:100/120,calibratedFraction:100/120});
 assert.equal(r.pairedComparison.status,'partial-descriptive');
 assert.equal(evaluate(plan,fs,ys,calendar,{now:time(55)}).holdoutCoverage,null);
});

test('sealed coverage retains zero counts and withholds ratios for missing or conflicting historical counts',()=>{
 const {frozenHoldoutCoverage}=require('../src/core/probability-reliability');
 const report={validationWindowClosed:true,expectedValidation:2,validationRaw:{samples:0},validationCalibrated:{samples:0}};
 assert.equal(frozenHoldoutCoverage(report).calibratedFraction,0);
 assert.deepEqual(frozenHoldoutCoverage({...report,expectedValidation:0}),{frozen:0,eligible:0,calibrated:0,eligibleFraction:null,calibratedFraction:null});
 assert.equal(frozenHoldoutCoverage({...report,expectedValidation:undefined}),null);
 assert.equal(frozenHoldoutCoverage({...report,validationCalibrated:{samples:1}}),null);
 assert.equal(frozenHoldoutCoverage({...report,pairedComparison:{expectedValidation:4}}),null);
});
