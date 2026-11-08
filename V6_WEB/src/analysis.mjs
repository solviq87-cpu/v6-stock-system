import featureModule from './vendor/model-features.js';
import conditionModule from './vendor/model-selection-conditions.js';
import patternModule from './vendor/a-share-patterns.js';
import universeModule from './vendor/historical-universe.js';
const {featuresAt,names}=featureModule;
const {validateModelFilters,evaluateModelFilters}=conditionModule;
const {detectPatterns,attachRps}=patternModule;
const {validateUniverseHistory,universeObservation}=universeModule;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const dayMs=86400000;
const chinaDate=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
const closeAt=date=>Date.parse(date+'T15:10:00+08:00');
const openAt=date=>Date.parse(date+'T09:30:00+08:00');
export {dataset as prepareResearchDataset,closeAt,openAt,knownAt,barOK};
const labels=['5日收益','20日收益','60日动量（跳过5日）','20日波动','20日量比','实体幅度','日内振幅','收盘位置'];
const warning='仅对提供的历史数据做研究；模拟及导入来源未经实时认证，结果不构成胜率、收益承诺或交易指令。';
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&
 Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const barOK=b=>b&&[b.open,b.high,b.low,b.close].every(x=>finite(x)&&x>0)&&
 b.high>=Math.max(b.open,b.close,b.low)&&b.low<=Math.min(b.open,b.close)&&
 Number.isSafeInteger(b.volume)&&b.volume>=0&&(b.amount===undefined||b.amount===null||(finite(b.amount)&&b.amount>=0));
function knownAt(row,asOf){
 for(const key of ['timestamp','observedAt','publishedAt'])if(row?.[key]!==undefined){
  const stamp=typeof row[key]==='string'?Date.parse(row[key]):row[key];
  if(!finite(stamp)||stamp<=0||stamp>asOf)return false;
 }
 return true;
}
function dataset(input,{strictBars=false}={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||!Array.isArray(input.stocks)||
  !input.stocks.length||input.stocks.length>300)throw Error('需要含1至300只股票的 stocks 数组');
 validateUniverseHistory(input.universeHistory);
 const symbols=new Set();let latest='';
 const stocks=input.stocks.map(stock=>{
  if(!stock||typeof stock.symbol!=='string'||!/^\d{6}$/.test(stock.symbol)||symbols.has(stock.symbol))
   throw Error('股票代码必须为不重复的6位字符串');
  symbols.add(stock.symbol);
  if(!Array.isArray(stock.bars)||!stock.bars.length||stock.bars.length>1500)throw Error(stock.symbol+' 需要1至1500根K线');
  let previous='';
  for(const bar of stock.bars){
   if(!bar||!validDate(bar.date)||bar.date<=previous)throw Error(stock.symbol+' K线日期无效、重复或倒序');
   previous=bar.date;if(bar.date>latest)latest=bar.date;
   if(strictBars&&!barOK(bar))throw Error(stock.symbol+' '+bar.date+' OHLCV或成交额无效');
  }
  return {...stock,name:typeof stock.name==='string'?stock.name.slice(0,80):stock.symbol};
 });
 const asOf=input.asOf===undefined?closeAt(latest):typeof input.asOf==='string'?Date.parse(input.asOf):input.asOf;
 if(!finite(asOf)||asOf<=0||!Number.isFinite(new Date(asOf).getTime())||asOf>Date.now())throw Error('asOf 必须为有效且不超前的研究时点');
 if(latest>chinaDate(asOf))throw Error('K线日期晚于研究时点，拒绝未来数据');
 return {stocks,asOf,universeHistory:input.universeHistory,
  simulated:input.source==='simulated'||stocks.some(s=>s.feed?.source==='simulated')};
}

export function demoDataset(){
 const dates=[];
 for(let d=Date.parse('2025-10-01T00:00:00Z');dates.length<260;d+=dayMs){
  const date=new Date(d);if(date.getUTCDay()>0&&date.getUTCDay()<6)dates.push(date.toISOString().slice(0,10));
 }
 const asOf=closeAt(dates.at(-1));
 const stocks=Array.from({length:10},(_,j)=>{
  let previous=10+j*2;
  const bars=dates.map((date,i)=>{
   const open=previous*(1+.002*Math.sin(i*.7+j));
   const move=.002*Math.cos(i/(4+j*.5)+j)+.00035*(j-3)+.001*Math.sin(i*.3+j);
   const close=open*(1+move),volume=Math.round(800000+j*100000+120000*Math.sin(i*.2+j));
   previous=close;
   return {date,open,close,high:Math.max(open,close)*1.002,low:Math.min(open,close)*.998,
    volume,amount:volume*(open+close)/2};
  });
  return {symbol:String(600001+j),name:'研究示例'+String(j+1).padStart(2,'0'),market:'main',limitPct:10,
   feed:{source:'simulated',timestamp:asOf},bars};
 });
 return {schemaVersion:1,source:'simulated',asOf,stocks};
}

