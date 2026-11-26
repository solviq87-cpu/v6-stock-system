'use strict';
// Read-only research projections. Never authorize a trade or replace an account.
const numeric=require('../../public/nova/shortline/numeric-factors');
const {verifiedSettlement}=require('./intelligence-execution-validation');
const {spearman}=require('./factor-redundancy');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const time=x=>Number.isSafeInteger(x)&&x>0?x:typeof x==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&Number.isFinite(Date.parse(x))?Date.parse(x):null;
const hash=numeric.fingerprint;
const DAY=86400000;
const TRIAL_POLICY=Object.freeze({observationCalendarDays:60,settlementWaitCalendarDays:30,minDays:20,minRows:60,topK:3,maximumConcurrentTrials:1});
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const sealed=x=>({...x,fingerprint:hash(x)});
const verifiedSeal=x=>{if(!x||typeof x!=='object')return false;const {fingerprint,...body}=x;return digest(fingerprint)&&fingerprint===hash(body);};
const real=numeric.realEvidence;
const vectorFor=(plan,check,row,archive)=>{
 const ref=plan?.researchFactorReference;
 if(!real(check)||check.method!=='行情自动识别'||plan.decisionAuthority!=='fayo-decision-center'||ref?.schema!=='fayo-plan-factor-reference-v1'||ref.status!=='linked'||ref.code!==row.code||check.code!==row.code||row.checkId!==check.id||ref.checkId!==check.id||ref.checkId!==plan.checkId||ref.frozenAt!==plan.frozenAt||ref.decisionId!==plan.decisionId||ref.decisionAt!==plan.decisionEvidence?.calculatedAt||ref.signalDay!==check.date||ref.targetDay!==plan.intendedDate||ref.dictionaryVersion!==archive.dictionaryVersion||ref.checkCreatedAt!==check.createdAt||ref.checkAsOf!==check.asOf||ref.checkFingerprint!==numeric.fingerprint(check)||!Array.isArray(ref.factorIds)||!ref.factorIds.length||new Set(ref.factorIds).size!==ref.factorIds.length||!ref.calendarEvidence||ref.calendarEvidence.from!==check.date||ref.calendarEvidence.to!==plan.intendedDate||ref.calendarEvidenceFingerprint!==numeric.fingerprint(ref.calendarEvidence))return null;
 const point=time(ref.decisionAt),frozen=time(plan.frozenAt),created=time(check.createdAt),observation=numeric.instant(ref.observationAt),calendar=ref.calendarEvidence;
 if(point===null||frozen===null||created===null||observation===null||observation!==numeric.instant(check.recognition?.ruleObservations?.cutoff)||observation>created||created>point||point>frozen||frozen>row.entry)return null;
 const calendarKnown=numeric.instant(calendar.knownAt);
 if(!real(calendar)||typeof calendar.source!=='string'||!calendar.source||calendarKnown===null||calendarKnown>point)return null;
 if(calendar.kind==='same-session'){if(calendar.from!==calendar.to||calendar.knownAt!==check.createdAt)return null;}
 else if(calendar.kind==='original-next-trading-day'){
  const recorded=numeric.instant(calendar.recordKnownAt);
  if(calendar.from>=calendar.to||calendarKnown>observation||recorded===null||recorded<calendarKnown||recorded>point)return null;
 }else return null;
 const vector=numeric.readNumericCheck(check,archive.catalog||[],point),ids=ref.factorIds;
 if(vector.rejected.length||ids.some(id=>!finite(vector.values[id])||!vector.definitions[id]||!vector.evidence[id]))return null;
 const values=Object.fromEntries(ids.map(id=>[id,vector.values[id]])),definitions=Object.fromEntries(ids.map(id=>[id,vector.definitions[id]])),evidence=Object.fromEntries(ids.map(id=>[id,vector.evidence[id]]));
 if(ref.factorDefinitionFingerprint!==numeric.fingerprint(definitions)||ref.observationFingerprint!==numeric.fingerprint({values,definitions,evidence})||numeric.stable(ref.numericFactors)!==numeric.stable({values,definitions}))return null;
 return {values,definitions,point};
};
const valid=(v,archive)=>v?.numericModel&&numeric.validModel(v.numericModel)&&v.numericModel.dictionaryVersion===archive.dictionaryVersion&&numeric.stable(v.weights)===numeric.stable(v.numericModel.weights);
const scoringState=v=>({weights:v.weights,threshold:v.threshold,strategyThresholds:v.strategyThresholds,minSupport:v.minSupport,numericModel:v.numericModel||null});
const validApproved=(v,a)=>valid(v,a)&&v.scoringFingerprint===numeric.fingerprint(scoringState(v));
const validCandidate=(v,a)=>valid(v,a)&&v.validationFingerprint===numeric.fingerprint({...scoringState(v),baseVersion:v.baseVersion,sourceIds:v.sourceIds,start:v.start,trainEnd:v.trainEnd,validationEnd:v.validationEnd,end:v.end,steps:v.steps});

