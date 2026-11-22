'use strict';

// Server-only bridge. Only the two existing V6 simulation ledgers are read.
// The caller owns the research lock and persists the research transaction.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {createPaperApplicationService} = require('../core/paper-application-service');
const {executionTimeOf} = require('../core/paper-fill-evidence');

const CN = 8 * 3600000;
const money = n => Math.round((n + Number.EPSILON) * 100);
const preciseMoney = n => Number.isFinite(n) && Number.isSafeInteger(money(n)) && Math.abs(n * 100 - money(n)) < .0001;
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const wall = n => new Date(n + CN).toISOString().slice(0,16);
const source = 'V6 模拟成交';

function verifiedFill(book, e, now) {
  const entry = book.orders[e.orderId];
  const fill = entry?.events.find(f => f.type === 'fill' && f.eventId === e.eventId);
  if (!fill || book.account.eventHashes?.[e.eventId] !== digest({orderId:e.orderId,fill,tradeDate:e.tradeDate}) ||
      entry.order.symbol !== e.symbol || entry.order.side !== e.side ||
      entry.order.orderId !== e.orderId || fill.quantity !== e.quantity || fill.price !== e.price ||
      fill.fee !== e.fee || fill.date !== e.tradeDate || !preciseMoney(e.fee) || e.fee < 0 ||
      !Number.isFinite(e.price) || e.price <= 0 || !preciseMoney(e.gross) || e.gross <= 0 ||
      money(e.price * e.quantity) !== money(e.gross)) return null;
  const time = executionTimeOf(e);
  if (!time || time > now || executionTimeOf({...fill,symbol:e.symbol}) !== time ||
      digest(e.fillEvidence || null) !== digest(fill.fillEvidence || null)) return null;
  return {time, strategy:entry.order.strategyId || ''};
}

function closedSample(accountId, sell, legs, sellTime, observed, names) {
  const basis = legs.reduce((s,l) => s+l.costCents,0);
  const gross = legs.reduce((s,l) => s+l.grossCents,0);
  const quantity = legs.reduce((s,l) => s+l.quantity,0);
  const fee = money(sell.fee), net = money(sell.gross) - fee - basis;
  if (!basis || quantity !== sell.quantity || !preciseMoney(sell.costBasis) ||
      money(sell.costBasis)!==basis || !preciseMoney(sell.realizedPnl) ||
      money(sell.realizedPnl)!==net || gross > basis ||
      legs.some(l=>l.time>=sellTime || wall(l.time).slice(0,10)>=sell.tradeDate)) return null;
  const entryTime=wall(Math.min(...legs.map(l=>l.time))), exitTime=wall(sellTime);
  const strategies=[...new Set(legs.map(l=>l.strategy).filter(Boolean))];
  const provenance={
    accountId,symbol:sell.symbol,exitEventId:sell.eventId,exitOrderId:sell.orderId,exitTimestamp:sellTime,
    exitQuantity:sell.quantity,exitPrice:sell.price,tradeDate:sell.tradeDate,
    exitGrossCents:money(sell.gross),exitFeeCents:fee,costBasisCents:basis,
    realizedCents:net,entryFills:legs
  };
  const id='paper-'+digest([accountId,sell.eventId]);
  const cause='成交事实可核对，缺少事前冻结的研究计划';
  return {
    id,source,sourceSet:'模拟成交',code:sell.symbol,name:names.get(sell.symbol)||sell.symbol,
    entryTime,exitTime,date:entryTime.slice(0,10),exitDate:sell.tradeDate,
    holdDays:Math.round((Date.parse(sell.tradeDate)-Date.parse(entryTime.slice(0,10)))/86400000),
    shares:quantity,entryPrice:gross/100/quantity,exitPrice:sell.price,
    cost:(basis-gross+fee)/100,costBasis:basis/100,pnlAmount:net/100,
    pnl:Math.round(net/basis*10000)/100,position:null,
    strategy:strategies.length?strategies.join('、'):'未判定',strategies,
    trend:'未判定',factors:[],knownRiskFactors:[],labels:{sourceSet:'V6 模拟成交',overnight:'是'},
    frozenLabels:{},planId:null,planStatus:'历史补录',snapshotVerified:false,
    exitReason:sell.reason||'模拟卖出成交',attribution:'未判定',quality:'模拟结算样本',
    repeatable:null,blackSwan:null,reviewable:false,violations:[],
    disciplineFacts:['追高','超仓','违反止损','计划外交易','过早离场'].map(rule=>({rule,status:'资料不足',evidence:cause})),
    paperSettlement:provenance,sourceFingerprint:digest(provenance),createdAt:new Date(observed).toISOString()
  };
}

