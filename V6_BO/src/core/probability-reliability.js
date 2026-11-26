'use strict';
// Research diagnostics only. A sealed export is not independent source attestation.
const {createHash}=require('node:crypto');
const {createTradingCalendar}=require('./trading-calendar');
const TARGETS=Object.freeze({ztToday:'当日收盘封板',ztNext:'下一交易日收盘封板',upNext:'下一交易日收盘涨幅大于零',up3Next:'下一交易日最高涨幅达到3%',netProfitAfterFill:'实际模拟成交后净盈利'});
const POLICY=Object.freeze({minSamples:100,minDays:20,minClass:10,minBin:20,bins:10});
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ms=x=>Number.isSafeInteger(x)&&x>0&&x<8e15;
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const str=x=>typeof x==='string'&&x.trim().length>0&&x.length<=256;
const prob=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1;
const day=x=>new Date(x+28800000).toISOString().slice(0,10);
const close=d=>Date.parse(d+'T15:00:00+08:00');
const sourceFor=(x,scope)=>x?.scope===scope&&str(x.source)&&(scope==='test'||(scope==='formal'&&!x.synthetic&&!x.mock&&!x.testSample&&!x.isTest&&!x.demo&&!/(?:fixture|synthetic|mock|demo|test)/i.test(x.source)));
const assert=(ok,message)=>{if(!ok)throw Error(message);};
function verify(sealed){const {fingerprint,...body}=sealed||{};assert(hex(fingerprint)&&hash(body)===fingerprint,'证据指纹不一致');return body;}
function seal(body){return {...body,fingerprint:hash(body)};}
function register(plan,{now=Date.now()}={}){
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
 const x=input||{};
 assert(sourceFor(x,p.scope)&&str(x.id)&&/^\d{6}$/.test(x.code)&&hex(x.sourceFingerprint)&&prob(x.value)&&ms(x.predictedAt)&&ms(x.observedAt)&&ms(now)&&x.observedAt<=x.predictedAt&&x.predictedAt<=now&&now-x.predictedAt<=60000&&x.predictedAt>=p.calibrationStartAt&&now<p.validationEndAt,'预测证据无效或存在未来输入');
 assert(x.modelVersion===p.modelVersion&&x.modelFingerprint===p.modelFingerprint&&x.target===p.target,'模型或事件目标不匹配');
 const d=day(x.predictedAt),end=targetDay(calendar,d,p.horizonTradingDays);
 const phase=x.predictedAt<p.validationStartAt?'calibration':'validation';
 assert(now<close(end)&&(phase!=='calibration'||now<p.validationStartAt),'不能在标签成熟或下一阶段后补冻结');
 return seal({schemaVersion:1,planFingerprint:plan.fingerprint,id:x.id,code:x.code,scope:x.scope,source:x.source,sourceFingerprint:x.sourceFingerprint,target:x.target,modelVersion:x.modelVersion,modelFingerprint:x.modelFingerprint,value:x.value,predictedAt:x.predictedAt,observedAt:x.observedAt,frozenAt:now,signalDay:d,targetDay:end,calendarFingerprint:calendar.metadata.sha256,phase});
}
const bin=x=>Math.min(POLICY.bins-1,Math.floor(x*POLICY.bins));
const average=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
function enough(rows){const pos=rows.filter(x=>x.y).length;return rows.length>=POLICY.minSamples&&new Set(rows.map(x=>x.signalDay)).size>=POLICY.minDays&&pos>=POLICY.minClass&&rows.length-pos>=POLICY.minClass;}
function metrics(rows){
 if(!rows.length)return {samples:0,days:0,brier:null,logLoss:null,ece:null,curve:[],dayLeaveOneOutBrierRange:null};
 const buckets=Array.from({length:POLICY.bins},()=>[]);for(const r of rows)buckets[bin(r.p)].push(r);
 const curve=buckets.map((b,i)=>({lower:i/POLICY.bins,upper:(i+1)/POLICY.bins,samples:b.length,days:new Set(b.map(r=>r.signalDay)).size,meanPrediction:average(b.map(r=>r.p)),observedFrequency:average(b.map(r=>r.y))}));
 const losses=rows.map(r=>(r.p-r.y)**2),total=losses.reduce((a,b)=>a+b,0),groups=new Map();
 rows.forEach((r,i)=>{const g=groups.get(r.signalDay)||{n:0,loss:0};g.n++;g.loss+=losses[i];groups.set(r.signalDay,g);});
 const loo=[...groups.values()].filter(g=>g.n<rows.length).map(g=>(total-g.loss)/(rows.length-g.n));
 return {samples:rows.length,days:groups.size,brier:total/rows.length,logLoss:average(rows.map(r=>-Math.log(Math.max(1e-15,r.y?r.p:1-r.p)))),ece:curve.reduce((s,b)=>s+(b.samples?b.samples*Math.abs(b.meanPrediction-b.observedFrequency):0),0)/rows.length,curve,dayLeaveOneOutBrierRange:loo.length?[Math.min(...loo),Math.max(...loo)]:null};
}
function evaluate(plan,predictions,outcomes,calendarData,{now=Date.now()}={}){
 const p=verifiedPlan(plan);assert(ms(now)&&now>=p.registeredAt&&Array.isArray(predictions)&&Array.isArray(outcomes)&&predictions.length<=50000&&outcomes.length<=50000,'研究输入无效');
 const calendar=createTradingCalendar(calendarData),byId=new Map(),keys=new Set(),labels=new Map(),exclusions=Object.create(null),rows={calibration:[],validation:[]};
 const exclude=k=>{exclusions[k]=(exclusions[k]||0)+1;};
 for(const f of predictions){const x=verify(f);const recreated=freezeWithCalendar(plan,p,x,calendar,x.frozenAt);assert(recreated.fingerprint===f.fingerprint&&x.frozenAt<=now,'冻结预测合同不一致或在未来');const key=x.code+'/'+x.signalDay;assert(!byId.has(x.id)&&!keys.has(key),'重复预测或重复股票日信号');byId.set(x.id,f);keys.add(key);}
 for(const y of outcomes){assert(y&&byId.has(y.predictionId)&&!labels.has(y.predictionId),'孤立或重复标签');labels.set(y.predictionId,y);}
 for(const [id,f] of byId){const y=labels.get(id);if(!y){exclude('missing-label');continue;}
  if(!sourceFor(y,p.scope)||!hex(y.sourceFingerprint)||y.predictionFingerprint!==f.fingerprint||y.target!==p.target||y.targetDay!==f.targetDay||typeof y.value!=='boolean'||!ms(y.availableAt)||y.availableAt<close(f.targetDay)||y.availableAt>now){exclude('invalid-or-unmatured-label');continue;}
  // Net profit requires the original ledger adapter. This generic export must not assert it.
  if(p.target==='netProfitAfterFill'){exclude('requires-original-verified-settlement-adapter');continue;}
  if(y.quality!=='standard'){exclude('nonstandard-label');continue;}
  if(f.phase==='calibration'&&y.availableAt>=p.validationStartAt){exclude('purged-overlapping-or-late-calibration-label');continue;}
  rows[f.phase].push({p:f.value,y:Number(y.value),signalDay:f.signalDay});
 }
 const fit=rows.calibration,holdout=rows.validation,ready=enough(fit)&&enough(holdout)&&now>=p.validationEndAt;
 const bins=Array.from({length:POLICY.bins},()=>[]);for(const r of fit)bins[bin(r.p)].push(r.y);
 const calibrated=ready?holdout.filter(r=>bins[bin(r.p)].length>=POLICY.minBin).map(r=>({...r,p:average(bins[bin(r.p)])})):[];
 const frozen=[...byId.values()],expectedValidation=frozen.filter(f=>f.phase==='validation').length;
 // Structural overlap is determined from the preregistered calendar and
 // target horizon, not from whether a favorable label was supplied later.
 const calibrationFrozen=frozen.filter(f=>f.phase==='calibration');
 const scheduledPurgedCalibration=calibrationFrozen.filter(f=>close(f.targetDay)>=p.validationStartAt).length;
 const expectedCalibration=calibrationFrozen.length-scheduledPurgedCalibration;
 const calibrationCoverage=expectedCalibration?fit.length/expectedCalibration:null;
 const completeCalibrationEvidence=expectedCalibration>0&&fit.length===expectedCalibration;
 const comparable=calibrated.length===holdout.length&&calibrated.length>0&&holdout.length===expectedValidation;
 return {schemaVersion:1,mode:'probability-reliability-research',scope:p.scope,target:p.target,targetLabel:TARGETS[p.target],modelVersion:p.modelVersion,modelFingerprint:p.modelFingerprint,planFingerprint:plan.fingerprint,asOf:now,policy:POLICY,status:p.scope==='test'?'fixture-only':ready&&comparable&&completeCalibrationEvidence?'descriptive-holdout-evaluated':'insufficient-or-incomplete-evidence',exclusions,expectedValidation,expectedCalibration,scheduledPurgedCalibration,calibrationCoverage,completeCalibrationEvidence,calibration:metrics(fit),validationRaw:metrics(holdout),validationCalibrated:metrics(calibrated),calibratedCoverage:holdout.length?calibrated.length/holdout.length:null,comparisonOnIdenticalRows:comparable,uncertaintyMethod:'leave-one-signal-day-out sensitivity, not a confidence interval',calibrationCertified:false,canTrade:false,canApprove:false,productionWeightsChanged:false,note:'源端真实性及登记存证独立核验尚需原实例；规则分、频率与模型概率不得混用。'};
}
module.exports={TARGETS,POLICY,register,freezePrediction,evaluate};