export function buildEvidenceSummary(patterns={}){
 const signals=Array.isArray(patterns)?patterns:patterns.matched||[];
 const groups=new Map(),risks=new Map(),positives=new Set();
 for(const signal of signals){
  if(!signal||typeof signal.id!=='string')continue;
  if(signal.side==='bearish'){risks.set(signal.id,{id:signal.id,label:signal.label||signal.id});continue;}
  if(signal.side!=='bullish'||positives.has(signal.id))continue;
  positives.add(signal.id);
  const candle=['red_three_soldiers','bullish_engulfing','hammer_rebound','morning_star'].includes(signal.id);
  const id=candle?'candle-structure':'price-volume-trend';
  if(!groups.has(id))groups.set(id,{id,label:candle?'K线结构':'价格趋势与成交量',dataFamily:'OHLCV',signalIds:[],labels:[]});
  groups.get(id).signalIds.push(signal.id);groups.get(id).labels.push(signal.label||signal.id);
 }
 return {families:[...groups.values()],familyCount:groups.size,
  rawPositiveCount:signals.filter(s=>s?.side==='bullish').length,uniquePositiveCount:positives.size,
  risks:[...risks.values()],riskCount:risks.size,confidence:null,
  note:'同源OHLCV信号按证据族去重；不同证据族不代表统计独立。看跌风险单列，不被看涨条件抵消。'};
}

export function analyzeSnapshot(input,filters={}){
 validateModelFilters(filters);
 const data=dataset(input,{strictBars:true}),prepared=[],items=[];
 for(const stock of data.stocks){
  const bars=stock.bars.filter(b=>closeAt(b.date)<=data.asOf&&b.complete!==false)
   .map(b=>b.amount===null?{...b,amount:undefined}:b);
  const last=bars.at(-1),warnings=[];
  const source=stock.feed?.source||'imported';
  if(source==='simulated')warnings.push('模拟数据');
  else warnings.push('导入历史来源，未经实时核验');
  if(stock.feed?.timestamp===undefined)warnings.push('未提供来源观测时点');
  const cutoff=last?closeAt(last.date):data.asOf;
  const observable=knownAt(stock.feed,data.asOf)&&bars.every(b=>knownAt(b,cutoff));
  if(!observable)warnings.push('来源或K线含无效/超前时间戳');
  const universe=last?universeObservation(data.universeHistory,stock.symbol,last.date):
   {eligible:false,verified:false,sector:null,reason:'NO_COMPLETED_SIGNAL_DATE'};
  if(!data.universeHistory)warnings.push('未提供历史股票池，沿用未核验样本范围');
  const features=last?featuresAt(bars,bars.length-1):null;
  const safety=stock.isST===true||stock.suspended===true||stock.tradable===false||
   last?.isST===true||last?.suspended===true||last?.tradable===false;
  const conditions=evaluateModelFilters(bars,bars.length-1,features,filters);
  const reasons=[...conditions.reasons];
  if(!features)reasons.push('FEATURE_HISTORY_UNAVAILABLE');
  if(!observable)reasons.push('OBSERVATION_TIME_INVALID');
  if(safety)reasons.push('SAFETY_BLOCKED');
  if(!universe.eligible)reasons.push('UNIVERSE_NOT_ELIGIBLE');
  const quality={usable:!!features&&observable&&universe.eligible,fresh:false,simulated:source==='simulated',source,warnings};
  const patternStock={...stock,bars};
  const item={symbol:stock.symbol,name:stock.name,date:last?.date||null,source,quality,features,universe,
   priceHistory:bars,
   conditions:{pass:reasons.length===0,reasons},patterns:detectPatterns(patternStock),blockedBySafety:safety,
   eligible:reasons.length===0,averageTurnover20:bars.length>=20&&bars.slice(-20).every(b=>finite(b.amount))?
    bars.slice(-20).reduce((sum,b)=>sum+b.amount/20,0):null};
  items.push(item);prepared.push(patternStock);
 }
 attachRps(prepared,items);
 for(const item of items)item.evidence=buildEvidenceSummary(item.patterns);
 const passed=items.filter(x=>x.eligible).length;
 return {mode:'research-only',asOf:data.asOf,sourceLabel:data.simulated?'确定性模拟样本':'导入历史数据（未核验）',
  simulated:data.simulated,total:items.length,passed,blocked:items.length-passed,filters:{...filters},items,
  autoTrade:false,universeMode:data.universeHistory?'point-in-time-imported-unverified':'legacy-unverified',warning};
}