function pairedFactorDiagnostics(samples,walkforward,{minDays=10,minRows=5,now=Date.now()}={}){
 const policy={minDays,minRows,minCoverage:.8,icDecline:.05,standardizedShift:1};
 const folds=(walkforward?.folds||[]).filter(f=>f.status==='evaluated'&&date(f.ranges?.test?.start)&&date(f.ranges?.test?.end)).sort((a,b)=>a.ranges.test.start.localeCompare(b.ranges.test.start));
 const recent=folds.at(-1),previous=recent&&folds.slice(0,-1).reverse().find(f=>f.ranges.test.end<recent.ranges.test.start);
 const base={status:'insufficient-disjoint-windows',policy,previous:previous?.ranges.test||null,recent:recent?.ranges.test||null,matchedSymbols:0,factors:[],canTrade:false,verifiedDecay:false};
 if(!previous||!recent||!Array.isArray(samples))return base;
 const inRange=(r,range)=>date(r.day)&&r.day>=range.start&&r.day<=range.end;
 const eligible=samples.filter(r=>inRange(r,previous.ranges.test)||inRange(r,recent.ranges.test));
 const seen=new Set();
 for(const r of eligible){
  const k=r.day+'/'+r.market+'/'+r.code;
  if(!r.code||!r.market||seen.has(k))return {...base,status:'duplicate-or-invalid-symbol-day'};
  seen.add(k);
 }
 // Every comparison day uses exactly the same securities in every market.
 // Missing stocks or a missing market exclude that day; a changed cross-section
 // cannot masquerade as a factor distribution shift.
 const mature=r=>date(r.targetDay)&&r.targetDay>r.day&&time(r.labelKnownAt)!==null&&time(r.labelKnownAt)<=now;
 const a=eligible.filter(r=>inRange(r,previous.ranges.test)&&mature(r)&&r.targetDay<recent.ranges.test.start&&time(r.labelKnownAt)<Date.parse(recent.ranges.test.start+'T00:00:00+08:00'));
 const b=eligible.filter(r=>inRange(r,recent.ranges.test)&&mature(r));
 const key=r=>r.market+'/'+r.code,bKeys=new Set(b.map(key)),common=new Set(a.map(key).filter(k=>bKeys.has(k)));
 const markets=[...new Set([...common].map(k=>k.split('/')[0]))].sort();
 const symbols=new Map(markets.map(m=>[m,[...common].filter(k=>k.startsWith(m+'/')).sort()]));
 if(!markets.length||markets.some(m=>symbols.get(m).length<minRows))return {...base,matchedSymbols:common.size};
 const matched=rows=>{
  const days=new Map();
  for(const r of rows.filter(r=>common.has(key(r)))){if(!days.has(r.day))days.set(r.day,[]);days.get(r.day).push(r);}
  return [...days.values()].filter(rs=>rs.length===common.size&&markets.every(m=>rs.filter(r=>r.market===m).length===symbols.get(m).length)).flat();
 };
 const x=matched(a),y=matched(b),countDays=rows=>new Set(rows.map(r=>r.day)).size;
 const dayCoverage={previous:countDays(x)/(countDays(eligible.filter(r=>inRange(r,previous.ranges.test)))||1),recent:countDays(y)/(countDays(eligible.filter(r=>inRange(r,recent.ranges.test)))||1)};
 const ids=[...new Set([...x,...y].flatMap(r=>Object.keys(r.values||{})))].sort();
 const mean=xs=>xs.length?xs.reduce((s,n)=>s+n,0)/xs.length:null;
 const inspect=(rows,id)=>{
  const usable=rows.filter(r=>finite(r.values?.[id])&&finite(r.returnPct)),groups=new Map(),definitions=new Set(usable.map(r=>r.definitionFingerprints?.[id]??null));
  for(const r of usable){const k=r.day+'/'+r.market;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
  const daily=[];
  for(const day of [...new Set(rows.map(r=>r.day))]){
   const cells=markets.map(m=>groups.get(day+'/'+m)||[]);
   if(cells.some((g,i)=>g.length!==symbols.get(markets[i]).length))continue;
   const ics=cells.map(g=>spearman(g.map(r=>r.values[id]),g.map(r=>r.returnPct)));
   if(ics.every(finite))daily.push(mean(ics));
  }
  const vals=usable.map(r=>r.values[id]),avg=mean(vals),sd=avg===null?null:Math.sqrt(mean(vals.map(v=>(v-avg)**2)));
  return {coverage:rows.length?usable.length/rows.length:null,observations:usable.length,days:daily.length,meanIC:mean(daily),mean:avg,sd,definitions:[...definitions]};
 };
 const factors=ids.map(id=>{
  const p=inspect(x,id),r=inspect(y,id),same=p.definitions.length===1&&r.definitions.length===1&&p.definitions[0]!==null&&p.definitions[0]===r.definitions[0];
  const enough=same&&Object.values(dayCoverage).every(n=>n>=policy.minCoverage)&&[p,r].every(v=>v.days>=minDays&&v.coverage>=policy.minCoverage);
  const delta=enough?r.meanIC-p.meanIC:null,shift=enough&&p.sd>1e-12?(r.mean-p.mean)/p.sd:null;
  return {factorId:id,previous:p,recent:r,definitionCompatible:same,status:!same?'definition-changed-or-unknown':!enough?'insufficient-samples':'descriptive-matched',icChange:delta,standardizedMeanShift:shift,performanceWarning:delta!==null&&delta<=-policy.icDecline&&r.meanIC<0,distributionWarning:shift!==null&&Math.abs(shift)>=policy.standardizedShift};
 });
 return {...base,status:factors.some(r=>r.status==='descriptive-matched')?'matched-window-diagnostics':'insufficient-factor-coverage',matchedSymbols:common.size,matchedRows:{previous:x.length,recent:y.length},matchedDayCoverage:dayCoverage,markets,factors};
}
function prospectiveComparison(rows,{minDays=20,minRows=60,topK=3}={}){
 const policy={minDays,minRows,topK,minimumGainPp:.1,stressSlippageBps:20,stressFeeMultiplier:2,maximumIndividualLossPct:20};
 const base={status:'insufficient-paired-settlements',policy,pairedRows:Array.isArray(rows)?rows.length:0,days:0,previous:null,candidate:null,meanGainPp:null,descriptiveGain:false,reviewSupported:false,approvalEligible:false,canTrade:false,canApprove:false,portfolioRiskCertified:false};
 const finite=n=>typeof n==='number'&&Number.isFinite(n);
 if(!Number.isSafeInteger(minDays)||minDays<1||!Number.isSafeInteger(minRows)||minRows<1||!Number.isSafeInteger(topK)||topK<1||!Array.isArray(rows)||rows.some(r=>!date(r.day)||!r.code||![r.currentScore,r.candidateScore,r.netReturnPct,r.stressedReturnPct].every(finite)))throw Error('配对模型研究行无效');
 const byDay=new Map(),seen=new Set();
 for(const r of rows){const k=r.day+'/'+r.code;if(seen.has(k))throw Error('配对模型股票日重复');seen.add(k);if(!byDay.has(r.day))byDay.set(r.day,[]);byDay.get(r.day).push(r);}
 const days=[...byDay].sort((a,b)=>a[0].localeCompare(b[0]));
 const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
 if(days.length<minDays||days.reduce((n,[,r])=>n+r.length,0)<minRows)return {...base,days:days.length};
 const daily=days.map(([day,r])=>{const pick=field=>[...r].sort((a,b)=>b[field]-a[field]||a.code.localeCompare(b.code)).slice(0,topK);const prev=pick('currentScore'),next=pick('candidateScore');return {day,universe:r.length,selectedEach:Math.min(topK,r.length),previous:mean(prev.map(x=>x.netReturnPct)),candidate:mean(next.map(x=>x.netReturnPct)),previousStress:mean(prev.map(x=>x.stressedReturnPct)),candidateStress:mean(next.map(x=>x.stressedReturnPct)),previousWorst:Math.min(...prev.map(x=>x.stressedReturnPct)),candidateWorst:Math.min(...next.map(x=>x.stressedReturnPct))};});
 const prev={meanDailyNetReturnPct:mean(daily.map(x=>x.previous)),meanDailyStressReturnPct:mean(daily.map(x=>x.previousStress)),worstStressedTradePct:Math.min(...daily.map(x=>x.previousWorst))};
 const next={meanDailyNetReturnPct:mean(daily.map(x=>x.candidate)),meanDailyStressReturnPct:mean(daily.map(x=>x.candidateStress)),worstStressedTradePct:Math.min(...daily.map(x=>x.candidateWorst))};
 const delta=next.meanDailyNetReturnPct-prev.meanDailyNetReturnPct,blocks=[daily.slice(0,Math.floor(daily.length/2)),daily.slice(Math.floor(daily.length/2))],blockGains=blocks.map(b=>mean(b.map(x=>x.candidate-x.previous)));
 const pass=delta>=policy.minimumGainPp&&next.meanDailyStressReturnPct>0&&next.meanDailyStressReturnPct>=prev.meanDailyStressReturnPct&&next.worstStressedTradePct>=Math.max(-policy.maximumIndividualLossPct,prev.worstStressedTradePct)&&blockGains.every(n=>n>0);
 return {...base,status:pass?'descriptive-paired-settlement-gain':'paired-settlement-gain-not-established',days:daily.length,pairedRows:daily.reduce((n,r)=>n+r.universe,0),previous:prev,candidate:next,meanGainPp:delta,blockGains,daily,descriptiveGain:pass};
}
function duplicateIdentity(rows,key='id'){
 if(!Array.isArray(rows))return true;
 const seen=new Set();
 for(const r of rows){if(r?.[key]==null||r[key]===''||seen.has(r[key]))return true;seen.add(r[key]);}
 return false;
}
function currentModel(archive,now){
 // Match the original learning reducer's append order, rather than selecting a
 // different baseline when timestamps happen to tie.
 return [...(archive.versions||[])].reverse().find(v=>real(v)&&time(v.approvedAt)!==null&&time(v.approvedAt)<=now);
}
function trialBinding(candidate,current,archive){
 return {candidateId:candidate.id,candidateFingerprint:candidate.numericModel.fingerprint,candidateValidationFingerprint:candidate.validationFingerprint,
  currentVersion:current.number,currentFingerprint:current.numericModel.fingerprint,currentScoringFingerprint:current.scoringFingerprint,dictionaryVersion:archive.dictionaryVersion};
}
function validTrialShape(trial){
 const registered=time(trial?.registeredAt);
 return verifiedSeal(trial)&&trial.schemaVersion===1&&trial.mode==='fayo-prospective-model-trial-v1'&&registered!==null&&
  numeric.stable(trial.policy)===numeric.stable(TRIAL_POLICY)&&trial.observationsFrom===registered+1&&
  trial.observationsThrough===registered+TRIAL_POLICY.observationCalendarDays*DAY&&
  trial.labelsThrough===trial.observationsThrough+TRIAL_POLICY.settlementWaitCalendarDays*DAY;
}
function validTrial(trial,candidate,current,archive){
 if(!validTrialShape(trial)||trial.status!=='registered'||
    numeric.stable(trial.binding)!==numeric.stable(trialBinding(candidate,current,archive))||numeric.stable(trial.policy)!==numeric.stable(TRIAL_POLICY))return false;
 const created=time(candidate.createdAt),registered=time(trial.registeredAt);
 return created!==null&&registered!==null&&created<=registered&&registered-created<=60000&&
  trial.observationsFrom===registered+1&&trial.observationsThrough===registered+TRIAL_POLICY.observationCalendarDays*DAY&&
  trial.labelsThrough===trial.observationsThrough+TRIAL_POLICY.settlementWaitCalendarDays*DAY;
}
// Called only for newly created candidates while the original archive is locked.
// Old candidates are deliberately not retroactively preregistered.
function registerModelTrials(archive,previousIds,{now=Date.now()}={}){
 if(!Number.isSafeInteger(now)||now<=0||!Array.isArray(previousIds))throw Error('前瞻试验登记上下文无效');
 if(!real(archive))return;
 const current=currentModel(archive,now),old=new Set(previousIds);
 if(!validApproved(current,archive))return;
 for(const candidate of archive.candidates||[]){
  if(old.has(candidate.id)||!candidate.numericModel)continue;
  const prior=(archive.candidates||[]).filter(c=>c!==candidate&&c.prospectiveTrial);
  const make=status=>sealed({schemaVersion:1,mode:'fayo-prospective-model-trial-v1',status,registeredAt:now,
   binding:trialBinding(candidate,current,archive),policy:{...TRIAL_POLICY},observationsFrom:now+1,
   observationsThrough:now+TRIAL_POLICY.observationCalendarDays*DAY,labelsThrough:now+(TRIAL_POLICY.observationCalendarDays+TRIAL_POLICY.settlementWaitCalendarDays)*DAY});
  if(candidate.prospectiveTrial)throw Error('新候选不得携带客户端前瞻登记');
  let status='registered';
  if(!validCandidate(candidate,archive)||candidate.baseVersion!==current.number||time(candidate.createdAt)===null||time(candidate.createdAt)>now||now-time(candidate.createdAt)>60000||
     candidate.status!=='待人工审批')status='ineligible-original-validation';
  else if(prior.some(c=>!validTrialShape(c.prospectiveTrial)))status='invalid-trial-history';
  else if(prior.some(c=>c.prospectiveTrial.binding?.candidateFingerprint===candidate.numericModel.fingerprint))status='model-already-registered';
  else if(prior.some(c=>c.prospectiveTrial.status==='registered'&&c.prospectiveTrial.labelsThrough>=now))status='overlapping-trial-blocked';
  candidate.prospectiveTrial=make(status);
 }
}
function validNativeReview(receipt,context){
 // Hashes alone do not establish authority. This receipt is accepted only from
 // the server-internal reader passed below, never from an HTTP payload or an
 // archive field. That reader must verify the original journals and risk result.
 // A delayed first close must not reuse a review from before the result was
 // actually sealed, even if the planned label deadline had already passed.
 const closedAt=time(context.closedAt);
 if(closedAt===null||!receipt||receipt.schemaVersion!==1||receipt.source!=='original-research-and-risk-services'||
    receipt.trialFingerprint!==context.trial.fingerprint||receipt.evidenceFingerprint!==context.evidenceFingerprint||
    receipt.currentFingerprint!==context.trial.binding.currentFingerprint||receipt.candidateFingerprint!==context.trial.binding.candidateFingerprint||
    time(receipt.knownAt)===null||time(receipt.knownAt)>context.now||time(receipt.knownAt)<closedAt)return false;
 const c=receipt.cohort,r=receipt.risk;
 return c?.source==='original-model-independent-observation-journal'&&digest(c.fingerprint)&&
  c.selection==='before-model-ranking'&&c.complete===true&&time(c.registeredAt)!==null&&time(c.registeredAt)<=context.trial.registeredAt&&
  c.observationsFrom===context.trial.observationsFrom&&c.observationsThrough===context.trial.observationsThrough&&
  Array.isArray(c.planIds)&&new Set(c.planIds).size===c.planIds.length&&numeric.stable([...c.planIds].sort())===numeric.stable(context.planIds)&&
  r?.source==='original-authoritative-risk-engine'&&digest(r.fingerprint)&&digest(r.policyFingerprint)&&
  r.evidenceFingerprint===context.evidenceFingerprint&&r.currentFingerprint===context.trial.binding.currentFingerprint&&
  r.candidateFingerprint===context.trial.binding.candidateFingerprint&&time(r.evaluatedAt)!==null&&
  time(r.evaluatedAt)>=closedAt&&time(r.evaluatedAt)<=time(receipt.knownAt)&&r.passed===true&&r.limitsUnchanged===true&&r.portfolioRiskCertified===true;
}
function modelComparison(archive,{now=Date.now(),candidateId,closing=false,readProspectiveReview}={}){
 const empty={status:'missing-compatible-current-and-candidate',candidateId:null,currentVersion:null,pairedRows:0,days:0,descriptiveGain:false,reviewSupported:false,approvalEligible:false,canTrade:false,canApprove:false,portfolioRiskCertified:false};
 if(!Number.isSafeInteger(now)||now<=0)throw Error('模型比较时钟无效');
 if(!real(archive))return empty;
 if(duplicateIdentity(archive.candidates||[])||duplicateIdentity(archive.plans||[])||duplicateIdentity(archive.checks||[])||duplicateIdentity(archive.trades||[])||duplicateIdentity(archive.versions||[],'number'))return {...empty,status:'duplicate-or-invalid-archive-identity'};
 const current=currentModel(archive,now),candidates=(archive.candidates||[]).filter(c=>real(c)&&time(c.createdAt)!==null&&time(c.createdAt)<=now);
 const candidate=candidateId?candidates.find(c=>c.id===candidateId):candidates.filter(c=>c.status==='待人工审批').at(-1);
 const base={...empty,candidateId:candidate?.id||null,currentVersion:current?.number??null,candidateCreatedAt:candidate?.createdAt||null,currentApprovedAt:current?.approvedAt||null,currentFingerprint:current?.numericModel?.fingerprint||null,candidateFingerprint:candidate?.numericModel?.fingerprint||null,source:'original-frozen-plans-and-verified-settlements'};
 if(!validApproved(current,archive)||!validCandidate(candidate,archive)||candidate.baseVersion!==current.number)return base;
 if(!closing&&candidate.status!=='待人工审批')return {...base,status:'candidate-not-pending'};
 const start=time(candidate.createdAt),approved=time(current.approvedAt),trial=candidate.prospectiveTrial;
 if(start<=approved||[current,candidate].some(v=>!finite(v.numericModel.trainingLabelKnownAtMax)||v.numericModel.trainingLabelKnownAtMax>=(v===current?approved:start)||time(v.numericModel.trainCutoff)===null||time(v.numericModel.trainCutoff)>(v===current?approved:start)))return {...base,status:'model-lineage-or-training-cutoff-invalid'};
 if(!validTrial(trial,candidate,current,archive))return {...base,status:trial?.status==='registered'?'invalid-preregistered-trial':trial?.status||'missing-preregistered-trial'};
 const trialView={fingerprint:trial.fingerprint,registeredAt:trial.registeredAt,observationsFrom:trial.observationsFrom,observationsThrough:trial.observationsThrough,labelsThrough:trial.labelsThrough,policy:trial.policy};
 if(now<trial.labelsThrough)return {...base,status:'prospective-trial-not-closed',trial:trialView,note:'留出期尚未结束，按事前固定观察与结算截止等待，不提前披露收益。'};
 if(!closing&&!candidate.prospectiveResult)return {...base,status:'awaiting-locked-trial-close',trial:trialView};
 const checks=new Map((archive.checks||[]).map(c=>[c.id,c])),trades=new Map(),settlementClaims=new Map(),codeDays=new Map(),accepted=[],excluded=Object.create(null),seen=new Set();
 const usedIds=new Set([...(candidate.sourceIds||[]),...(candidate.numericModel.sourceIds||[]),...(current.numericModel.sourceIds||[])]);
 const skip=k=>{excluded[k]=(excluded[k]||0)+1;};
 for(const t of archive.trades||[]){
  if(!trades.has(t.planId))trades.set(t.planId,[]);trades.get(t.planId).push(t);
  const p=t.paperSettlement;
  // Audit the original event identity across the whole formal archive, before
  // filtering by date, plan or valid economics. A second conflicting claim
  // must not leave whichever profitable row happened to be encountered first.
  if(real(t)&&p&&['pool','pre'].includes(p.accountId)&&typeof p.exitEventId==='string'&&p.exitEventId){
   const identity=hash([p.accountId,p.exitEventId]);
   settlementClaims.set(identity,(settlementClaims.get(identity)||0)+1);
  }
 }
 const cohort=(archive.plans||[]).filter(p=>real(p)&&p.decisionAuthority==='fayo-decision-center'&&time(p.frozenAt)>=trial.observationsFrom&&time(p.frozenAt)<=trial.observationsThrough).sort((a,b)=>a.id.localeCompare(b.id));
 const inputFingerprint=hash(cohort.map(p=>({plan:p,check:checks.get(p.checkId)||null,trades:(trades.get(p.id)||[]).toSorted((a,b)=>a.id.localeCompare(b.id))})));
 for(const p of cohort){
  const ts=trades.get(p.id)||[];
  if(ts.length!==1){skip(ts.length?'partial-or-repeated-settlement':'unfilled-or-unsettled-plan');continue;}
  const t=ts[0];
  if(!real(t)){skip('non-formal-settlement');continue;}
  const v=verifiedSettlement(t,p,trial.labelsThrough),r=v.row;
  if(!r||r.quality!=='standard'){skip(v.reason||'extreme-stratum');continue;}
  if(!digest(r.settlementIdentity)||!digest(r.settlementContentFingerprint)||settlementClaims.get(r.settlementIdentity)!==1){skip('reused-or-conflicting-original-settlement-event');continue;}
  if(r.entryPriceEvidence!=='exact-cent-price-reconciled'){skip('entry-price-allocation-not-replayed');continue;}
  if(seen.has(r.fingerprint)){skip('repeated-settlement-proof');continue;}seen.add(r.fingerprint);
  if(usedIds.has(t.id)){skip('used-training-or-validation-trade');continue;}
  const vector=vectorFor(p,checks.get(p.checkId),{...r,checkId:t.checkId},archive);
  if(!vector||vector.point<trial.observationsFrom||vector.point>trial.observationsThrough){skip('missing-post-registration-frozen-vector');continue;}
  const a=numeric.numericScore(current.numericModel,vector).score,b=numeric.numericScore(candidate.numericModel,vector).score;
  if(!finite(a)||!finite(b)){skip('incompatible-factor-vector');continue;}
  const row={day:r.signalDay,code:r.code,planId:p.id,currentScore:a,candidateScore:b,netReturnPct:r.netCents/r.costBasisCents*100,
   stressedReturnPct:(r.netCents-r.costCents-(r.entryGrossCents+r.exitGrossCents)*.002)/r.costBasisCents*100,settlementFingerprint:r.fingerprint,settlementIdentity:r.settlementIdentity,settlementContentFingerprint:r.settlementContentFingerprint,entryPriceEvidence:r.entryPriceEvidence};
  const k=row.day+'/'+row.code;codeDays.set(k,(codeDays.get(k)||0)+1);accepted.push(row);
 }
 const rows=accepted.filter(r=>codeDays.get(r.day+'/'+r.code)===1).sort((a,b)=>a.day.localeCompare(b.day)||a.code.localeCompare(b.code));
 if(rows.length!==accepted.length)excluded['duplicate-symbol-day']=accepted.length-rows.length;
 const comparison=prospectiveComparison(rows),planIds=cohort.map(p=>p.id).sort(),coverage={planned:cohort.length,paired:rows.length,excluded:cohort.length-rows.length,complete:cohort.length>0&&cohort.length===rows.length};
 const evidenceFingerprint=hash({trialFingerprint:trial.fingerprint,inputFingerprint,rows,excluded,coverage});
 const result={...base,...comparison,trial:trialView,excluded,coverage,inputFingerprint,evidenceFingerprint,planIds,
  scope:'descriptive-original-settled-cohort; independent-universe-and-original-risk-review-required',
  note:'同日净结算排序仅为描述。未成交、未平仓、晚到、重复事件或未重放的买入价分摊均保留覆盖缺口；完整独立队列与原风险引擎回执齐备前不支持晋级。'};
 if(closing)return result;
 const saved=candidate.prospectiveResult;
 if(!verifiedSeal(saved)||saved.schemaVersion!==1||saved.trialFingerprint!==trial.fingerprint||time(saved.closedAt)===null||time(saved.closedAt)<trial.labelsThrough||time(saved.closedAt)>now||saved.evidenceFingerprint!==evidenceFingerprint||saved.inputFingerprint!==inputFingerprint)return {...result,status:'sealed-trial-evidence-changed',descriptiveGain:false,reviewSupported:false,approvalEligible:false};
 if(!coverage.complete)return {...result,status:'incomplete-prospective-cohort'};
 if(!comparison.descriptiveGain)return result;
 if(typeof readProspectiveReview!=='function')return {...result,status:'missing-independent-cohort-and-original-risk-review'};
 const context={trial:structuredClone(trial),evidenceFingerprint,planIds,closedAt:time(saved.closedAt),now};
 const priorReviewState=hash({current,candidate,plans:archive.plans,checks:archive.checks,trades:archive.trades});
 let receipt;
 try{receipt=readProspectiveReview(structuredClone(context));}catch{return {...result,status:'native-review-unavailable'};}
 if(hash({current,candidate,plans:archive.plans,checks:archive.checks,trades:archive.trades})!==priorReviewState)return {...result,status:'native-review-evidence-changed'};
 if(!validNativeReview(receipt,context))return {...result,status:'invalid-native-review-receipt'};
 return {...result,status:'independent-prospective-review-supported',reviewSupported:true,approvalEligible:true,portfolioRiskCertified:true,
  nativeReview:{fingerprint:hash(receipt),knownAt:receipt.knownAt,cohortFingerprint:receipt.cohort.fingerprint,riskFingerprint:receipt.risk.fingerprint,riskPolicyFingerprint:receipt.risk.policyFingerprint}};
}
function closeModelTrials(archive,{now=Date.now()}={}){
 const closedCandidateIds=[];
 if(!real(archive))return {closedCandidateIds};
 for(const candidate of archive.candidates||[]){
  const trial=candidate.prospectiveTrial;
  if(trial?.status!=='registered'||candidate.prospectiveResult||!Number.isSafeInteger(trial.labelsThrough)||now<trial.labelsThrough)continue;
  const result=modelComparison(archive,{now,candidateId:candidate.id,closing:true});
  if(!result.evidenceFingerprint)continue;
  candidate.prospectiveResult=sealed({schemaVersion:1,trialFingerprint:trial.fingerprint,closedAt:now,inputFingerprint:result.inputFingerprint,
   evidenceFingerprint:result.evidenceFingerprint,status:result.status,coverage:result.coverage,excluded:result.excluded,days:result.days,pairedRows:result.pairedRows,
   descriptiveGain:result.descriptiveGain,meanGainPp:result.meanGainPp,reviewSupported:false,approvalEligible:false});
  closedCandidateIds.push(candidate.id);
 }
 return {closedCandidateIds};
}
function buildGovernance({archive,samples=[],walkforward={},quality={},execution={},feedback={},now=Date.now()}={}){
 const normalized=samples.map(r=>({...r,definitionFingerprints:Object.fromEntries(Object.keys(r.values||{}).map(id=>[id,r.evidence?.[id]?numeric.fingerprint(numeric.numericDefinition(id,r.evidence[id])):null]))}));
 const drift=pairedFactorDiagnostics(normalized,walkforward,{now});
 const latest=(walkforward.folds||[]).filter(f=>f.status==='evaluated').at(-1);
 const factors=(archive?.catalog||[]).map(r=>'YZ-'+String(r.id).padStart(2,'0'));
 const ids=[...new Set([...factors,...(walkforward.factorIds||[])])].sort();
 const health=ids.map(id=>{const t=latest?.raw?.train?.[id],v=latest?.raw?.validation?.[id],o=latest?.raw?.test?.[id],d=drift.factors.find(r=>r.factorId===id),duplicate=latest?.redundancy?.suppressedFactors?.find(r=>r.factorId===id);return {factorId:id,trainingIC:t?.meanIC??null,validationIC:v?.meanIC??null,holdoutIC:o?.meanIC??null,holdoutDays:o?.days??0,coverage:d?.recent?.coverage??null,meanShift:d?.standardizedMeanShift??null,icChange:d?.icChange??null,redundantWith:duplicate?.duplicateOf??null,reviewCandidate:duplicate?'review-redundancy':d?.performanceWarning?'review-decay':d?.distributionWarning?'review-distribution':d?.recent?.coverage!=null&&d.recent.coverage<.8?'review-coverage':d?.status==='descriptive-matched'?'no-review-trigger':'insufficient-evidence',productionChanged:false};});
 const comparison=modelComparison(archive,{now});
 const reasons=[];
 const q=(quality.components||[]).filter(r=>r.key!=='realtime'&&r.id!=='realtime');
 const bad=q.filter(r=>finite(r.value)&&r.value<.8);
 if(bad.length)reasons.push({code:'DATA_QUALITY_GAP',scope:'current-research-input',evidence:bad.map(r=>({label:r.label,value:r.value})),meaning:'数据质量异常，不能直接归为策略衰减'});
 if(drift.status!=='matched-window-diagnostics')reasons.push({code:'INSUFFICIENT_MATCHED_SAMPLES',scope:'same-symbol-disjoint-holdout',meaning:'成熟同口径样本不足'});
 const shifts=drift.factors.filter(r=>r.distributionWarning).map(r=>r.factorId),decays=drift.factors.filter(r=>r.performanceWarning).map(r=>r.factorId);
 if(shifts.length)reasons.push({code:'FACTOR_DISTRIBUTION_SHIFT',scope:'matched-factor-definition',factorIds:shifts,meaning:'分布变化，原因待核验'});
 if(decays.length)reasons.push({code:'FACTOR_IC_DETERIORATION',scope:'same-definition-hfq-label-effect-not-certified',factorIds:decays,meaning:'独立窗口 IC 下滑，仅为因子表现复核线索'});
 if(execution.overall?.costStressPassed===false)reasons.push({code:'COST_PRESSURE',scope:'verified-settlements',meaning:'原结算在假设成本压力下未通过；不等于真实成本已经上涨'});
 const executionSummary=groups=>Object.fromEntries(Object.entries(groups||{}).map(([k,v])=>[k,{samples:v.samples,status:v.status,netReturnPct:v.scenarios?.find(r=>r.slippageBps===0&&r.feeMultiplier===1)?.meanTradeNetReturnPct??null,costStressPassed:v.costStressPassed??null,portfolioDrawdownPct:null}]));
 const environments=executionSummary(execution.byRegime);
 return {schemaVersion:1,mode:'fayo-research-governance-readonly',asOf:now,status:reasons.some(r=>r.code!=='INSUFFICIENT_MATCHED_SAMPLES')?'review-observed-unverified':'unknown',decay:{status:'unverified',reasons,verifiedDecay:false,drift,executionDeviation:null,causalAttribution:null},factors:health,modelComparison:comparison,modelHistory:{approved:(archive?.versions||[]).filter(v=>real(v)&&time(v.approvedAt)!==null&&time(v.approvedAt)<=now).slice(-20).map(v=>({number:v.number,candidateId:v.candidateId,approvedAt:v.approvedAt,modelFingerprint:v.numericModel?.fingerprint??null,trainingFingerprint:v.numericModel?.trainingFingerprint??null,previousVersion:(v.number||1)-1,reason:v.reason??null})),candidates:(feedback.archivedCandidates||[]).slice(-20)},environments:{status:Object.keys(environments).length?'observed-unverified':'missing-original-regime-settlements',byRegime:environments,byStrategy:executionSummary(execution.byStrategy),byCycle:execution.byCycle||{},factorHoldoutByCycle:latest?.strata?.test||{},applicableStrategies:null,changesRiskThresholds:false},probability:{status:'not-certified',targets:require('./probability-reliability').TARGETS,types:{score:'规则评分，非概率','historical-frequency':'对应成熟样本的历史频率','model-estimate':'未经独立校准的事件估计','calibrated-probability':'需独立校准验证及认证；当前无认证'},calibrationCertified:false},executionAttribution:execution.overall?.scenarios?.find(r=>r.slippageBps===0&&r.feeMultiplier===1)?.attribution??null,canTrade:false,canApprove:false,canNotify:false,productionWeightsChanged:false,writesAccount:false};
}
module.exports={pairedFactorDiagnostics,prospectiveComparison,modelComparison,buildGovernance,registerModelTrials,closeModelTrials,TRIAL_POLICY};
