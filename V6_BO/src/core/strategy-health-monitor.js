'use strict';
/** Explanatory risk diagnostics for FOUR independently verified strategy systems.
 * Research-only signals and portfolio estimates; do not interpret small samples as alpha. */
const {SYSTEMS}=require('./independent-strategy-attribution');
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const count=x=>Number.isSafeInteger(x)&&x>=0?x:null;
const returnPct=x=>Number.isFinite(x)&&x>=-100?x:null;
const percent=x=>Number.isFinite(x)&&x>=0&&x<=100?x:null;
const validDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const mean=xs=>{if(!xs.length)return null;const value=xs.reduce((a,b)=>a+b,0)/xs.length;return Number.isFinite(value)?value:null;};
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
 if(!Array.isArray(rows)||!Array.isArray(sessionDates)||!validDay(splitDate)||!Number.isSafeInteger(universeCount)||universeCount<1||
  !Number.isSafeInteger(universeCount*policy.windowSessions)||!sessionDates.includes(splitDate)||Array.from(sessionDates).some((d,i)=>!validDay(d)||(i>0&&d<=sessionDates[i-1])))return empty;
 const index=new Map(sessionDates.map((d,i)=>[d,i]));
 // A single-strategy comparison cannot pool different evaluators' systems.
 // Legacy untagged rows remain supported when the whole input is untagged.
 if(Array.from(rows).some(r=>!record(r)||!index.has(r.signalDate)||r.system!==undefined&&!SYSTEMS.includes(r.system))||
  new Set(rows.map(r=>r.system)).size>1)return {...empty,reason:'inconsistent-window-evidence'};
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
   const ok=r.verdict==='pass'&&returnPct(r.outcome.netReturnPct)!==null&&r.outcome.exitDate===sessionDates[i+policy.purgeSessions]&&
    typeof r.outcome.exitDate==='string'&&(r.outcome.entryDate==null||r.outcome.entryDate===sessionDates[i+1]);
   if(!ok)invalidOutcomes++;
   return ok;
  });
  const byDate=new Map();
  for(const row of done){const bucket=byDate.get(row.signalDate)||[];bucket.push(row.outcome.netReturnPct);byDate.set(row.signalDate,bucket);}
  const dailyMeans=[...byDate.values()].map(mean);
  const meanReturn=dailyMeans.includes(null)?null:mean(dailyMeans);
  const coverage=unique.filter(r=>r.verdict==='pass'||r.verdict==='fail').length/(ds.length*universeCount);
  return {startDate:ds[0],endDate:ds.at(-1),sessions:ds.length,expectedRows:ds.length*universeCount,evaluatedCoverage:coverage,
   ...evaluatedVersionEvidence(unique),
   invalidRows,duplicateRows,invalidOutcomes,overfullSessions,passedSignals:unique.filter(r=>r.verdict==='pass').length,
   blockedSignals:unique.filter(r=>r.outcome?.status==='blocked').length,estimatedTrades:done.length,tradeDays:dailyMeans.length,
   meanDailySignalReturnPct:meanReturn};
 };
 const previous=stats(priorDates),recent=stats(recentDates);
 const base={...empty,previous,recent};
 if(marketQuality?.reviewReady!==true)return {...base,reason:'data-quality-unverified'};
 if([previous,recent].some(x=>x.invalidRows||x.duplicateRows||x.invalidOutcomes||x.overfullSessions))return {...base,reason:'inconsistent-window-evidence'};
 if([previous,recent].some(x=>x.estimatedTrades>0&&x.meanDailySignalReturnPct===null))return {...base,reason:'nonfinite-window-aggregation'};
 if([previous,recent].some(x=>x.evaluatedCoverage<policy.minEvaluatedCoverage||x.evaluatedCoverage>1||x.tradeDays<policy.minTradeDays||x.estimatedTrades<policy.minTrades))return base;
 // A change of evaluator is not evidence that the same strategy deteriorated.
 // Preserve the descriptive window figures, but do not compare unlike versions.
 if(previous.unknownVersionRows||recent.unknownVersionRows)return {...base,reason:'evaluator-version-unverified'};
 if(previous.evaluatorVersions.length!==1||recent.evaluatorVersions.length!==1||previous.evaluatorVersions[0]!==recent.evaluatorVersions[0])return {...base,reason:'evaluator-version-not-comparable'};
 const comparableEvaluatorVersion=recent.evaluatorVersions[0];
 const changePp=recent.meanDailySignalReturnPct-previous.meanDailySignalReturnPct;
 if(!Number.isFinite(changePp))return {...base,reason:'nonfinite-window-aggregation'};
 return {...base,status:changePp<=-policy.negativeChangePp&&recent.meanDailySignalReturnPct<0?'paper-deterioration-review':'paper-observed-no-threshold-breach',reason:'factor-regime-cost-and-fill-evidence-not-linked',changePp,comparableEvaluatorVersion};
}
// A claimed sample summary is descriptive only until it matches the supplied rows.
function holdoutConsistent(rows,out,sessionDates,splitDate){
 if(!record(out)||count(out.paperTrades)===null||!validDay(splitDate))return false;
 const hasSessions=Array.isArray(sessionDates),index=hasSessions?new Map(Array.from(sessionDates,(d,i)=>[d,i])):null;
 if(hasSessions&&(!index.has(splitDate)||Array.from(sessionDates).some((d,i)=>!validDay(d)||i>0&&d<=sessionDates[i-1])))return false;
 const seen=new Set(),returns=[];
 for(const row of rows){
  if(!record(row)||typeof row.symbol!=='string'||!row.symbol.trim()||!validDay(row.signalDate)||row.signalDate<splitDate||
   !['pass','fail','unknown'].includes(row.verdict)||index&&!index.has(row.signalDate)||!record(row.outcome)||
   !['paper-estimate','blocked','not-evaluated'].includes(row.outcome.status))return false;
  const key=JSON.stringify([row.signalDate,row.symbol]);if(seen.has(key))return false;seen.add(key);
  const o=row.outcome;
  if(o.status==='paper-estimate'){
   const i=index?.get(row.signalDate);
   if(row.verdict!=='pass'||returnPct(o.netReturnPct)===null||!validDay(o.exitDate)||o.exitDate<=row.signalDate||
    o.entryDate!=null&&(!validDay(o.entryDate)||o.entryDate<=row.signalDate||o.entryDate>=o.exitDate)||
    index&&(o.exitDate!==sessionDates[i+2]||o.entryDate!=null&&o.entryDate!==sessionDates[i+1]))return false;
   returns.push(o.netReturnPct);
  }
 }
 if(out.evidenceCount!==undefined&&out.evidenceCount!==rows.length||out.paperTrades!==returns.length)return false;
 if(!returns.length)return out.meanNetReturnPct===null&&out.winRatePct===null;
 const avg=mean(returns),win=100*returns.filter(x=>x>0).length/returns.length;
 return avg!==null&&returnPct(out.meanNetReturnPct)!==null&&percent(out.winRatePct)!==null&&
  Math.abs(out.meanNetReturnPct-Number(avg.toFixed(4)))<=0.00005&&Math.abs(out.winRatePct-Number(win.toFixed(4)))<=0.00005;
}
function strategyHealth(native,portfolios,{minClosedTrades=20,maxDrawdownAlertPct=15,sessionDates,universeCount,marketQuality}={}){
 if(!Number.isSafeInteger(minClosedTrades)||minClosedTrades<1||minClosedTrades>100000||typeof maxDrawdownAlertPct!=='number'||!Number.isFinite(maxDrawdownAlertPct)||maxDrawdownAlertPct<=0||maxDrawdownAlertPct>100)throw Error('策略健康门限无效');
 const systems={};
 const replay=native?.replay,holdout=replay?.windows?.outOfSample,rawRows=holdout?.records;
 const recordsValid=Array.isArray(rawRows)&&!Array.from(rawRows).some(r=>!record(r)||!SYSTEMS.includes(r.system));
 for(const system of SYSTEMS){
  const coverage=native?.coverage?.[system],m=portfolios?.systems?.[system]?.metrics,out=holdout?.systems?.[system];
  const evaluated=count(coverage?.evaluated),unknown=count(coverage?.unknown),closedTrades=count(m?.closedTrades),
   maxDrawdownPct=percent(m?.maxDrawdownPct),paperReturnPct=returnPct(m?.returnPct),paperTrades=count(out?.paperTrades),
   holdoutMeanReturnPct=returnPct(out?.meanNetReturnPct),holdoutWinRatePct=percent(out?.winRatePct);
  const holdoutRows=Array.isArray(rawRows)?rawRows.filter(r=>r?.system===system):[];
  const holdoutVersionEvidence=evaluatedVersionEvidence(holdoutRows);
  const hasHoldout=count(replay?.splitDay)!==null&&validDay(replay?.splitDate)&&Array.isArray(sessionDates)&&sessionDates[replay.splitDay]===replay.splitDate;
  const holdoutEvidenceConsistent=recordsValid&&hasHoldout&&holdoutConsistent(holdoutRows,out,sessionDates,replay?.splitDate)&&
   evaluated!==null&&unknown!==null&&holdoutVersionEvidence.evaluatedRows<=evaluated&&holdoutRows.length-holdoutVersionEvidence.evaluatedRows<=unknown;
  const blockers=[];
  if(evaluated===null||unknown===null)blockers.push('原生评估计数证据无效或缺失');
  if(closedTrades===null||maxDrawdownPct===null||paperReturnPct===null||typeof m?.halted!=='boolean')blockers.push('独立模拟账户指标或熔断状态证据无效');
  if(!holdoutEvidenceConsistent)blockers.push('样本外汇总与逐笔证据不一致或缺失');
  if(marketQuality?.reviewReady!==true)blockers.push('行情质量尚未核验');
  if(paperTrades>0&&(holdoutVersionEvidence.unknownVersionRows||!holdoutVersionEvidence.evaluatorVersions.length))blockers.push('样本外评估器版本证据不足');
  if(holdoutVersionEvidence.evaluatorVersions.length>1)blockers.push('样本外混合评估器版本，不能作为单一版本有效性证据');
  if(evaluated===0)blockers.push('原生信号无可评估记录');
  if(closedTrades===null||closedTrades<minClosedTrades)blockers.push(`已平仓纸面交易不足 ${minClosedTrades} 笔`);
  if(paperTrades===null||paperTrades<minClosedTrades)blockers.push(`样本外有效纸面结果不足 ${minClosedTrades} 笔`);
  if(maxDrawdownPct!==null&&maxDrawdownPct>=maxDrawdownAlertPct)blockers.push('独立模拟账户超过回撤警戒线');
  if(m?.halted===true)blockers.push('独立模拟账户已触发回撤熔断');
  if(holdoutMeanReturnPct!==null&&holdoutMeanReturnPct<0)blockers.push('样本外平均纸面单笔收益为负');
  if(!hasHoldout)blockers.push('未预先指定样本外日期分割');
  systems[system]={status:evaluated===0?'not-evaluated':blockers.length?'research-warning':'research-observed',
   evaluated,unknown,holdoutTrades:paperTrades,holdoutMeanReturnPct,paperClosedTrades:closedTrades,
   paperReturnPct,maxDrawdownPct,holdoutWinRatePct,
   warnings:blockers,liveEligible:false,holdoutVersionEvidence,holdoutEvidenceConsistent,
   rollingDiagnosis:rollingPaperDiagnosis(holdoutRows,{sessionDates,universeCount,marketQuality,splitDate:replay?.splitDate})};
 }
 return {schemaVersion:1,mode:'four-strategy-research-health',canTrade:false,verifiedLive:false,
  systems,summary:{systemsWithObservedEvidence:SYSTEMS.filter(s=>systems[s].evaluated>0).length,
   systemsWithWarnings:SYSTEMS.filter(s=>systems[s].warnings.length>0).length,
   productionReady:0},
  note:'策略健康指标基于离线估算，不是统计显著性或可交易资格证明'};
}
module.exports={strategyHealth,rollingPaperDiagnosis};