// Rebuild FIFO exactly at the ledger's cent precision. Unknown opening lots,
// corporate entitlements and date-only fills consume volume but cannot supply
// an invented entry time or cost. Subsequent independently closed lots remain usable.
function projectSymbol(book, accountId, symbol, fills, actions, now, report, names) {
  const finalQuantity=book.account.positions[symbol]?.quantity??0;
  const sellCount=fills.filter(e=>e.side==='sell').length;
  const validQty=e=>Number.isSafeInteger(e.quantity)&&e.quantity>0&&['buy','sell'].includes(e.side);
  if (!/^\d{6}$/.test(symbol) || !fills.every(validQty) || !Number.isSafeInteger(finalQuantity) ||
      finalQuantity<0 || !actions.every(e=>Number.isSafeInteger(e.shareDelta)&&Number.isSafeInteger(e.accountRevision)) ||
      (actions.length && !fills.every(e=>Number.isSafeInteger(e.accountRevision)))) {
    report.skipped+=sellCount;return [];
  }
  const filled=fills.reduce((n,e)=>n+(e.side==='buy'?e.quantity:-e.quantity),0);
  let balance=finalQuantity-filled-actions.reduce((n,e)=>n+e.shareDelta,0);
  if (!Number.isSafeInteger(balance)||balance<0) {report.skipped+=sellCount;return [];}
  const lots=balance?[{quantity:balance}]:[],out=[];
  const sequence=[...fills,...actions].sort((a,b)=>(a.accountRevision||0)-(b.accountRevision||0));
  for(const e of sequence){
    if(e.kind){
      // Preserve unverified entitlement economics as unknown lots until cleared.
      balance+=e.shareDelta;
      if(balance<0){report.skipped+=sellCount;return [];}
      lots.length=0;if(balance)lots.push({quantity:balance});continue;
    }
    const fact=verifiedFill(book,e,now);
    if(e.side==='buy'){
      balance+=e.quantity;
      const lot={quantity:e.quantity};
      if(fact)Object.assign(lot,{eventId:e.eventId,orderId:e.orderId,...fact,price:e.price,
        grossCents:money(e.gross),costCents:money(e.gross)+money(e.fee)});
      lots.push(lot);continue;
    }
    balance-=e.quantity;
    if(balance<0){report.skipped+=sellCount;return [];}
    let remaining=e.quantity,complete=Boolean(fact);
    const legs=[];
    while(remaining&&lots.length){
      const lot=lots[0],quantity=Math.min(lot.quantity,remaining);
      if(lot.eventId){
        const grossCents=Math.round(lot.grossCents*quantity/lot.quantity);
        const costCents=Math.round(lot.costCents*quantity/lot.quantity);
        legs.push({eventId:lot.eventId,orderId:lot.orderId,time:lot.time,price:lot.price,
          strategy:lot.strategy,quantity,grossCents,costCents});
        lot.grossCents-=grossCents;lot.costCents-=costCents;
      } else complete=false;
      lot.quantity-=quantity;remaining-=quantity;
      if(!lot.quantity)lots.shift();
    }
    const trade=complete&&!remaining?closedSample(accountId,e,legs,fact.time,now,names):null;
    if(trade)out.push(trade);else report.skipped++;
  }
  return out;
}

function accountSamples(book,key,now,report){
  const result=[];
  for(const period of [...(book.archives||[]),book]){
    const ledger=period.account;
    if(!ledger||!period.orders||ledger.fingerprint!==digest({cash:ledger.cash,positions:ledger.positions,events:ledger.events}))throw Error('结算存档校验失败');
    const seen=new Set(),groups=new Map(),actions=new Map(),names=new Map();
    for(const t of period.legacy?.trades||[])if(t.name&&t.name!==t.code)names.set(t.code,t.name);
    for(const e of ledger.events){
      if(!e.eventId||seen.has(e.eventId))throw Error('重复或缺失成交编号');
      seen.add(e.eventId);
      if(!groups.has(e.symbol))groups.set(e.symbol,[]);
      groups.get(e.symbol).push(e);
    }
    for(const e of period.corporateEvents||[]){
      if(!actions.has(e.symbol))actions.set(e.symbol,[]);
      actions.get(e.symbol).push(e);
    }
    for(const [symbol,rows] of groups)result.push(...projectSymbol(period,key,symbol,rows,actions.get(symbol)||[],now,report,names));
  }
  return result;
}

function importSettledPaperTrades(state,{accountDir=process.env.V6_ORDER_ACCOUNTS_DIR||path.resolve(__dirname,'../../data/order-accounts'),now=Date.now()}={}){
  const report={imported:0,existing:0,skipped:0,missing:0,issues:[],exitDays:[]};
  const records=new Map(state.trades.map(t=>[t.id,t])),days=new Set();
  for(const key of ['pool','pre']){
    const file=path.join(accountDir,key+'.json');
    let samples;
    try{
      fs.lstatSync(file); // No constructors or directory creation for absent accounts.
      const book=createPaperApplicationService({file}).read();
      if(book.paperOnly!==true||book.brokerConnected!==false)throw Error('模拟账本身份无效');
      samples=accountSamples(book,key,now,report);
    }catch(e){
      if(e.code==='ENOENT'){report.missing++;continue;}
      report.issues.push(key+' 模拟账本未通过完整性核对');continue;
    }
    for(const sample of samples){
      const old=records.get(sample.id);
      if(old){
        if(old.source===source&&old.sourceFingerprint===sample.sourceFingerprint)report.existing++;
        else{report.skipped++;report.issues.push(key+' 成交编号对应的归档内容冲突');}
        continue;
      }
      state.trades.push(sample);records.set(sample.id,sample);days.add(sample.exitDate);report.imported++;
    }
  }
  report.exitDays=[...days].sort();
  if(report.skipped)report.issues.push('部分模拟成交的开仓批次、成交时间或净成本无法完整核对');
  return report;
}
module.exports={importSettledPaperTrades};
