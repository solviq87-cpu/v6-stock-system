'use strict';
const {scanUniverse}=require('./universe-scanner');
const {validateHistoricalBars}=require('./feed-quality');
const {atLockedLimit:openingLimit,limitPct:historicalLimitPct}=require('./historical-session');
const num=v=>typeof v==='number'&&Number.isFinite(v);
const LIMITS={main:10,chinext:20,star:20,bse:30};
function limitPct(stock){
 if(stock.isST)return 5;
 if(num(stock.limitPct)&&stock.limitPct>0&&stock.limitPct<=100)return stock.limitPct;
 return LIMITS[stock.market]??null;
}
function atLockedLimit(bar,prior,stock,side){
 const limit=limitPct(stock);
 if(!num(limit)||!prior||!num(prior.close)||prior.close<=0)return {blocked:true,reason:'缺少涨跌停制度或前收盘价'};
 if(!bar||![bar.open,bar.high,bar.low,bar.close].every(num))return {blocked:true,reason:'当日OHLC无效'};
 const pct=side==='buy'?limit:-limit;
 const boundary=prior.close*(1+pct/100);
 const price=side==='buy'?bar.open:bar.open;
 const locked=side==='buy'?(price>=boundary-.011&&bar.low>=boundary-.011):(price<=boundary+.011&&bar.high<=boundary+.011);
 return {blocked:locked,reason:locked?(side==='buy'?'一字涨停无法买入':'一字跌停无法卖出'):null};
}
function legacyWalkForward({stocks=[],start=27,end=null,topN=3,feeBps=8,slippageBps=10,initialCash=100000,
 maxAgeMs=86400000,source='imported',holdDays=1,feeSchedules=null,riskPolicy=null,universeHistory=null,settlements=null}={}){
 if(!Array.isArray(stocks)||!stocks.length)throw Error('回测需要历史股票数据');
 if(feeSchedules||riskPolicy||universeHistory||settlements)return require('./walk-forward-policy-adapter').walkForwardWithPolicy({stocks,start,end,topN,feeBps,slippageBps,initialCash,maxAgeMs,source,holdDays,feeSchedules,riskPolicy,universeHistory,settlements});
 if(!num(initialCash)||initialCash<=0||!num(feeBps)||feeBps<0||!num(slippageBps)||slippageBps<0)throw Error('非法成本参数');
 if(!Number.isInteger(topN)||topN<1||!Number.isInteger(holdDays)||holdDays<1)throw Error('非法回测参数');
 const length=Math.min(...stocks.map(s=>Array.isArray(s.bars)?s.bars.length:0));
 // 信号 d 收盘；d+1 开盘买入；最早 d+2 开盘卖出（买入次日）。
 const last=Math.min(end===null?length-2-holdDays:end,length-2-holdDays);
 const maxUsed=Math.max(0,Math.min(length-1,last+1+holdDays));
 for(const stock of stocks){const q=validateHistoricalBars(stock?.bars?.slice(0,maxUsed+1));if(!q.usable)throw Error(`历史行情质量门禁拒绝 ${stock?.symbol||stock?.code||'unknown'}: ${q.errors.join('；')}`);}
 if(last<start)return {trades:[],equity:[{day:start-1,value:initialCash}],metrics:{trades:0,returnPct:0},warnings:['历史长度不足']};
 let cash=initialCash;const trades=[],skipped=[],equity=[{day:start-1,value:cash}];
 for(let day=start;day<=last;day+=holdDays+1){
  const now=Date.UTC(2020,0,1)+day*86400000;
  const input=stocks.map(s=>({...s,bars:s.bars.slice(0,day+1),feed:{source,timestamp:now}}));
  const ranked=scanUniverse({stocks:input,now,maxAgeMs}).items.filter(x=>x.tradable).slice(0,topN);
  const buyDay=day+1,sellDay=buyDay+holdDays;
  const selected=[];
  for(const item of ranked){
   const s=stocks.find(s=>String(s.symbol||s.code)===item.symbol);
   const entry=s.bars[buyDay],exit=s.bars[sellDay];
   const entryLimit=atLockedLimit(entry,s.bars[day],s,'buy');
   if(entryLimit.blocked||!entry||!num(entry.open)||entry.open<=0||entry.volume<=0||entry.suspended){
    skipped.push({symbol:item.symbol,signalDay:day,reason:entryLimit.reason||'买入日停牌或无有效成交'});continue;
   }
   if(!exit||!num(exit.open)||exit.open<=0||exit.volume<=0||exit.suspended){
    skipped.push({symbol:item.symbol,signalDay:day,reason:'卖出日停牌或无有效成交'});continue;
   }
   const exitLimit=atLockedLimit(exit,s.bars[sellDay-1],s,'sell');
   if(exitLimit.blocked){
    skipped.push({symbol:item.symbol,signalDay:day,reason:exitLimit.reason+'；不计入已实现收益'});continue;
   }
   selected.push({item,entry,exit});
  }
  if(!selected.length){equity.push({day:sellDay,value:cash});continue;}
  const allocation=cash/selected.length;let after=0;
  for(const {item,entry,exit} of selected){
   const buy=entry.open*(1+slippageBps/10000),sell=exit.open*(1-slippageBps/10000);
   const net=allocation*(sell/buy)*(1-feeBps/10000)**2;
   trades.push({symbol:item.symbol,signalDay:day,buyDay,sellDay,entry:buy,exit:sell,
    netReturnPct:+((net/allocation-1)*100).toFixed(4),score:item.score});
   after+=net;
  }
  cash=after;equity.push({day:sellDay,value:+cash.toFixed(2)});
 }
 let peak=initialCash,maxDrawdown=0;for(const e of equity){peak=Math.max(peak,e.value);maxDrawdown=Math.max(maxDrawdown,1-e.value/peak);}
 return {researchOnly:true,canTrade:false,executionModel:'legacy-simplified',trades,skipped,equity,
  warnings:['显式旧版兼容结果：跳过卖出受阻样本，不得作为逐日账本净收益或回撤验收'],
  metrics:{trades:trades.length,returnPct:+((cash/initialCash-1)*100).toFixed(4),
  maxDrawdownPct:+(maxDrawdown*100).toFixed(4),winRatePct:trades.length?+(trades.filter(t=>t.netReturnPct>0).length/trades.length*100).toFixed(2):null},
  assumptions:['信号日收盘后生成；次日开盘买入；买入后至少下一交易日开盘卖出，符合T+1最低持有日约束',
  '一字涨停买入、一字跌停卖出及未知涨跌停制度跳过，不能保证其他涨跌停状态可成交',
  '跳过卖出受阻样本可能产生幸存者偏差；不模拟延迟卖出和逐日持仓盯市，收益仅供流程研究',
  '未模拟订单簿、真实冲击成本、复权制度变化及完整交易所撮合']};
}
// General callers get the original scanner with a position ledger. Retain the
// old simplified algorithm only under an explicitly named compatibility API.
function walkForward(options={}){
 const {start=27,holdDays=1,initialCash=100000}=options;
 const result=require('./walk-forward-policy-adapter').walkForwardWithPolicy({
  ...options,lotSize:options.lotSize??1,sellTaxBps:options.sellTaxBps??0});
 const stride=holdDays+1,dailyEquity=result.equity;
 return {...result,researchOnly:true,canTrade:false,executionModel:'daily-position-ledger',
  dataProvenance:{...result.dataProvenance,mode:'strategy-scanner'},dailyEquity,
  equity:[{day:start-1,value:initialCash},...dailyEquity.filter(e=>e.day>start&&(e.day-start)%stride===0)],
  openPositions:result.openPositions||[],orders:result.orders||[],skipped:result.skipped||[],
  assumptions:[...(result.assumptions||[]),'默认逐日保留卖出受阻持仓，减少丢弃亏损样本的幸存者偏差；未认证真实历史成分完整性']};
}
module.exports={walkForward,legacyWalkForward,atLockedLimit:openingLimit,limitPct:historicalLimitPct};
