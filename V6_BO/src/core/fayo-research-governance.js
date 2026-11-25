'use strict';
// Read-only research projections. Never authorize a trade or replace an account.
const numeric=require('../../public/nova/shortline/numeric-factors');
const {verifiedSettlement}=require('./intelligence-execution-validation');
const {createHash}=require('node:crypto');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const time=x=>Number.isSafeInteger(x)&&x>0?x:typeof x==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&Number.isFinite(Date.parse(x))?Date.parse(x):null;
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const real=x=>x&&!['test','demo'].includes(x.sampleSet)&&!['test','demo'].includes(x.scope)&&!['test','demo'].includes(x.sampleScope)&&!x.synthetic&&!x.mock&&![true,1,'true','1','是'].includes(x.testSample)&&![true,1,'true','1','是'].includes(x.isTest)&&x.quality!=='教学样本'&&!/(?:^|[-_: /])(fixture|simulated|synthetic|mock|demo)(?:$|[-_: /])/i.test(String(x.source||''));
const vectorFor=(plan,check,row,archive)=>{
 const ref=plan?.researchFactorReference;
 if(!real(check)||plan.decisionAuthority!=='fayo-decision-center'||ref?.schema!=='fayo-plan-factor-reference-v1'||ref.status!=='linked'||ref.code!==row.code||ref.checkId!==check.id||ref.checkId!==plan.checkId||ref.frozenAt!==plan.frozenAt||ref.decisionId!==plan.decisionId||ref.decisionAt!==plan.decisionEvidence?.calculatedAt||ref.signalDay!==check.date||ref.targetDay!==plan.intendedDate||ref.dictionaryVersion!==archive.dictionaryVersion||ref.checkCreatedAt!==check.createdAt||ref.checkAsOf!==check.asOf||ref.checkFingerprint!==numeric.fingerprint(check)||!Array.isArray(ref.factorIds)||!ref.factorIds.length||new Set(ref.factorIds).size!==ref.factorIds.length||!ref.calendarEvidence||ref.calendarEvidence.from!==check.date||ref.calendarEvidence.to!==plan.intendedDate||ref.calendarEvidenceFingerprint!==numeric.fingerprint(ref.calendarEvidence))return null;
 const point=time(ref.decisionAt),frozen=time(plan.frozenAt),created=time(check.createdAt);
 if(point===null||frozen===null||created===null||created>point||point>frozen||frozen>row.entry)return null;
 const vector=numeric.readNumericCheck(check,archive.catalog||[],point),ids=ref.factorIds;
 if(ids.some(id=>!finite(vector.values[id])||!vector.definitions[id]||!vector.evidence[id]))return null;
 const values=Object.fromEntries(ids.map(id=>[id,vector.values[id]])),definitions=Object.fromEntries(ids.map(id=>[id,vector.definitions[id]])),evidence=Object.fromEntries(ids.map(id=>[id,vector.evidence[id]]));
 if(ref.factorDefinitionFingerprint!==numeric.fingerprint(definitions)||ref.observationFingerprint!==numeric.fingerprint({values,definitions,evidence})||numeric.stable(ref.numericFactors)!==numeric.stable({values,definitions}))return null;
 return {values,definitions,point};
};
const valid=(v,archive)=>v?.numericModel&&numeric.validModel(v.numericModel)&&v.numericModel.dictionaryVersion===archive.dictionaryVersion&&numeric.stable(v.weights)===numeric.stable(v.numericModel.weights);
const scoringState=v=>({weights:v.weights,threshold:v.threshold,strategyThresholds:v.strategyThresholds,minSupport:v.minSupport,numericModel:v.numericModel||null});
const validApproved=(v,a)=>valid(v,a)&&v.scoringFingerprint===numeric.fingerprint(scoringState(v));
const validCandidate=(v,a)=>valid(v,a)&&v.validationFingerprint===numeric.fingerprint({...scoringState(v),baseVersion:v.baseVersion,sourceIds:v.sourceIds,start:v.start,trainEnd:v.trainEnd,validationEnd:v.validationEnd,end:v.end,steps:v.steps});

