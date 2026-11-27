'use strict';
// Research diagnostics only. A sealed export is not independent source attestation.
const {createHash}=require('node:crypto');
const {createTradingCalendar}=require('./trading-calendar');
const TARGETS=Object.freeze({ztToday:'当日收盘封板',ztNext:'下一交易日收盘封板',upNext:'下一交易日收盘涨幅大于零',up3Next:'下一交易日最高涨幅达到3%',netProfitAfterFill:'实际模拟成交后净盈利'});
const POLICY=Object.freeze({minSamples:100,minDays:20,minClass:10,minBin:20,minBinDays:5,bins:10});
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ms=x=>Number.isSafeInteger(x)&&x>0&&x<=253402271999999; // four-digit China date
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const str=x=>typeof x==='string'&&x.trim().length>0&&x.length<=256;
const prob=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1;
const day=x=>new Date(x+28800000).toISOString().slice(0,10);
const close=d=>Date.parse(d+'T15:00:00+08:00');
// Only explicit own data fields can supply evidence. Copy without invoking getters.
function record(x){
 if(!x||typeof x!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(x)))return null;
 const out=Object.create(null);
 for(const k of Reflect.ownKeys(x)){
  const d=Object.getOwnPropertyDescriptor(x,k);
  if(typeof k!=='string'||k==='toJSON'||!d.enumerable||!Object.hasOwn(d,'value'))return null;
  out[k]=d.value;
 }
 return out;
}
const sourceFor=(x,scope)=>!!x&&x.scope===scope&&str(x.source)&&(scope==='test'||(scope==='formal'&&
 ['synthetic','mock','testSample','isTest','demo','simulated','blackSwan','extreme','extremeMarket'].every(k=>!Object.hasOwn(x,k)||x[k]===false)&&
 !['test','demo','synthetic','fixture'].includes(x.sampleSet)&&['repeatable','replicable'].every(k=>!Object.hasOwn(x,k)||x[k]===true)&&
 !['教学样本','演示样本','黑天鹅','不可复制极端行情'].includes(x.quality)&&!/(?:fixture|synthetic|mock|demo|test)/i.test(x.source)));
