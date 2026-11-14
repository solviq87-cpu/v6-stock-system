 'use strict';
const {scanUniverse}=require('./universe-scanner');
const num=v=>typeof v==='number'&&Number.isFinite(v);
// Day d signal uses bars through d close; earliest fill is day d+1 open.
function walkForward({stocks=[],start=27,end=null,topN=3,feeBps=8,slippageBps=10,initialCash=100000,
 maxAgeMs=86400000,source='imported'}={}){
 if(!Array.isArray(stocks)||!stocks.length)throw Error('回测需要历史股票数据');
 if(!num(initialCash)||initialCash<=0||!num(feeBps)||feeBps<0||!num(slippageBps)||slippageBps<0)throw Error('非法成本参数');
 if(!Number.isInteger(topN)||topN<1)throw Error('非法候选数量');
 const length=Math.min(...stocks.map(s=>Array.isArray(s.bars)?s.bars.length:0));
 const last=Math.min(end===null?length-2:end,length-2);
 if(last<start)return {trades:[],equity:[{day:start-1,value:initialCash}],metrics:{trades:0,returnPct:0},warnings:['历史长度不足']};
 let cash=initialCash;const trades=[],equity=[{day:start-1,value:cash}];
 for(let day=start;day<=last;day++){
  const now=Date.UTC(2020,0,1)+day*86400000;
  const input=stocks.map(s=>({...s,bars:s.bars.slice(0,day+1),feed:{source,timestamp:now}}));
  const ranked=scanUniverse({stocks:input,now,maxAgeMs}).items.filter(x=>x.tradable).slice(0,topN);
  const next=day+1;
  const selected=ranked.filter(x=>{
   const s=stocks.find(s=>String(s.symbol||s.code)===x.symbol),b=s.bars[next];
   return b&&num(b.open)&&num(b.close)&&b.open>0&&b.close>0&&b.volume>0&&!b.suspended;
  });
  if(!selected.length){equity.push({day:next,value:cash});continue;}
  const allocation=cash/selected.length;let after=0;
  for(const item of selected){
   const s=stocks.find(s=>String(s.symbol||s.code)===item.symbol),b=s.bars[next];
   const buy=b.open*(1+slippageBps/10000),sell=b.close*(1-slippageBps/10000);
   const gross=allocation*(sell/buy),net=gross*(1-feeBps/10000)**2;
   trades.push({symbol:item.symbol,signalDay:day,executionDay:next,entry:buy,exit:sell,netReturnPct:+((net/allocation-1)*100).toFixed(4),score:item.score});
   after+=net;
  }
  cash=after;equity.push({day:next,value:+cash.toFixed(2)});
 }
 let peak=initialCash,maxDrawdown=0;for(const e of equity){peak=Math.max(peak,e.value);maxDrawdown=Math.max(maxDrawdown,1-e.value/peak);}
 return {trades,equity,metrics:{trades:trades.length,returnPct:+((cash/initialCash-1)*100).toFixed(4),
  maxDrawdownPct:+(maxDrawdown*100).toFixed(4),winRatePct:trades.length?+(trades.filter(t=>t.netReturnPct>0).length/trades.length*100).toFixed(2):null},
  assumptions:['仅在收盘后生成信号，下一交易日开盘买入并当日收盘卖出','不模拟涨跌停无法成交、停牌、撮合深度与真实冲击成本','仅用于流程验证，不能视为策略收益证明']};
}
module.exports={walkForward};
