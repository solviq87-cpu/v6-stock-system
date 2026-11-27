'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {register,freezePrediction,evaluate,POLICY}=require('../src/core/probability-reliability');
const dates=Array.from({length:80},(_,i)=>new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10));
const time=(i,h='15:10')=>Date.parse(dates[i]+'T'+h+':00+08:00');
const calendar={schemaVersion:1,exchange:'SSE',source:'test-fixture',from:dates[0],to:dates.at(-1),sessions:dates.map(date=>({date,open:true}))};
const modelFingerprint='a'.repeat(64),sourceFingerprint='b'.repeat(64);
const spec={scope:'test',source:'test-fixture',target:'ztNext',modelVersion:'test-v1',modelFingerprint,trainingEndedAt:time(0),calibrationStartAt:time(1,'09:00'),validationStartAt:time(30,'09:00'),validationEndAt:time(60,'16:00'),horizonTradingDays:1};
const registeredAt=time(0,'16:00'),plan=register(spec,{now:registeredAt});
const formalSpec={...spec,scope:'formal',source:'unit-research-source'},formal=register(formalSpec,{now:registeredAt});
const input=(i,j=0,p=.55,study=plan)=>({scope:study.scope,source:study.source,id:i+'-'+j,code:String(j+1).padStart(6,'0'),sourceFingerprint,target:study.target,modelVersion:study.modelVersion,modelFingerprint,value:p,predictedAt:time(i,'10:00'),observedAt:time(i,'10:00')});
const freeze=(i,j=0,p=.55,study=plan)=>freezePrediction(study,input(i,j,p,study),calendar,{now:time(i,'10:00')});
const label=(f,value,patch={})=>({scope:f.scope,source:f.source,sourceFingerprint,predictionId:f.id,predictionFingerprint:f.fingerprint,target:f.target,targetDay:f.targetDay,value,quality:'standard',availableAt:Date.parse(f.targetDay+'T15:10:00+08:00'),...patch});
const run=(fs,ys,now=time(70),study=plan)=>evaluate(study,fs,ys,calendar,{now});
function pairFixture({calibrationP=.55,fitValue=(_i,j)=>j<3,holdoutP=()=>.55,holdoutValue=(_i,j)=>j<4,concentratedDays=0}={}){
 const fs=[],ys=[];const add=(i,j,p,y)=>{const f=freeze(i,j,p);fs.push(f);ys.push(label(f,y));};
 for(let i=2;i<22;i++)for(let j=0;j<5;j++)add(i,j,calibrationP,fitValue(i,j));
 for(let k=0;k<20&&concentratedDays;k++)add(2+k%concentratedDays,10+k,.95,k%2===0);
 for(let i=32;i<52;i++)for(let j=0;j<5;j++)add(i,j,holdoutP(i,j),holdoutValue(i,j));
 return {fs,ys};
}
function near(actual,expected){assert.ok(Math.abs(actual-expected)<1e-12,`${actual} != ${expected}`);}
test('inherited plan and prediction fields cannot provide explicit research evidence',()=>{
 assert.throws(()=>register(Object.create(spec),{now:registeredAt}),/登记/);
 assert.throws(()=>freezePrediction(plan,Object.create(input(31)),calendar,{now:time(31,'10:00')}),/预测证据/);
});
test('plan and raw prediction accessors reject before invoking a getter',()=>{
 let reads=0;const p={...spec},x=input(31);Object.defineProperty(p,'source',{enumerable:true,get(){reads++;return spec.source;}});Object.defineProperty(x,'value',{enumerable:true,get(){reads++;return .5;}});
 assert.throws(()=>register(p,{now:registeredAt}),/登记/);assert.throws(()=>freezePrediction(plan,x,calendar,{now:x.predictedAt}),/预测证据/);assert.equal(reads,0);
});
test('sealed forecast accessor and label accessor or inheritance reject without reading',()=>{
 const f=freeze(31),copy={...f},y=label(f,true);let reads=0;
 Object.defineProperty(copy,'value',{enumerable:true,get(){reads++;return f.value;}});
 Object.defineProperty(y,'value',{enumerable:true,get(){reads++;return true;}});
 assert.throws(()=>run([copy],[]),/显式数据/);assert.throws(()=>run([f],[y]),/显式数据标签/);assert.throws(()=>run([f],[Object.create(label(f,true))]),/显式数据标签/);assert.equal(reads,0);
});
test('ambiguous formal source flags are not explicit non-simulated evidence',()=>{
 for(const flags of [{simulated:0},{synthetic:null},{repeatable:null},{replicable:0},{blackSwan:undefined}]){
  assert.throws(()=>register({...formalSpec,...flags},{now:registeredAt}),/登记/);
  assert.throws(()=>freezePrediction(formal,{...input(31,0,.5,formal),...flags},calendar,{now:time(31,'10:00')}),/预测证据/);
  const f=freeze(31,0,.5,formal),r=run([f],[label(f,true,flags)],time(70),formal);assert.equal(r.exclusions['invalid-or-unmatured-label'],1);assert.equal(r.validationRaw.samples,0);
 }
});
test('explicit false source flags and explicit model-estimate or legacy omitted kind remain compatible',()=>{
 const p=register({...formalSpec,simulated:false,repeatable:true},{now:registeredAt});
 const f=freezePrediction(p,{...input(31,0,0,p),kind:'model-estimate',replicable:true},calendar,{now:time(31,'10:00')});
 assert.equal(f.value,0);assert.equal(run([f],[label(f,false,{simulated:false})],time(70),p).validationRaw.samples,1);assert.equal(freeze(31,0,1).value,1);
});
test('explicit unknown probability kind cannot be frozen as an estimate',()=>{
 for(const k of ['kind','valueKind','probKind'])assert.throws(()=>freezePrediction(plan,{...input(31),[k]:null},calendar,{now:time(31,'10:00')}),/预测证据/);
});
test('decision clocks outside representable four-digit China dates are rejected',()=>{
 assert.throws(()=>register({...spec,validationEndAt:253402300799999},{now:registeredAt}),/登记/);
 assert.throws(()=>run([],[],253402300799999),/研究输入/);
});
test('a bin with many rows but only one signal day is not calibrated',()=>{
 const {fs,ys}=pairFixture({concentratedDays:1,holdoutP:(_i,j)=>j===4?.95:.55}),r=run(fs,ys);
 assert.equal(r.validationRaw.samples,100);assert.equal(r.validationCalibrated.samples,80);assert.equal(r.calibrationBinEvidence[9].samples,20);assert.equal(r.calibrationBinEvidence[9].signalDays,1);assert.equal(r.calibrationBinEvidence[9].eligible,false);assert.equal(r.comparisonOnIdenticalRows,false);assert.equal(r.pairedComparison.improvedBrierOnCompleteHoldout,null);
});
test('four-day bin is insufficient and exactly five days with twenty rows passes',()=>{
 for(const d of [4,5]){const {fs,ys}=pairFixture({concentratedDays:d,holdoutP:()=>.95}),r=run(fs,ys);assert.equal(r.calibrationBinEvidence[9].signalDays,d);assert.equal(r.calibrationBinEvidence[9].eligible,d===5);assert.equal(r.validationCalibrated.samples,d===5?100:0);}
 assert.equal(POLICY.minBinDays,5);
});
test('fixed classification thresholds disclose false positives, false negatives and high-confidence errors',()=>{
 const sample=[[.9,false],[.1,true],[.8,true],[.2,false],[.5,true],[.49,false]],fs=sample.map(([p],j)=>freeze(31,j,p)),ys=sample.map(([,y],j)=>label(fs[j],y));const c=run(fs,ys).validationRaw.classification;
 assert.equal(c.threshold,.5);assert.equal(c.highConfidenceThreshold,.8);assert.equal(c.truePositive,2);assert.equal(c.trueNegative,2);assert.equal(c.falsePositive,1);assert.equal(c.falseNegative,1);near(c.accuracy,2/3);near(c.precision,2/3);near(c.recall,2/3);near(c.specificity,2/3);near(c.balancedAccuracy,2/3);assert.equal(c.highConfidenceSamples,4);assert.equal(c.highConfidenceErrors,2);near(c.highConfidenceErrorRate,.5);
});
test('unknown labels and zero denominators are not fabricated failures or perfect accuracy',()=>{
 const fs=[freeze(31,0,.2),freeze(31,1,.9)],r=run(fs,[label(fs[0],false)]),c=r.validationRaw.classification;
 assert.equal(r.exclusions['missing-label'],1);assert.equal(c.trueNegative,1);assert.equal(c.falsePositive,0);assert.equal(c.precision,null);assert.equal(c.recall,null);assert.equal(c.balancedAccuracy,null);assert.equal(c.accuracy,1);assert.equal(c.highConfidenceSamples,1);assert.equal(c.highConfidenceErrorRate,0);
 const empty=run([],[]).validationRaw.classification;assert.equal(empty.accuracy,null);assert.equal(empty.highConfidenceErrorRate,null);
});
test('raw accuracy on identical paired rows and full holdout have distinct denominators',()=>{
 const {fs,ys}=pairFixture({concentratedDays:1,holdoutP:(_i,j)=>j===4?.95:.55}),r=run(fs,ys),p=r.pairedComparison;
 const sum=c=>c.truePositive+c.trueNegative+c.falsePositive+c.falseNegative;
 assert.equal(sum(r.validationRaw.classification),100);assert.equal(sum(p.raw.classification),80);assert.equal(sum(p.calibrated.classification),80);assert.equal(sum(p.baseline.classification),80);assert.equal(p.reviewStatus,'insufficient-or-incomplete-evidence');assert.equal(p.improvedBrierUnderEachDayOmission,null);
});
test('paired day omissions flag an improvement that reverses without one favorable day',()=>{
 const {fs,ys}=pairFixture({holdoutValue:(i,j)=>(i-32)*5+j<58}),r=run(fs,ys),p=r.pairedComparison;
 assert.equal(p.status,'complete-descriptive');assert.ok(p.pairedBrierDelta<0);assert.ok(p.pairedLeaveOneOutBrierDeltaRange[0]<0);assert.ok(p.pairedLeaveOneOutBrierDeltaRange[1]>0);assert.equal(p.improvedBrierUnderEachDayOmission,false);assert.equal(p.reviewStatus,'improved-but-day-sensitive');
});
test('stable improvement and worsening get descriptive review states without approval',()=>{
 const good=pairFixture(),bad=pairFixture({holdoutValue:(_i,j)=>j===0});const g=run(good.fs,good.ys),b=run(bad.fs,bad.ys);
 assert.equal(g.pairedComparison.reviewStatus,'improved-across-day-omissions');assert.equal(g.pairedComparison.improvedBrierUnderEachDayOmission,true);assert.ok(g.pairedComparison.pairedLeaveOneOutBrierDeltaRange[1]<0);
 assert.equal(b.pairedComparison.reviewStatus,'calibration-worsened');assert.equal(b.pairedComparison.improvedBrierUnderEachDayOmission,false);assert.ok(b.pairedComparison.pairedLeaveOneOutBrierDeltaRange[0]>0);
 for(const r of [g,b]){assert.equal(r.calibrationCertified,false);assert.equal(r.canApprove,false);assert.equal(r.canTrade,false);assert.equal(r.productionWeightsChanged,false);}
});
test('equal raw and calibrated estimates produce no-material-change rather than a false upgrade',()=>{
 const {fs,ys}=pairFixture({calibrationP:.5,holdoutP:()=>.5,fitValue:(i,j)=>((i-2)*5+j)%2===0}),p=run(fs,ys).pairedComparison;
 near(p.pairedBrierDelta,0);assert.deepEqual(p.pairedLeaveOneOutBrierDeltaRange,[0,0]);assert.equal(p.reviewStatus,'no-material-change');assert.equal(p.improvedBrierUnderEachDayOmission,false);
});
test('classification and paired warnings remain withheld before validation close',()=>{
 const fs=[freeze(31,0,.9)],ys=[label(fs[0],false)],r=run(fs,ys,time(33));
 assert.equal(r.validationWindowClosed,false);assert.equal(r.validationRaw.samples,0);assert.equal(r.validationRaw.classification.accuracy,null);assert.equal(r.validationRaw.classification.falsePositive,0);assert.equal(r.pairedComparison.reviewStatus,'withheld-until-window-close');assert.equal(r.pairedComparison.pairedLeaveOneOutBrierDeltaRange,null);assert.equal(r.pairedComparison.improvedBrierUnderEachDayOmission,null);
});
