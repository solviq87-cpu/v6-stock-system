'use strict';
/** Four INDEPENDENT research portfolios, built exclusively from dated native strategy
 * pass/fail/unknown signals. Signal at close t may fill no earlier than open t+1.
 * Paper estimates: no broker connection, no claimed live liquidity or fill guarantee. */
const {tradingFees,validateFeeSchedules,maxAffordableQuantity}=require('./trading-fees');
const {validateEntryPolicy,evaluateEntryRisk,consecutiveLosses}=require('./common-entry-risk');
const {validateUniverseHistory,universeObservation}=require('./historical-universe');
const {validateDataset}=require('./historical-validation');
const {assertUnadjustedExecutionPriceBasis}=require('./historical-execution-price-basis');
const {SYSTEMS}=require('./independent-strategy-attribution');
const {applyResearchSettlements,validateSettlementTable}=require('./corporate-settlements');
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const validVersion=v=>typeof v==='string'&&v.length>0&&v.length<=256&&v.trim()===v&&!/[\x00-\x1f\x7f]/.test(v);
const r=n=>Math.round((n+Number.EPSILON)*1e4)/1e4;
function checkConfig(config={}){
 if(!config||typeof config!=='object'||Array.isArray(config))throw Error('独立模拟盘配置无效');
 const c={initialCash:100000,maxPositions:3,allocationPct:0.25,feeBps:8,slippageBps:10,sellTaxBps:5,lotSize:100,minCommission:5,stopLossPct:0.08,maxDrawdownPct:20,startDay:31,...config};
 if(!finite(c.initialCash)||c.initialCash<=0||c.initialCash>1e15||!Number.isSafeInteger(c.maxPositions)||c.maxPositions<1||c.maxPositions>30||!finite(c.allocationPct)||c.allocationPct<=0||c.allocationPct>1||!Number.isSafeInteger(c.lotSize)||c.lotSize<1||c.lotSize>10000||!finite(c.minCommission)||c.minCommission<0||c.minCommission>100||!Number.isSafeInteger(c.startDay)||c.startDay<1||!finite(c.stopLossPct)||c.stopLossPct<0||c.stopLossPct>=1||!finite(c.maxDrawdownPct)||c.maxDrawdownPct<=0||c.maxDrawdownPct>100||![c.feeBps,c.slippageBps,c.sellTaxBps].every(x=>finite(x)&&x>=0&&x<=1000))throw Error('独立模拟盘参数超出安全范围');
 return c;
}
function limitPct(stock){
 if(finite(stock.tradingLimitPct)&&stock.tradingLimitPct>0&&stock.tradingLimitPct<=1)return stock.tradingLimitPct;
 if(stock.isST)return .05;
 return ['star','chinext'].includes(String(stock.market||'').toLowerCase())?.20:.10;
}
function executionBlock(stock,day,side){
 const now=stock.bars[day],prev=stock.bars[day-1];
 if(stock.tradable===false||stock.suspended===true||now.suspended===true||now.tradable===false||now.volume<=0)return '停牌、无成交量或明确不可交易';
 if(day>0&&now.high===now.low){const ratio=now.open/prev.close-1,limit=limitPct(stock);
  if(side==='buy'&&ratio>=limit-.002)return '一字涨停无法保证买入';
  if(side==='sell'&&ratio<=-limit+.002)return '一字跌停无法保证卖出';
 }
 return null;
}
function replayStrategyPortfolios(history,signals,{config={}}={}){
 const ds=validateDataset(history),cfg=checkConfig(config);assertUnadjustedExecutionPriceBasis(history);
 for(const stock of history.stocks){assertUnadjustedExecutionPriceBasis(stock);for(const bar of stock.bars)assertUnadjustedExecutionPriceBasis(bar);}validateFeeSchedules(cfg.feeSchedules);validateEntryPolicy(cfg.riskPolicy);const settlementsBySystem=cfg.settlementsBySystem??history.strategySettlements??{};if(history.settlements?.length&&!SYSTEMS.every(k=>Array.isArray(settlementsBySystem[k])))throw Error('独立策略账户需要各自的权益结算凭据（无权益时显式空数组）');for(const [system,rows] of Object.entries(settlementsBySystem)){if(!SYSTEMS.includes(system))throw Error('未知权益策略账户');validateSettlementTable(rows);}const universeHistory=cfg.universeHistory??history.universeHistory;validateUniverseHistory(universeHistory);
 if(cfg.startDay>=ds.barsPerStock)throw Error('模拟起点超过行情日期');
 if(!Array.isArray(signals)||signals.length>ds.stocks*ds.barsPerStock*SYSTEMS.length)throw Error('独立模拟盘策略证据数量无效');
 const dates=history.stocks[0].bars.map(b=>b.date);
 if(dates.some(x=>!x))throw Error('独立模拟盘需要完整交易日期');
 const stocks=new Map(history.stocks.map(s=>[String(s.symbol||s.code),s]));
 const index=new Map(dates.map((d,i)=>[d,i]));
 const daily=Object.fromEntries(SYSTEMS.map(s=>[s,new Map()]));const seen=new Set();
 for(const sig of signals){
  if(!sig||!SYSTEMS.includes(sig.system)||!stocks.has(sig.symbol)||!index.has(sig.date)||!['pass','fail','unknown'].includes(sig.verdict)||typeof sig.provenance!=='string'||!sig.provenance.trim()||!validVersion(sig.evaluatorVersion)||sig.observedThrough!==sig.date)throw Error('独立模拟盘信号来源、日期或策略无效');
  const key=`${sig.system}/${sig.symbol}/${sig.date}`;if(seen.has(key))throw Error('独立模拟盘重复信号: '+key);seen.add(key);
  const idx=index.get(sig.date);if(!daily[sig.system].has(idx))daily[sig.system].set(idx,[]);
  if(sig.verdict==='pass')daily[sig.system].get(idx).push({symbol:sig.symbol,signalDate:sig.date,evaluatorVersion:sig.evaluatorVersion,provenance:sig.provenance});
 }
 const reports={};
 for(const system of SYSTEMS){
  const settlements=settlementsBySystem[system]||[];
  let cash=cfg.initialCash,peak=cash,halted=false,closed=0,wins=0,realized=0,signalsPassed=0;
  const positions=new Map(),orders=[],equity=[],fills=[];
  let previousCloseEquity=cfg.initialCash,unattributedFills=0;
  const versionStats=new Map();
  function versionOf(ref){
   if(!ref)return null;
   const v=ref.evaluatorVersion;
   if(!versionStats.has(v))versionStats.set(v,{evaluatorVersion:v,passSignalsConsidered:0,buys:0,closedTrades:0,wins:0,realizedPnl:0});
   return versionStats.get(v);
  }
  function attributeExit(ref,pnl){
   const v=versionOf(ref);
   if(!v){unattributedFills++;return;}
   v.closedTrades++;if(pnl>0)v.wins++;v.realizedPnl+=pnl;
  }
  const evaluate=day=>cash+[...positions.values()].reduce((sum,p)=>sum+p.qty*stocks.get(p.symbol).bars[day].close,0);
  const block=(day,symbol,side,reason)=>orders.push({date:dates[day],symbol,side,status:'blocked',reason});
  for(let day=cfg.startDay;day<dates.length;day++){
   // Use the stored previous close before today's settlements and opening
   // executions change cash or holdings. Current cash still limits purchases.
   const prevEquity=previousCloseEquity;
   const settlementRefs=new Map([...positions].map(([symbol,p])=>[symbol,p.signalRef]));
   const applied=applyResearchSettlements({cash,positions,events:settlements||[],day,date:dates[day],quantityKey:'qty',basisKey:'cost'});cash=applied.cash;
   for(const t of applied.realizations){realized+=t.netPnl;closed++;if(t.netPnl>0)wins++;
    const signalRef=settlementRefs.get(t.symbol)??null;
    attributeExit(signalRef,t.netPnl);fills.push({...t,date:dates[day],side:'sell',pnl:t.netPnl,signalRef});}
   orders.push(...applied.flows.map(f=>({...f,date:dates[day],status:'corporate-settlement'})));
   const signalDay=day-1,selected=(daily[system].get(signalDay)||[]).slice().sort((a,b)=>a.symbol.localeCompare(b.symbol));
   signalsPassed+=selected.length;
   for(const ref of selected)versionOf(ref).passSignalsConsidered++;
   // Exit on next trading day after entry; stop-loss is observable only as of previous close.
   for(const [symbol,p] of [...positions]){
    if(day<=p.buyDay)continue;
    const s=stocks.get(symbol);const b=s.bars[day];const reason=cfg.stopLossPct>0&&s.bars[day-1].close<=p.entry*(1-cfg.stopLossPct)?'stop-loss-from-previous-close':'one-session-hold';
    const why=executionBlock(s,day,'sell');if(why){block(day,symbol,'sell',why);continue;}
    const price=b.open*(1-cfg.slippageBps/10000),gross=price*p.qty,feeEvidence=cfg.feeSchedules?tradingFees({side:'sell',quantity:p.qty,price,tradeDate:dates[day],schedules:cfg.feeSchedules}):null,fee=feeEvidence?feeEvidence.total:Math.max(cfg.minCommission,gross*cfg.feeBps/10000)+gross*cfg.sellTaxBps/10000;
    cash+=gross-fee;const pnl=gross-fee-p.cost;realized+=pnl;closed++;if(pnl>0)wins++;
    attributeExit(p.signalRef,pnl);
    positions.delete(symbol);const entry={date:dates[day],symbol,side:'sell',qty:p.qty,price:r(price),fees:r(fee),feeEvidence,reason,pnl:r(pnl),signalRef:p.signalRef??null};
    fills.push(entry);orders.push({...entry,status:'filled'});
   }
   // Circuit breaker is based on last available close and cannot peek at today's close.
   peak=Math.max(peak,prevEquity);
   if((peak-prevEquity)/peak*100>=cfg.maxDrawdownPct)halted=true;
   if(halted){for(const {symbol} of selected)block(day,symbol,'buy','账户回撤熔断，禁止新增仓位');}
   else for(const signalRef of selected){
    const {symbol}=signalRef;
    if(positions.has(symbol)||positions.size>=cfg.maxPositions)continue;
    if(!universeObservation(universeHistory,symbol,dates[signalDay]).eligible||!universeObservation(universeHistory,symbol,dates[day],{at:'open'}).eligible){block(day,symbol,'buy','NO_POINT_IN_TIME_MEMBERSHIP');continue;}
    const s=stocks.get(symbol);if(s.isST===true){block(day,symbol,'buy','ST风险门禁');continue;}
    const reason=executionBlock(s,day,'buy');if(reason){block(day,symbol,'buy',reason);continue;}
    const price=s.bars[day].open*(1+cfg.slippageBps/10000),unit=price*(1+cfg.feeBps/10000);
    const budget=Math.min(cash,prevEquity*cfg.allocationPct);let qty=cfg.feeSchedules?maxAffordableQuantity({budget,price,lotSize:cfg.lotSize,tradeDate:dates[day],schedules:cfg.feeSchedules}):Math.floor(budget/unit/cfg.lotSize)*cfg.lotSize;
    while(!cfg.feeSchedules&&qty>=cfg.lotSize){const gross=price*qty,fee=Math.max(cfg.minCommission,gross*cfg.feeBps/10000);if(gross+fee<=budget+1e-7)break;qty-=cfg.lotSize;}
    if(qty<cfg.lotSize){block(day,symbol,'buy','含最低佣金后可用资金不足以购买一手');continue;}
    const riskInput={policy:cfg.riskPolicy,symbol,strategyId:system,quantity:qty,price,cash,positions:[...positions.values()].map(p=>({symbol:p.symbol,quantity:p.qty,strategyId:system})),marks:Object.fromEntries([...stocks].map(([c,s])=>[c,s.bars[signalDay].close])),sectors:Object.fromEntries([...stocks.keys()].map(c=>[c,universeObservation(universeHistory,c,dates[signalDay]).sector])),lossStreak:consecutiveLosses(fills.filter(f=>f.side==='sell').map(f=>({side:'sell',realizedPnl:f.pnl}))),previousClose:{priorEquity:prevEquity,priorPeak:peak,previousEquity:equity.at(-2)?.equity??cfg.initialCash}};
    const entryRisk=evaluateEntryRisk(riskInput);if(!entryRisk.allowed){block(day,symbol,'buy',entryRisk.reasonCodes.join(','));continue;}
    const cost=price*qty,feeEvidence=cfg.feeSchedules?tradingFees({side:'buy',quantity:qty,price,tradeDate:dates[day],schedules:cfg.feeSchedules}):null,fee=feeEvidence?feeEvidence.total:Math.max(cfg.minCommission,cost*cfg.feeBps/10000);
    cash-=cost+fee;positions.set(symbol,{symbol,qty,buyDay:day,buyDate:dates[day],entry:r(price),cost:cost+fee,signalRef:{...signalRef}});
    versionOf(signalRef).buys++;
    const fill={date:dates[day],signalDate:dates[signalDay],symbol,side:'buy',qty,price:r(price),fees:r(fee),feeEvidence,entryRisk,reason:'previous-session-native-pass',signalRef:{...signalRef}};
    fills.push(fill);orders.push({...fill,status:'filled'});
   }
   const value=evaluate(day);previousCloseEquity=value;peak=Math.max(peak,value);
   const drawdownPct=peak>0?(peak-value)/peak*100:0;
   if(drawdownPct>=cfg.maxDrawdownPct)halted=true;
   equity.push({date:dates[day],cash:r(cash),equity:r(value),positions:positions.size,drawdownPct:r(drawdownPct)});
  }
  const final=equity.at(-1),returns=equity.slice(1).map((e,i)=>e.equity/equity[i].equity-1);
  const mean=returns.length?returns.reduce((a,b)=>a+b,0)/returns.length:0;
  const variance=returns.length>1?returns.reduce((a,b)=>a+(b-mean)**2,0)/(returns.length-1):0;
  // Capital is isolated by system, not evaluator version. Do not present a
  // mixed-version account's equity or drawdown as independently funded P&L.
  const versions=[...versionStats.values()].sort((a,b)=>a.evaluatorVersion.localeCompare(b.evaluatorVersion)).map(v=>({...v,
   realizedPnl:r(v.realizedPnl),winRatePct:v.closedTrades?r(v.wins/v.closedTrades*100):null}));
  reports[system]={versionAttribution:{scope:'entry-signal-version-within-system-account',separateCapitalByVersion:false,
   status:unattributedFills?'incomplete':!versions.length?'not-evaluated':versions.length===1?'single-version':'mixed-version',
   unattributedFills,versions},status:signalsPassed?'research-paper-estimate':'no-passing-signals',canTrade:false,verifiedLive:false,
   metrics:{initialCash:cfg.initialCash,finalEquity:final.equity,returnPct:r((final.equity/cfg.initialCash-1)*100),
    maxDrawdownPct:r(Math.max(0,...equity.map(e=>e.drawdownPct))),closedTrades:closed,winRatePct:closed?r(wins/closed*100):null,
    realizedPnl:r(realized),blockedOrders:orders.filter(o=>o.status==='blocked').length,openPositions:positions.size,
    sharpeEstimate:returns.length>1&&variance>0?r(mean/Math.sqrt(variance)*Math.sqrt(252)):null,halted,
    passSignalsConsidered:signalsPassed},
   equity,orders,positions:[...positions.values()],fills};
 }
 return {schemaVersion:1,mode:'four-independent-native-evidence-paper-portfolios',canTrade:false,verifiedLive:false,
  config:cfg,source:history.source,asOf:history.asOf,systems:reports,
  limitations:['只有 pass 信号触发次日开盘纸面委托；unknown/fail 不伪造交易','独立模拟盘不合并四套策略的评分或资金','不含盘口排队、真实成交、除权除息到账及交易所完整交易日历','一字板、T+1、买入整手、最低佣金、停牌、ST和成本为保守近似，不构成真实可成交证明']};
}
// The interactive comparison accepts only the existing numeric research
// settings. It never accepts a second set of per-system capital or risk rules.
function comparisonConfig(value={}){
 const keys=['initialCash','maxPositions','allocationPct','feeBps','slippageBps','sellTaxBps','lotSize','minCommission','stopLossPct','maxDrawdownPct','startDay'];
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw Error('同条件回放配置只接受原研究资金、成本与退出参数');
 return checkConfig(value);
}
// Summarize an ALREADY computed independent replay. No new signals, scoring,
// account ledger, return arithmetic, ranking or promotion logic is created.
function describeStrategyComparison(history,native,portfolios){
 const dataset=validateDataset(history),dates=history.stocks[0].bars.map(b=>b.date),cfg=portfolios?.config;
 if(portfolios?.mode!=='four-independent-native-evidence-paper-portfolios'||portfolios.source!==history.source||portfolios.asOf!==history.asOf||!cfg||!Number.isSafeInteger(cfg.startDay)||cfg.startDay<1||cfg.startDay>=dates.length||!Array.isArray(native?.signals))throw Error('同条件回放缺少原生信号或独立账本');
 const symbols=history.stocks.map(s=>String(s.symbol||s.code)),allDates=new Set(dates),windowDates=dates.slice(cfg.startDay-1,-1),windowSet=new Set(windowDates),symbolsSet=new Set(symbols);
 const seen=new Set(),bySystem=Object.fromEntries(SYSTEMS.map(id=>[id,new Map()]));
 for(const signal of native.signals){
  if(!signal||!SYSTEMS.includes(signal.system)||!symbolsSet.has(signal.symbol)||!allDates.has(signal.date)||!['pass','fail','unknown'].includes(signal.verdict))throw Error('同条件信号的体系、证券、日期或状态无效');
  const key=JSON.stringify([signal.symbol,signal.date]),identity=JSON.stringify([signal.system,signal.symbol,signal.date]);
  if(seen.has(identity))throw Error('同条件回放不接受重复信号');seen.add(identity);
  if(signal.observedThrough!==signal.date)throw Error('同条件信号含无效或未来观察时点，须保持原同日信号合同');
  if(typeof signal.provenance!=='string'||!signal.provenance.trim()||!validVersion(signal.evaluatorVersion))throw Error('同条件信号缺少原来源或评估版本');
  if(windowSet.has(signal.date))bySystem[signal.system].set(key,signal);
 }
 const evaluated=s=>s&&['pass','fail'].includes(s.verdict)&&typeof s.observedThrough==='string'&&s.observedThrough<=s.date&&typeof s.evaluatorVersion==='string'&&!!s.evaluatorVersion.trim();
 const total=dataset.stocks*windowDates.length;
 let commonEvaluatedSignals=0;
 for(const date of windowDates)for(const symbol of symbols){const key=JSON.stringify([symbol,date]);if(SYSTEMS.every(id=>evaluated(bySystem[id].get(key))))commonEvaluatedSignals++;}
 const digest=x=>require('node:crypto').createHash('sha256').update(JSON.stringify(x)).digest('hex');
 const systems=SYSTEMS.map(id=>{
  const rows=[...bySystem[id].values()],known=rows.filter(evaluated),account=portfolios.systems?.[id];
  if(!account?.metrics||!Array.isArray(account.fills)||!Array.isArray(account.orders)||!Array.isArray(account.equity)||account.metrics.initialCash!==cfg.initialCash)throw Error('独立组合资金或账本不完整');
  const bought=account.fills.filter(f=>f.side==='buy').length,assessed=known.length>0;
  return {id,status:!assessed?'not-evaluated':!bought?'no-buy-fills':'paper-estimate',
   coverage:{total,evaluated:known.length,unknown:total-known.length,missing:total-rows.length,passed:known.filter(s=>s.verdict==='pass').length,failed:known.filter(s=>s.verdict==='fail').length},
   evaluatorVersions:[...new Set(known.map(s=>s.evaluatorVersion))].sort(),
   paperReturnPct:assessed&&bought?account.metrics.returnPct:null,
   paperDrawdownPct:assessed&&bought?account.metrics.maxDrawdownPct:null,
   accountMetrics:{...account.metrics},buyFills:bought,orderCount:account.orders.length,
   blockedOrders:account.metrics.blockedOrders,openPositions:account.metrics.openPositions,
   versionAttribution:account.versionAttribution,accountEvidenceFingerprint:digest(account)};
 });
 return {schemaVersion:1,mode:'native-strategy-protocol-comparison',status:commonEvaluatedSignals?'shared-protocol-descriptive-only':'insufficient-common-evaluated-signals',
  scope:'existing-four-native-systems-only',datasetFingerprint:digest(history),signalsFingerprint:digest(native.signals),protocolFingerprint:digest({config:cfg,dates,symbols}),
  source:history.source,provider:history.provider||null,asOf:history.asOf,retrievedAt:history.retrievedAt??null,
  dataset,protocol:{...cfg,signalStart:windowDates[0],signalEnd:windowDates.at(-1),entryStart:dates[cfg.startDay],valuationThrough:dates.at(-1),
   exitPolicy:'next-eligible-session-open-after-entry; T+1/limit/suspension constraints retained'},
  commonEvaluatedSignals,totalCandidateSignals:total,systems,
  limitations:[...portfolios.limitations,'当前取得的历史版本不等于逐日当时已知的完整股票池、因子与证券状态','共同已评估信号不是独立成熟收益样本；没有选出赢家','无评估或无买入成交时，现金未动不显示为策略零收益胜出'],
  canTrade:false,canTrain:false,canNotify:false,verifiedLive:false,eligibleForPromotion:false,weightsChanged:false,pointInTimeCertified:false};
}
module.exports={replayStrategyPortfolios,checkConfig,executionBlock,comparisonConfig,describeStrategyComparison};
