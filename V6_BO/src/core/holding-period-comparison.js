'use strict';
// A bounded adapter around the original research backtest, not another account
// or execution engine. Each period keeps its own full original report.
const crypto=require('node:crypto');
const {runValidatedBacktest}=require('./historical-validation');
const HORIZONS=Object.freeze([1,3,5,10,20]);
const FLAGS=Object.freeze({canTrade:false,canTrain:false,canNotify:false,verifiedLive:false,eligibleForPromotion:false,weightsChanged:false});
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
// Identify symbols for which ordinary unadjusted-price paths or allocated
// costs cannot represent the original economic position after corporate action.
function corporateAffectedSymbols(report){
 if(!Array.isArray(report?.orders)||!Array.isArray(report?.cashFlows))return null;
 const affected=new Set();
 for(const o of report.orders)if(['corporate-action','corporate-settlement'].includes(o?.status)){
  if(typeof o.symbol!=='string'||!o.symbol)return null;affected.add(o.symbol);
 }
 for(const f of report.cashFlows)if(!['initial','buy','sell'].includes(f?.kind)){
  if(typeof f?.symbol!=='string'||!f.symbol)return null;affected.add(f.symbol);
 }
 return affected;
}
// F20.2: descriptive net return of original settled portions, not a signal
// forecast, whole-position return, or independent calibration sample.
function summarizeSettledNetReturns(report){
 const total=Array.isArray(report?.trades)?report.trades.length:null;
 const unknown={status:'unavailable',totalSettledRecords:total,usableRecords:0,excludedRecords:total,
  coveragePct:null,p10Pct:null,p50Pct:null,p90Pct:null,empiricalWidthPct:null,predictiveCoverage:null,
  independentSamplesCertified:false,canTrain:false,canTrade:false};
 if(total===null||report.metrics?.closedTrades!==total||!Array.isArray(report.orders)||!Array.isArray(report.cashFlows))return unknown;
 // A company action can change cost basis or realize a nonordinary exit.
 // Exclude the entire affected symbol conservatively rather than guess its
 // economics. The original report still includes every cash flow and trade.
 const affected=corporateAffectedSymbols(report);if(!affected)return unknown;
 const finite=x=>typeof x==='number'&&Number.isFinite(x);
 const values=[];
 for(const t of report.trades){
  if(!t||typeof t.symbol!=='string'||!t.symbol||affected.has(t.symbol)||!Number.isSafeInteger(t.buyDay)||
   !Number.isSafeInteger(t.sellDay)||t.sellDay<=t.buyDay||!Number.isSafeInteger(t.shares)||t.shares<=0||
   !finite(t.costBasis)||t.costBasis<=0||!finite(t.netPnl))continue;
  const pct=100*t.netPnl/t.costBasis;if(finite(pct))values.push(pct);
 }
 values.sort((a,b)=>a-b);
 const n=values.length,round=x=>Number.isFinite(x)?Number(x.toFixed(6)):null;
 const q=p=>n?values[Math.max(0,Math.ceil(p*n)-1)]:null;
 return {...unknown,status:n?'descriptive-only':'no-usable-settled-records',usableRecords:n,excludedRecords:total-n,
  coveragePct:total?round(100*n/total):null,p10Pct:round(q(.1)),p50Pct:round(q(.5)),p90Pct:round(q(.9)),
  empiricalWidthPct:n?round(q(.9)-q(.1)):null,
  basis:'original allocated cost basis and net PnL; nearest-rank empirical quantiles; settled portions may share entry; excludes corporate-action symbols'};
}
// F20.3: an opening-execution model can describe daily mark extrema from
// entry open through the exit opening print. It cannot infer intraday ordering,
// realizable fills at extrema, or barrier labels from OHLC.
function summarizeSettledExcursions(history,report){
 const total=Array.isArray(report?.trades)?report.trades.length:null;
 const empty={status:'unavailable',totalSettledRecords:total,usableRecords:0,excludedRecords:total,rows:[],
  meanMfePct:null,meanMaePct:null,coveragePct:null,barInspections:0,intradayOrderKnown:false,
  executionCertified:false,canTrain:false,canTrade:false};
 const unavailable=reason=>({...empty,reason});
 const affected=corporateAffectedSymbols(report);
 if(total===null||report.metrics?.closedTrades!==total||!affected||!Array.isArray(history?.stocks))return unavailable('ORIGINAL_PATH_EVIDENCE_UNAVAILABLE');
 const stocks=new Map(history.stocks.map(s=>[String(s.symbol||s.code),s]));
 const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
 const finite=x=>typeof x==='number'&&Number.isFinite(x);
 const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
 const fills=new Map();
 for(const o of report.orders)if(o?.status==='filled'&&['buy','sell'].includes(o.side)){
  const k=JSON.stringify([o.symbol,o.day,o.side]);if(fills.has(k))fills.set(k,null);else fills.set(k,o);
 }
 const matches=(o,price,shares,partial=false)=>o&&o.price===price&&Number.isSafeInteger(o.shares)&&
  (partial?o.shares>=shares:o.shares===shares);
 const rows=[];let barInspections=0;
 for(let index=0;index<total;index++){
  const t=report.trades[index],stock=stocks.get(t?.symbol);
  const validDays=Number.isSafeInteger(t?.buyDay)&&t.buyDay>=0&&Number.isSafeInteger(t?.sellDay)&&t.sellDay>t.buyDay&&
   Array.isArray(stock?.bars)&&t.sellDay<stock.bars.length&&t.sellDay<=(history.end??stock.bars.length-1);
  const row={tradeIndex:index,symbol:typeof t?.symbol==='string'?t.symbol:null,shares:Number.isSafeInteger(t?.shares)&&t.shares>0?t.shares:null,
   buyDate:validDays&&date(stock.bars[t.buyDay]?.date)?stock.bars[t.buyDay].date:null,
   sellDate:validDays&&date(stock.bars[t.sellDay]?.date)?stock.bars[t.sellDay].date:null,
   status:'unknown',mfePct:null,maePct:null,netReturnPct:null,extremaOrder:'unknown'};
  const exclude=reason=>rows.push({...row,reason});
  if(!validDays||!row.shares||!row.buyDate||!row.sellDate||row.buyDate>=row.sellDate||row.sellDate>history.asOf||
   !positive(t.entry)||!positive(t.exit)||!positive(t.costBasis)||!finite(t.netPnl)){
   exclude('INVALID_OR_UNDATED_SETTLED_RECORD');continue;
  }
  if(affected.has(t.symbol)){exclude('CORPORATE_ACTION_PATH_UNAVAILABLE');continue;}
  const buy=fills.get(JSON.stringify([t.symbol,t.buyDay,'buy'])),sell=fills.get(JSON.stringify([t.symbol,t.sellDay,'sell']));
  if(!matches(buy,t.entry,t.shares,true)||!matches(sell,t.exit,t.shares)){
   exclude('ORIGINAL_FILL_LINEAGE_UNAVAILABLE');continue;
  }
  if(barInspections+t.sellDay-t.buyDay+1>80000)return unavailable('PATH_INSPECTION_BUDGET_EXCEEDED');
  let high=t.entry,low=t.entry,previous='',missing=false;
  for(let d=t.buyDay;d<=t.sellDay;d++){
   barInspections++;
   const b=stock.bars[d];
   if(!b||!date(b.date)||b.date<=previous||b.date>history.asOf||b.corporateAction||
    b.priceBasis&&b.priceBasis!=='unadjusted'||(b.suspended??stock.suspended)===true||(b.tradable??stock.tradable)===false||
    !positive(b.volume)||!positive(b.open)||!positive(b.high)||!positive(b.low)||!positive(b.close)||
    b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close)){
    missing=true;break;
   }
   previous=b.date;
   // On the modeled sell-at-open session do not borrow the later day's high/low.
   high=Math.max(high,d===t.sellDay?b.open:b.high);
   low=Math.min(low,d===t.sellDay?b.open:b.low);
  }
  if(missing){exclude('INCOMPLETE_OR_RESTRICTED_PRICE_PATH');continue;}
  const mfe=(high/t.entry-1)*100,mae=(low/t.entry-1)*100,net=100*t.netPnl/t.costBasis;
  if(![mfe,mae,net].every(finite)){exclude('INVALID_PATH_RANGE');continue;}
  const round=x=>Number(x.toFixed(6));
  rows.push({...row,status:'descriptive-only',mfePct:round(mfe),maePct:round(mae),netReturnPct:round(net),
   entryPrice:t.entry,exitPrice:t.exit,observedHigh:high,observedLow:low,reason:null});
 }
 const usable=rows.filter(x=>x.status==='descriptive-only'),n=usable.length;
 const mean=key=>n?Number((usable.reduce((s,x)=>s+x[key]/n,0)).toFixed(6)):null;
 return {...empty,status:n?'descriptive-only':'no-usable-paths',rows,usableRecords:n,excludedRecords:total-n,
  coveragePct:total?Number((100*n/total).toFixed(6)):null,meanMfePct:mean('mfePct'),meanMaePct:mean('maePct'),barInspections,
  basis:'modeled opening entry; daily high/low through prior session; exit session opening print only; entry baseline zero; price excursions before costs, settled net return separate'};
}
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
  const settledExcursions=summarizeSettledExcursions(history,report);
  evidenceRows+=report.orders.length+report.trades.length+report.equity.length+report.openPositions.length+(report.cashFlows?.length||0)+settledExcursions.rows.length;
  if(evidenceRows>40000)return unavailable('多期限完整证据超过交互预算；原单期限结果保留，未截取部分期限或删减交易记录',attempts);
  const buys=report.orders.filter(o=>o.side==='buy'&&o.status==='filled').length;
  const closed=report.metrics.closedTrades,open=report.openPositions.length;
  periods.push({holdDays,status:!buys?'no-buy-fills':!closed?'no-closed-trades':open?'unsettled-paper-estimate':'closed-paper-estimate',
   buyFills:buys,closedTrades:closed,openPositions:open,blockedOrders:report.orders.filter(o=>o.status==='blocked').length,
   markedAccountReturnPct:buys?report.metrics.returnPct:null,
   closedAccountReturnPct:buys&&closed&&!open?report.metrics.returnPct:null,
   drawdownPct:buys?report.metrics.maxDrawdownPct:null,
   settledNetDistribution:summarizeSettledNetReturns(report),settledExcursions,
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
module.exports={HORIZONS,runHoldingPeriodStudy,summarizeSettledNetReturns,summarizeSettledExcursions};
