'use strict';
// A bounded adapter around the original research backtest, not another account
// or execution engine. Each period keeps its own full original report.
const crypto=require('node:crypto');
const {runValidatedBacktest}=require('./historical-validation');
const HORIZONS=Object.freeze([1,3,5,10,20]);
const FLAGS=Object.freeze({canTrade:false,canTrain:false,canNotify:false,verifiedLive:false,eligibleForPromotion:false,weightsChanged:false});
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function runHoldingPeriodStudy(history){
 // Take the protocol snapshot before any outcome computation. This local
 // snapshot does not certify preregistration, an untouched holdout or trial budget.
 const datasetFingerprint=hash(history),baselinePeriod=history.holdDays??1;
 const defaults={start:27,topN:3,initialCash:100000,feeBps:8,slippageBps:10,sellTaxBps:5,stopLossPct:null,maxPositionPct:100,drawdownAlertPct:null,
  maxDrawdownPausePct:null,maxDailyLossPausePct:null,maxParticipationPct:null,minPriorTurnover:null,feeSchedules:null,riskPolicy:null};
 const configuration=Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,history[key]??value]));
 const protocol={schemaVersion:1,engine:'original-runValidatedBacktest/research-v2-position-ledger-backtest',horizons:[...HORIZONS],baselinePeriod,configuration,
  end:history.end??history.stocks?.[0]?.bars?.length-1,splitDay:history.splitDay??null,
  comparison:'independent-account-trajectories; not identical-entry-cohort returns',
  exit:'original close-scheduled next-open exit; T+1, stop-loss, risk, capacity and blocked-exit rules retained',
  snapshotStage:'in-process-before-evaluation; not externally preregistered'};
 const protocolFingerprint=hash({datasetFingerprint,protocol});
 const baseline=runValidatedBacktest(history);
 const unavailable=(reason,attempts=[])=>({baseline,comparison:{schemaVersion:1,mode:'holding-period-research-comparison',status:'unavailable',reason,
  datasetFingerprint,protocolFingerprint,protocol,attempts,periods:[],trialBudgetVerified:false,independentHoldoutCertified:false,...FLAGS}});
 const executions=HORIZONS.length+(HORIZONS.includes(baselinePeriod)?0:1);
 const workUnits=baseline.dataset.stocks*baseline.dataset.barsPerStock*executions*(history.splitDay===undefined?1:3);
 if(workUnits>60000)return unavailable('多期限总计算超过交互预算；原单期限结果保留，请分期使用原离线validate-history入口');
 const attempts=[],periods=[];let evidenceRows=0;
 for(const holdDays of HORIZONS){
  let report;
  try{report=holdDays===baselinePeriod?baseline:runValidatedBacktest({...history,holdDays});}
  catch(error){attempts.push({holdDays,status:'failed',reason:String(error?.message||'原回测未完成').slice(0,180)});return unavailable('部分期限未完成，未发布可选择的局部成绩',attempts);}
  attempts.push({holdDays,status:'completed',reusedBaseline:holdDays===baselinePeriod});
  evidenceRows+=report.orders.length+report.trades.length+report.equity.length+report.openPositions.length+(report.cashFlows?.length||0);
  if(evidenceRows>40000)return unavailable('多期限完整证据超过交互预算；原单期限结果保留，未截取部分期限或删减交易记录',attempts);
  const buys=report.orders.filter(o=>o.side==='buy'&&o.status==='filled').length;
  const closed=report.metrics.closedTrades,open=report.openPositions.length;
  periods.push({holdDays,status:!buys?'no-buy-fills':!closed?'no-closed-trades':open?'unsettled-paper-estimate':'closed-paper-estimate',
   buyFills:buys,closedTrades:closed,openPositions:open,blockedOrders:report.orders.filter(o=>o.status==='blocked').length,
   markedAccountReturnPct:buys?report.metrics.returnPct:null,
   closedAccountReturnPct:buys&&closed&&!open?report.metrics.returnPct:null,
   drawdownPct:buys?report.metrics.maxDrawdownPct:null,
   evidenceFingerprint:hash(report),report});
 }
 return {baseline,comparison:{schemaVersion:1,mode:'holding-period-research-comparison',status:'descriptive-only',
  datasetFingerprint,protocolFingerprint,source:history.source,asOf:history.asOf,dataset:baseline.dataset,protocol,attempts,periods,
  backtestEvaluations:executions,workUnits,trialBudgetVerified:false,independentHoldoutCertified:false,...FLAGS,
  limitations:['仅原研究扫描器的一组固定参数，不代表原四体系或全部策略的期限竞技',
   '持仓期限会改变现金、再入场与后续候选，不能当相同入场信号的条件收益对照',
   '止损可能提前退出，停牌/跌停及流动性限制可能延后退出；参数天数不是保证持有时间',
   '未平仓估值与成熟已平仓结果分列；零成交不代表零收益赢家，不选择最佳期限',
   '费用和滑点是原研究假设，未证明真实成交、容量、净收益优势或预测可靠性',
   '本次协议指纹不是独立预注册、试验额度或留出集认证；即使有splitDay也不自动认证样本外',
   '历史证券、因子、公司行为、股票池及数据用途许可仍按原输入证据核验，不能倒填点时信息']}};
}
module.exports={HORIZONS,runHoldingPeriodStudy};
