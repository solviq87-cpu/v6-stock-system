'use strict';
// Read-only projection of a snapshot already validated by the original account service.
// Never feeds an order, changes a book, or certifies an executable fill.
const {quoteUseEligibility,quoteSnapshotFields}=require('./quote-observation-view');
const {tradingFees}=require('./trading-fees');
const {exitRisk}=require('./advanced-portfolio-evidence');
const {reconcileAccountSnapshot,defensiveStatus}=require('./account-safety-state');
const MAX_HOLDINGS=220;
const qty=x=>Number.isSafeInteger(x)&&x>=0;
const num=x=>typeof x==='number'&&Number.isFinite(x);
const dateOk=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const codeOk=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const safeSource=x=>typeof x==='string'&&/^[\p{L}\p{N}_.:-]{1,80}$/u.test(x)?x:null;
const money=x=>Math.round(x*100)/100;
const issue=(code,severity,basis,object,restriction,check,release)=>({code,severity,basis,object,restriction,check,release});
function unavailable(account,reason){
 return {account,status:'unknown',reason,completeReconciliation:false,positions:[],canTrade:false,writesAccount:false,
 alerts:[issue('ACCOUNT_EVIDENCE_UNAVAILABLE','critical','原权威账本或其诊断证据不可用',account,'建议暂停新增并沿原门禁核对；本报告不执行限制','检查原账户读校验、角色、持久卷和对账','原主实例重新核验并确认一致')]};
}
// Select from existing rows only. Never pair a price with another row's timestamp.
function selectAdvancedRiskQuotes({codes,stocks,lastPx,now,limitFor}){
 if(!Array.isArray(codes)||codes.length>MAX_HOLDINGS||codes.some(x=>!codeOk(x)))return {};
 const wanted=new Set(codes),byCode=new Map();
 for(const row of Array.isArray(stocks)?stocks:[])if(wanted.has(row?.code)){
  const rows=byCode.get(row.code)||[];rows.push(row);byCode.set(row.code,rows);
 }
 const out={};
 for(const code of wanted){
  const wire=lastPx?.get?.(code)?.wireQuote,stocks=byCode.get(code)||[];
  const rows=[wire,...stocks].filter(x=>x?.code===code);
  const usable=rows.filter(x=>quoteUseEligibility(x,now).canTrade);
  const row=usable[0]||rows[0];
  if(!row)continue;
  const use=quoteUseEligibility(row,now),basis=quoteSnapshotFields(row);
  const raw={...basis,code,price:num(row.price)?row.price:null,canTrade:row.canTrade===true?true:row.canTrade===false?false:null};
  const conflicts=usable.some(x=>x.quoteAt===row.quoteAt&&x.price!==row.price)||
    rows.some(x=>x.quoteAt===row.quoteAt&&quoteUseEligibility(x,now).quoteStatus==='recent-unverified'&&
      (typeof x.suspended==='boolean'&&typeof row.suspended==='boolean'&&x.suspended!==row.suspended||
       x.preClose!=null&&row.preClose!=null&&x.preClose!==row.preClose||
       x.lowerLimit!=null&&row.lowerLimit!=null&&x.lowerLimit!==row.lowerLimit));
  if(conflicts){out[code]={quote:{...raw,sourceConflict:true,canTrade:false},limitDown:null,suspended:null,limitEvidenceStatus:'conflict'};continue;}
  let limitDown=null,limitEvidenceStatus='unknown',lowerLimit=null;
  if(use.canTrade&&num(row.preClose)&&row.preClose>0&&typeof row.name==='string'&&row.name.trim()&&typeof limitFor==='function'){
   const limit=limitFor(code,row.name);
   if(num(limit)&&limit>0&&limit<1){
    const boundary=Math.round(row.preClose*(1-limit)*100)/100;
    const special=row.noPriceLimit===true||row.ipoNoLimit===true||row.corporateAction!=null&&row.corporateAction!==false;
    const explicit=Object.hasOwn(row,'lowerLimit'),same=explicit&&num(row.lowerLimit)&&row.lowerLimit>0&&Math.abs(row.lowerLimit-boundary)<1e-8;
    // Keep the original server's legacy derived boundary separate from
    // explicit agreement. No forward rule or no-limit day is inferred.
    if(special)limitEvidenceStatus='special-session-unverified';
    else if(explicit&&!same)limitEvidenceStatus='conflict-or-missing';
    else if(boundary>0){lowerLimit=boundary;limitDown=row.price<=boundary;limitEvidenceStatus=same?'original-rule-and-quote-agree':'original-rule-derived-unverified';}
   }
  }
  out[code]={quote:raw,limitDown,lowerLimit,limitEvidenceStatus,suspended:typeof row.suspended==='boolean'?row.suspended:null};
 }
 return out;
}
function accountExitDiagnostics(book,{account,day,now,marketOpen,continuous,quotes={},portfolioContext,portfolioContextStatus}={}){
 if(!['pool','pre'].includes(account)||!dateOk(day)||!Number.isSafeInteger(now)||now<=0||typeof marketOpen!=='boolean'||typeof continuous!=='boolean'||continuous&&!marketOpen)return unavailable(account,'INVALID_CONTEXT');
 if(!book||book.paperOnly!==true||book.brokerConnected!==false||!Number.isSafeInteger(book.revision)||book.revision<1||!book.account||!num(book.account.cash)||book.account.cash<0||!book.orders||typeof book.orders!=='object'||Array.isArray(book.orders)||!book.account.positions||typeof book.account.positions!=='object'||Array.isArray(book.account.positions)||!Array.isArray(book.account.events))return unavailable(account,'INVALID_BOOK');
 const entries=Object.entries(book.account.positions),orders=Object.values(book.orders);
 if(entries.length>MAX_HOLDINGS||orders.length>50000||book.account.events.length>50000)return unavailable(account,'DIAGNOSTIC_LIMIT');
 const seen=new Set(),seenFills=new Set(),sellFrozen=new Map(),alerts=[],positions=[];
 for(const event of book.account.events){
  if(typeof event?.eventId!=='string'||!event.eventId||seen.has(event.eventId))return unavailable(account,'DUPLICATE_OR_INVALID_LEDGER_EVENT');
  seen.add(event.eventId);
 }
 let reservedCash=0,feesComplete=true;
 for(const item of orders){
  const o=item?.order,s=item?.state;
  if(!o||!s||!codeOk(o.symbol)||!['buy','sell'].includes(o.side)||typeof s.terminal!=='boolean'||!qty(s.remainingQuantity)||!Array.isArray(item.events))return unavailable(account,'INVALID_ORDER_EVIDENCE');
  for(const e of item.events)if(e?.type==='fill'){
   if(typeof e.eventId!=='string'||!e.eventId||seenFills.has(e.eventId)||!seen.has(e.eventId))return unavailable(account,'DUPLICATE_OR_ORPHAN_FILL');
   seenFills.add(e.eventId);
  }
  if(s.terminal)continue;
  if(s.remainingQuantity===0)return unavailable(account,'UNFINISHED_ORDER_WITHOUT_REMAINDER');
  if(o.side==='sell'){const amount=(sellFrozen.get(o.symbol)||0)+s.remainingQuantity;if(!qty(amount))return unavailable(account,'FROZEN_QUANTITY_OVERFLOW');sellFrozen.set(o.symbol,amount);}
  else try{
   if(!dateOk(o.tradeDate)||!num(o.limitPrice)||o.limitPrice<=0)throw Error('invalid order');
   const fee=tradingFees({side:'buy',quantity:s.remainingQuantity,price:o.limitPrice,tradeDate:[o.tradeDate,day].sort().at(-1),policy:book.feePolicy,schedules:book.feeSchedules||null,priorFills:item.events});
   reservedCash+=s.remainingQuantity*o.limitPrice+fee.total;
   if(!num(reservedCash)||reservedCash<0)throw Error('invalid cash');
  }catch{feesComplete=false;}
 }
 if(seenFills.size!==seen.size)return unavailable(account,'ORPHAN_LEDGER_EVENT');
 for(const [symbol,frozen] of sellFrozen)if(frozen>0&&!entries.some(([c])=>c===symbol))return unavailable(account,'ORPHAN_FROZEN_POSITION');
 let markedValue=0,markedCount=0;
 for(const [symbol,p] of entries){
  if(!codeOk(symbol)||!qty(p?.quantity)||!Array.isArray(p.lots))return unavailable(account,'INVALID_POSITION');
  let total=0,eligible=0,reservedLots=0;
  for(const lot of p.lots){
   const reserved=lot?.reserved??0;
   if(!qty(lot?.quantity)||!qty(reserved)||reserved>lot.quantity||!dateOk(lot.buyDate)||lot.buyDate>day||lot.sellableDate!=null&&(!dateOk(lot.sellableDate)||lot.sellableDate<lot.buyDate))return unavailable(account,'INVALID_LOT');
   total+=lot.quantity;reservedLots+=reserved;
   if(lot.sellableDate?lot.sellableDate<=day:lot.buyDate<day)eligible+=lot.quantity-reserved;
  }
  const frozen=sellFrozen.get(symbol)||0;
  if(!qty(total)||total!==p.quantity||frozen>eligible)return unavailable(account,'LOT_OR_FROZEN_MISMATCH');
  if(!p.quantity)continue;
  const available=eligible-frozen,raw=quotes[symbol],quote=raw?.quote?.code===symbol?raw.quote:null;
  const use=quote?quoteUseEligibility(quote,now):null;
  if(use?.canTrade){markedValue+=p.quantity*quote.price;markedCount++;}
  // The original submit gate uses lot maturity and outstanding sell reservations.
  // On a closed market show the lot quantity separately, not a tradable order.
  const risks=exitRisk({position:{symbol,quantity:p.quantity,sellable:available},quote,now,limitDown:raw?.limitDown,suspended:raw?.suspended});
  let fee=null,feeVersion=null;
  if(continuous&&available>0&&use?.canTrade&&raw?.suspended===false&&raw?.limitDown===false&&book.legacy?.enabled!==false)try{
   const estimate=tradingFees({side:'sell',quantity:available,price:quote.price,tradeDate:day,policy:book.feePolicy,schedules:book.feeSchedules||null});
   fee=estimate.total;feeVersion=safeSource(estimate.version);
  }catch{}
  const rowAlerts=Array.isArray(risks.alerts)?risks.alerts:[];
  if(!continuous)rowAlerts.push(issue('SESSION_CLOSED','high','当前不在连续竞价时段',symbol,'不得据此执行退出','核对原交易时钟','原连续竞价及全部执行门禁恢复'));
  if(book.legacy?.enabled===false)rowAlerts.push(issue('ACCOUNT_PAUSED','high','原模拟账户暂停',symbol,'不得通过本报告恢复交易','核对原账户状态及授权','原账户按授权启用并通过门禁'));
  positions.push({symbol,quantity:p.quantity,matureUnreserved:available,sellable:marketOpen?available:null,
   orderFrozen:frozen,lotReserved:reservedLots,quoteAt:use?.quoteAt??null,quoteSource:safeSource(quote?.quoteSource),quoteStatus:use?.quoteStatus||'unknown',
   estimatedFee:fee,feeVersion,estimatedMarketImpact:null,conditionalSessions:null,estimatedExitCost:null,
   conditionalSellableSessions:null,estimatedSellableExitCost:null,exitEstimateQuantity:null,costReason:null,
   guaranteedFill:false,alerts:rowAlerts});
 }
 if(feesComplete&&reservedCash>book.account.cash+0.011)return unavailable(account,'CASH_RESERVATION_MISMATCH');
 if(!feesComplete)alerts.push(issue('CASH_RESERVATION_UNKNOWN','high','原待买委托费率或预算证据不足',account,'不确认可用资金；建议核对原委托','核对生效费率及未终结委托','原冻结资金可核对'));
 const marksComplete=markedCount===positions.length&&num(markedValue);
 if(!marksComplete)alerts.push(issue('VALUATION_UNKNOWN','high','缺少逐股可用原始报价',account,'不确认当前权益及仓位','核对原报价门禁','全部持仓取得合规原始报价'));
 const result={account,status:'observed-unverified',revision:book.revision,checkedAt:now,day,marketOpen,continuous,originalReadValidation:true,
  completeReconciliation:false,diagnosticChecks:'order-fill-identity/lot-quantity/reservation',cash:book.account.cash,reservedCash:feesComplete?money(reservedCash):null,
  availableCash:feesComplete?money(book.account.cash-reservedCash):null,equity:marksComplete?money(book.account.cash+markedValue):null,
  positions,alerts,canTrade:false,writesAccount:false};
 result.reconciliation=reconcileAccountSnapshot(book,{tradeDate:day});
 try{result.defensive=defensiveStatus(book);}catch{result.defensive={state:'unknown',reason:'DEFENSIVE_STATE_UNAVAILABLE',originalEntryGatesRemain:true};}
 // Selecting a few live quotes must not load the historical research engine
 // into the server request path. The actual report is evaluated in the worker.
 try{result.portfolioEvidence=require('./advanced-portfolio-runtime').buildAdvancedPortfolioReport({book,diagnostic:result,account,day,now,quotes,portfolioContext,portfolioContextStatus});}
 catch{result.portfolioEvidence={status:'unknown',reason:'PORTFOLIO_EVIDENCE_UNAVAILABLE',canTrade:false,writesAccount:false,automaticSwitch:false};}
 for(const row of positions){
  const extra=result.portfolioEvidence.exits?.find(x=>x.symbol===row.symbol);
  if(!extra)continue;
  row.estimatedMarketImpact=extra.estimatedMarketImpact;row.conditionalSessions=extra.conditionalSessions;row.estimatedExitCost=extra.estimatedExitCost;
  row.conditionalSellableSessions=extra.conditionalSellableSessions??null;row.estimatedSellableExitCost=extra.estimatedSellableExitCost??null;
  row.exitEstimateQuantity=extra.exitEstimateQuantity??null;row.costReason=extra.costReason??null;
  row.historicalDailyShares=extra.historicalDailyShares;row.liquidityEvidence=extra.liquidityEvidence;row.scenarioVersion=extra.scenarioVersion;
  row.alerts=[...row.alerts.filter(a=>a.code!=='LIQUIDITY_EXIT'),...(extra.alerts||[]).filter(a=>a.code==='LIQUIDITY_EXIT')];
 }
 return result;
}
module.exports={selectAdvancedRiskQuotes,accountExitDiagnostics,unavailable};
