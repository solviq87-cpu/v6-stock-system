'use strict';
const {chinaValue}=require('./china-value');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {featuresAt,names}=require('./model-features');
const {assertAligned,visibleCloseFactors}=require('./historical-session');
const {ledgerBacktest}=require('./research-v2-position-ledger-backtest');
const {applyRiskFilter}=require('./risk-filter');

function modelExperiment(options) {
  const {stocks,splitDay,source='imported',holdDays=1}=options;
  if (!Array.isArray(stocks)||!stocks.length||!['imported','simulated'].includes(source))
    throw Error('需要导入或模拟的历史股票池');
  if (holdDays!==1) throw Error('本模型标签对应隔日开盘卖出，holdDays 必须为 1');
  const end=options.end??stocks[0].bars.length-1;
  if (!Number.isInteger(splitDay)||splitDay<84||!Number.isInteger(end)||end<splitDay+2||
      stocks.some(s=>!Array.isArray(s.bars)||s.bars.length<=end)) throw Error('训练或评估区间不足');
  const dates=stocks[0].bars.slice(0,end+1).map(b=>b?.date);
  assertAligned(stocks,end,options.tradingDates??dates);
  for(const stock of stocks){
    for(const bar of stock.bars.slice(0,end+1)){
      if(![bar.open,bar.high,bar.low,bar.close,bar.volume].every(Number.isFinite) ||
        bar.low<=0 || bar.low>Math.min(bar.open,bar.close) || bar.high<Math.max(bar.open,bar.close) || bar.volume<0)
        throw Error('历史 OHLCV 不完整，请先完成质量核对');
    }
  }
  const x=[],y=[],test=[],rows=[];
  const trainingDays=new Set();
  let lastLabelDay=null;
  for(let day=60;day<=end;day++){
    for(const stock of stocks){
      const bar=stock.bars[day];
      const risk=applyRiskFilter({...visibleCloseFactors(bar),isST:bar.isST??stock.isST,
        suspended:bar.suspended??stock.suspended,tradable:bar.tradable??stock.tradable});
      if(!risk.pass)continue;
      const features=featuresAt(stock.bars,day);
      if(!features)continue;
      const vector=names.map(n=>features[n]);
      if(day>=splitDay){
        rows.push({day,symbol:String(stock.symbol||stock.code),features});
        test.push(vector);
      }else if(day+2<splitDay){
        const [entry,exit]=stock.bars.slice(day+1,day+3);
        if(![entry,exit].every(b=>Number.isFinite(b.open)&&b.open>0&&b.volume>0&&!b.suspended))continue;
        x.push(vector);y.push(exit.open/entry.open-1);trainingDays.add(day);lastLabelDay=day+2;
      }
    }
  }
  if(x.length<40||trainingDays.size<20||!rows.length)throw Error('有效训练数据需至少40行、20个信号日，并有可评估样本');
  const fit=spawnSync(process.env.V6_MODEL_PYTHON||'python3',[path.join(__dirname,'../../tools/fit-market-models.py')],{
    input:JSON.stringify({x,y,test}),encoding:'utf8',timeout:180000,maxBuffer:128*1024*1024,
    env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1',MKL_NUM_THREADS:'1'}});
  if(fit.error||fit.status!==0)throw Error('模型训练失败 '+(fit.error?.message||fit.stderr.trim()));
  const {version,scores}=JSON.parse(fit.stdout);
  const strategies=['ridge','extraTrees','histBoost','momentum','lowVol'];
  const byDay=new Map();
  for(const [i,row] of rows.entries()){
    row.scores={momentum:row.features.momentum60Skip5,lowVol:-row.features.volatility20};
    for(const name of strategies.slice(0,3))row.scores[name]=scores[name][i];
    if(!byDay.has(row.day))byDay.set(row.day,[]);
    byDay.get(row.day).push(row);
  }
  const stockMap=new Map(stocks.map(s=>[String(s.symbol||s.code),s]));
  let valueSignalDays=0;
  for(const [day,group] of byDay){
    const inputs=group.map(r=>{
      const bar=stockMap.get(r.symbol).bars[day];
      return {symbol:r.symbol,marketCap:bar.marketCap,financials:bar.financials};
    });
    const value=chinaValue(inputs,dates[day]);
    if(day<end&&value.size)valueSignalDays++;
    for(const r of group)r.scores.chinaValue=value.get(r.symbol)??null;
  }
  if(valueSignalDays)strategies.push('chinaValue');
  const base={...options,source,start:splitDay,end,selectCandidates:null};
  const summaries={v6Original:ledgerBacktest(base).metrics};
  for(const name of strategies){
    const result=ledgerBacktest({...base,selectCandidates:(_input,day)=>
      (byDay.get(day)||[]).filter(r=>Number.isFinite(r.scores[name])).sort((a,b)=>b.scores[name]-a.scores[name]||a.symbol.localeCompare(b.symbol)).map(r=>r.symbol)});
    summaries[name]=result.metrics;
  }
  return {source,verifiedLive:false,autoTrade:false,sklearn:version,features:names,
    valueSignalDays,trainingRows:x.length,trainingDays:trainingDays.size,lastTrainingLabelDate:dates[lastLabelDay],
    firstEvaluationDate:dates[splitDay],asOf:dates[end],latest:byDay.get(end)||[],summaries,
    note:'三个模型预测未扣费的次日至再次日开盘收益；仅用于排序。动量与低波动为规则对照，各组均以相同账本参数独立执行。'};
}
module.exports={modelExperiment};
