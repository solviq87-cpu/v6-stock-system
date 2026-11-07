'use strict';
const {scanUniverse}=require('./research-v2-universe-scanner');
const {atLockedLimit,historicalStock,assertAligned}=require('./historical-session');
const {validateRiskLimits,evaluatePreviousCloseRisk}=require('../core/portfolio-risk-gate');
const {validateExecutionRisk,executionCapacity}=require('../core/execution-risk');
const {performanceStatistics}=require('../core/performance-statistics');
const {corporateAction,entitlement}=require('../core/corporate-actions');
const {tradingFees,validateFeeSchedules,maxAffordableQuantity}=require('../core/trading-fees');
const {validateEntryPolicy,evaluateEntryRisk,consecutiveLosses}=require('../core/common-entry-risk');
const {validateUniverseHistory,universeObservation}=require('../core/historical-universe');
const {applyResearchSettlements,validateSettlementTable}=require('../core/corporate-settlements');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const good=x=>finite(x)&&x>0;
function ledgerBacktest({stocks=[],start=27,end,initialCash=100000,topN=3,holdDays=1,
 feeBps=8,slippageBps=10,sellTaxBps=5,lotSize=100,source='imported',maxAgeMs=86400000,selectCandidates=null,entryEligibility=null,strictMarks=true,stopLossPct=null,maxPositionPct=100,drawdownAlertPct=null,tradingDates=null,maxDrawdownPausePct=null,maxDailyLossPausePct=null,maxParticipationPct=null,minPriorTurnover=null,feeSchedules=null,riskPolicy=null,universeHistory=null,settlements=null}={}){
 validateFeeSchedules(feeSchedules);validateEntryPolicy(riskPolicy);
 validateSettlementTable(settlements);validateUniverseHistory(universeHistory);validateFeeSchedules(feeSchedules);validateEntryPolicy(riskPolicy);
 validateRiskLimits({maxDrawdownPausePct,maxDailyLossPausePct});
 const executionRisk={maxParticipationPct,minPriorTurnover};validateExecutionRisk(executionRisk);
 if(!Array.isArray(stocks)||!stocks.length)throw Error('需要历史K线股票池');
 if(entryEligibility!==null&&typeof entryEligibility!=='function')throw Error('开仓证据检查必须为函数');
 if(selectCandidates!==null&&typeof selectCandidates!=='function')throw Error('选股函数必须是函数');
 if(!good(initialCash)||![feeBps,slippageBps,sellTaxBps].every(x=>finite(x)&&x>=0&&x<10000)||
  !Number.isInteger(topN)||topN<1||!Number.isInteger(holdDays)||holdDays<1||!Number.isInteger(lotSize)||lotSize<1)
  throw Error('回测参数不合法');
 for(const threshold of [stopLossPct,drawdownAlertPct])if(threshold!==null&&(!good(threshold)||threshold>100))throw Error('风险阈值无效');
 if(!good(maxPositionPct)||maxPositionPct>100||feeBps+sellTaxBps>=10000)throw Error('仓位或卖出成本无效');
 const n=Math.min(...stocks.map(s=>Array.isArray(s.bars)?s.bars.length:0));
 const stop=end===undefined?n-1:Math.min(end,n-1);
 if(!Number.isInteger(start)||start<27||!Number.isInteger(stop)||stop<=start)throw Error('历史数据不足');
 assertAligned(stocks,stop,tradingDates);
 let equityPeak=initialCash,alertActive=false,riskPauseDays=0;
 const cashFlows=[{day:start,kind:"initial",amount:initialCash,balance:initialCash}];
 const byCode=new Map();
 for(const s of stocks){const code=String(s.symbol||s.code||'').trim();if(!code||byCode.has(code))throw Error('股票代码缺失或重复');byCode.set(code,s);}
 let cash=initialCash,positions=new Map(),lastMarks=new Map(),pending=[],trades=[],orders=[],equity=[],warnings=[];
 const cost=feeBps/10000,slip=slippageBps/10000,tax=sellTaxBps/10000;
 const getBar=(s,d)=>s.bars[d];
 for(let day=start;day<=stop;day++){
  const date=stocks[0].bars[day].date;
  if(settlements?.some(e=>e.effectiveDate===date)){
   if(stocks.some(s=>s.bars[day].corporateAction&&settlements.some(e=>e.symbol===String(s.symbol||s.code)&&e.effectiveDate===date)))throw Error('同日不能混用旧权益和结算表');
   const result=applyResearchSettlements({cash,positions,events:settlements,day,date});cash=result.cash;trades.push(...result.realizations);
   orders.push(...result.flows.map(f=>({...f,status:'corporate-settlement'})));
   cashFlows.push(...result.flows);
  }

  for(const s of stocks){
   const action=corporateAction(s.bars[day]);if(!action)continue;
   const symbol=String(s.symbol||s.code),p=positions.get(symbol);if(!p)continue;
   const value=entitlement(p.shares,action);p.shares=value.shares;p.entry=(p.entry-action.netCashPerShare)/action.shareMultiplier;p.costBasis-=value.cash;
   cash+=value.cash;cashFlows.push({day,symbol,kind:'corporate-action',amount:value.cash,balance:cash});
   orders.push({day,symbol,status:'corporate-action',shares:p.shares,cash:value.cash,source:action.source});
  }
  // Orders are generated at previous close, filled at today's open. Sell first to free cash.
  const sells=pending.filter(o=>o.side==='sell'),buys=pending.filter(o=>o.side==='buy');
  pending=[];
  for(const o of sells){
   const p=positions.get(o.symbol);if(!p)continue;
   const s=byCode.get(o.symbol),bar=getBar(s,day),prev=getBar(s,day-1);
   const lock=atLockedLimit(bar,prev,s,'sell');
   if(!bar||(bar.suspended??s.suspended)||(bar.tradable??s.tradable)===false||!good(bar.volume)||!good(bar.open)||lock.blocked){
    orders.push({day,symbol:o.symbol,side:'sell',status:'blocked',reason:lock.reason||'当日状态限制或无有效成交'});
    p.sellPending=true;continue;
   }
   if(p.buyDay>=day)throw Error('T+1禁止当日卖出');
   const capacity=executionCapacity(s,prev,p.shares,lotSize,executionRisk);
   if(!capacity.shares){orders.push({day,symbol:o.symbol,side:'sell',status:'blocked',reason:capacity.reason});p.sellPending=true;continue;}
   const sold=capacity.shares,basis=p.costBasis*sold/p.shares;
   const price=Math.max(lock.boundary,bar.open*(1-slip)),gross=price*sold;
   const feeEvidence=feeSchedules?tradingFees({side:'sell',quantity:sold,price,tradeDate:bar.date,schedules:feeSchedules}):null;
   const proceeds=gross-(feeEvidence?feeEvidence.total:gross*(cost+tax));
   cash+=proceeds;trades.push({symbol:o.symbol,buyDay:p.buyDay,sellDay:day,shares:sold,
    entry:p.entry,exit:price,costBasis:basis,netPnl:+(proceeds-basis).toFixed(2),holdingDays:day-p.buyDay});
   orders.push({day,symbol:o.symbol,side:'sell',status:'filled',shares:sold,price,fees:feeEvidence?feeEvidence.total:gross*(cost+tax),feeEvidence});
   cashFlows.push({day,symbol:o.symbol,kind:'sell',amount:proceeds,balance:cash});
   if(sold===p.shares){positions.delete(o.symbol);lastMarks.delete(o.symbol);}else{p.shares-=sold;p.costBasis-=basis;p.sellPending=true;}
  }
  const prior=equity.at(-1),beforePrior=equity.at(-2);
  const risk=prior?evaluatePreviousCloseRisk({priorEquity:prior.value,priorPeak:equityPeak,previousEquity:beforePrior?.value??initialCash,maxDrawdownPausePct,maxDailyLossPausePct}):{paused:false};
  if(risk.paused){riskPauseDays++;orders.push({day,side:'buy',status:'risk-paused',reason:risk.reasons.join('；')});}
  for(const o of (risk.paused?[]:buys)){
   if(positions.has(o.symbol))continue;
   const s=byCode.get(o.symbol),bar=getBar(s,day),prev=getBar(s,day-1);
   const lock=atLockedLimit(bar,prev,s,'buy');
   if(!bar||(bar.suspended??s.suspended)||(bar.isST??s.isST)||(bar.tradable??s.tradable)===false||!good(bar.volume)||!good(bar.open)||lock.blocked){
    orders.push({day,symbol:o.symbol,side:'buy',status:'blocked',reason:lock.reason||'当日状态限制或无有效成交'});continue;
   }
   if(entryEligibility){const gate=entryEligibility({symbol:o.symbol,tradeDate:bar.date,decisionAt:Date.parse(bar.date+'T09:30:00+08:00')});if(!gate||typeof gate.eligible!=='boolean')throw Error('开仓证据检查结果无效');if(!gate.eligible){orders.push({day,symbol:o.symbol,side:'buy',status:'blocked',reason:(gate.reasons||['ENTRY_EVIDENCE_REJECTED']).join(',')});continue;}}
   if(!universeObservation(universeHistory,o.symbol,bar.date,{at:'open'}).eligible){orders.push({day,symbol:o.symbol,side:'buy',status:'blocked',reason:'NO_POINT_IN_TIME_MEMBERSHIP'});continue;}
   const price=Math.min(lock.boundary,bar.open*(1+slip)),allocation=Math.min(cash,o.budget);
   const requested=feeSchedules?maxAffordableQuantity({budget:allocation,price,lotSize,tradeDate:bar.date,schedules:feeSchedules}):Math.floor(allocation/(price*(1+cost))/lotSize)*lotSize;
   const capacity=executionCapacity(s,prev,requested,lotSize,executionRisk);
   const shares=capacity.shares;
   if(shares<=0){orders.push({day,symbol:o.symbol,side:'buy',status:'blocked',reason:capacity.reason||'现金不足一手'});continue;}
   const entryRisk=evaluateEntryRisk({policy:riskPolicy,symbol:o.symbol,strategyId:byCode.get(o.symbol).strategyId,sectors:Object.fromEntries([...byCode.keys()].map(symbol=>[symbol,universeObservation(universeHistory,symbol,getBar(byCode.get(symbol),day-1)?.date).sector])),lossStreak:consecutiveLosses(trades.map(t=>({side:'sell',realizedPnl:t.netPnl}))),quantity:shares,price,cash,positions:[...positions.values()].map(p=>({symbol:p.symbol,quantity:p.shares,strategyId:byCode.get(p.symbol).strategyId})),marks:Object.fromEntries([...byCode].map(([symbol,s])=>[symbol,getBar(s,day-1)?.close])),previousClose:equity.length?{priorEquity:equity.at(-1).value,priorPeak:equityPeak,previousEquity:equity.at(-2)?.value??initialCash}:null});
   if(!entryRisk.allowed){orders.push({day,symbol:o.symbol,side:'buy',status:'risk-paused',reason:entryRisk.reasonCodes.join(','),entryRisk});continue;}
   const feeEvidence=feeSchedules?tradingFees({side:'buy',quantity:shares,price,tradeDate:bar.date,schedules:feeSchedules}):null;
   const spent=shares*price+(feeEvidence?feeEvidence.total:shares*price*cost);cash-=spent;
   positions.set(o.symbol,{symbol:o.symbol,shares,buyDay:day,entry:price,costBasis:spent,sellPending:false});
   orders.push({day,symbol:o.symbol,side:'buy',status:'filled',shares,price,fees:feeEvidence?feeEvidence.total:shares*price*cost,feeEvidence,entryRisk});
   cashFlows.push({day,symbol:o.symbol,kind:'buy',amount:-spent,balance:cash});
  }
  // Daily close: mark held shares even if exit is blocked. Never drop unrealized losses.
  let marked=0,unpriced=[];
  for(const [symbol,p] of positions){
   const bar=getBar(byCode.get(symbol),day);
   if(bar&&good(bar.close))lastMarks.set(symbol,bar.close);
   const mark=lastMarks.get(symbol);
   if(!good(mark)){unpriced.push(symbol);continue;}
   marked+=mark*p.shares;
   if(day>=p.buyDay+holdDays-1 || (stopLossPct!==null && mark<=p.entry*(1-stopLossPct/100)))p.sellPending=true;
  }
  equity.push({day,cash:+cash.toFixed(2),marketValue:+marked.toFixed(2),
   value:+(cash+marked).toFixed(2),openPositions:positions.size,unpriced});
  if(unpriced.length){warnings.push(`第${day}日持仓无法估值：${unpriced.join(',')}`);if(strictMarks)throw Error(`第${day}日持仓无法估值，拒绝计算不完整净值`);}
  equityPeak=Math.max(equityPeak,cash+marked);
  const alert=drawdownAlertPct!==null && (1-(cash+marked)/equityPeak)*100>=drawdownAlertPct;
  if(alert&&!alertActive)warnings.push('第'+day+'日达到回撤预警阈值');
  alertActive=alert;
  if(day===stop)break;
  // Every blocked sale is retried next trading day; no overlapping buy of held names.
  for(const [symbol,p] of positions)if(p.sellPending)pending.push({side:'sell',symbol});
  // Scan at day close using only bars <= day; orders cannot execute until day+1.
  const now=Date.UTC(2020,0,1)+day*86400000;
  const input=stocks.filter(s=>universeObservation(universeHistory,String(s.symbol||s.code),s.bars[day].date).eligible).map(s=>historicalStock(s,day,source,now));
  const ranked=typeof selectCandidates==='function'?selectCandidates(input,day).map(symbol=>({symbol:String(symbol)})):
   scanUniverse({stocks:input,now,maxAgeMs}).items.filter(x=>x.tradable);
  const slots=Math.max(0,topN-positions.size);
  const eligible=new Set(input.filter(s=>!s.isST&&!s.suspended&&s.tradable!==false).map(s=>String(s.symbol)));
  const available=[...new Set(ranked.map(x=>x.symbol))].filter(symbol=>byCode.has(symbol)&&!positions.has(symbol)&&eligible.has(symbol)).slice(0,slots);
  const budget=available.length?Math.min(cash/available.length,(cash+marked)*maxPositionPct/100):0;
  for(const symbol of available)pending.push({side:'buy',symbol,budget});
 }
 let peak=initialCash,maxDD=0;for(const e of equity){peak=Math.max(peak,e.value);maxDD=Math.max(maxDD,1-e.value/peak);}
 const last=equity.at(-1);
 return {dataProvenance:{source,mode:selectCandidates?'test-selector':'strategy-scanner',syntheticOrImported:source==='imported'||source==='simulated'},
  cashFlows,statistics:performanceStatistics(equity,{initialCash,trades}),equity,orders,trades,openPositions:[...positions.values()],cash:+cash.toFixed(2),warnings,
  metrics:{initialCash,finalEquity:last.value,returnPct:+((last.value/initialCash-1)*100).toFixed(4),
   maxDrawdownPct:+(maxDD*100).toFixed(4),riskPauseDays,closedTrades:trades.length,
   winRatePct:trades.length?+(100*trades.filter(t=>t.netPnl>0).length/trades.length).toFixed(2):null},
  assumptions:['收盘后扫描、次交易日开盘执行；买入后最早下一交易日卖出','卖出受阻继续持仓并每日按收盘价估值',
  '按整手下单；手续费、卖出印花税及双向滑点按参数计入','涨跌停按简化板块参数判断，不能替代逐日交易所规则',
  '缺少真实订单簿、成交队列、公司行为复权与准确市场日历，结果仅供研究']};
}
module.exports={ledgerBacktest};
