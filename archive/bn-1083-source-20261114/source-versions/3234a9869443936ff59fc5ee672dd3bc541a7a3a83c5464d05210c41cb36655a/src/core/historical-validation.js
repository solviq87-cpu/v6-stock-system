'use strict';
const {ledgerBacktest}=require('../strategy/research-v2-position-ledger-backtest');
const {holdoutBacktest}=require('../strategy/holdout-backtest');
const {corporateAction}=require('./corporate-actions');
const finite=n=>typeof n==='number'&&Number.isFinite(n);
function validCalendarDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const t=Date.parse(value+'T00:00:00Z');
 return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===value;
}
function validateDataset(data){
 if(!data||typeof data!=='object'||!data.source||!validCalendarDate(data.asOf)||!Array.isArray(data.stocks)||!data.stocks.length)throw Error('需要来源、截至日期和非空股票历史');
 if(data.stocks.length>500)throw Error('离线股票池超过500只');
 const ids=new Set();let length=null;let dates=null;let dateMode=null;
 for(const stock of data.stocks){
  const id=String(stock.symbol||stock.code||'');if(!/^\d{6}$/.test(id)||ids.has(id))throw Error('股票代码无效或重复: '+id);ids.add(id);
  if(!Array.isArray(stock.bars)||stock.bars.length<32||stock.bars.length>10000)throw Error('历史长度不足或超过限制: '+id);
  if(length===null)length=stock.bars.length;
  if(length!==stock.bars.length)throw Error('各股票历史交易日未对齐');
  for(let i=0;i<stock.bars.length;i++){
   const b=stock.bars[i];if(!b||![b.open,b.high,b.low,b.close,b.volume].every(finite)||b.open<=0||b.close<=0||b.high<Math.max(b.open,b.close,b.low)||b.low<=0||b.low>Math.min(b.open,b.close)||b.volume<0)throw Error(`${id} 第${i}条OHLCV无效`);
   if(b.priceBasis&&b.priceBasis!=='unadjusted')throw Error('成交账本要求未复权价格');
   corporateAction(b);
   if(b.date!==undefined){if(!validCalendarDate(b.date))throw Error('日期无效');if(i>0&&b.date<=stock.bars[i-1].date)throw Error('日期非递增');}
  }
  const ds=stock.bars.map(b=>b.date);
  if(data.source==='imported'&&!ds.every(Boolean))throw Error('导入行情每条K线必须有交易日期');
  if(ds.some(Boolean)&&!ds.every(Boolean))throw Error('禁止混用带日期和无日期行情');
  const mode=ds.every(Boolean)?'dated':'undated';
  if(dateMode!==null&&mode!==dateMode)throw Error('不同股票禁止混用带日期和无日期行情');
  dateMode=mode;
  if(mode==='dated'){if(dates===null)dates=ds;else if(ds.some((d,i)=>d!==dates[i]))throw Error('交易日期不一致');}
 }
 if(dates&&dates.at(-1)>data.asOf)throw Error('历史行情包含超过截至日期的未来K线');
 if(!['fixture','simulated','imported'].includes(data.source)&&!data.provider&&!data.datasetId)throw Error('外部数据需要provider或datasetId以便追溯');
 return {stocks:data.stocks.length,barsPerStock:length,firstDate:dates?.[0]||null,lastDate:dates?.at(-1)||null,source:data.source,asOf:data.asOf,verifiedExternal:false};
}
function validateBacktestConfig(history,barCount){
 const integer=(name,min,max)=>{const value=history[name];if(value!==undefined&&(!Number.isSafeInteger(value)||value<min||value>max))throw Error(name+' 参数无效');};
 const numeric=(name,min,max,allowNull=false)=>{const value=history[name];if(value===undefined||(allowNull&&value===null))return;if(!finite(value)||value<min||value>max)throw Error(name+' 参数无效');};
 for(const key of ['maxDrawdownPausePct','maxDailyLossPausePct','maxParticipationPct'])numeric(key,0.000001,100,true);
 numeric('minPriorTurnover',0,1e18,true);
 integer('start',27,barCount-2);integer('end',28,barCount-1);
 integer('topN',1,500);integer('holdDays',1,barCount);integer('splitDay',0,barCount-1);
 numeric('feeBps',0,10000);numeric('slippageBps',0,10000);numeric('sellTaxBps',0,10000);
 numeric('initialCash',0.01,1e15);numeric('maxPositionPct',0.01,100);
 numeric('stopLossPct',0,100,true);numeric('drawdownAlertPct',0,100,true);
 const start=history.start??27,end=history.end??barCount-1;
 if(start>=end)throw Error('回测起止区间无效');
 if(history.splitDay!==undefined&&(history.splitDay<start+2||history.splitDay>=end))throw Error('样本内外各需至少两个交易日');
}
function runValidatedBacktest(history){
 const dataset=validateDataset(history);
 validateBacktestConfig(history,dataset.barsPerStock);
 const options={stocks:history.stocks,source:history.source,start:history.start??27,
  feeBps:history.feeBps??8,slippageBps:history.slippageBps??10,
  sellTaxBps:history.sellTaxBps??5,topN:history.topN??3,
  holdDays:history.holdDays??1,initialCash:history.initialCash??100000,
  stopLossPct:history.stopLossPct??null,maxPositionPct:history.maxPositionPct??100,
  drawdownAlertPct:history.drawdownAlertPct??null,
  maxDrawdownPausePct:history.maxDrawdownPausePct??null,maxDailyLossPausePct:history.maxDailyLossPausePct??null,
  maxParticipationPct:history.maxParticipationPct??null,minPriorTurnover:history.minPriorTurnover??null,
  ...(history.end===undefined?{}:{end:history.end})};
 const result=ledgerBacktest(options);
 let holdout={status:'not-tested',reason:'未预先指定样本外分割点'};
 if(Number.isInteger(history.splitDay)){
  const split=holdoutBacktest({...options,splitDay:history.splitDay});
  holdout={status:'evaluated',splitDay:history.splitDay,method:split.method,
   inSample:split.inSample.metrics,outOfSample:split.outOfSample.metrics};
 }
 return {status:result.metrics.closedTrades?'research-only':'insufficient',dataset,
  metrics:result.metrics,statistics:result.statistics,cashFlows:result.cashFlows,holdout,assumptions:result.assumptions,warnings:result.warnings,
  trades:result.trades,orders:result.orders,equity:result.equity,openPositions:result.openPositions,
  releaseEligible:false,reason:'研究回测不构成实盘放行；需要真实来源校验、模拟盘和人工风控验收'};
}
module.exports={validateDataset,validateBacktestConfig,runValidatedBacktest};
