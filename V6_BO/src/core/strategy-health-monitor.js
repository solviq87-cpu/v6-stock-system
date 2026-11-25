'use strict';
/** Explanatory risk diagnostics for FOUR independently verified strategy systems.
 * Research-only signals and portfolio estimates; do not interpret small samples as alpha. */
const {SYSTEMS}=require('./independent-strategy-attribution');
const round=n=>Math.round(n*10000)/10000;
// Common session windows, purged by the two-session label horizon; descriptive only.
function rollingPaperDiagnosis(rows, {sessionDates, splitDate, universeCount, marketQuality}={}) {
 const policy={windowSessions:20,purgeSessions:2,minTradeDays:10,minTrades:20,minEvaluatedCoverage:0.8,negativeChangePp:1};
 const empty={status:'unknown',reason:'insufficient-samples',evidenceScope:'offline-paper-estimate',verifiedDecay:false,canTrade:false,policy,previous:null,recent:null,changePp:null,causalEvidence:{factorDrift:null,marketRegime:null,executionDeviation:null,observedCost:null}};
 if(!Array.isArray(sessionDates)||!splitDate||!Number.isSafeInteger(universeCount)||universeCount<1||sessionDates.some((d,i)=>typeof d!=='string'||(i>0&&d<=sessionDates[i-1])))return empty;
 const dates=sessionDates.slice(0,-policy.purgeSessions).filter(d=>d>=splitDate);
 if(dates.length<2*policy.windowSessions+policy.purgeSessions)return empty;
 const recentDates=dates.slice(-policy.windowSessions),priorDates=dates.slice(-2*policy.windowSessions-policy.purgeSessions,-policy.windowSessions-policy.purgeSessions);
 const stats=ds=>{
  const dateSet=new Set(ds),items=rows.filter(r=>dateSet.has(r.signalDate));
  const done=items.filter(r=>r.outcome?.status==='paper-estimate'&&Number.isFinite(r.outcome.netReturnPct)&&r.outcome.exitDate<=sessionDates.at(-1));
  const byDate=new Map();
  for(const row of done){const bucket=byDate.get(row.signalDate)||[];bucket.push(row.outcome.netReturnPct);byDate.set(row.signalDate,bucket);}
  const dailyMeans=[...byDate.values()].map(xs=>xs.reduce((a,b)=>a+b,0)/xs.length);
  const coverage=items.filter(r=>r.verdict==='pass'||r.verdict==='fail').length/(ds.length*universeCount);
  return {startDate:ds[0],endDate:ds.at(-1),sessions:ds.length,expectedRows:ds.length*universeCount,evaluatedCoverage:coverage,passedSignals:items.filter(r=>r.verdict==='pass').length,blockedSignals:items.filter(r=>r.outcome?.status==='blocked').length,estimatedTrades:done.length,tradeDays:dailyMeans.length,meanDailySignalReturnPct:dailyMeans.length?dailyMeans.reduce((a,b)=>a+b,0)/dailyMeans.length:null};
 };
 const previous=stats(priorDates),recent=stats(recentDates);
 const base={...empty,previous,recent};
 if(!marketQuality?.reviewReady)return {...base,reason:'data-quality-unverified'};
 if([previous,recent].some(x=>x.evaluatedCoverage<policy.minEvaluatedCoverage||x.evaluatedCoverage>1||x.tradeDays<policy.minTradeDays||x.estimatedTrades<policy.minTrades))return base;
 const changePp=recent.meanDailySignalReturnPct-previous.meanDailySignalReturnPct;
 return {...base,status:changePp<=-policy.negativeChangePp&&recent.meanDailySignalReturnPct<0?'paper-deterioration-review':'paper-observed-no-threshold-breach',reason:'factor-regime-cost-and-fill-evidence-not-linked',changePp};
}
function strategyHealth(native,portfolios,{minClosedTrades=20,maxDrawdownAlertPct=15,sessionDates,universeCount,marketQuality}={}){
 if(!Number.isSafeInteger(minClosedTrades)||minClosedTrades<1||minClosedTrades>100000||typeof maxDrawdownAlertPct!=='number'||!Number.isFinite(maxDrawdownAlertPct)||maxDrawdownAlertPct<=0||maxDrawdownAlertPct>100)throw Error('策略健康门限无效');
 const systems={};
 for(const system of SYSTEMS){
  const coverage=native.coverage[system],p=portfolios.systems[system],m=p.metrics;
  const windows=native.replay.windows;
  const out=windows.outOfSample.systems[system];
  const blockers=[];
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
   warnings:blockers,liveEligible:false,rollingDiagnosis:rollingPaperDiagnosis((windows.outOfSample.records||[]).filter(r=>r.system===system),{sessionDates,universeCount,marketQuality,splitDate:native.replay.splitDate})};
 }
 return {schemaVersion:1,mode:'four-strategy-research-health',canTrade:false,verifiedLive:false,
  systems,summary:{systemsWithObservedEvidence:SYSTEMS.filter(s=>systems[s].evaluated>0).length,
   systemsWithWarnings:SYSTEMS.filter(s=>systems[s].warnings.length>0).length,
   productionReady:0},
  note:'策略健康指标基于离线估算，不是统计显著性或可交易资格证明'};
}
module.exports={strategyHealth,rollingPaperDiagnosis};