function ranks(values){
 const order=values.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v),out=[];
 for(let i=0;i<order.length;){
  let j=i+1;while(j<order.length&&order[j].v===order[i].v)j++;
  const rank=(i+j+1)/2;for(let k=i;k<j;k++)out[order[k].i]=rank;i=j;
 }
 return out;
}
function rankIC(x,y){
 const a=ranks(x),b=ranks(y),middle=(x.length+1)/2;
 let xy=0,xx=0,yy=0;
 for(let i=0;i<a.length;i++){const da=a[i]-middle,db=b[i]-middle;xy+=da*db;xx+=da*da;yy+=db*db;}
 return xx&&yy?xy/Math.sqrt(xx*yy):null;
}
export function analyzeFactors(input){
 const data=dataset(input),minimum=5,byDate=new Map(),opportunities=new Map();
 const calendar=[...new Set(data.stocks.flatMap(s=>s.bars.map(b=>b.date)))].sort();
 const calendarIndex=new Map(calendar.map((d,i)=>[d,i]));
 for(const stock of data.stocks){
  const bars=stock.bars;
  for(let d=60;d<bars.length;d++){
   const signal=bars[d],index=calendarIndex.get(signal.date),exitDate=calendar[index+2];
   if(!exitDate||openAt(exitDate)>data.asOf)continue;
   if(!universeObservation(data.universeHistory,stock.symbol,signal.date).eligible||
    !universeObservation(data.universeHistory,stock.symbol,calendar[index+1],{at:'open'}).eligible)continue;
   opportunities.set(signal.date,(opportunities.get(signal.date)||0)+1);
   const entry=bars[d+1],exit=bars[d+2];
   if(!entry||!exit||entry.date!==calendar[index+1]||exit.date!==exitDate||
    !knownAt(stock.feed,data.asOf)||
    !bars.slice(d-60,d+1).every(b=>barOK(b)&&knownAt(b,closeAt(signal.date))&&b.complete!==false)||
    ![entry,exit].every(b=>barOK(b)&&knownAt(b,data.asOf)&&b.complete!==false)||
    closeAt(signal.date)>data.asOf||
    [signal,entry,exit].some(b=>b.suspended===true||b.isST===true||b.tradable===false||b.volume===0))continue;
   const features=featuresAt(bars,d),ret=exit.open/entry.open-1;
   if(!features||!finite(ret)||names.some(name=>!finite(features[name])))continue;
   const rows=byDate.get(signal.date)||[];rows.push({features,ret});byDate.set(signal.date,rows);
  }
 }
 const potential=[...opportunities.values()].reduce((a,b)=>a+b,0);
 const features=names.map((name,i)=>{
  const daily=[],quantiles=Array.from({length:5},(_,q)=>({quantile:q+1,sum:0,samples:0}));
  let samples=0;
  for(const date of [...opportunities.keys()].sort()){
   const rows=byDate.get(date)||[],x=rows.map(r=>r.features[name]),y=rows.map(r=>r.ret);
   samples+=rows.length;
   const ic=rows.length>=minimum?rankIC(x,y):null;
   daily.push({date,samples:rows.length,rankIC:ic});
   if(rows.length<minimum||new Set(x).size<2)continue;
   ranks(x).forEach((rank,j)=>{const bucket=quantiles[Math.min(4,Math.floor((rank-1)*5/rows.length))];bucket.sum+=y[j];bucket.samples++;});
  }
  const valid=daily.filter(d=>d.rankIC!==null);
  return {name,label:labels[i],meanRankIC:valid.length?valid.reduce((sum,d)=>sum+d.rankIC,0)/valid.length:null,
   validDates:valid.length,sampleCount:samples,coverage:potential?samples/potential:0,daily,
   quantiles:quantiles.map(q=>({quantile:q.quantile,meanReturn:q.samples?q.sum/q.samples:null,samples:q.samples}))};
 });
 return {mode:'research-only',asOf:data.asOf,gross:true,autoTrade:false,minSamples:minimum,
  label:'next-open-to-following-open',features,
  universeMode:data.universeHistory?'point-in-time-imported-unverified':'legacy-unverified',
  warning:'逐日截面Spearman RankIC与次日开盘至再次日开盘毛收益；并列值用平均秩。仅到期标签，未计成本/成交约束；提供日期推定日历，非交易日认证。不改变权重。'};
}