function pairedFactorDiagnostics(samples,walkforward,{minDays=10,minRows=5}={}){
 const policy={minDays,minRows,minCoverage:.8,icDecline:.05,standardizedShift:1};
 const folds=(walkforward?.folds||[]).filter(f=>f.status==='evaluated'&&f.ranges?.test);
 const recent=folds.at(-1),previous=recent&&folds.slice(0,-1).reverse().find(f=>f.ranges.test.end<recent.ranges.test.start);
 const base={status:'insufficient-disjoint-windows',policy,previous:previous?.ranges.test||null,recent:recent?.ranges.test||null,matchedSymbols:0,factors:[],canTrade:false,verifiedDecay:false};
 if(!previous||!recent)return base;
 // Do not reuse boundary-crossing labels even when test windows abut.
 const inRange=(r,range)=>r.day>=range.start&&r.day<=range.end;
 const a=samples.filter(r=>inRange(r,previous.ranges.test)&&r.targetDay<recent.ranges.test.start&&r.labelKnownAt<Date.parse(recent.ranges.test.start+'T00:00:00+08:00'));
 const b=samples.filter(r=>inRange(r,recent.ranges.test));
 const key=r=>r.market+'/'+r.code;
 const bKeys=new Set(b.map(key)),common=new Set(a.map(key).filter(k=>bKeys.has(k)));
 if(common.size<minRows)return {...base,matchedSymbols:common.size};
 const x=a.filter(r=>common.has(key(r))),y=b.filter(r=>common.has(key(r)));
 const ids=[...new Set(x.flatMap(r=>Object.keys(r.values||{})))].sort();
 const finite=n=>typeof n==='number'&&Number.isFinite(n);
 const mean=xs=>xs.length?xs.reduce((s,n)=>s+n,0)/xs.length:null;
 const ranks=xs=>{const sorted=xs.map((v,i)=>({v,i})).sort((l,r)=>l.v-r.v),out=[];for(let i=0;i<sorted.length;){let j=i+1;while(j<sorted.length&&sorted[j].v===sorted[i].v)j++;for(let k=i;k<j;k++)out[sorted[k].i]=(i+j-1)/2;i=j;}return out;};
 const corr=(xs,ys)=>{const a=ranks(xs),b=ranks(ys),am=mean(a),bm=mean(b);let aa=0,bb=0,ab=0;for(let i=0;i<a.length;i++){const u=a[i]-am,v=b[i]-bm;aa+=u*u;bb+=v*v;ab+=u*v;}return aa&&bb?ab/Math.sqrt(aa*bb):null;};
 const inspect=(rows,id)=>{const usable=rows.filter(r=>finite(r.values?.[id])&&finite(r.returnPct)),groups=new Map(),definitions=new Set(usable.map(r=>r.definitionFingerprints?.[id]??null));for(const r of usable){const k=r.day+'/'+r.market;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}const daily=new Map();for(const g of groups.values()){if(g.length<minRows)continue;const ic=corr(g.map(r=>r.values[id]),g.map(r=>r.returnPct));if(ic===null)continue;if(!daily.has(g[0].day))daily.set(g[0].day,[]);daily.get(g[0].day).push(ic);}const vals=usable.map(r=>r.values[id]),avg=mean(vals),sd=avg===null?null:Math.sqrt(mean(vals.map(v=>(v-avg)**2)));return {coverage:rows.length?usable.length/rows.length:null,observations:usable.length,days:daily.size,meanIC:mean([...daily.values()].map(mean)),mean:avg,sd,definitions:[...definitions]};};
 const factors=ids.map(id=>{const p=inspect(x,id),r=inspect(y,id),same=p.definitions.length===1&&r.definitions.length===1&&p.definitions[0]!==null&&p.definitions[0]===r.definitions[0],enough=same&&[p,r].every(v=>v.days>=minDays&&v.coverage>=policy.minCoverage),delta=enough?r.meanIC-p.meanIC:null,shift=enough&&p.sd>1e-12?(r.mean-p.mean)/p.sd:null;return {factorId:id,previous:p,recent:r,definitionCompatible:same,status:!same?'definition-changed-or-unknown':!enough?'insufficient-samples':'descriptive-matched',icChange:delta,standardizedMeanShift:shift,performanceWarning:delta!==null&&delta<=-policy.icDecline&&r.meanIC<0,distributionWarning:shift!==null&&Math.abs(shift)>=policy.standardizedShift};});
 return {...base,status:factors.some(r=>r.status==='descriptive-matched')?'matched-window-diagnostics':'insufficient-factor-coverage',matchedSymbols:common.size,matchedRows:{previous:x.length,recent:y.length},factors};
}
function prospectiveComparison(rows,{minDays=20,minRows=60,topK=3}={}){
 const policy={minDays,minRows,topK,minimumGainPp:.1,stressSlippageBps:20,stressFeeMultiplier:2,maximumIndividualLossPct:20};
 const base={status:'insufficient-paired-settlements',policy,pairedRows:rows.length,days:0,previous:null,candidate:null,meanGainPp:null,reviewSupported:false,canTrade:false,canApprove:false,portfolioRiskCertified:false};
 const finite=n=>typeof n==='number'&&Number.isFinite(n);
 if(!Array.isArray(rows)||rows.some(r=>!r.day||!r.code||![r.currentScore,r.candidateScore,r.netReturnPct,r.stressedReturnPct].every(finite)))throw Error('配对模型研究行无效');
 const byDay=new Map(),seen=new Set();
 for(const r of rows){const k=r.day+'/'+r.code;if(seen.has(k))throw Error('配对模型股票日重复');seen.add(k);if(!byDay.has(r.day))byDay.set(r.day,[]);byDay.get(r.day).push(r);}
 const days=[...byDay].sort((a,b)=>a[0].localeCompare(b[0])).filter(([,r])=>r.length>=topK+1);
 const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
 if(days.length<minDays||days.reduce((n,[,r])=>n+r.length,0)<minRows)return {...base,days:days.length};
 const daily=days.map(([day,r])=>{const pick=field=>[...r].sort((a,b)=>b[field]-a[field]||a.code.localeCompare(b.code)).slice(0,topK);const prev=pick('currentScore'),next=pick('candidateScore');return {day,universe:r.length,previous:mean(prev.map(x=>x.netReturnPct)),candidate:mean(next.map(x=>x.netReturnPct)),previousStress:mean(prev.map(x=>x.stressedReturnPct)),candidateStress:mean(next.map(x=>x.stressedReturnPct)),previousWorst:Math.min(...prev.map(x=>x.stressedReturnPct)),candidateWorst:Math.min(...next.map(x=>x.stressedReturnPct))};});
 const prev={meanDailyNetReturnPct:mean(daily.map(x=>x.previous)),meanDailyStressReturnPct:mean(daily.map(x=>x.previousStress)),worstStressedTradePct:Math.min(...daily.map(x=>x.previousWorst))};
 const next={meanDailyNetReturnPct:mean(daily.map(x=>x.candidate)),meanDailyStressReturnPct:mean(daily.map(x=>x.candidateStress)),worstStressedTradePct:Math.min(...daily.map(x=>x.candidateWorst))};
 const delta=next.meanDailyNetReturnPct-prev.meanDailyNetReturnPct,blocks=[daily.slice(0,Math.floor(daily.length/2)),daily.slice(Math.floor(daily.length/2))],blockGains=blocks.map(b=>mean(b.map(x=>x.candidate-x.previous)));
 const pass=delta>=policy.minimumGainPp&&next.meanDailyStressReturnPct>0&&next.meanDailyStressReturnPct>=prev.meanDailyStressReturnPct&&next.worstStressedTradePct>=Math.max(-policy.maximumIndividualLossPct,prev.worstStressedTradePct)&&blockGains.every(n=>n>0);
 return {...base,status:pass?'paired-settlement-gain-review':'paired-settlement-gain-not-established',days:daily.length,pairedRows:daily.reduce((n,r)=>n+r.universe,0),previous:prev,candidate:next,meanGainPp:delta,blockGains,daily,reviewSupported:pass};
}
function modelComparison(archive,{now=Date.now(),candidateId}={}){
 const empty={status:'missing-compatible-current-and-candidate',candidateId:null,currentVersion:null,pairedRows:0,days:0,reviewSupported:false,canTrade:false,canApprove:false,portfolioRiskCertified:false};
 if(!archive||archive.scope==='demo')return empty;
 const versions=(archive.versions||[]).filter(v=>real(v)&&time(v.approvedAt)!==null&&time(v.approvedAt)<=now).sort((a,b)=>time(a.approvedAt)-time(b.approvedAt));
 const current=versions.at(-1),candidates=(archive.candidates||[]).filter(c=>real(c)&&time(c.createdAt)!==null&&time(c.createdAt)<=now).sort((a,b)=>time(a.createdAt)-time(b.createdAt));
 const candidate=candidateId?candidates.find(c=>c.id===candidateId):candidates.filter(c=>c.status==='待人工审批').at(-1);
 const base={...empty,candidateId:candidate?.id||null,currentVersion:current?.number??null,candidateCreatedAt:candidate?.createdAt||null,currentApprovedAt:current?.approvedAt||null,currentFingerprint:current?.numericModel?.fingerprint||null,candidateFingerprint:candidate?.numericModel?.fingerprint||null,source:'original-frozen-plans-and-verified-settlements'};
 if(!validApproved(current,archive)||!validCandidate(candidate,archive)||candidate.baseVersion!==current.number)return base;
 const start=time(candidate.createdAt),approved=time(current.approvedAt);
 if(start<=approved||[current,candidate].some(v=>!finite(v.numericModel.trainingLabelKnownAtMax)||v.numericModel.trainingLabelKnownAtMax>=(v===current?approved:start)||time(v.numericModel.trainCutoff)===null||time(v.numericModel.trainCutoff)>(v===current?approved:start)))return {...base,status:'model-lineage-or-training-cutoff-invalid'};
 const plans=new Map((archive.plans||[]).map(p=>[p.id,p])),checks=new Map((archive.checks||[]).map(c=>[c.id,c]));
 const counts=new Map(),codeDays=new Map(),accepted=[],excluded=Object.create(null),seen=new Set();
 const usedIds=new Set([...(candidate.sourceIds||[]),...(candidate.numericModel.sourceIds||[]),...(current.numericModel.sourceIds||[])]);
 const skip=k=>{excluded[k]=(excluded[k]||0)+1;};
 for(const t of archive.trades||[]){counts.set(t.planId,(counts.get(t.planId)||0)+1);}
 for(const t of archive.trades||[]){
  const p=plans.get(t.planId),v=verifiedSettlement(t,p,now),r=v.row;
  if(!r||r.quality!=='standard'){skip(v.reason||'extreme-stratum');continue;}
  if(counts.get(t.planId)!==1||seen.has(r.fingerprint)){skip('partial-or-repeated-settlement');continue;}
  seen.add(r.fingerprint);
  if(usedIds.has(t.id)||time(p.frozenAt)<=start){skip('used-or-pre-candidate-signal');continue;}
  const vector=vectorFor(p,checks.get(p.checkId),r,archive);
  if(!vector||vector.point<=start){skip('missing-post-candidate-frozen-vector');continue;}
  const a=numeric.numericScore(current.numericModel,vector).score,b=numeric.numericScore(candidate.numericModel,vector).score;
  if(!finite(a)||!finite(b)){skip('incompatible-factor-vector');continue;}
  const row={day:r.signalDay,code:r.code,currentScore:a,candidateScore:b,netReturnPct:r.netCents/r.costBasisCents*100,
   stressedReturnPct:(r.netCents-r.costCents-(r.entryGrossCents+r.exitGrossCents)*.002)/r.costBasisCents*100,settlementFingerprint:r.fingerprint};
  const k=row.day+'/'+row.code;codeDays.set(k,(codeDays.get(k)||0)+1);accepted.push(row);
 }
 const rows=accepted.filter(r=>codeDays.get(r.day+'/'+r.code)===1);
 if(rows.length!==accepted.length)excluded['duplicate-symbol-day']=accepted.length-rows.length;
 const comparison=prospectiveComparison(rows);
 return {...base,...comparison,excluded,evidenceFingerprint:hash(rows),scope:'conditional-on-original-settled-cohort; no counterfactual fills or portfolio equity',
  note:'同日同股同费用的真实模拟结算样本，按日取双方相同数量的排序前列。未成交股票不伪造收益；该对照不是全市场收益或风险认证。'};
}
function buildGovernance({archive,samples=[],walkforward={},quality={},execution={},feedback={},now=Date.now()}={}){
 const normalized=samples.map(r=>({...r,definitionFingerprints:Object.fromEntries(Object.keys(r.values||{}).map(id=>[id,numeric.fingerprint(numeric.numericDefinition(id,r.evidence?.[id]))]))}));
 const drift=pairedFactorDiagnostics(normalized,walkforward);
 const latest=(walkforward.folds||[]).filter(f=>f.status==='evaluated').at(-1);
 const factors=(archive?.catalog||[]).map(r=>'YZ-'+String(r.id).padStart(2,'0'));
 const ids=[...new Set([...factors,...(walkforward.factorIds||[])])].sort();
 const health=ids.map(id=>{const t=latest?.raw?.train?.[id],v=latest?.raw?.validation?.[id],o=latest?.raw?.test?.[id],d=drift.factors.find(r=>r.factorId===id),duplicate=latest?.redundancy?.suppressedFactors?.find(r=>r.factorId===id);return {factorId:id,trainingIC:t?.meanIC??null,validationIC:v?.meanIC??null,holdoutIC:o?.meanIC??null,holdoutDays:o?.days??0,coverage:d?.recent?.coverage??null,meanShift:d?.standardizedMeanShift??null,icChange:d?.icChange??null,redundantWith:duplicate?.duplicateOf??null,reviewCandidate:duplicate?'review-redundancy':d?.performanceWarning?'review-decay':d?.distributionWarning?'review-distribution':d?.recent?.coverage!=null&&d.recent.coverage<.8?'review-coverage':'insufficient-or-no-review-trigger',productionChanged:false};});
 const comparison=modelComparison(archive,{now});
 const reasons=[];
 const q=(quality.components||[]).filter(r=>r.key!=='realtime'&&r.id!=='realtime');
 const bad=q.filter(r=>finite(r.value)&&r.value<.8);
 if(bad.length)reasons.push({code:'DATA_QUALITY_GAP',scope:'current-research-input',evidence:bad.map(r=>({label:r.label,value:r.value})),meaning:'数据质量异常，不能直接归为策略衰减'});
 if(drift.status!=='matched-window-diagnostics')reasons.push({code:'INSUFFICIENT_MATCHED_SAMPLES',scope:'same-symbol-disjoint-holdout',meaning:'成熟同口径样本不足'});
 const shifts=drift.factors.filter(r=>r.distributionWarning).map(r=>r.factorId),decays=drift.factors.filter(r=>r.performanceWarning).map(r=>r.factorId);
 if(shifts.length)reasons.push({code:'FACTOR_DISTRIBUTION_SHIFT',scope:'matched-factor-definition',factorIds:shifts,meaning:'分布变化，原因待核验'});
 if(decays.length)reasons.push({code:'FACTOR_IC_DETERIORATION',scope:'unadjusted-model-effect-not-certified',factorIds:decays,meaning:'独立窗口 IC 下滑，仅为因子表现复核线索'});
 if(execution.overall?.costStressPassed===false)reasons.push({code:'COST_PRESSURE',scope:'verified-settlements',meaning:'原结算在假设成本压力下未通过；不等于真实成本已经上涨'});
 const environments=Object.fromEntries(Object.entries(execution.byRegime||{}).map(([k,v])=>[k,{samples:v.samples,status:v.status,netReturnPct:v.scenarios?.find(r=>r.slippageBps===0&&r.feeMultiplier===1)?.meanTradeNetReturnPct??null,costStressPassed:v.costStressPassed??null,portfolioDrawdownPct:null}]));
 return {schemaVersion:1,mode:'fayo-research-governance-readonly',asOf:now,status:reasons.some(r=>r.code!=='INSUFFICIENT_MATCHED_SAMPLES')?'review-observed-unverified':'unknown',decay:{status:'unverified',reasons,verifiedDecay:false,drift,executionDeviation:null,causalAttribution:null},factors:health,modelComparison:comparison,modelHistory:{approved:(archive?.versions||[]).filter(v=>real(v)&&time(v.approvedAt)!==null&&time(v.approvedAt)<=now).slice(-20).map(v=>({number:v.number,candidateId:v.candidateId,approvedAt:v.approvedAt,modelFingerprint:v.numericModel?.fingerprint??null,trainingFingerprint:v.numericModel?.trainingFingerprint??null,previousVersion:(v.number||1)-1,reason:v.reason??null})),candidates:(feedback.archivedCandidates||[]).slice(-20)},environments:{status:Object.keys(environments).length?'observed-unverified':'missing-original-regime-settlements',byRegime:environments,byCycle:execution.byCycle||{},factorHoldoutByCycle:latest?.strata?.test||{},applicableStrategies:null,changesRiskThresholds:false},probability:{status:'not-certified',targets:require('./probability-reliability').TARGETS,types:{score:'规则评分，非概率','historical-frequency':'对应成熟样本的历史频率','model-estimate':'未经独立校准的事件估计','calibrated-probability':'需独立校准验证及认证；当前无认证'},calibrationCertified:false},executionAttribution:execution.overall?.scenarios?.find(r=>r.slippageBps===0&&r.feeMultiplier===1)?.attribution??null,canTrade:false,canApprove:false,canNotify:false,productionWeightsChanged:false,writesAccount:false};
}
module.exports={pairedFactorDiagnostics,prospectiveComparison,modelComparison,buildGovernance};
