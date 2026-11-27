'use strict';
// C-group risk-warning research only. Reuse the original frozen cohort and
// forward price observer; no new collector, ledger, training store or gate.
const crypto=require('node:crypto');
const {freezeCohort,evaluateForward,HORIZONS}=require('./forward-signal-observer');
const {closeReceipt,indexStocks,buildCloseRiskPath,summarizeClosePaths,labelSensitivity}=require('./crowding-close-path-evidence');
const VERSION='fayo-risk-close-event-audit-v1',POLICIES=['original','fixed','conditional'],FOLDS=['training','validation','holdout'];
const FLAGS={researchOnly:true,canTrade:false,canNotify:false,canAuthorize:false,canTrain:false,autoPromotion:false,productionWeightsChanged:false,prospectiveCertified:false,executionSimulated:false};
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const text=x=>typeof x==='string'&&x.trim().length>0&&x.length<=200;
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const ms=x=>Number.isSafeInteger(x)&&x>0&&x<8e15;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const int=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const prob=x=>finite(x)&&x>=0&&x<=1;
const unique=a=>new Set(a).size===a.length;
const fake=x=>/(?:^|[-_:/\.\s])(?:fixture|synthetic|mock|demo|test|simulated)(?:$|[-_:/\.\s])/i.test(String(x||''));
const open=d=>Date.parse(d+'T09:30:00+08:00');
const close=d=>Date.parse(d+'T16:00:00+08:00');
const check=(yes,reason)=>{if(!yes)throw Error(reason);};
function feedOf(f,scope){
 check(f&&f.source===scope&&text(f.provider)&&text(f.datasetId)&&f.priceBasis==='unadjusted'&&(scope==='fixture'||!fake(f.provider)&&!fake(f.datasetId)&&!['synthetic','mock','fixture','simulated','testSample'].some(k=>f[k]===true)),'AUDIT_FEED_INVALID');
 return {source:f.source,provider:f.provider,datasetId:f.datasetId,priceBasis:f.priceBasis};
}
const seal=body=>({...body,fingerprint:hash(body)});
function unseal(value){const {fingerprint,...body}=value||{};check(hex(fingerprint)&&hash(body)===fingerprint,'AUDIT_FINGERPRINT_MISMATCH');return body;}
function registerRiskAudit(input,{now=Date.now()}={}){
 const p=input||{},calendar=p.calendar;
 check(ms(now)&&Array.isArray(calendar)&&int(calendar.length,4,1000)&&calendar.every((d,i)=>date(d)&&(!i||calendar[i-1]<d)), 'AUDIT_CALENDAR_INVALID');
 check(['fixture','imported'].includes(p.scope)&&text(p.population)&&HORIZONS.includes(p.horizon)&&finite(p.lossPct)&&p.lossPct>0&&p.lossPct<100,'AUDIT_TARGET_INVALID');
 check(p.criteria&&int(p.criteria.minSamples,1,5000)&&int(p.criteria.minDays,1,90)&&int(p.criteria.minTailWindows,1,90)&&prob(p.criteria.maxFalseAlertRate)&&prob(p.criteria.maxMissRate)&&finite(p.criteria.tailConfidence)&&p.criteria.tailConfidence>=.5&&p.criteria.tailConfidence<1,'AUDIT_CRITERIA_INVALID');
 const folds=Object.fromEntries(FOLDS.map(k=>[k,p.folds?.[k]])),days=FOLDS.flatMap(k=>folds[k]||[]);
 check(FOLDS.every(k=>Array.isArray(folds[k])&&folds[k].length>0)&&int(days.length,3,90)&&unique(days)&&days.every((d,i)=>calendar.includes(d)&&(!i||days[i-1]<d)&&calendar[calendar.indexOf(d)+p.horizon])&&now<open(days[0]),'AUDIT_FOLDS_OR_REGISTRATION_INVALID');
 const policies=Object.fromEntries(POLICIES.map(k=>{const m=p.policies?.[k];check(m&&text(m.version)&&hex(m.modelFingerprint)&&ms(m.trainingEndedAt)&&m.trainingEndedAt<=now,'AUDIT_POLICY_IDENTITY_INVALID');return [k,{version:m.version,modelFingerprint:m.modelFingerprint,trainingEndedAt:m.trainingEndedAt}];}));
 return seal({schemaVersion:1,version:VERSION,scope:p.scope,feed:feedOf(p.feed,p.scope),population:p.population,horizon:p.horizon,lossPct:p.lossPct,calendar:calendar.slice(),folds:Object.fromEntries(FOLDS.map(k=>[k,folds[k].slice()])),criteria:{minSamples:p.criteria.minSamples,minDays:p.criteria.minDays,minTailWindows:p.criteria.minTailWindows,maxFalseAlertRate:p.criteria.maxFalseAlertRate,maxMissRate:p.criteria.maxMissRate,tailConfidence:p.criteria.tailConfidence},policies,registeredAt:now});
}
function verifiedPlan(plan){const p=unseal(plan);check(registerRiskAudit(p,{now:p.registeredAt}).fingerprint===plan.fingerprint,'AUDIT_PLAN_INVALID');return p;}
function freezeRiskDay(plan,cohort,opinions,{now=Date.now()}={}){
 const p=verifiedPlan(plan),c=unseal(cohort),again=freezeCohort({schemaVersion:1,feed:c.feed,signals:c.signals},{now:c.frozenAt});
 check(again.fingerprint===cohort.fingerprint&&hash(c.feed)===hash(p.feed)&&ms(c.frozenAt)&&ms(now)&&c.frozenAt<=now,'AUDIT_COHORT_INVALID');
 const day=c.signals[0].signalDate,i=p.calendar.indexOf(day),fold=FOLDS.find(k=>p.folds[k].includes(day));
 check(fold&&c.signals.every(s=>s.signalDate===day&&s.cohort===p.population&&typeof s.symbol==='string'&&ms(s.signalAt)&&s.signalAt>=close(day)&&(p.scope==='fixture'||!fake(s.provenance)))&&unique(c.signals.map(s=>s.symbol))&&c.frozenAt>=close(day)&&now<open(p.calendar[i+1]),'AUDIT_LATE_OR_DUPLICATE_SECURITY_DAY');
 check(Array.isArray(opinions)&&opinions.length<=3*c.signals.length,'AUDIT_OPINIONS_INVALID');
 const signals=new Map(c.signals.map(s=>[s.signalId,s])),seen=new Set();
 const rows=opinions.map(o=>{const s=signals.get(o?.signalId),m=p.policies[o?.policy],key=JSON.stringify([o?.signalId,o?.policy]);
  check(s&&m&&POLICIES.includes(o.policy)&&!seen.has(key)&&o.planFingerprint===plan.fingerprint&&o.target==='forward-close-loss-event'&&o.horizon===p.horizon&&o.lossPct===p.lossPct&&o.version===m.version&&o.modelFingerprint===m.modelFingerprint&&text(o.evidenceRef)&&ms(o.knownAt)&&o.knownAt>=s.signalAt&&o.knownAt<=now&&['alert','clear','abstain'].includes(o.verdict)&& (o.probability===null||o.verdict!=='abstain'&&o.valueKind==='declared-event-probability'&&prob(o.probability)),'AUDIT_OPINION_TIME_IDENTITY_OR_KIND_INVALID');
  seen.add(key);return {signalId:o.signalId,policy:o.policy,planFingerprint:o.planFingerprint,target:o.target,horizon:o.horizon,lossPct:o.lossPct,version:o.version,modelFingerprint:o.modelFingerprint,evidenceRef:o.evidenceRef,knownAt:o.knownAt,verdict:o.verdict,probability:o.probability,valueKind:o.probability===null?null:o.valueKind};});
 return seal({schemaVersion:1,version:VERSION,planFingerprint:plan.fingerprint,day,fold,cohortFingerprint:cohort.fingerprint,frozenAt:now,opinions:rows});
}
const div=(n,d)=>d?n/d:null;
const avg=a=>a.length?a.reduce((n,x)=>n+x/a.length,0):null;
function counts(rows,policy){
 let tp=0,fp=0,tn=0,fn=0,unknown=0,abstained=0,missedOrAbstained=0;
 for(const row of rows){const o=row.opinions[policy];if(row.event===null){unknown++;continue;}if(!o||o.verdict==='abstain'){abstained++;if(row.event)missedOrAbstained++;continue;}if(o.verdict==='alert'){if(row.event)tp++;else fp++;}else if(row.event){fn++;missedOrAbstained++;}else tn++;}
 const positives=rows.filter(r=>r.event===true).length;
 return {tp,fp,tn,fn,unknownOutcome:unknown,abstainedOrMissing:abstained,decisiveCoverage:div(tp+fp+tn+fn,rows.length),precision:div(tp,tp+fp),recallOnDecisions:div(tp,tp+fn),recallIncludingAbstention:div(tp,positives),falseAlertRate:div(fp,fp+tn),missRateIncludingAbstention:div(missedOrAbstained,positives),normalDivergenceFalseAlertRate:null,trueCollapseRecall:null};
}
function tail(rows,p){
 const incomplete=new Set(rows.filter(r=>r.event===null).map(r=>r.day));
 const byDay=new Map();for(const r of rows){if(incomplete.has(r.day))continue;const old=byDay.get(r.day),loss=Math.max(0,-r.priceReturnPct);if(!old||loss>old.loss)byDay.set(r.day,{day:r.day,target:r.targetDate,loss});}
 // One worst observed security per date, then greedily choose disjoint
 // windows. This is a descriptive price-loss proxy, not independent trials.
 let end='',chosen=[];for(const r of [...byDay.values()].sort((a,b)=>a.target.localeCompare(b.target)||a.day.localeCompare(b.day))){if(r.day>end){chosen.push(r);end=r.target;}}
 const n=chosen.length,k=Math.ceil((1-p.criteria.tailConfidence)*n-1e-12),values=chosen.map(x=>x.loss).sort((a,b)=>b-a);
 const ready=n>=p.criteria.minDays&&k>=p.criteria.minTailWindows&&k>0;
 return {observedDays:byDay.size,incompleteDays:incomplete.size,nonOverlappingWindows:n,tailWindows:k,confidence:p.criteria.tailConfidence,status:ready?'descriptive-price-tail':'insufficient-tail-evidence',varLossPct:ready?values[n-Math.ceil(n*p.criteria.tailConfidence)]:null,expectedShortfallPct:ready?avg(values.slice(0,k)):null,maximumLossBound:null,independenceCertified:false,basis:'worst-security-per-complete-signal-day, disjoint close-to-close windows; mean of worst ceil((1-confidence)*n) windows'};
}
function evaluateRiskAudit(plan,packets,market,{now=Date.now()}={}){
 const p=verifiedPlan(plan),days=FOLDS.flatMap(k=>p.folds[k]);
 check(ms(now)&&now>=p.registeredAt&&Array.isArray(packets)&&packets.length<=days.length&&hash(feedOf(market?.feed,p.scope))===hash(p.feed)&&hash(market.calendar)===hash(p.calendar)&&ms(market.observedAt)&&market.observedAt<=now&&Array.isArray(market.stocks)&&market.stocks.length<=500&&market.stocks.reduce((n,s)=>n+(Array.isArray(s.bars)?s.bars.length:50001),0)<=50000,'AUDIT_MARKET_OR_INPUT_INVALID');
 const byDay=new Map(),signals=new Set();let total=0;
 for(const item of packets){const c=item?.cohort,packet=item?.packet,b=unseal(packet),recreated=freezeRiskDay(plan,c,b.opinions,{now:b.frozenAt});
  check(recreated.fingerprint===packet.fingerprint&&b.frozenAt<=now&&!byDay.has(b.day)&&c.signals.every(s=>!signals.has(s.signalId)),'AUDIT_PACKET_DUPLICATE_OR_INVALID');
  c.signals.forEach(s=>signals.add(s.signalId));total+=c.signals.length;check(total<=5000,'AUDIT_SAMPLE_LIMIT');byDay.set(b.day,{c,b,packetFingerprint:packet.fingerprint});}
 const rows=[],missingDays=[],unavailableDays=[],marketFingerprint=hash(market),stockIndex=indexStocks(market);
 for(const day of days){const item=byDay.get(day);if(!item){missingDays.push(day);continue;}
  const {c,b}=item,idx=FOLDS.indexOf(b.fold),targetDate=p.calendar[p.calendar.indexOf(day)+p.horizon],next=FOLDS[idx+1],purged=!!next&&targetDate>=p.folds[next][0];
  let records=new Map();if(!purged&&market.asOf>=day){try{records=new Map(evaluateForward(c,market,{now}).records.map(r=>[r.signalId,r]));}catch{unavailableDays.push(day);}}
  const opinions=new Map(b.opinions.map(o=>[JSON.stringify([o.signalId,o.policy]),o]));
  for(const s of c.signals){
   const record=records.get(s.signalId),w=record?.windows.find(x=>x.tradingDays===p.horizon),stock=stockIndex.get(s.symbol);
   const receipt=closeReceipt(stock?.bars.get(targetDate),s.symbol,market);
   // Legacy source snapshots lacking individual bar clocks remain descriptive;
   // an EXPLICIT invalid clock/finality/conflict may not be silently ignored.
   const known=!purged&&w?.status==='observed'&&w.targetDate===targetDate&&finite(w.priceReturnPct)&&w.priceReturnPct>=-100&&market.observedAt>=close(targetDate)&&receipt.status!=='invalid-or-missing';
   const closePath=buildCloseRiskPath({signal:s,market,stock,calendarIndex:p.calendar.indexOf(day),horizon:p.horizon,lossPct:p.lossPct,validated:!!record,purged});
   rows.push({signalId:s.signalId,symbol:s.symbol,day,fold:b.fold,targetDate,cohortFingerprint:c.fingerprint,packetFingerprint:item.packetFingerprint,marketFingerprint:known?marketFingerprint:null,outcomeObservedAt:known?market.observedAt:null,outcomeReceiptStatus:known?receipt.status:null,outcomeExplicitAvailableAt:known?receipt.knownAt:null,status:purged?'purged-overlapping-fold':known?'observed-price':w?.status==='observed'?'invalid-outcome':w?.status||'unavailable',priceReturnPct:known?w.priceReturnPct:null,event:known?w.priceReturnPct<=-p.lossPct+1e-9:null,closePath,opinions:Object.fromEntries(POLICIES.map(k=>[k,opinions.get(JSON.stringify([s.signalId,k]))||null]))});}
 }
 const folds=Object.fromEntries(FOLDS.map(k=>{const all=rows.filter(r=>r.fold===k),eligible=all.filter(r=>r.status!=='purged-overlapping-fold'),known=eligible.filter(r=>r.event!==null),paired=known.filter(r=>POLICIES.every(m=>r.opinions[m]&&r.opinions[m].verdict!=='abstain')),probabilityRows=paired.filter(r=>POLICIES.every(m=>prob(r.opinions[m].probability)));
  const perPolicy=Object.fromEntries(POLICIES.map(m=>[m,{all:counts(eligible,m),paired:counts(paired,m),pairedBrier:probabilityRows.length===paired.length&&paired.length?avg(probabilityRows.map(r=>(r.opinions[m].probability-Number(r.event))**2)):null}]));
  return [k,{expectedDays:p.folds[k].length,receivedDays:p.folds[k].filter(d=>byDay.has(d)).length,missingDays:p.folds[k].filter(d=>!byDay.has(d)),purgedCount:all.length-eligible.length,expectedSignals:eligible.length,knownOutcomes:known.length,pairedCount:paired.length,pairedProbabilityCount:probabilityRows.length,pairedDays:new Set(paired.map(r=>r.day)).size,coverage:div(paired.length,eligible.length),perPolicy,tail:tail(eligible,p),receivedDayCoverage:div(p.folds[k].filter(d=>byDay.has(d)).length,p.folds[k].length),registeredPopulationCoverage:null,closePaths:summarizeClosePaths(eligible,p.folds[k].length,p.folds[k].filter(d=>byDay.has(d)).length),labelSensitivity:labelSensitivity(paired,p.lossPct)}];}));
 const h=folds.holdout,c=h.perPolicy.conditional.all;
 const reviewReady=missingDays.length===0&&unavailableDays.length===0&&FOLDS.every(k=>folds[k].expectedSignals>=p.criteria.minSamples&&folds[k].pairedDays>=p.criteria.minDays&&folds[k].coverage===1)&&h.tail.status==='descriptive-price-tail'&&c.falseAlertRate!==null&&c.missRateIncludingAbstention!==null&&c.falseAlertRate<=p.criteria.maxFalseAlertRate&&c.missRateIncludingAbstention<=p.criteria.maxMissRate;
 return {version:VERSION,asOf:now,planFingerprint:plan.fingerprint,scope:p.scope,marketFingerprint,target:'forward-close-loss-event',horizon:p.horizon,lossPct:p.lossPct,missingDays,unavailableDays,rows,folds,status:reviewReady?'descriptive-review-criteria-met':'incomplete-or-criteria-not-met',reviewCriteriaMet:reviewReady,eligibleForPromotion:false,trainingLabelAvailabilityCertified:false,trialBudgetCertified:false,sourceLicenseCertified:false,executionAndCostEvidence:null,actualAvoidableLoss:null,netOpportunityCost:null,prAuc:null,maximumAdverseExcursion:null,normalDivergenceReview:null,...FLAGS};
}
module.exports={registerRiskAudit,freezeRiskDay,evaluateRiskAudit,VERSION};
