'use strict';
/** Explanatory risk diagnostics for FOUR independently verified strategy systems.
 * Research-only signals and portfolio estimates; do not interpret small samples as alpha. */
const {SYSTEMS}=require('./independent-strategy-attribution');
const round=n=>Math.round(n*10000)/10000;
function strategyHealth(native,portfolios,{minClosedTrades=20,maxDrawdownAlertPct=15}={}){
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
   warnings:blockers,liveEligible:false};
 }
 return {schemaVersion:1,mode:'four-strategy-research-health',canTrade:false,verifiedLive:false,
  systems,summary:{systemsWithObservedEvidence:SYSTEMS.filter(s=>systems[s].evaluated>0).length,
   systemsWithWarnings:SYSTEMS.filter(s=>systems[s].warnings.length>0).length,
   productionReady:0},
  note:'策略健康指标基于离线估算，不是统计显著性或可交易资格证明'};
}
module.exports={strategyHealth};
