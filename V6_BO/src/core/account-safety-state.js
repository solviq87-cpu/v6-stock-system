'use strict';
// Additional reconciliation of the original combined snapshot. This module has
// no persistence, account, price source, order router or independent risk policy.
const crypto=require('node:crypto');
const {tradingFees}=require('./trading-fees');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const quantity=value=>Number.isSafeInteger(value)&&value>=0;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const money=value=>Math.round((value+Number.EPSILON)*100)/100;

function openingReconciliationEvidence(account,{kind,at,sourceFingerprint}={}){
 return {version:1,kind,recordedAt:at,sourceFingerprint:sourceFingerprint||account.fingerprint,
  cash:account.cash,positions:Object.fromEntries(Object.entries(account.positions).map(([symbol,p])=>[symbol,p.quantity]))};
}
function pendingBuyOrderBudget(book,item,tradeDate=null){
 const order=item?.order,state=item?.state;
 if(!order||order.side!=='buy'||!state||typeof state.terminal!=='boolean')throw Error('待买委托冻结预算输入无效');
 if(state.terminal)return 0;
 if(!quantity(state.remainingQuantity)||!state.remainingQuantity||!day(order.tradeDate)||tradeDate!==null&&!day(tradeDate)||!Array.isArray(item.events))throw Error('待买委托冻结预算输入无效');
 // Every writer and reconciliation use the same remaining order, execution-day
 // fee schedule and original partial fills. An old order date cannot preserve
 // yesterday's minimum commission credit after the next trading day starts.
 const executionDay=tradeDate===null?order.tradeDate:[tradeDate,order.tradeDate].sort().at(-1);
 const fees=tradingFees({side:'buy',quantity:state.remainingQuantity,price:order.limitPrice,tradeDate:executionDay,
  policy:book.feePolicy,schedules:book.feeSchedules||null,priorFills:item.events.filter(event=>event?.type==='fill')});
 const budget=state.remainingQuantity*order.limitPrice+fees.total;
 if(!finite(budget)||budget<0)throw Error('待买委托冻结预算不可计算');
 return budget;
}
function reconcileAccountSnapshot(book,{tradeDate=null}={}){
 const reasons=[],restrictions=[],fail=code=>{if(!reasons.includes(code))reasons.push(code);};
 const result=()=>({mode:'original-account-reconciliation',status:reasons.length?'mismatch':restrictions.length?'restricted':'consistent',
  accountRevision:book?.revision??null,internallyConsistent:!reasons.length,
  quantityFlowVerified:!!book?.reconciliationOpening&&!reasons.length,completeExternalReconciliation:false,
  newExposureAllowed:!reasons.length&&!restrictions.length,reasonCodes:[...reasons,...restrictions],
  scope:['original-cash-and-order-validation','fill-identity-and-idempotency','lot-quantity-and-origin','pending-reservations',...(book?.reconciliationOpening?['opening-plus-fill-and-corporate-quantity-flow']:[])],
  missing:book?.reconciliationOpening?['独立外部托管或券商对账证据未接入']:['历史迁入期初数量未单独封存，不追认完整数量流水','独立外部托管或券商对账证据未接入'],
  canTrade:false,writesAccount:false});
 if(!plain(book?.account)||!plain(book.account.positions)||!Array.isArray(book.account.events)||!plain(book.orders)||!plain(book.account.eventHashes)){
  fail('INVALID_ACCOUNT_STRUCTURE');return result();
 }
 const byEvent=new Map(),fills=new Map(),corporate=new Map(),reserved=new Map();
 for(const event of book.account.events){
  if(!event||typeof event.eventId!=='string'||byEvent.has(event.eventId))fail('DUPLICATE_LEDGER_EVENT');
  else byEvent.set(event.eventId,event);
  if(!/^\d{6}$/.test(event?.symbol||'')||!['buy','sell'].includes(event?.side)||!quantity(event?.quantity)||event.quantity===0||!finite(event.price)||event.price<=0||!finite(event.fee)||event.fee<0||!day(event.tradeDate)||!finite(event.gross)||Math.abs(event.gross-money(event.quantity*event.price))>.011||!finite(event.cashAfter)||event.cashAfter<0)fail('INVALID_LEDGER_FILL');
  if(!/^[a-f0-9]{64}$/.test(book.account.eventHashes[event?.eventId]||''))fail('INVALID_IDEMPOTENCY_INDEX');
 }
 if(Object.keys(book.account.eventHashes).length!==byEvent.size)fail('INVALID_IDEMPOTENCY_INDEX');
 for(const event of book.corporateEvents||[]){
  if(!event||corporate.has(event.eventId)||byEvent.has(event.eventId)||!/^\d{6}$/.test(event.symbol||'')||!Number.isSafeInteger(event.shareDelta)||!finite(event.cashDelta)||!day(event.effectiveDate))fail('INVALID_CORPORATE_EVENT');
  else corporate.set(event.eventId,event);
 }
 let reservedCash=0;
 for(const [id,item] of Object.entries(book.orders)){
  const order=item?.order,state=item?.state;
  if(!order||id!==order.orderId||!Array.isArray(item.events)||!state||!quantity(state.remainingQuantity)||typeof state.terminal!=='boolean'){fail('INVALID_ORDER_IDENTITY');continue;}
  for(const fill of item.events.filter(event=>event.type==='fill')){
   if(fills.has(fill.eventId))fail('DUPLICATE_ORDER_FILL');
   fills.set(fill.eventId,fill);
   const event=byEvent.get(fill.eventId);
   if(!event||event.orderId!==id||fill.orderId!==id||event.symbol!==order.symbol||event.side!==order.side||event.tradeDate!==fill.date||event.quantity!==fill.quantity||event.price!==fill.price||event.fee!==fill.fee)fail('ORDER_LEDGER_FILL_MISMATCH');
   if(book.account.eventHashes[fill.eventId]!==hash({orderId:id,fill,tradeDate:fill.date}))fail('FILL_IDEMPOTENCY_HASH_MISMATCH');
  }
  if(state.terminal)continue;
  if(state.remainingQuantity===0)fail('EMPTY_NONTERMINAL_ORDER');
  // Aggregate by the string-keyed holding identity, not the raw request type.
  // Keep strict order/fill identity and historical hashes unchanged above.
  if(order.side==='sell'){const symbol=String(order.symbol);reserved.set(symbol,(reserved.get(symbol)||0)+state.remainingQuantity);}
  else if(order.side==='buy')try{
   reservedCash+=pendingBuyOrderBudget(book,item,tradeDate);
  }catch{restrictions.push('PENDING_BUY_BUDGET_UNKNOWN');}
 }
 if(fills.size!==byEvent.size)fail('ORPHAN_LEDGER_FILL');
 if(!finite(reservedCash)||reservedCash>book.account.cash+.011)restrictions.push('PENDING_CASH_RESERVATION_MISMATCH');
 for(const [symbol,position] of Object.entries(book.account.positions)){
  if(!/^\d{6}$/.test(symbol)||!quantity(position?.quantity)||!Array.isArray(position?.lots)){fail('INVALID_POSITION');continue;}
  let total=0,lotReserved=0;
  for(const lot of position.lots){
   if(!quantity(lot?.quantity)||!day(lot.buyDate)||lot.sellableDate!=null&&(!day(lot.sellableDate)||lot.sellableDate<lot.buyDate)||!quantity(lot.reserved??0)||(lot.reserved||0)>lot.quantity||!finite(lot.price)||lot.price<0||!finite(lot.cost??lot.price*lot.quantity)||(lot.cost??lot.price*lot.quantity)<0||!finite(lot.fee??0)||(lot.fee??0)<0){fail('INVALID_HOLDING_LOT');continue;}
   total+=lot.quantity;lotReserved+=lot.reserved||0;
   if(lot.sourceActionId){const source=corporate.get(lot.sourceActionId);if(!source||String(source.symbol)!==symbol||source.shareDelta<=0)fail('ORPHAN_CORPORATE_LOT');}
   else if(lot.sourceEventId!=='opening-'+symbol){const source=byEvent.get(lot.sourceEventId);if(!source||String(source.symbol)!==symbol||source.side!=='buy')fail('ORPHAN_PURCHASE_LOT');}
  }
  if(!quantity(total)||total!==position.quantity)fail('LOT_QUANTITY_MISMATCH');
  if((reserved.get(symbol)||0)>total-lotReserved)restrictions.push('PENDING_SELL_RESERVATION_MISMATCH');
 }
 for(const [symbol,amount] of reserved)if(amount>0&&!book.account.positions[symbol])restrictions.push('ORPHAN_SELL_RESERVATION');
 const opening=book.reconciliationOpening;
 if(opening!==undefined){
  if(!plain(opening)||opening.version!==1||!plain(opening.positions)||opening.cash!==book.initialCash||!finite(opening.recordedAt)||!/^[a-f0-9]{64}$/.test(opening.sourceFingerprint||''))fail('INVALID_RECONCILIATION_OPENING');
  else {
   const expected=new Map();
   for(const [symbol,count] of Object.entries(opening.positions)){if(!/^\d{6}$/.test(symbol)||!quantity(count))fail('INVALID_RECONCILIATION_OPENING');else expected.set(symbol,count);}
   for(const event of byEvent.values()){const symbol=String(event.symbol);expected.set(symbol,(expected.get(symbol)||0)+(event.side==='buy'?event.quantity:-event.quantity));}
   for(const event of corporate.values()){const symbol=String(event.symbol);expected.set(symbol,(expected.get(symbol)||0)+event.shareDelta);}
   for(const symbol of new Set([...expected.keys(),...Object.keys(book.account.positions)]))if(expected.get(symbol)!==undefined&&(expected.get(symbol)<0||expected.get(symbol)!==(book.account.positions[symbol]?.quantity||0))||expected.get(symbol)===undefined&&book.account.positions[symbol]?.quantity)fail('POSITION_QUANTITY_FLOW_MISMATCH');
  }
 }
 return {...result(),reservedCash:finite(reservedCash)?money(reservedCash):null};
}
function assertAccountReconciliation(book,options){
 const report=reconcileAccountSnapshot(book,options);
 if(!report.internallyConsistent){const error=Error('权威账户对账失败: '+report.reasonCodes.join(','));error.reasonCodes=report.reasonCodes;throw error;}
 return report;
}
function defensiveStatus(book){
 const state=book?.defensiveControl;
 if(!state)return {state:'open',version:1,reasonCodes:[],changedAt:null,releaseRequiresApproval:true,originalEntryGatesRemain:true};
 if(!plain(state)||state.version!==1||!['open','restricted'].includes(state.state)||!Array.isArray(state.events)||!state.events.length||state.events.length>1000)throw Error('防御状态完整性无效');
 let previous=null;
 for(const event of state.events){const {hash:stored,...payload}=event;if(stored!==hash(payload)||event.previousHash!==previous||!['open','restricted'].includes(event.state))throw Error('防御状态审计链无效');previous=stored;}
 const last=state.events.at(-1);
 if(last.state!==state.state)throw Error('防御状态与审计回执不一致');
 return {version:1,state:state.state,reasonCodes:last.reasonCodes,reason:last.reason,changedAt:last.at,receipt:last.hash,
  releaseRequiresApproval:true,originalEntryGatesRemain:true};
}
function appendDefensiveEvent(book,{state,reason,reasonCodes=[],at,actor='original-risk-gate',approved=false}){
 defensiveStatus(book);
 if(!['open','restricted'].includes(state)||typeof reason!=='string'||!reason.trim()||reason.length>240||!Number.isSafeInteger(at)||at<=0||typeof actor!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(actor)||!Array.isArray(reasonCodes)||reasonCodes.length>20||reasonCodes.some(x=>typeof x!=='string'||!/^[A-Z0-9_]{1,80}$/.test(x)))throw Error('防御状态输入无效');
 const events=book.defensiveControl?.events||[];
 if(events.length>=1000)throw Error('防御状态审计达到预算，请先按原备份流程归档核对');
 const payload={state,reason:reason.trim(),reasonCodes,at,actor,approved:approved===true,accountRevision:book.revision,previousHash:events.at(-1)?.hash||null};
 book.defensiveControl={version:1,state,events:[...events,{...payload,hash:hash(payload)}]};
 return book;
}
module.exports={openingReconciliationEvidence,pendingBuyOrderBudget,reconcileAccountSnapshot,assertAccountReconciliation,defensiveStatus,appendDefensiveEvent};
