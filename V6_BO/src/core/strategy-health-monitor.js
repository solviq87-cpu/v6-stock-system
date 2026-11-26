'use strict';
/** Explanatory risk diagnostics for FOUR independently verified strategy systems.
 * Research-only signals and portfolio estimates; do not interpret small samples as alpha. */
const {SYSTEMS}=require('./independent-strategy-attribution');
const round=n=>Math.round(n*10000)/10000;
const validVersion=v=>typeof v==='string'&&v.length>0&&v.length<=256&&v.trim()===v&&!/[\x00-\x1f\x7f]/.test(v);
function evaluatedVersionEvidence(rows){
 const versions=new Set();let unknownVersionRows=0,evaluatedRows=0;
 for(const r of rows){
  // Unknown verdicts may have a placeholder evaluator; they cast no version vote.
  if(r.verdict!=='pass'&&r.verdict!=='fail')continue;
  evaluatedRows++;
  if(validVersion(r.evaluatorVersion))versions.add(r.evaluatorVersion);else unknownVersionRows++;
 }
 return {evaluatorVersions:[...versions].sort(),unknownVersionRows,evaluatedRows};
}
// Common session windows, purged by the two-session label horizon; descriptive only.
function rollingPaperDiagnosis(rows, {sessionDates, splitDate, universeCount, marketQuality}={}) {
 const policy={windowSessions:20,purgeSessions:2,minTradeDays:10,minTrades:20,minEvaluatedCoverage:0.8,negativeChangePp:1};
 const empty={status:'unknown',reason:'insufficient-samples',evidenceScope:'offline-paper-estimate',verifiedDecay:false,canTrade:false,policy,previous:null,recent:null,changePp:null,comparableEvaluatorVersion:null,causalEvidence:{factorDrift:null,marketRegime:null,executionDeviation:null,observedCost:null}};
 const validDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
 if(!Array.isArray(rows)||!Array.isArray(sessionDates)||!validDay(splitDate)||!Number.isSafeInteger(universeCount)||universeCount<1||
  !Number.isSafeInteger(universeCount*policy.windowSessions)||sessionDates.some((d,i)=>!validDay(d)||(i>0&&d<=sessionDates[i-1])))return empty;
 const index=new Map(sessionDates.map((d,i)=>[d,i]));
 const dates=sessionDates.slice(0,-policy.purgeSessions).filter(d=>d>=splitDate);
 if(dates.length<2*policy.windowSessions+policy.purgeSessions)return empty;
 const recentDates=dates.slice(-policy.windowSessions),priorDates=dates.slice(-2*policy.windowSessions-policy.purgeSessions,-policy.windowSessions-policy.purgeSessions);
 const stats=ds=>{
  const dateSet=new Set(ds),items=rows.filter(r=>dateSet.has(r?.signalDate)),byKey=new Map(),bySession=new Map();
  let invalidRows=0,duplicateRows=0,invalidOutcomes=0;
  for(const row of items){
   if(typeof row.symbol!=='string'||!row.symbol.trim()||!['pass','fail','unknown'].includes(row.verdict)){invalidRows++;continue;}
   const key=JSON.stringify([row.signalDate,row.symbol]),bucket=byKey.get(key)||[];
   bucket.push(row);byKey.set(key,bucket);
  }
  const unique=[];
  for(const bucket of byKey.values()){
   const row=bucket[0];bySession.set(row.signalDate,(bySession.get(row.signalDate)||0)+1);
   // Duplicate evidence cannot inflate coverage, and conflicting copies cannot
   // be silently resolved by choosing the more attractive result.
   if(bucket.length!==1){duplicateRows+=bucket.length;continue;}
   unique.push(row);
  }
  const overfullSessions=[...bySession.values()].filter(n=>n>universeCount).length;
  const done=unique.filter(r=>{
   if(r.outcome?.status!=='paper-estimate')return false;
   const i=index.get(r.signalDate);
   const ok=r.verdict==='pass'&&Number.isFinite(r.outcome.netReturnPct)&&r.outcome.exitDate===sessionDates[i+policy.purgeSessions]&&
    typeof r.outcome.exitDate==='string'&&(r.outcome.entryDate==null||r.outcome.entryDate===sessionDates[i+1]);
   if(!ok)invalidOutcomes++;
   return ok;
  });
  const byDate=new Map();
  for(const row of done){const bucket=byDate.get(row.signalDate)||[];bucket.push(row.outcome.netReturnPct);byDate.set(row.signalDate,bucket);}
  const dailyMeans=[...byDate.values()].map(xs=>xs.reduce((a,b)=>a+b,0)/xs.length);
  const coverage=unique.filter(r=>r.verdict==='pass'||r.verdict==='fail').length/(ds.length*universeCount);
  return {startDate:ds[0],endDate:ds.at(-1),sessions:ds.length,expectedRows:ds.length*universeCount,evaluatedCoverage:coverage,
   ...evaluatedVersionEvidence(unique),
   invalidRows,duplicateRows,invalidOutcomes,overfullSessions,passedSignals:unique.filter(r=>r.verdict==='pass').length,
   blockedSignals:unique.filter(r=>r.outcome?.status==='blocked').length,estimatedTrades:done.length,tradeDays:dailyMeans.length,
   meanDailySignalReturnPct:dailyMeans.length?dailyMeans.reduce((a,b)=>a+b,0)/dailyMeans.length:null};
 };
 const previous=stats(priorDates),recent=stats(recentDates);
 const base={...empty,previous,recent};
 if(marketQuality?.reviewReady!==true)return {...base,reason:'data-quality-unverified'};
 if([previous,recent].some(x=>x.invalidRows||x.duplicateRows||x.invalidOutcomes||x.overfullSessions))return {...base,reason:'inconsistent-window-evidence'};
 if([previous,recent].some(x=>x.evaluatedCoverage<policy.minEvaluatedCoverage||x.evaluatedCoverage>1||x.tradeDays<policy.minTradeDays||x.estimatedTrades<policy.minTrades))return base;
 // A change of evaluator is not evidence that the same strategy deteriorated.
 // Preserve the descriptive window figures, but do not compare unlike versions.
 if(previous.unknownVersionRows||recent.unknownVersionRows)return {...base,reason:'evaluator-version-unverified'};
 if(previous.evaluatorVersions.length!==1||recent.evaluatorVersions.length!==1||previous.evaluatorVersions[0]!==recent.evaluatorVersions[0])return {...base,reason:'evaluator-version-not-comparable'};
 const comparableEvaluatorVersion=recent.evaluatorVersions[0];
 const changePp=recent.meanDailySignalReturnPct-previous.meanDailySignalReturnPct;
 return {...base,status:changePp<=-policy.negativeChangePp&&recent.meanDailySignalReturnPct<0?'paper-deterioration-review':'paper-observed-no-threshold-breach',reason:'factor-regime-cost-and-fill-evidence-not-linked',changePp,comparableEvaluatorVersion};
}
function strategyHealth(native,portfolios,{minClosedTrades=20,maxDrawdownAlertPct=15,sessionDates,universeCount,marketQuality}={}){
 if(!Number.isSafeInteger(minClosedTrades)||minClosedTrades<1||minClosedTrades>100000||typeof maxDrawdownAlertPct!=='number'||!Number.isFinite(maxDrawdownAlertPct)||maxDrawdownAlertPct<=0||maxDrawdownAlertPct>100)throw Error('策略健康门限无效');
 const systems={};
 for(const system of SYSTEMS){
  const coverage=native.coverage[system],p=portfolios.systems[system],m=p.metrics;
  const windows=native.replay.windows;
  const out=windows.outOfSample.systems[system];
  const holdoutRows=(windows.outOfSample.records||[]).filter(r=>r.system===system);
  const holdoutVersionEvidence=evaluatedVersionEvidence(holdoutRows);
  const blockers=[];
  if(out.paperTrades>0&&(holdoutVersionEvidence.unknownVersionRows||!holdoutVersionEvidence.evaluatorVersions.length))blockers.push('样本外评估器版本证据不足');
  if(holdoutVersionEvidence.evaluatorVersions.length>1)blockers.push('样本外混合评估器版本，不能作为单一版本有效性证据');
  if(!coverage.evaluated)blockers.push('原生信号无可评估记录');
  if(!m.closedTrades||m.closedTrades<minClosedTrades)blockers.push(`已平仓纸面交易不足 ${minClosedTrades} 笔`);
  if(!out.paperTrades||out.paperTrades<minClosedTrades)blockers.push(`样本外有效纸面结果不足 ${minClosedTrades} 笔`);
  if(m.maxDrawdownPct>=maxDrawdownAlertPct)blockers.push('独立模拟账户超过回撤警戒线');
  if(m.halted)blockers.push('独立模拟账户已触发回撤熔断');
  if(out.meanNetReturnPct!==null&&out.meanNetReturnPct<0)blockers.push('样本外平均纸面单笔收益为负');
  const hasHoldout=native.replay.splitDay!==null;
  if(!hasHoldout)blockers.push('未预先指定样本外日期分割');
  systems[system]={status:!coverage.evaluated?'not-evaluated':blockers.length?'research-warning':'research-observed',
   evaluated:coverage.evaluated,unknown:coverage.unknown,holdoutTrades:out.paperTrades,
   holdoutMeanReturnPct:out.meanNetReturnPct,paperClosedTrades:m.closedTrades,
   paperReturnPct:m.returnPct,maxDrawdownPct:m.maxDrawdownPct,holdoutWinRatePct:out.winRatePct,
   warnings:blockers,liveEligible:false,holdoutVersionEvidence,rollingDiagnosis:rollingPaperDiagnosis(holdoutRows,{sessionDates,universeCount,marketQuality,splitDate:native.replay.splitDate})};
 }
 return {schemaVersion:1,mode:'four-strategy-research-health',canTrade:false,verifiedLive:false,
  systems,summary:{systemsWithObservedEvidence:SYSTEMS.filter(s=>systems[s].evaluated>0).length,
   systemsWithWarnings:SYSTEMS.filter(s=>systems[s].warnings.length>0).length,
   productionReady:0},
  note:'策略健康指标基于离线估算，不是统计显著性或可交易资格证明'};
}
module.exports={strategyHealth,rollingPaperDiagnosis};
