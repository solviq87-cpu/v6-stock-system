'use strict';
// A-share research-only pattern library: isolated from live signal weights and orders.
// All thresholds are hypotheses to be tested out of sample, not promises of returns.
const {validateHistoricalBars}=require('./feed-quality');
const mean=(values)=>values.reduce((a,b)=>a+b,0)/values.length;
const avg=(rows,key,start,end)=>mean(rows.slice(start,end).map(x=>x[key]));
const isBar=b=>b&&[b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)&&b.low>0&&b.volume>=0;
function detectPatterns(stock={}){
 const bars=stock.bars,checks=[],symbol=String(stock.symbol||stock.code||'');
 const record=(id,label,side,pool,history,passed,detail,available=true)=>{
  checks.push({id,label,side,pool,status:available?(passed?'matched':'not_matched'):'insufficient_data',
   detail,requiredBars:history});
 };
 if(!Array.isArray(bars)||bars.length<3||!bars.every(isBar)){
  return {symbol,usable:false,positiveCount:0,riskCount:0,confluencePoints:0,matched:[],
   checks:[],reason:'缺少有效OHLCV历史K线'};
 }
 const quality=validateHistoricalBars(bars);
 if(!quality.usable){
  return {symbol,usable:false,positiveCount:0,riskCount:0,confluencePoints:0,matched:[],
   checks:[],reason:quality.errors.join('；')};
 }
 const n=bars.length, last=bars[n-1],prev=bars[n-2];
 const enough=k=>n>=k;
 const body=b=>Math.abs(b.close-b.open);
 const candleRange=b=>b.high-b.low;
 const lower=b=>Math.min(b.open,b.close)-b.low;
 const upper=b=>b.high-Math.max(b.open,b.close);
 const up=b=>b.close>b.open&&candleRange(b)>0;
 const down=b=>b.close<b.open&&candleRange(b)>0;
 const bodyFraction=b=>candleRange(b)>0?body(b)/candleRange(b):0;
 const ma=(period,end=n)=>enough(period)&&end>=period?avg(bars,'close',end-period,end):null;
 const vol=(period,end=n)=>enough(period)&&end>=period?avg(bars,'volume',end-period,end):null;
 const ma5=ma(5),ma20=ma(20),ma5Prev=ma(5,n-1),ma20Prev=ma(20,n-1),vol20=vol(20,n-1);
 const maxHigh=(count,end=n)=>Math.max(...bars.slice(end-count,end).map(b=>b.high));
 const minLow=(count,end=n)=>Math.min(...bars.slice(end-count,end).map(b=>b.low));
 const amountOk=Number.isFinite(last.amount)&&last.amount>=100000000;
 const p3=bars.slice(-3),p1=p3[0],p2=p3[1],p3last=p3[2];
 const soldiers=p3.every(b=>up(b)&&bodyFraction(b)>=.45&&upper(b)<=Math.max(body(b)*.7,.001))&&
  p1.close<p2.close&&p2.close<p3last.close&&p1.low<=p2.low&&p2.low<=p3last.low;
 const crows=p3.every(b=>down(b)&&bodyFraction(b)>=.45&&lower(b)<=Math.max(body(b)*.7,.001))&&
  p1.close>p2.close&&p2.close>p3last.close&&p1.high>=p2.high&&p2.high>=p3last.high;
 record('red_three_soldiers','红三兵','bullish','K线看涨池',3,soldiers,'连续三根有实体的阳线，收盘和低点抬高；不保证见底');
 record('three_black_crows','三只乌鸦','bearish','形态风险池',3,crows,'连续三根较强阴线，收盘和高点降低');
 record('bullish_engulfing','看涨吞没','bullish','K线看涨池',2,down(prev)&&up(last)&&
  last.open<=prev.close&&last.close>=prev.open&&bodyFraction(last)>=.5,'前阴后阳，后者实体包住前者实体');
 record('bearish_engulfing','看跌吞没','bearish','形态风险池',2,up(prev)&&down(last)&&
  last.open>=prev.close&&last.close<=prev.open&&bodyFraction(last)>=.5,'前阳后阴，后者实体包住前者实体');
 const hammer=candleRange(last)>0&&bodyFraction(last)<=.35&&lower(last)>=Math.max(body(last)*2,.001)&&upper(last)<=Math.max(body(last),.001);
 const star=candleRange(last)>0&&bodyFraction(last)<=.35&&upper(last)>=Math.max(body(last)*2,.001)&&lower(last)<=Math.max(body(last),.001);
 const priorDown=enough(7)&&bars[n-2].close<bars[n-7].close;
 const priorUp=enough(7)&&bars[n-2].close>bars[n-7].close;
 record('hammer_rebound','下跌后锤头线','bullish','K线看涨池',7,hammer&&priorDown,'此前下行，末根下影线至少是实体两倍；需后续确认',enough(7));
 record('shooting_star','上涨后射击之星','bearish','形态风险池',7,star&&priorUp,'此前上行，末根上影线至少是实体两倍',enough(7));
 const morning=down(p1)&&bodyFraction(p1)>=.45&&body(p2)<=body(p1)*.5&&
  up(p3last)&&p3last.close>(p1.open+p1.close)/2;
 const evening=up(p1)&&bodyFraction(p1)>=.45&&body(p2)<=body(p1)*.5&&
  down(p3last)&&p3last.close<(p1.open+p1.close)/2;
 record('morning_star','早晨之星','bullish','K线看涨池',3,morning,'长阴、短实体、长阳收复首日实体中点');
 record('evening_star','黄昏之星','bearish','形态风险池',3,evening,'长阳、短实体、长阴跌破首日实体中点');
 const volReady=enough(21)&&vol20>0;
 const cross=volReady&&ma5Prev!==null&&ma20Prev!==null&&ma5Prev<=ma20Prev&&ma5>ma20;
 record('ma5_ma20_volume','MA5/MA20金叉放量','bullish','强势启动池',21,cross&&last.volume>=1.5*vol20,
  'MA5由下上穿MA20，当前量≥前20日均量1.5倍',enough(21)&&vol20>0);
 record('breakout20_liquid','20日新高放量突破','bullish','强势启动池',21,
  enough(21)&&volReady&&last.close>maxHigh(20,n-1)&&up(last)&&last.close>prev.close&&amountOk&&last.volume>=1.5*vol20,
  '收盘突破此前20日最高价，阳线、上行、量≥1.5倍、成交额≥1亿元',enough(21)&&vol20>0&&Number.isFinite(last.amount));
 const flagReady=enough(40)&&volReady;
 const high40=flagReady?maxHigh(40):null,low40=flagReady?minLow(40):null;
 const high10=flagReady?maxHigh(10):null,low10=flagReady?minLow(10):null;
 record('high_tight_flag','高位旗形缩量整理','bullish','趋势整理池',40,
  flagReady&&low40>0&&low10>0&&high40/low40>1.6&&high10/low10<1.15&&low10>=high40*.8&&last.volume<vol20*.6,
  '40日高低比>1.6；10日高低比<1.15；整理低点≥40日高点80%；当日量<前20日均量60%',flagReady&&low40>0&&low10>0);
 const close20=enough(21)?bars[n-21].close:NaN;
 const ma50=ma(50);
 record('momentum20_above_ma50','20日动量强于50日线','bullish','强势启动池',50,
  enough(50)&&close20>0&&last.close/close20>=1.05&&last.close>ma50,
  '20日涨幅≥5%，收盘价在MA50之上',enough(50)&&close20>0);
 const prev20low=enough(21)?minLow(20,n-1):null;
 record('breakdown20_volume','20日低点放量破位','bearish','形态风险池',21,
  volReady&&last.close<prev20low&&last.volume>=1.5*vol20,
  '收盘跌破此前20日低点，量≥前20日均量1.5倍',volReady);
 record('heavy_distribution','放量长阴','bearish','形态风险池',21,
  volReady&&last.close<=prev.close*.97&&down(last)&&last.volume>=2*vol20,
  '当日跌幅≥3%，阴线且成交量≥前20日均量2倍',volReady);
 record('ma5_ma20_death_cross','MA5/MA20死叉','bearish','形态风险池',21,
  volReady&&ma5Prev>=ma20Prev&&ma5<ma20,'MA5由上向下跌破MA20',enough(21));
 // Main-board 10% is NOT a universal A-share limit. Other boards / ST / IPO exemptions
 // require exchange-specific evidence and are not guessed from a price ratio.
 const board=String(stock.market||'').toLowerCase();
 const mainBoard=board==='main'&&stock.isST!==true&&stock.noPriceLimit!==true&&
  stock.ipoNoLimit!==true&&stock.limitPct===10;
 record('limit_up_shakeout_main','主板涨停后洗盘候选','bullish','短线热点池',3,
  mainBoard&&bars[n-2].close>=bars[n-3].close*1.095&&down(last)&&
  bars[n-2].volume>0&&last.volume>=2*bars[n-2].volume&&last.low>=bars[n-2].close,
  '仅限明确10%涨跌幅主板；昨近涨停、今放量阴线且未破昨收',
  enough(3)&&mainBoard&&bars[n-2].volume>0);
 // Support/rebound: a conservative, independently testable variant rather than a
 // transcription of a dynamic intraday support formula.
 let atr=null,rsi=null;
 if(enough(21)){
  const tr=[];
  for(let i=n-14;i<n;i++){
   const b=bars[i],c=bars[i-1].close;
   tr.push(Math.max(b.high-b.low,Math.abs(b.high-c),Math.abs(b.low-c)));
  }
  atr=mean(tr);
  let gains=0,losses=0;
  for(let i=n-14;i<n;i++){const d=bars[i].close-bars[i-1].close;gains+=Math.max(0,d);losses+=Math.max(0,-d);}
  rsi=losses===0?(gains===0?50:100):100-100/(1+gains/losses);
 }
 record('support_stabilization','缩量支撑企稳候选','bullish','趋势整理池',21,
  enough(21)&&atr>0&&maxHigh(20)-last.close>=2*atr&&rsi>=30&&rsi<=55&&
  last.volume<=vol20*.7&&last.low>=minLow(10)*.96&&up(last),
  '阶段高点回落≥2ATR14、RSI在30~55、缩量≤70%、未明显新低、收阳确认',
  enough(21)&&atr>0&&vol20>0);
 const matched=checks.filter(x=>x.status==='matched');
 const positives=matched.filter(x=>x.side==='bullish'),risks=matched.filter(x=>x.side==='bearish');
 return {symbol,usable:true,positiveCount:positives.length,riskCount:risks.length,
  confluencePoints:Math.min(100,positives.length*5),matched,checks,
  note:'独立研究分，仅表示匹配条件数；未经收益率校准，不加入V6正式总分'};
}
function attachRps(stocks,items,{period=120,minUniverse=10}={}){
 const byDate=new Map(),index=new Map();
 for(const stock of stocks){
  const code=String(stock?.symbol||stock?.code||'').trim();
  const item=items.find(x=>x.symbol===code&&x.quality.usable&&x.patterns?.usable);
  const bars=stock?.bars;
  if(!item||!Array.isArray(bars)||bars.length<=period||stock.isST||stock.suspended)continue;
  const last=bars.at(-1),before=bars[bars.length-1-period];
  if(!last?.date||!Number.isFinite(last.close)||!Number.isFinite(before.close)||before.close<=0)continue;
  const rows=byDate.get(last.date)||[];
  const max=Math.max(...bars.slice(-period).map(b=>b.high));
  rows.push({item,ret:last.close/before.close-1,close:last.close,max});
  byDate.set(last.date,rows);index.set(code,item);
 }
 for(const rows of byDate.values()){
  if(rows.length<minUniverse)continue;
  rows.sort((a,b)=>a.ret-b.ret||a.item.symbol.localeCompare(b.item.symbol));
  for(let i=0;i<rows.length;i++){
   const row=rows[i],pct=+(100*(i+1)/rows.length).toFixed(2);
   row.item.patterns.rps120=pct;
   if(pct<90||row.close<row.max*.9)continue;
   const signal={id:'rps120_breakout',label:'RPS120强势接近新高',side:'bullish',pool:'强势启动池',
    status:'matched',detail:'120日涨幅横向排名前10%，收盘价≥120日最高价的90%，RPS='+pct,
    requiredBars:121};
   row.item.patterns.checks.push(signal);row.item.patterns.matched.push(signal);
   row.item.patterns.positiveCount++;row.item.patterns.confluencePoints=Math.min(100,row.item.patterns.positiveCount*5);
  }
 }
}
function buildPatternPools(items=[]){
 const pools={};
 for(const item of items){
  if(!item.quality?.usable||!item.quality?.fresh||!item.patterns?.usable)continue;
  for(const sig of item.patterns.matched){
   // Risk pattern matches may be displayed even on blocked stocks; bullish
   // matches are NOT promoted into pools on ST, suspended or blocked stocks.
   if(sig.side==='bullish'&&(item.blockedBySafety||item.quality.simulated))continue;
   const list=pools[sig.pool]||(pools[sig.pool]=[]);
   if(!list.some(x=>x.symbol===item.symbol))
    list.push({symbol:item.symbol,name:item.name,positiveCount:item.patterns.positiveCount,
     riskCount:item.patterns.riskCount,confluencePoints:item.patterns.confluencePoints,
     matched:item.patterns.matched.map(s=>s.label),source:item.quality.source});
  }
 }
 for(const list of Object.values(pools))list.sort((a,b)=>b.positiveCount-a.positiveCount||b.confluencePoints-a.confluencePoints||a.symbol.localeCompare(b.symbol));
 return pools;
}
module.exports={detectPatterns,attachRps,buildPatternPools};
