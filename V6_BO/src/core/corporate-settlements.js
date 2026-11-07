'use strict';
// Explicit provider settlement statements. Fractional shares must have been
// settled into net cash by the source; prices/entitlements are never inferred.
const crypto=require('node:crypto');
const round=x=>Math.round((x+Number.EPSILON)*100)/100;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
function validateSettlement(e,{now=Date.now()}={}){
 if(!e||!['cash-dividend','share-distribution','rights-subscription','delisting-cash','fractional-cash'].includes(e.kind)||!['eventId','actionId','sourceRecordId'].every(k=>typeof e[k]==='string'&&/^[A-Za-z0-9_.:-]{1,100}$/.test(e[k]))||!/^\d{6}$/.test(e.symbol)||e.source!=='imported'||typeof e.provider!=='string'||!e.provider.trim()||!validDate(e.effectiveDate)||typeof e.publishedAt!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(e.publishedAt)||!Number.isFinite(Date.parse(e.publishedAt))||Date.parse(e.publishedAt)>now||Date.parse(e.effectiveDate+'T00:00:00+08:00')>now)throw Error('公司行为结算缺少有效来源、日期或已知证据');
 if(![e.cashDelta,e.basisDelta,e.expectedCostBasis].every(x=>typeof x==='number'&&Number.isFinite(x))||!Number.isSafeInteger(e.shareDelta)||!Number.isSafeInteger(e.expectedQuantity)||e.expectedQuantity<0||e.expectedCostBasis<0||Math.abs(e.cashDelta)>1e12||Math.abs(e.basisDelta)>1e12||Math.abs(e.shareDelta)>1e12)throw Error('公司行为结算金额、整股或期初证据无效');
 if(['cash-dividend','fractional-cash'].includes(e.kind)&&(e.cashDelta<0||e.shareDelta!==0||e.basisDelta!==0))throw Error('净现金权益不得改变股份与成本');
 if(e.kind==='share-distribution'&&(e.shareDelta<=0||e.cashDelta!==0||e.basisDelta!==0))throw Error('送转股结算必须提供正整股');
 if(e.kind==='rights-subscription'&&(e.shareDelta<=0||e.cashDelta>=0||Math.abs(e.basisDelta+e.cashDelta)>.011))throw Error('配股结算必须提供认购扣款与成本');
 if(e.kind==='delisting-cash'&&(e.shareDelta!==-e.expectedQuantity||e.expectedQuantity<=0||e.cashDelta<0||Math.abs(e.basisDelta+e.expectedCostBasis)>.011))throw Error('退市清算必须完整核销持股与成本');
 return e;
}
function applySettlement(account,e,options={}){
 validateSettlement(e,options);const before=account.positions[e.symbol]||{quantity:0,lots:[]};const basis=(before.lots||[]).reduce((n,l)=>n+Number(l.cost??l.price*l.quantity),0);
 if(before.quantity!==e.expectedQuantity||Math.abs(basis-e.expectedCostBasis)>.011)throw Error('公司行为期初持仓/成本与结算证据不一致');
 const next=JSON.parse(JSON.stringify(account));next.cash=round(next.cash+e.cashDelta);if(next.cash<0)throw Error('配股认购资金不足');
 const p=next.positions[e.symbol]||{quantity:0,lots:[],sellable:0};p.lots=p.lots||[];
 if(e.shareDelta>0){p.lots.push({buyDate:e.effectiveDate,sellableDate:e.effectiveDate,quantity:e.shareDelta,price:e.basisDelta/e.shareDelta,fee:0,cost:round(e.basisDelta),sourceActionId:e.eventId,sourceEventId:p.lots.length===1?p.lots[0].sourceEventId:null});p.quantity+=e.shareDelta;}
 if(e.shareDelta<0){p.quantity=0;p.lots=[];p.sellable=0;}
 p.sellable=p.lots.filter(l=>l.sellableDate?l.sellableDate<=e.effectiveDate:l.buyDate<e.effectiveDate).reduce((n,l)=>n+l.quantity,0);next.positions[e.symbol]=p;
 const record={...e,cashDelta:round(e.cashDelta),basisDelta:round(e.basisDelta),realizedPnl:e.kind==='delisting-cash'?round(e.cashDelta-basis):['cash-dividend','fractional-cash'].includes(e.kind)?round(e.cashDelta):0,requestHash:hash(e),verifiedExternal:false};
 return {account:next,record};
}
module.exports={validateSettlement,applySettlement};
// Research tables are account-specific settlement evidence. Different entitlement
// quantities must fail rather than be rescaled to improve a backtest result.
function applyResearchSettlements({cash,positions,events=[],day,date,quantityKey='shares',basisKey='costBasis'}){
 const flows=[],realizations=[];
 for(const e of events.filter(e=>e.effectiveDate===date)){
  const p=positions.get(e.symbol);const quantity=p?.[quantityKey]||0,basis=p?.[basisKey]||0;
  const account={cash,positions:{[e.symbol]:{quantity,lots:quantity?[{quantity,cost:basis,price:p.entry,buyDate:p.buyDate||date}]:[]}}};
  const result=applySettlement(account,e,{now:Date.parse(date+'T09:30:00+08:00')});cash=result.account.cash;const next=result.account.positions[e.symbol];
  if(next.quantity){const n={...(p||{}),symbol:e.symbol,[quantityKey]:next.quantity,[basisKey]:round(basis+e.basisDelta),entry:next.quantity===quantity&&e.basisDelta===0?p.entry:(next.quantity?(basis+e.basisDelta)/next.quantity:0),buyDay:p?.buyDay??day-1,buyDate:p?.buyDate||date,sellPending:p?.sellPending||false};positions.set(e.symbol,n);}else positions.delete(e.symbol);
  flows.push({day,symbol:e.symbol,kind:e.kind,amount:e.cashDelta,balance:cash,eventId:e.eventId,verifiedExternal:false});
  if(e.kind==='delisting-cash')realizations.push({symbol:e.symbol,buyDay:p?.buyDay,sellDay:day,shares:quantity,entry:p?.entry,exit:quantity?e.cashDelta/quantity:0,costBasis:basis,netPnl:result.record.realizedPnl,holdingDays:day-(p?.buyDay??day),execution:'provider-settlement',eventId:e.eventId});
 }
 return {cash,flows,realizations};
}
function validateSettlementTable(events,{now=Date.now()}={}){if(events==null)return;if(!Array.isArray(events)||events.length>10000)throw Error('权益结算表无效');const ids=new Set();for(const e of events){validateSettlement(e,{now});if(ids.has(e.eventId))throw Error('权益结算事件ID重复');ids.add(e.eventId);}}
module.exports.applyResearchSettlements=applyResearchSettlements;
module.exports.validateSettlementTable=validateSettlementTable;
