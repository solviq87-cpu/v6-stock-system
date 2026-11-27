'use strict';
// Internal, declared-evidence research. Predicts a benchmark's next-session
// close direction, NOT a bull/bear regime, portfolio return or trade signal.
const {createHash}=require('node:crypto');
const {freezeEvaluationPlan}=require('./market-policy-evaluation');
const CLASSES=Object.freeze(['up','flat','down']);
const BASES=Object.freeze(['persistence','frequency','markov']);
const LIMITS=Object.freeze({thresholdPct:.5,minTrainingDays:20,maxTrainingDays:240,minStateDays:5,minCalibrationBin:10,minComparisonDays:20,maxExperts:8});
const FLAGS=Object.freeze({canTrade:false,canNotify:false,canOpenRisk:false,autoPromotion:false,weightsChanged:false,certified:false,calibrationCertified:false,outOfSampleCertified:false});
const stamp=x=>Number.isSafeInteger(x)&&x>=946684800000&&x<4102444800000;
const text=x=>typeof x==='string'&&x.length>0&&x.length<=160&&x.trim()===x;
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const day=x=>new Date(x+28800000).toISOString().slice(0,10);
const time=(d,t)=>Date.parse(d+'T'+t+'+08:00');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const check=(v,msg)=>{if(!v)throw Error(msg);};
const fail=reason=>({status:'unknown',reason,...FLAGS});
const fake=x=>x?.simulated===true||x?.synthetic===true||x?.mock===true||x?.sampleSet==='demo';
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
const prob=(counts,n)=>CLASSES.map((_,i)=>(counts[i]+1)/(n+CLASSES.length));
function cls(a,b){const r=100*(b/a-1);check(finite(r),'nonfinite-index-return');return r>LIMITS.thresholdPct+1e-10?'up':r< -LIMITS.thresholdPct-1e-10?'down':'flat';}
function bar(plan,r){
 const ds=plan.calendar.tradeDates,i=ds.indexOf(r?.tradeDate);
 check(i>=0&&i+1<ds.length&&!fake(r)&&r.indexCode===plan.benchmarkId&&r.provider===plan.provider&&r.priceMethod==='index-close'&&text(r.evidenceId)&&text(r.featureEvidenceId)&&r.evidenceId!==r.featureEvidenceId&&text(r.breadthSource)&&finite(r.close)&&r.close>0&&finite(r.breadth)&&r.breadth>=0&&r.breadth<=1&&finite(r.medianPct)&&r.medianPct>=-100&&r.medianPct<=100,'index-or-feature-evidence-invalid');
 check(stamp(r.observedAt)&&stamp(r.knownAt)&&stamp(r.recordedAt)&&day(r.observedAt)===r.tradeDate&&r.observedAt>=time(r.tradeDate,'15:10:00')&&r.observedAt<=r.knownAt&&r.knownAt<=r.recordedAt&&day(r.recordedAt)===r.tradeDate&&r.recordedAt<time(ds[i+1],'09:30:00'),'index-or-feature-clock-invalid');
 return {tradeDate:r.tradeDate,indexCode:r.indexCode,provider:r.provider,priceMethod:r.priceMethod,evidenceId:r.evidenceId,featureEvidenceId:r.featureEvidenceId,breadthSource:r.breadthSource,close:r.close,breadth:r.breadth,medianPct:r.medianPct,observedAt:r.observedAt,knownAt:r.knownAt,recordedAt:r.recordedAt};
}
function buildStudy(plan,config,training){
 const p=freezeEvaluationPlan(plan);check(plan?.status==='declared-frozen'&&p.status==='declared-frozen'&&p.planId===plan.planId&&same(p.windows,plan.windows)&&p.horizon===1,'base-plan-invalid-or-horizon-not-one');
 const ds=p.calendar.tradeDates,a=ds.indexOf(config?.calibrationStart),z=ds.indexOf(p.trainingEnd),n=z-a+1;
 check(config&&config.schemaVersion===1&&config.target==='next-session-benchmark-close-direction'&&!fake(config)&&text(config.evidenceId)&&stamp(config.knownAt)&&config.knownAt<=p.registeredAt&&a>=1&&n>=LIMITS.minTrainingDays&&n<=LIMITS.maxTrainingDays,'forecast-config-or-training-window-invalid');
 check(text(config.breadthSource)&&Array.isArray(config.experts)&&config.experts.length<=LIMITS.maxExperts,'expert-config-invalid');
 const ids=new Set(BASES);const experts=config.experts.map(e=>{check(e&&!fake(e)&&typeof e.id==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(e.id)&&!ids.has(e.id)&&e.id!=='route'&&text(e.version)&&digest(e.modelFingerprint)&&text(e.trainingEvidenceId)&&ds.indexOf(e.trainedThrough)>=0&&ds.indexOf(e.trainedThrough)<=z&&stamp(e.knownAt)&&e.knownAt>=time(ds[ds.indexOf(e.trainedThrough)+1],'15:10:00')&&e.knownAt<=p.registeredAt,'expert-identity-invalid');ids.add(e.id);return {id:e.id,version:e.version,modelFingerprint:e.modelFingerprint,trainingEvidenceId:e.trainingEvidenceId,trainedThrough:e.trainedThrough,knownAt:e.knownAt};});
 check(config.route&&Object.keys(config.route).length===3&&CLASSES.every(c=>ids.has(config.route[c])),'predeclared-route-invalid');
 const cfg={schemaVersion:1,target:config.target,evidenceId:config.evidenceId,knownAt:config.knownAt,calibrationStart:config.calibrationStart,breadthSource:config.breadthSource,experts,route:Object.fromEntries(CLASSES.map(c=>[c,config.route[c]]))};
 check(Array.isArray(training)&&training.length===n+2,'training-coverage-incomplete');
 const used=new Set(),bars=training.map((r,i)=>{const b=bar(p,r);check(b.tradeDate===ds[a-1+i]&&b.recordedAt<=p.registeredAt&&b.breadthSource===cfg.breadthSource&&!used.has(b.evidenceId)&&!used.has(b.featureEvidenceId)&&b.evidenceId!==b.featureEvidenceId,'training-order-source-or-identity-invalid');used.add(b.evidenceId);used.add(b.featureEvidenceId);return b;});
 const counts=[0,0,0],conditional=CLASSES.map(()=>[0,0,0]);
 for(let i=1;i<bars.length-1;i++){const k=CLASSES.indexOf(cls(bars[i-1].close,bars[i].close)),j=CLASSES.indexOf(cls(bars[i].close,bars[i+1].close));counts[j]++;conditional[k][j]++;}
 const features=bars.slice(1,-1),bounds=Object.fromEntries(['breadth','medianPct'].map(k=>[k,[Math.min(...features.map(b=>b[k])),Math.max(...features.map(b=>b[k]))]]));
 const body={schemaVersion:1,mode:'benchmark-forecast-shadow',basePlan:p,config:cfg,training:bars,trainingSummary:{days:n,counts,conditional,bounds},limits:{...LIMITS}};
 return {...body,status:'declared-frozen',studyId:hash(body),...FLAGS};
}
function freezeMarketForecastStudy(plan,config,training){try{return buildStudy(plan,config,training);}catch(e){return fail(e.message);}}
function studyOf(s){const f=buildStudy(s?.basePlan,s?.config,s?.training);check(s?.status==='declared-frozen'&&s.studyId===f.studyId&&same(s.trainingSummary,f.trainingSummary)&&same(s.limits,f.limits),'study-integrity-invalid');return f;}
function makeDecision(s,input){
 const p=s.basePlan,c=s.config,ds=p.calendar.tradeDates,d=input;
 check(d&&!fake(d)&&d.studyId===s.studyId&&text(d.evidenceId)&&stamp(d.forecastAt)&&stamp(d.recordedAt)&&d.forecastAt<=d.recordedAt&&p.windows.some(w=>w.signalDates.includes(d.signalDate))&&d.forecastAt>=p.registeredAt,'forecast-decision-contract-invalid');
 const i=ds.indexOf(d.signalDate),prior=bar(p,d.prior),current=bar(p,d.current);
 check(prior.tradeDate===ds[i-1]&&current.tradeDate===d.signalDate&&prior.breadthSource===c.breadthSource&&current.breadthSource===c.breadthSource&&prior.recordedAt<=current.observedAt&&current.recordedAt<=d.forecastAt&&day(d.forecastAt)===d.signalDate&&d.recordedAt<time(ds[i+1],'09:30:00'),'decision-feature-window-invalid');
 check(new Set([d.evidenceId,prior.evidenceId,prior.featureEvidenceId,current.evidenceId,current.featureEvidenceId]).size===5,'decision-evidence-identity-conflict');
 const state=cls(prior.close,current.close),k=CLASSES.indexOf(state),sm=s.trainingSummary;
 const outside=Object.keys(sm.bounds).filter(f=>current[f]<sm.bounds[f][0]||current[f]>sm.bounds[f][1]);
 const stateDays=sm.conditional[k].reduce((a,b)=>a+b,0),supported=outside.length===0&&stateDays>=LIMITS.minStateDays;
 const predictions={persistence:CLASSES.map(x=>x===state?1:0),frequency:prob(sm.counts,sm.days),markov:supported?prob(sm.conditional[k],stateDays):null};
 const models=d.modelForecasts;check(Array.isArray(models)&&models.length<=c.experts.length,'expert-predictions-invalid');
 const seen=new Set(),modelForecasts=[],usedEvidence=new Set([d.evidenceId,prior.evidenceId,prior.featureEvidenceId,current.evidenceId,current.featureEvidenceId]);
 for(const m of models){const expert=c.experts.find(e=>e.id===m?.id);check(expert&&!seen.has(m.id)&&!fake(m)&&m.version===expert.version&&m.modelFingerprint===expert.modelFingerprint&&text(m.evidenceId)&&!usedEvidence.has(m.evidenceId)&&m.featureEvidenceId===current.featureEvidenceId&&stamp(m.generatedAt)&&m.generatedAt>=current.recordedAt&&m.generatedAt<=d.forecastAt&&Array.isArray(m.probabilities)&&m.probabilities.length===3&&m.probabilities.every(x=>finite(x)&&x>=0&&x<=1)&&Math.abs(m.probabilities.reduce((a,b)=>a+b,0)-1)<=1e-9,'expert-prediction-invalid-or-late');seen.add(m.id);usedEvidence.add(m.evidenceId);modelForecasts.push({id:m.id,version:m.version,modelFingerprint:m.modelFingerprint,evidenceId:m.evidenceId,featureEvidenceId:m.featureEvidenceId,generatedAt:m.generatedAt,probabilities:[...m.probabilities]});}
 for(const expert of c.experts){const m=modelForecasts.find(x=>x.id===expert.id);predictions[expert.id]=supported&&m?m.probabilities:null;}
 modelForecasts.sort((a,b)=>a.id.localeCompare(b.id,'en'));
 const routeId=c.route[state],route=supported&&predictions[routeId]?routeId:null;predictions.route=route?predictions[route]:null;
 const body={studyId:s.studyId,signalDate:d.signalDate,targetDate:ds[i+1],forecastAt:d.forecastAt,recordedAt:d.recordedAt,evidenceId:d.evidenceId,prior,current,modelForecasts,state,stateDays,oodFeatures:outside,routeId:route,abstentionReason:outside.length?'outside-training-feature-range':stateDays<LIMITS.minStateDays?'rare-current-state':route?null:'predeclared-expert-unavailable',predictions};
 return {...body,status:'declared-frozen',decisionId:hash(body),...FLAGS};
}
function freezeMarketForecastDecision(study,input){try{return makeDecision(studyOf(study),input);}catch(e){return fail(e.message);}}
const score=(p,y)=>({brier:p.reduce((s,x,i)=>s+(x-(i===y?1:0))**2,0),logLoss:-Math.log(Math.max(1e-12,p[y])),predicted:p.filter(x=>x===Math.max(...p)).length===1?p.indexOf(Math.max(...p)):null});
function report(rows,model,total){
 const evaluated=rows.filter(r=>r.status==='descriptive-unverified'&&r.predictions[model]!==null),ys=evaluated.map(r=>CLASSES.indexOf(r.actual)),ps=evaluated.map(r=>r.predictions[model]),scores=ps.map((p,i)=>score(p,ys[i]));
 const confusion=CLASSES.map(()=>[0,0,0,0]);scores.forEach((s,i)=>confusion[ys[i]][s.predicted??3]++);
 const classCounts=confusion.map(a=>a.reduce((s,x)=>s+x,0));
 const f1=classCounts.every(n=>n>=LIMITS.minStateDays)?mean(CLASSES.map((_,i)=>2*confusion[i][i]/(classCounts[i]+confusion.reduce((s,a)=>s+a[i],0)))):null;
 const reliability=CLASSES.map((c,j)=>({class:c,bins:Array.from({length:5},(_,b)=>{const items=ps.map((p,i)=>({p:p[j],y:ys[i]===j?1:0})).filter(o=>Math.min(4,Math.floor(o.p*5))===b);const p=mean(items.map(x=>x.p)),y=mean(items.map(x=>x.y));return {lower:b/5,upper:(b+1)/5,count:items.length,meanProbability:p,observedFraction:y,gap:items.length>=LIMITS.minCalibrationBin?y-p:null};})}));
 return {evaluatedDays:evaluated.length,coverage:total?evaluated.length/total:null,meanBrier:mean(scores.map(x=>x.brier)),meanLogLoss:mean(scores.map(x=>x.logLoss)),accuracy:mean(scores.map((s,i)=>s.predicted===ys[i]?1:0)),tiedPredictions:scores.filter(s=>s.predicted===null).length,classCounts,confusion,macroF1:f1,reliability};
}
function evaluateMarketForecasts(study,decisions,labels,{asOf}={}){
 try{const s=studyOf(study),p=s.basePlan,dates=p.windows.flatMap(w=>w.signalDates),dateSet=new Set(dates),targets=new Set(dates.map(d=>p.calendar.tradeDates[p.calendar.tradeDates.indexOf(d)+1]));
 check(stamp(asOf)&&asOf>=p.registeredAt&&Array.isArray(decisions)&&decisions.length<=5000&&Array.isArray(labels)&&labels.length<=5000,'forecast-evaluation-input-invalid');
 const byDate=new Map(),byLabel=new Map(),evidence=new Map(),conflict=new Set(),identity=new Map();
 const bind=(id,date,role)=>{const prev=identity.get(id);if(prev&&(prev.date!==date||prev.role!==role)){conflict.add(prev.date);conflict.add(date);}else identity.set(id,{date,role});};
 const observe=b=>{const old=evidence.get(b.tradeDate);if(old&&!same(old,b))conflict.add(b.tradeDate);else evidence.set(b.tradeDate,b);bind(b.evidenceId,b.tradeDate,'index');bind(b.featureEvidenceId,b.tradeDate,'features');};
 s.training.forEach(observe);
 for(const d of decisions){if(stamp(d?.recordedAt)&&d.recordedAt>asOf)continue;const f=makeDecision(s,d);check(dateSet.has(f.signalDate)&&d.status==='declared-frozen'&&d.decisionId===f.decisionId&&same(d.predictions,f.predictions),'forecast-decision-integrity-invalid');if(byDate.has(f.signalDate))byDate.set(f.signalDate,null);else byDate.set(f.signalDate,f);observe(f.prior);observe(f.current);bind(f.evidenceId,f.signalDate,'decision');for(const m of f.modelForecasts)bind(m.evidenceId,f.signalDate,'expert:'+m.id);}
 for(const l of labels){if(stamp(l?.recordedAt)&&l.recordedAt>asOf)continue;check(targets.has(l?.tradeDate),'unexpected-label-date');const b=bar(p,l);check(b.recordedAt<=asOf&&b.breadthSource===s.config.breadthSource,'label-source-or-time-invalid');if(byLabel.has(b.tradeDate))byLabel.set(b.tradeDate,null);else byLabel.set(b.tradeDate,b);observe(b);}
 const rows=dates.map(signalDate=>{const i=p.calendar.tradeDates.indexOf(signalDate),targetDate=p.calendar.tradeDates[i+1],d=byDate.get(signalDate),l=byLabel.get(targetDate),base={signalDate,targetDate};const no=reason=>({...base,status:'not-evaluated',reason});if(!d)return no(byDate.has(signalDate)?'duplicate-decision':'decision-missing-or-not-known');if(asOf<time(targetDate,'15:10:00'))return no('label-not-mature');if(!l)return no(byLabel.has(targetDate)?'duplicate-label':'label-missing-or-not-known');if([p.calendar.tradeDates[i-1],signalDate,targetDate].some(x=>conflict.has(x)))return no('conflicting-bar-evidence');return {...base,status:'descriptive-unverified',reason:null,decisionId:d.decisionId,labelEvidenceId:l.evidenceId,state:d.state,actual:cls(d.current.close,l.close),oodFeatures:d.oodFeatures,abstentionReason:d.abstentionReason,routeId:d.routeId,predictions:d.predictions};});
 const models=[...BASES,...s.config.experts.map(e=>e.id),'route'],evaluated=rows.filter(r=>r.status==='descriptive-unverified');
 const metrics=Object.fromEntries(models.map(m=>[m,report(rows,m,dates.length)]));
 const compare=(rs,minDays)=>models.flatMap(m=>BASES.filter(b=>m!==b&&(!BASES.includes(m)||BASES.indexOf(b)<BASES.indexOf(m))).map(b=>{const matched=rs.filter(r=>r.predictions[m]!==null&&r.predictions[b]!==null),diff=matched.map(r=>score(r.predictions[m],CLASSES.indexOf(r.actual)).brier-score(r.predictions[b],CLASSES.indexOf(r.actual)).brier);return {model:m,baseline:b,matchedDays:matched.length,meanBrierDifference:matched.length>=minDays?mean(diff):null,status:matched.length>=minDays?'descriptive-unverified':'insufficient-matched-days',significance:null};}));
 const comparisons=compare(evaluated,LIMITS.minComparisonDays);
 const byWindow=p.windows.map(w=>{const rs=rows.filter(r=>w.signalDates.includes(r.signalDate)),done=rs.filter(r=>r.status==='descriptive-unverified');return {id:w.id,expectedDays:rs.length,evaluatedDays:done.length,metrics:Object.fromEntries(models.map(m=>[m,report(rs,m,rs.length)])),comparisons:compare(done,LIMITS.minComparisonDays)};});
 const states=Object.fromEntries(CLASSES.map(c=>{const rs=evaluated.filter(r=>r.state===c);return [c,{days:rs.length,route:report(rs,'route',rs.length),trainingStateDays:s.trainingSummary.conditional[CLASSES.indexOf(c)].reduce((a,b)=>a+b,0)}];}));
 return {schemaVersion:1,mode:'benchmark-forecast-shadow-audit',status:evaluated.length?'descriptive-unverified':'unknown',reason:evaluated.length?null:'no-mature-labels',studyId:s.studyId,asOf,expectedDays:dates.length,evaluatedDays:evaluated.length,classes:[...CLASSES],confusionColumns:[...CLASSES,'tie'],rows,metrics,comparisons,byWindow,states,oodDays:evaluated.filter(r=>r.oodFeatures.length).length,routeAbstentions:evaluated.filter(r=>r.predictions.route===null).length,marketRegimeAccuracy:null,certifiedProbability:false,...FLAGS};
 }catch(e){return fail(e.message);}
}
module.exports={freezeMarketForecastStudy,freezeMarketForecastDecision,evaluateMarketForecasts};