const probabilityKind=x=>['kind','valueKind','probKind'].every(k=>!Object.hasOwn(x,k)||x[k]==='model-estimate');
const assert=(ok,message)=>{if(!ok)throw Error(message);};
function verify(sealed){const copy=record(sealed);assert(copy,'证据必须是显式数据记录');const {fingerprint,...body}=copy;assert(hex(fingerprint)&&hash(body)===fingerprint,'证据指纹不一致');return body;}
function seal(body){return {...body,fingerprint:hash(body)};}
function register(plan,{now=Date.now()}={}){
 plan=record(plan);
 const {target,modelVersion,modelFingerprint,trainingEndedAt,calibrationStartAt,validationStartAt,validationEndAt,horizonTradingDays,scope,source}=plan||{};
 assert(sourceFor(plan,scope)&&Object.hasOwn(TARGETS,target)&&str(modelVersion)&&hex(modelFingerprint)&&[now,trainingEndedAt,calibrationStartAt,validationStartAt,validationEndAt].every(ms)&&trainingEndedAt<=now&&now<=calibrationStartAt&&calibrationStartAt<validationStartAt&&validationStartAt<validationEndAt,'研究登记无效或时间分隔不成立');
 assert(Number.isSafeInteger(horizonTradingDays)&&(target==='ztToday'?horizonTradingDays===0:target==='netProfitAfterFill'?horizonTradingDays>=1&&horizonTradingDays<=20:horizonTradingDays===1),'目标与标签窗口不匹配');
 return seal({schemaVersion:1,target,modelVersion,modelFingerprint,trainingEndedAt,calibrationStartAt,validationStartAt,validationEndAt,horizonTradingDays,scope,source,registeredAt:now});
}
function verifiedPlan(plan){const p=verify(plan);assert(p.schemaVersion===1,'研究登记版本无效');assert(register(p,{now:p.registeredAt}).fingerprint===plan.fingerprint,'研究登记合同不一致');return p;}
function targetDay(calendar,signalDay,horizon){assert(calendar.isOpen(signalDay),'预测不在交易日');let d=signalDay;for(let i=0;i<horizon;i++){d=calendar.next(d);assert(d,'标签窗口超出日历');}return d;}
function freezePrediction(plan,input,calendarData,{now=Date.now()}={}){
 return freezeWithCalendar(plan,verifiedPlan(plan),input,createTradingCalendar(calendarData),now);
}
function freezeWithCalendar(plan,p,input,calendar,now){
 const x=record(input);
 assert(sourceFor(x,p.scope)&&probabilityKind(x)&&str(x.id)&&typeof x.code==='string'&&/^\d{6}$/.test(x.code)&&hex(x.sourceFingerprint)&&prob(x.value)&&ms(x.predictedAt)&&ms(x.observedAt)&&ms(now)&&x.observedAt<=x.predictedAt&&x.predictedAt<=now&&now-x.predictedAt<=60000&&x.predictedAt>=p.calibrationStartAt&&now<p.validationEndAt,'预测证据无效或存在未来输入');
 assert(x.modelVersion===p.modelVersion&&x.modelFingerprint===p.modelFingerprint&&x.target===p.target,'模型或事件目标不匹配');
 const d=day(x.predictedAt),end=targetDay(calendar,d,p.horizonTradingDays);
 // Match the existing journal boundary for direct core and CLI callers.
 assert(close(end)<=p.validationEndAt,'标签成熟窗口超出预登记结束时间');
 const phase=x.predictedAt<p.validationStartAt?'calibration':'validation';
 assert(now<close(end)&&(phase!=='calibration'||now<p.validationStartAt),'不能在标签成熟或下一阶段后补冻结');
 return seal({schemaVersion:1,planFingerprint:plan.fingerprint,id:x.id,code:x.code,scope:x.scope,source:x.source,sourceFingerprint:x.sourceFingerprint,target:x.target,modelVersion:x.modelVersion,modelFingerprint:x.modelFingerprint,value:x.value,predictedAt:x.predictedAt,observedAt:x.observedAt,frozenAt:now,signalDay:d,targetDay:end,calendarFingerprint:calendar.metadata.sha256,phase});
}
const bin=x=>Math.min(POLICY.bins-1,Math.floor(x*POLICY.bins));
const average=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
function enough(rows){const pos=rows.filter(x=>x.y).length;return rows.length>=POLICY.minSamples&&new Set(rows.map(x=>x.signalDay)).size>=POLICY.minDays&&pos>=POLICY.minClass&&rows.length-pos>=POLICY.minClass;}
function labelClockValid(y,f,now){
 const end=close(f.targetDay);
 if(!ms(y.availableAt)||y.availableAt<end||y.availableAt>now)return false;
 // A late study receipt cannot repair an immature original source receipt.
 if(Object.hasOwn(y,'sourceAvailableAt')&&(!ms(y.sourceAvailableAt)||y.sourceAvailableAt<end||y.sourceAvailableAt>y.availableAt))return false;
 return true;
}
// Fixed descriptive thresholds, never selected from the holdout.
const ratio=(n,d)=>d?n/d:null;
function classification(rows){
 let tp=0,tn=0,fp=0,fn=0,highConfidenceSamples=0,highConfidenceErrors=0;
 for(const r of rows){
  const positive=r.p>=.5;
  if(positive){if(r.y===1)tp++;else fp++;}else{if(r.y===1)fn++;else tn++;}
  if(r.p>=.8||r.p<=.2){highConfidenceSamples++;if(positive!==(r.y===1))highConfidenceErrors++;}
 }
 const recall=ratio(tp,tp+fn),specificity=ratio(tn,tn+fp);
 return {threshold:.5,highConfidenceThreshold:.8,truePositive:tp,trueNegative:tn,falsePositive:fp,falseNegative:fn,
  accuracy:ratio(tp+tn,rows.length),precision:ratio(tp,tp+fp),recall,specificity,
  balancedAccuracy:recall===null||specificity===null?null:(recall+specificity)/2,
  highConfidenceSamples,highConfidenceErrors,highConfidenceErrorRate:ratio(highConfidenceErrors,highConfidenceSamples)};
}
function metrics(rows){
 if(!rows.length)return {samples:0,days:0,brier:null,logLoss:null,ece:null,curve:[],dayLeaveOneOutBrierRange:null,classification:classification(rows)};
 const buckets=Array.from({length:POLICY.bins},()=>[]);for(const r of rows)buckets[bin(r.p)].push(r);
 const curve=buckets.map((b,i)=>({lower:i/POLICY.bins,upper:(i+1)/POLICY.bins,samples:b.length,days:new Set(b.map(r=>r.signalDay)).size,meanPrediction:average(b.map(r=>r.p)),observedFrequency:average(b.map(r=>r.y))}));
 const losses=rows.map(r=>(r.p-r.y)**2),total=losses.reduce((a,b)=>a+b,0),groups=new Map();
 rows.forEach((r,i)=>{const g=groups.get(r.signalDay)||{n:0,loss:0};g.n++;g.loss+=losses[i];groups.set(r.signalDay,g);});
 const loo=[...groups.values()].filter(g=>g.n<rows.length).map(g=>(total-g.loss)/(rows.length-g.n));
 return {samples:rows.length,days:groups.size,brier:total/rows.length,logLoss:average(rows.map(r=>-Math.log(Math.max(1e-15,r.y?r.p:1-r.p)))),ece:curve.reduce((s,b)=>s+(b.samples?b.samples*Math.abs(b.meanPrediction-b.observedFrequency):0),0)/rows.length,curve,dayLeaveOneOutBrierRange:loo.length?[Math.min(...loo),Math.max(...loo)]:null,classification:classification(rows)};
}
// Leave out each signal day on the SAME paired rows, not independently chosen
// best/worst raw and calibrated samples. This is sensitivity, not a confidence interval.
function pairedDayRange(raw,calibrated){
 const groups=new Map();let total=0;
 raw.forEach((r,i)=>{const delta=(calibrated[i].p-r.y)**2-(r.p-r.y)**2;
  const g=groups.get(r.signalDay)||{n:0,delta:0};g.n++;g.delta+=delta;total+=delta;groups.set(r.signalDay,g);});
 const loo=[...groups.values()].filter(g=>g.n<raw.length).map(g=>(total-g.delta)/(raw.length-g.n));
 return loo.length?[Math.min(...loo),Math.max(...loo)]:null;
}
function evaluate(plan,predictions,outcomes,calendarData,{now=Date.now()}={}){
 const p=verifiedPlan(plan);assert(ms(now)&&now>=p.registeredAt&&Array.isArray(predictions)&&Array.isArray(outcomes)&&predictions.length<=50000&&outcomes.length<=50000,'研究输入无效');
 const calendar=createTradingCalendar(calendarData),byId=new Map(),keys=new Set(),labels=new Map(),exclusions=Object.create(null),rows={calibration:[],validation:[]};
 const exclude=k=>{exclusions[k]=(exclusions[k]||0)+1;};
 for(const input of predictions){const f=record(input);assert(f,'冻结预测必须是显式数据记录');const x=verify(f);const recreated=freezeWithCalendar(plan,p,x,calendar,x.frozenAt);assert(recreated.fingerprint===f.fingerprint&&x.frozenAt<=now,'冻结预测合同不一致或在未来');const key=x.code+'/'+x.signalDay;assert(!byId.has(x.id)&&!keys.has(key),'重复预测或重复股票日信号');byId.set(x.id,f);keys.add(key);}
 for(const input of outcomes){const y=record(input);assert(y&&byId.has(y.predictionId)&&!labels.has(y.predictionId),'孤立、重复或非显式数据标签');labels.set(y.predictionId,y);}
 for(const [id,f] of byId){const y=labels.get(id);if(!y){exclude('missing-label');continue;}
  if(!sourceFor(y,p.scope)||!hex(y.sourceFingerprint)||y.predictionFingerprint!==f.fingerprint||y.target!==p.target||y.targetDay!==f.targetDay||typeof y.value!=='boolean'||!labelClockValid(y,f,now)){exclude('invalid-or-unmatured-label');continue;}
  // Net profit requires the original ledger adapter. This generic export must not assert it.
  if(p.target==='netProfitAfterFill'){exclude('requires-original-verified-settlement-adapter');continue;}
  if(y.quality!=='standard'){exclude('nonstandard-label');continue;}
  if(f.phase==='calibration'&&y.availableAt>=p.validationStartAt){exclude('purged-overlapping-or-late-calibration-label');continue;}
  rows[f.phase].push({p:f.value,y:Number(y.value),signalDay:f.signalDay});
 }
 const fit=rows.calibration,holdout=rows.validation,validationWindowClosed=now>=p.validationEndAt;
 const ready=validationWindowClosed&&enough(fit)&&enough(holdout);
 const bins=Array.from({length:POLICY.bins},()=>({labels:[],days:new Set()}));
 for(const r of fit){const b=bins[bin(r.p)];b.labels.push(r.y);b.days.add(r.signalDay);}
 const eligibleBin=b=>b.labels.length>=POLICY.minBin&&b.days.size>=POLICY.minBinDays;
 const calibrationBinEvidence=bins.map((b,i)=>({lower:i/POLICY.bins,upper:(i+1)/POLICY.bins,samples:b.labels.length,signalDays:b.days.size,eligible:eligibleBin(b)}));
 const paired=ready?holdout.filter(r=>eligibleBin(bins[bin(r.p)])):[];
 const calibrated=paired.map(r=>({...r,p:average(bins[bin(r.p)].labels)}));
 // Historical base rate is fitted only on calibration labels, never holdout.
 const calibrationBaseRate=average(fit.map(r=>r.y));
 const baseline=paired.map(r=>({...r,p:calibrationBaseRate}));
 const frozen=[...byId.values()],expectedValidation=frozen.filter(f=>f.phase==='validation').length;
 // Structural overlap is determined from the preregistered calendar and
 // target horizon, not from whether a favorable label was supplied later.
 const calibrationFrozen=frozen.filter(f=>f.phase==='calibration');
 const scheduledPurgedCalibration=calibrationFrozen.filter(f=>close(f.targetDay)>=p.validationStartAt).length;
 const expectedCalibration=calibrationFrozen.length-scheduledPurgedCalibration;
 const calibrationCoverage=expectedCalibration?fit.length/expectedCalibration:null;
 const completeCalibrationEvidence=expectedCalibration>0&&fit.length===expectedCalibration;
 const comparable=calibrated.length===holdout.length&&calibrated.length>0&&holdout.length===expectedValidation;
 const pairedRaw=metrics(paired),pairedCalibrated=metrics(calibrated),pairedBaseline=metrics(baseline);
 const complete=ready&&comparable&&completeCalibrationEvidence;
 const pairedLeaveOneOutBrierDeltaRange=pairedDayRange(paired,calibrated);
 const pairedDelta=paired.length?pairedCalibrated.brier-pairedRaw.brier:null;
 const stableImprovement=complete&&pairedLeaveOneOutBrierDeltaRange!==null?pairedLeaveOneOutBrierDeltaRange[1]<-1e-12:null;
 const reviewStatus=!validationWindowClosed?'withheld-until-window-close':!complete?'insufficient-or-incomplete-evidence':pairedDelta>1e-12?'calibration-worsened':pairedDelta< -1e-12?(stableImprovement?'improved-across-day-omissions':'improved-but-day-sensitive'):'no-material-change';
 const pairedComparison={status:!validationWindowClosed?'withheld-until-window-close':!paired.length?'not-evaluated':complete?'complete-descriptive':'partial-descriptive',
  samples:paired.length,expectedValidation,raw:pairedRaw,calibrated:pairedCalibrated,baseline:pairedBaseline,
  baselineBasis:'calibration-window-event-frequency-only',calibrationBaseRate,
  pairedBrierDelta:pairedDelta,
  pairedLeaveOneOutBrierDeltaRange,improvedBrierUnderEachDayOmission:stableImprovement,reviewStatus,
  pairedBaselineBrierDelta:paired.length?pairedCalibrated.brier-pairedBaseline.brier:null,
  improvedBrierOnCompleteHoldout:complete?pairedCalibrated.brier<pairedRaw.brier:null,
  calibrationCertified:false};
 return {schemaVersion:1,mode:'probability-reliability-research',scope:p.scope,target:p.target,targetLabel:TARGETS[p.target],modelVersion:p.modelVersion,modelFingerprint:p.modelFingerprint,planFingerprint:plan.fingerprint,asOf:now,policy:POLICY,status:p.scope==='test'?'fixture-only':ready&&comparable&&completeCalibrationEvidence?'descriptive-holdout-evaluated':'insufficient-or-incomplete-evidence',exclusions,expectedValidation,expectedCalibration,scheduledPurgedCalibration,calibrationCoverage,completeCalibrationEvidence,calibrationBinEvidence,calibration:metrics(fit),validationWindowClosed,validationRaw:metrics(validationWindowClosed?holdout:[]),validationCalibrated:pairedCalibrated,pairedComparison,calibratedCoverage:validationWindowClosed&&holdout.length?calibrated.length/holdout.length:null,comparisonOnIdenticalRows:comparable,uncertaintyMethod:'leave-one-signal-day-out sensitivity, not a confidence interval',calibrationCertified:false,canTrade:false,canApprove:false,productionWeightsChanged:false,note:'源端真实性及登记存证独立核验尚需原实例；规则分、频率与模型概率不得混用。'};
}
module.exports={TARGETS,POLICY,register,freezePrediction,evaluate};
