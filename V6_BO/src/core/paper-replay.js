'use strict';
/** Deterministic, offline paper-account replay. Research ranking at close t executes no earlier than open t+1. */
const crypto=require('node:crypto');
const {validateDataset}=require('./historical-validation');
const {scanUniverse}=require('../strategy/universe-scanner');
const {validateRiskLimits,evaluatePreviousCloseRisk}=require('./portfolio-risk-gate');
const {atLockedLimit,historicalStock}=require('../strategy/historical-session');
const {validateExecutionRisk,executionCapacity}=require('./execution-risk');
const {performanceStatistics}=require('./performance-statistics');
const {corporateAction,entitlement}=require('./corporate-actions');
const {reconcilePaperAccount}=require('./paper-account-reconciliation');
const sha256=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Read-only audit of the replay report's signal -> order provenance graph. */
function auditPaperReplayProvenance(report){
 const errors=[];
 if(!report||typeof report!=='object'||report.mode!=='offline-paper-replay')return {ok:false,errors:['回放报告类型无效'],signals:0,orders:0};
 const fingerprint=report.fingerprint;
 if(typeof fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(fingerprint))errors.push('数据集指纹无效');
 const signals=Array.isArray(report.signals)?report.signals:[];
 const orders=Array.isArray(report.orders)?report.orders:[];
 if(!Array.isArray(report.signals))errors.push('信号列表缺失');
 if(!Array.isArray(report.orders))errors.push('订单列表缺失');
 const byId=new Map();
 for(let i=0;i<signals.length;i++){
  const signal=signals[i];
  if(!signal||typeof signal!=='object'){errors.push(`信号[${i}]结构无效`);continue;}
  const {signalId,canTrade,...payload}=signal;
  if(typeof signalId!=='string'||!/^[a-f0-9]{64}$/.test(signalId)||sha256(payload)!==signalId)errors.push(`信号[${i}]指纹不匹配`);
  if(byId.has(signalId))errors.push(`信号[${i}]重复`);
  else byId.set(signalId,signal);
  if(signal.datasetFingerprint!==fingerprint)errors.push(`信号[${i}]数据集指纹不一致`);
  if(signal.source!==report.source)errors.push(`信号[${i}]行情来源不一致`);
  if(signal.canTrade!==false)errors.push(`信号[${i}]交易授权标记无效`);
  if(typeof signal.signalDate!=='string'||typeof signal.executionDate!=='string'||signal.signalDate>=signal.executionDate)errors.push(`信号[${i}]日期顺序无效`);
 }
 let linked=0;
 for(let i=0;i<orders.length;i++){
  const order=orders[i],prov=order&&order.provenance;
  if(order?.status==="risk-paused")continue;
  if(!prov||prov.kind!=='offline-replay-decision'||prov.canTrade!==false){errors.push(`订单[${i}]缺少离线证据或授权标记无效`);continue;}
  linked++;
  const signal=byId.get(prov.signalId);
  if(!signal)errors.push(`订单[${i}]引用了不存在的信号`);
  else if(signal.signalDate!==prov.signalDate||signal.executionDate!==order.day||prov.executionDate!==order.day)errors.push(`订单[${i}]信号日期或执行日期不匹配`);
  if(prov.datasetFingerprint!==fingerprint)errors.push(`订单[${i}]数据集指纹不一致`);
  if(prov.source!==report.source)errors.push(`订单[${i}]行情来源不一致`);
  if(typeof order.day!=='string'||typeof order.symbol!=='string'||!['buy','sell'].includes(order.side))errors.push(`订单[${i}]关键字段无效`);
 }
 if(report.provenance?.ordersWithSignalReference!==linked)errors.push('证据汇总订单数量不一致');
 if(report.provenance?.datasetFingerprint!==fingerprint||report.provenance?.canTrade!==false)errors.push('证据汇总指纹或交易授权标记无效');
 return {ok:errors.length===0,errors,signals:signals.length,orders:orders.length,linkedOrders:linked,datasetFingerprint:fingerprint,canTrade:false};
}
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=x=>Math.round(x*100)/100;
function replayPaperAccount(history,settings={}){
 const dataset=validateDataset(history);
 const cfg={initialCash:100000,maxPositions:3,allocationPct:0.25,feeBps:8,slippageBps:10,sellTaxBps:5,stopLossPct:0.08,startDay:31,maxDrawdownPausePct:null,maxDailyLossPausePct:null,maxParticipationPct:null,minPriorTurnover:null,...settings};
 if(!finite(cfg.initialCash)||cfg.initialCash<=0||!Number.isInteger(cfg.maxPositions)||cfg.maxPositions<1||cfg.maxPositions>30||!finite(cfg.allocationPct)||cfg.allocationPct<=0||cfg.allocationPct>1||!Number.isInteger(cfg.startDay)||cfg.startDay<31||cfg.startDay>=dataset.barsPerStock-1||![cfg.feeBps,cfg.slippageBps,cfg.sellTaxBps].every(x=>finite(x)&&x>=0&&x<=1000)||!finite(cfg.stopLossPct)||cfg.stopLossPct<=0||cfg.stopLossPct>=1)throw Error('模拟盘参数无效');
 validateRiskLimits(cfg);validateExecutionRisk(cfg);
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify(history)).digest('hex');
 const stocks=history.stocks.map(s=>({...s,symbol:String(s.symbol||s.code)}));
 const dates=stocks[0].bars.map((b,i)=>b.date||`day-${i}`);
 const cashFlows=[{day:dates[cfg.startDay],kind:"initial",amount:cfg.initialCash,balance:cfg.initialCash}],closedTrades=[];
 const positions=new Map(),orders=[],equity=[],signals=[];let cash=cfg.initialCash,peak=cash,closed=0,win=0,realized=0;let riskPauseDays=0,activeSignal=null;
 const valuation=day=>cash+[...positions.values()].reduce((sum,p)=>sum+p.qty*stocks.find(s=>s.symbol===p.symbol).bars[day].close,0);
 const fill=(s,side,day,qty,reason)=>{
  const b=s.bars[day],prev=s.bars[day-1],symbol=s.symbol;
  const provenance={kind:"offline-replay-decision",signalId:activeSignal.signalId,signalDate:activeSignal.signalDate,executionDate:dates[day],datasetFingerprint:fingerprint,source:history.source,canTrade:false};
  if((b.suspended??s.suspended)||(b.tradable??s.tradable)===false||b.volume===0){orders.push({day:dates[day],symbol,side,status:'blocked',reason:'停牌或无成交量',provenance});return false;}
  // An opening fill cannot use the later high/low to infer that the limit unlocked.
  const lock=atLockedLimit(b,prev,s,side);
  if(lock.blocked){orders.push({day:dates[day],symbol,side,status:'blocked',reason:lock.reason,provenance});return false;}
  const capacity=executionCapacity(s,prev,qty,100,cfg);
  if(capacity.shares<qty){orders.push({day:dates[day],symbol,side,status:'blocked',reason:capacity.reason,provenance});return false;}
  const price=side==='buy'?Math.min(lock.boundary,b.open*(1+cfg.slippageBps/10000)):Math.max(lock.boundary,b.open*(1-cfg.slippageBps/10000));
  const gross=price*qty,fees=gross*(cfg.feeBps+(side==='sell'?cfg.sellTaxBps:0))/10000;
  if(side==='buy'){
   if(gross+fees>cash+1e-7)return false;
   cash-=gross+fees;cashFlows.push({day:dates[day],symbol,kind:'buy',amount:-(gross+fees),balance:cash});positions.set(symbol,{symbol,qty,buyDay:day,cost:gross+fees,entry:price});
  }else{
   const p=positions.get(symbol);if(!p||p.buyDay>=day)return false;
   cash+=gross-fees;const pnl=gross-fees-p.cost;realized+=pnl;closedTrades.push({symbol,netPnl:pnl});cashFlows.push({day:dates[day],symbol,kind:'sell',amount:gross-fees,balance:cash});closed++;if(pnl>0)win++;positions.delete(symbol);
  }
  orders.push({day:dates[day],symbol,side,status:'filled',qty,price:round(price),fees:round(fees),amount:round(gross),reason,provenance});return true;
 };
 for(let day=cfg.startDay;day<dataset.barsPerStock;day++){
  // Only yesterday's close can generate today's orders.
  const previous=day-1,priorCloseEquity=valuation(day-1),priorClosePeak=peak,priorDayEquity=day>cfg.startDay?equity.at(-2)?.equity??cfg.initialCash:cfg.initialCash,ts=Date.parse((stocks[0].bars[previous].date||history.asOf)+'T15:00:00+08:00');
  for(const s of stocks){const action=corporateAction(s.bars[day]),p=positions.get(s.symbol);if(!action||!p)continue;
   const value=entitlement(p.qty,action);p.qty=value.shares;p.entry=(p.entry-action.netCashPerShare)/action.shareMultiplier;p.cost-=value.cash;cash+=value.cash;
   cashFlows.push({day:dates[day],symbol:s.symbol,kind:'corporate-action',amount:value.cash,balance:cash});
  }
  const snapshot=stocks.map(s=>{const b=s.bars[previous],p=s.bars[previous-1];return {...historicalStock(s,previous,history.source,ts),price:b.close,volume:b.volume};});
  const scan=scanUniverse({stocks:snapshot,now:ts,maxAgeMs:86400000});
  const picks=scan.items.filter(x=>x.tradable).slice(0,cfg.maxPositions).map(x=>x.symbol);
  const signalPayload={signalDate:dates[previous],executionDate:dates[day],picks,eligible:scan.eligible,source:history.source,datasetFingerprint:fingerprint,decisionMode:'offline-next-day-replay'};
  activeSignal={...signalPayload,signalId:sha256(signalPayload)};
  signals.push({...activeSignal,canTrade:false});
  for(const s of stocks){const p=positions.get(s.symbol);if(!p)continue;
   const priorEntry=p.entry*(s.bars[day].corporateAction?.shareMultiplier??1)+(s.bars[day].corporateAction?.netCashPerShare??0);
   const breached=s.bars[previous].close<=priorEntry*(1-cfg.stopLossPct);
   if(breached||!picks.includes(s.symbol))fill(s,'sell',day,p.qty,breached?'stop-loss':'rebalance');
  }
  // Risk limits use the prior close only; today's close must never determine today's orders.
  const risk=evaluatePreviousCloseRisk({priorEquity:priorCloseEquity,priorPeak:priorClosePeak,previousEquity:priorDayEquity,...cfg});
  const pauseReasons=risk.reasons;
  if(risk.paused){riskPauseDays++;orders.push({day:dates[day],side:'buy',status:'risk-paused',reason:pauseReasons.join('；'),drawdownPct:round(risk.drawdownPct),dailyLossPct:round(risk.dailyLossPct)});}
  for(const symbol of (pauseReasons.length?[]:picks)){if(positions.size>=cfg.maxPositions)break;if(positions.has(symbol))continue;
   const s=stocks.find(x=>x.symbol===symbol),b=s.bars[day];const budget=Math.min(cash,priorCloseEquity*cfg.allocationPct);
   const unit=b.open*(1+cfg.slippageBps/10000)*(1+cfg.feeBps/10000);
   const qty=Math.floor(budget/unit/100)*100;
   if(qty>=100)fill(s,'buy',day,qty,'previous-close-ranking');
  }
  const value=valuation(day);peak=Math.max(peak,value);
  equity.push({date:dates[day],cash:round(cash),positions:positions.size,equity:round(value),drawdownPct:round((peak-value)/peak*100)});
 }
 const last=equity.at(-1);const maxDrawdownPct=Math.max(0,...equity.map(x=>x.drawdownPct));
 const report={schemaVersion:1,mode:'offline-paper-replay',source:history.source,verifiedLive:false,canTrade:false,dataset,fingerprint,
  cashFlows,statistics:performanceStatistics(equity,{initialCash:cfg.initialCash,trades:closedTrades}),config:cfg,metrics:{initialCash:cfg.initialCash,finalEquity:last.equity,returnPct:round((last.equity/cfg.initialCash-1)*100),maxDrawdownPct,closedTrades:closed,winRatePct:closed?round(win/closed*100):null,realizedPnl:round(realized),blockedOrders:orders.filter(x=>x.status==='blocked').length,riskPauseDays,openPositions:positions.size},
  positions:[...positions.values()],orders,equity,signals,provenance:{kind:"offline-replay-only",datasetFingerprint:fingerprint,ordersWithSignalReference:orders.filter(o=>o.provenance?.signalId).length,canTrade:false},
  warnings:['使用历史日线的下一交易日开盘价进行纸面撮合，不代表真实可成交','不包含盘口排队、部分成交、退市及公司行为完整对账','仅供离线研究，不构成自动交易授权']};
 report.provenanceAudit=auditPaperReplayProvenance(report);
 const trades=orders.filter(o=>o.status==='filled').map((o,index)=>({t:(()=>{const parsed=Date.parse(`${o.day}T00:00:00Z`);return Number.isSafeInteger(parsed)?parsed:index;})(),tradeId:`${fingerprint.slice(0,12)}-${index+1}`,side:o.side==='buy'?'BUY':'SELL',code:o.symbol,shares:o.qty,amount:o.amount,fee:o.fees}));
 const accountPositions=Object.fromEntries(positions.entries().map(([symbol,p])=>[symbol,{shares:p.qty,basis:round(p.cost)}]));
 report.accountReconciliation=cashFlows.some(f=>f.kind==="corporate-action")?{ok:false,status:"unsupported-corporate-actions",errors:["成交对账不包含公司行为，请使用现金流审计"]}:reconcilePaperAccount({initialCash:cfg.initialCash,trades,account:{cash:last.cash,realized:round(realized),positions:accountPositions}});
 report.accountReconciliation.mode='offline-paper-replay-read-only';report.accountReconciliation.canTrade=false;
 return report;
}
module.exports={replayPaperAccount,auditPaperReplayProvenance};
