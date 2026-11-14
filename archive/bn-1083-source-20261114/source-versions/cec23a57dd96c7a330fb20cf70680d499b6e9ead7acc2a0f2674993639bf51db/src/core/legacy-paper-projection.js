'use strict';
const crypto=require('node:crypto');
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
 for(const [symbol,p] of Object.entries(s.account.positions)){
  if(p.quantity<=0)continue;
  const cost=money(p.lots.reduce((n,l)=>n+Number(l.cost??l.price*l.quantity),0));
  const latest=p.lots.reduce((a,l)=>l.buyDate>a?l.buyDate:a,'');
  positions[symbol]={...(original.positions[symbol]||{}),code:symbol,name:original.positions[symbol]?.name||symbol,shares:p.quantity,basis:cost,buyPrice:p.lots.reduce((n,l)=>n+l.price*l.quantity,0)/p.quantity,buyTs:Date.parse(latest+'T09:30:00+08:00')};
 }
 const trades=[...s.account.events].reverse().map(e=>({t:e.timestamp||Date.parse(e.tradeDate+'T09:30:00+08:00'),side:e.side==='buy'?'买入':'卖出',code:e.symbol,name:original.positions[e.symbol]?.name||e.symbol,price:e.price,shares:e.quantity,amount:e.gross,fee:e.fee,basis:e.costBasis,pnl:e.side==='sell'?e.realizedPnl:null,reason:e.reason||'统一订单成交',eventId:e.eventId}));
 return {...original,cash:s.account.cash,realized:money((s.legacyOpeningRealized||0)+s.account.events.reduce((n,e)=>n+Number(e.realizedPnl||0),0)),positions,trades:[...trades,...(s.legacyOpeningTrades||[])]};
}
module.exports={openingAccount,projectLegacy,hash,money};
