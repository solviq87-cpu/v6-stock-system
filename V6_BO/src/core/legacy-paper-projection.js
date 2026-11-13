'use strict';
const crypto=require('node:crypto');
const {fillEvidenceOf,executionTimeOf}=require('./paper-fill-evidence');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const money=x=>Math.round(x*100)/100;
function openingAccount(legacy){
 if(!legacy||!Number.isFinite(legacy.cash)||legacy.cash<0||!legacy.positions||!Array.isArray(legacy.trades))throw Error('历史账户结构无效');
 const positions={};
 for(const [symbol,p] of Object.entries(legacy.positions)){
  if(!/^\d{6}$/.test(symbol)||!Number.isSafeInteger(p.shares)||p.shares<=0||!Number.isFinite(p.buyTs)||p.buyTs<=0||!Number.isFinite(p.buyPrice)||p.buyPrice<=0)throw Error('历史持仓缺少可靠数量、价格或日期');
  const date=require('./a-share-calendar').aShareCalendarDate(p.buyTs),cost=Number.isFinite(p.basis)?p.basis:money(p.shares*p.buyPrice);
  positions[symbol]={quantity:p.shares,sellable:0,lots:[{buyDate:date,quantity:p.shares,price:p.buyPrice,cost,fee:Math.max(0,money(cost-p.shares*p.buyPrice)),sourceEventId:'opening-'+symbol}]};
 }
 const account={schemaVersion:1,cash:legacy.cash,positions,events:[],eventHashes:{}};account.fingerprint=hash({cash:account.cash,positions,events:[]});return account;
}
function projectLegacy(s){
 if(!s.legacy)return null;
 const original=s.legacy,positions={};
 const eventById=new Map(s.account.events.map(e=>[e.eventId,e]));
 for(const [symbol,p] of Object.entries(s.account.positions)){
  if(p.quantity<=0)continue;
  const cost=money(p.lots.reduce((n,l)=>n+Number(l.cost??l.price*l.quantity),0));
  const latest=p.lots.reduce((a,l)=>l.buyDate>a?l.buyDate:a,'');
  const latestLots=p.lots.filter(l=>l.buyDate===latest),times=latestLots.map(l=>{
   const event=eventById.get(l.sourceEventId),known=event&&executionTimeOf(event);
   if(known)return known;
   const old=original.positions[symbol]?.buyTs;
   return String(l.sourceEventId).startsWith('opening-')&&Number.isSafeInteger(old)&&old>0&&require('./a-share-calendar').aShareCalendarDate(old)===latest?old:null;
  });
  const buyTs=times.length&&times.every(t=>t!==null)?Math.max(...times):null;
  positions[symbol]={...(original.positions[symbol]||{}),code:symbol,name:original.positions[symbol]?.name||symbol,shares:p.quantity,basis:cost,buyPrice:p.lots.reduce((n,l)=>n+l.price*l.quantity,0)/p.quantity,buyDate:latest,buyTs,buyTimeQuality:buyTs===null?'date-only':'known'};
 }
 const trades=[...s.account.events].reverse().map(e=>{
  const t=executionTimeOf(e),fillEvidence=fillEvidenceOf(e);
  return {t,tradeDate:e.tradeDate,timeQuality:t===null?'date-only':'known',side:e.side==='buy'?'买入':'卖出',code:e.symbol,name:original.positions[e.symbol]?.name||e.symbol,price:e.price,shares:e.quantity,amount:e.gross,fee:e.fee,basis:e.costBasis,pnl:e.side==='sell'?e.realizedPnl:null,reason:e.reason||'统一订单成交',eventId:e.eventId,orderId:e.orderId||null,...(fillEvidence?{fillEvidence:JSON.parse(JSON.stringify(fillEvidence))}:{} )};
 });
 return {...original,cash:s.account.cash,realized:money((s.legacyOpeningRealized||0)+s.account.events.reduce((n,e)=>n+Number(e.realizedPnl||0),0)),positions,trades:[...trades,...(s.legacyOpeningTrades||[])]};
}
module.exports={openingAccount,projectLegacy,hash,money};
