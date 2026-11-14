'use strict';
/** Deterministic, offline paper-account replay. Research ranking at close t executes no earlier than open t+1. */
const crypto=require('node:crypto');
const {validateDataset}=require('./historical-validation');
const {scanUniverse}=require('../strategy/universe-scanner');
const {validateRiskLimits,evaluatePreviousCloseRisk}=require('./portfolio-risk-gate');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=x=>Math.round(x*100)/100;
function replayPaperAccount(history,settings={}){
 const dataset=validateDataset(history);
 const cfg={initialCash:100000,maxPositions:3,allocationPct:0.25,feeBps:8,slippageBps:10,sellTaxBps:5,stopLossPct:0.08,startDay:31,maxDrawdownPausePct:null,maxDailyLossPausePct:null,...settings};
 if(!finite(cfg.initialCash)||cfg.initialCash<=0||!Number.isInteger(cfg.maxPositions)||cfg.maxPositions<1||cfg.maxPositions>30||!finite(cfg.allocationPct)||cfg.allocationPct<=0||cfg.allocationPct>1||!Number.isInteger(cfg.startDay)||cfg.startDay<31||cfg.startDay>=dataset.barsPerStock-1||![cfg.feeBps,cfg.slippageBps,cfg.sellTaxBps].every(x=>finite(x)&&x>=0&&x<=1000)||!finite(cfg.stopLossPct)||cfg.stopLossPct<=0||cfg.stopLossPct>=1)throw Error('模拟盘参数无效');
 validateRiskLimits(cfg);
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify(history)).digest('hex');
 const stocks=history.stocks.map(s=>({...s,symbol:String(s.symbol||s.code)}));
 const dates=stocks[0].bars.map((b,i)=>b.date||`day-${i}`);
 const positions=new Map(),orders=[],equity=[],signals=[];let cash=cfg.initialCash,peak=cash,closed=0,win=0,realized=0;let riskPauseDays=0;
 const valuation=day=>cash+[...positions.values()].reduce((sum,p)=>sum+p.qty*stocks.find(s=>s.symbol===p.symbol).bars[day].close,0);
 const fill=(s,side,day,qty,reason)=>{
  const b=s.bars[day],prev=s.bars[day-1],symbol=s.symbol;
  if(s.suspended||s.tradable===false||b.volume===0){orders.push({day:dates[day],symbol,side,status:'blocked',reason:'停牌或无成交量'});return false;}
  // Conservative limit lock detection. A one-price bar at/through limit cannot be filled.
  const limit=s.isST?0.05:(s.market==='star'||s.market==='chinext'?0.20:0.10);
  const ratio=b.open/prev.close-1;
  if(b.high===b.low&&((side==='buy'&&ratio>=limit-0.002)||(side==='sell'&&ratio<=-limit+0.002))){orders.push({day:dates[day],symbol,side,status:'blocked',reason:'涨跌停一字板'});return false;}
  const price=b.open*(1+(side==='buy'?1:-1)*cfg.slippageBps/10000);
  const gross=price*qty,fees=gross*(cfg.feeBps+(side==='sell'?cfg.sellTaxBps:0))/10000;
  if(side==='buy'){
   if(gross+fees>cash+1e-7)return false;
   cash-=gross+fees;positions.set(symbol,{symbol,qty,buyDay:day,cost:gross+fees,entry:price});
  }else{
   const p=positions.get(symbol);if(!p||p.buyDay>=day)return false;
   cash+=gross-fees;const pnl=gross-fees-p.cost;realized+=pnl;closed++;if(pnl>0)win++;positions.delete(symbol);
  }
  orders.push({day:dates[day],symbol,side,status:'filled',qty,price:round(price),fees:round(fees),reason});return true;
 };
 for(let day=cfg.startDay;day<dataset.barsPerStock;day++){
  // Only yesterday's close can generate today's orders.
  const previous=day-1,priorCloseEquity=valuation(day-1),priorClosePeak=peak,priorDayEquity=day>cfg.startDay?equity.at(-2)?.equity??cfg.initialCash:cfg.initialCash,ts=Date.parse((stocks[0].bars[previous].date||history.asOf)+'T15:00:00+08:00');
  const snapshot=stocks.map(s=>{const b=s.bars[previous],p=s.bars[previous-1];return {...s,bars:s.bars.slice(0,day),feed:{source:history.source,timestamp:ts},price:b.close,close:b.close,volume:b.volume,pctChange:(b.close/p.close-1)*100};});
  const scan=scanUniverse({stocks:snapshot,now:ts,maxAgeMs:86400000});
  const picks=scan.items.filter(x=>x.tradable).slice(0,cfg.maxPositions).map(x=>x.symbol);
  signals.push({signalDate:dates[previous],executionDate:dates[day],picks,eligible:scan.eligible});
  for(const s of stocks){const p=positions.get(s.symbol);if(!p)continue;
   const breached=s.bars[previous].close<=p.entry*(1-cfg.stopLossPct);
   if(breached||!picks.includes(s.symbol))fill(s,'sell',day,p.qty,breached?'stop-loss':'rebalance');
  }
  // Risk limits use the prior close only; today's close must never determine today's orders.
  const risk=evaluatePreviousCloseRisk({priorEquity:priorCloseEquity,priorPeak:priorClosePeak,previousEquity:priorDayEquity,...cfg});
  const pauseReasons=risk.reasons;
  if(risk.paused){riskPauseDays++;orders.push({day:dates[day],side:'buy',status:'risk-paused',reason:pauseReasons.join('；'),drawdownPct:round(risk.drawdownPct),dailyLossPct:round(risk.dailyLossPct)});}
  for(const symbol of (pauseReasons.length?[]:picks)){if(positions.size>=cfg.maxPositions)break;if(positions.has(symbol))continue;
   const s=stocks.find(x=>x.symbol===symbol),b=s.bars[day];const budget=Math.min(cash,valuation(previous)*cfg.allocationPct);
   const unit=b.open*(1+cfg.slippageBps/10000)*(1+cfg.feeBps/10000);
   const qty=Math.floor(budget/unit/100)*100;
   if(qty>=100)fill(s,'buy',day,qty,'previous-close-ranking');
  }
  const value=valuation(day);peak=Math.max(peak,value);
  equity.push({date:dates[day],cash:round(cash),positions:positions.size,equity:round(value),drawdownPct:round((peak-value)/peak*100)});
 }
 const last=equity.at(-1);const maxDrawdownPct=Math.max(0,...equity.map(x=>x.drawdownPct));
 return {schemaVersion:1,mode:'offline-paper-replay',source:history.source,verifiedLive:false,canTrade:false,dataset,fingerprint,
  config:cfg,metrics:{initialCash:cfg.initialCash,finalEquity:last.equity,returnPct:round((last.equity/cfg.initialCash-1)*100),maxDrawdownPct,closedTrades:closed,winRatePct:closed?round(win/closed*100):null,realizedPnl:round(realized),blockedOrders:orders.filter(x=>x.status==='blocked').length,riskPauseDays,openPositions:positions.size},
  positions:[...positions.values()],orders,equity,signals,
  warnings:['使用历史日线的下一交易日开盘价进行纸面撮合，不代表真实可成交','不包含盘口排队、部分成交、退市及公司行为完整对账','仅供离线研究，不构成自动交易授权']};
}
module.exports={replayPaperAccount};
