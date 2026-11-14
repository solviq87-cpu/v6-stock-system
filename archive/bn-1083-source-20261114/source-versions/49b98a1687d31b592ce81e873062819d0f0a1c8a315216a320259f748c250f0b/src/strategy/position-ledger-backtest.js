'use strict';
const {scanUniverse}=require('./universe-scanner');
const {atLockedLimit,limitPct}=require('./walk-forward-backtest');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const good=x=>finite(x)&&x>0;
function ledgerBacktest({stocks=[],start=27,end,initialCash=100000,topN=3,holdDays=1,
 feeBps=8,slippageBps=10,sellTaxBps=5,lotSize=100,source='imported',maxAgeMs=86400000,selectCandidates=null,strictMarks=true}={}){
 if(!Array.isArray(stocks)||!stocks.length)throw Error('需要历史K线股票池');
 if(selectCandidates!==null&&typeof selectCandidates!=='function')throw Error('选股函数必须是函数');
 if(!good(initialCash)||![feeBps,slippageBps,sellTaxBps].every(x=>finite(x)&&x>=0&&x<10000)||
  !Number.isInteger(topN)||topN<1||!Number.isInteger(holdDays)||holdDays<1||!Number.isInteger(lotSize)||lotSize<1)
  throw Error('回测参数不合法');
 const n=Math.min(...stocks.map(s=>Array.isArray(s.bars)?s.bars.length:0));
 const stop=end===undefined?n-1:Math.min(end,n-1);
 if(!Number.isInteger(start)||start<27||stop<=start)throw Error('历史数据不足');
 const byCode=new Map();
 for(const s of stocks){const code=String(s.symbol||s.code||'').trim();if(!code||byCode.has(code))throw Error('股票代码缺失或重复');byCode.set(code,s);}
 let cash=initialCash,positions=new Map(),lastMarks=new Map(),pending=[],trades=[],orders=[],equity=[],warnings=[];
 const cost=feeBps/10000,slip=slippageBps/10000,tax=sellTaxBps/10000;
 const getBar=(s,d)=>s.bars[d];
 for(let day=start;day<=stop;day++){
  // Orders are generated at previous close, filled at today's open. Sell first to free cash.
  const sells=pending.filter(o=>o.side==='sell'),buys=pending.filter(o=>o.side==='buy');
  pending=[];
  for(const o of sells){
   const p=positions.get(o.symbol);if(!p)continue;
   const s=byCode.get(o.symbol),bar=getBar(s,day),prev=getBar(s,day-1);
   const lock=atLockedLimit(bar,prev,s,'sell');
   if(!bar||bar.suspended||!good(bar.volume)||!good(bar.open)||lock.blocked){
    orders.push({day,symbol:o.symbol,side:'sell',status:'blocked',reason:lock.reason||'停牌/无成交'});
    p.sellPending=true;continue;
   }
   const price=bar.open*(1-slip),gross=price*p.shares,proceeds=gross*(1-cost-tax);
   cash+=proceeds;trades.push({symbol:o.symbol,buyDay:p.buyDay,sellDay:day,shares:p.shares,
    entry:p.entry,exit:price,netPnl:+(proceeds-p.costBasis).toFixed(2),holdingDays:day-p.buyDay});
   orders.push({day,symbol:o.symbol,side:'sell',status:'filled',shares:p.shares,price});
   positions.delete(o.symbol);
  }
  for(const o of buys){
   if(positions.has(o.symbol))continue;
   const s=byCode.get(o.symbol),bar=getBar(s,day),prev=getBar(s,day-1);
   const lock=atLockedLimit(bar,prev,s,'buy');
   if(!bar||bar.suspended||!good(bar.volume)||!good(bar.open)||lock.blocked){
    orders.push({day,symbol:o.symbol,side:'buy',status:'blocked',reason:lock.reason||'停牌/无成交'});continue;
   }
   const price=bar.open*(1+slip),allocation=Math.min(cash,o.budget);
   const shares=Math.floor(allocation/(price*(1+cost))/lotSize)*lotSize;
   if(shares<=0){orders.push({day,symbol:o.symbol,side:'buy',status:'blocked',reason:'现金不足一手'});continue;}
   const spent=shares*price*(1+cost);cash-=spent;
   positions.set(o.symbol,{symbol:o.symbol,shares,buyDay:day,entry:price,costBasis:spent,sellPending:false});
   orders.push({day,symbol:o.symbol,side:'buy',status:'filled',shares,price});
  }
  // Daily close: mark held shares even if exit is blocked. Never drop unrealized losses.
  let marked=0,unpriced=[];
  for(const [symbol,p] of positions){
   const bar=getBar(byCode.get(symbol),day);
   if(bar&&good(bar.close))lastMarks.set(symbol,bar.close);
   const mark=lastMarks.get(symbol);
   if(!good(mark)){unpriced.push(symbol);continue;}
   marked+=mark*p.shares;
   if(day>=p.buyDay+holdDays-1)p.sellPending=true;
  }
  equity.push({day,cash:+cash.toFixed(2),marketValue:+marked.toFixed(2),
   value:+(cash+marked).toFixed(2),openPositions:positions.size,unpriced});
  if(unpriced.length){warnings.push(`第${day}日持仓无法估值：${unpriced.join(',')}`);if(strictMarks)throw Error(`第${day}日持仓无法估值，拒绝计算不完整净值`);}
  if(day===stop)break;
  // Every blocked sale is retried next trading day; no overlapping buy of held names.
  for(const [symbol,p] of positions)if(p.sellPending)pending.push({side:'sell',symbol});
  // Scan at day close using only bars <= day; orders cannot execute until day+1.
  const now=Date.UTC(2020,0,1)+day*86400000;
  const input=stocks.map(s=>({...s,bars:s.bars.slice(0,day+1),feed:{source,timestamp:now}}));
  const ranked=typeof selectCandidates==='function'?selectCandidates(input,day).map(symbol=>({symbol:String(symbol)})):
   scanUniverse({stocks:input,now,maxAgeMs}).items.filter(x=>x.tradable);
  const slots=Math.max(0,topN-positions.size);
  const available=ranked.filter(x=>byCode.has(x.symbol)&&!positions.has(x.symbol)&&
   !byCode.get(x.symbol).isST&&!byCode.get(x.symbol).suspended&&byCode.get(x.symbol).tradable!==false).slice(0,slots);
  const budget=available.length?cash/available.length:0;
  for(const x of available)pending.push({side:'buy',symbol:x.symbol,budget});
 }
 let peak=initialCash,maxDD=0;for(const e of equity){peak=Math.max(peak,e.value);maxDD=Math.max(maxDD,1-e.value/peak);}
 const last=equity.at(-1);
 return {dataProvenance:{source,mode:selectCandidates?'test-selector':'strategy-scanner',syntheticOrImported:source==='imported'||source==='simulated'},
  equity,orders,trades,openPositions:[...positions.values()],cash:+cash.toFixed(2),warnings,
  metrics:{initialCash,finalEquity:last.value,returnPct:+((last.value/initialCash-1)*100).toFixed(4),
   maxDrawdownPct:+(maxDD*100).toFixed(4),closedTrades:trades.length,
   winRatePct:trades.length?+(100*trades.filter(t=>t.netPnl>0).length/trades.length).toFixed(2):null},
  assumptions:['收盘后扫描、次交易日开盘执行；买入后最早下一交易日卖出','卖出受阻继续持仓并每日按收盘价估值',
  '按整手下单；手续费、卖出印花税及双向滑点按参数计入','涨跌停按简化板块参数判断，不能替代逐日交易所规则',
  '缺少真实订单簿、成交队列、公司行为复权与准确市场日历，结果仅供研究']};
}
module.exports={ledgerBacktest};
