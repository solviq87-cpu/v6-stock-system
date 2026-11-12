'use strict';
const {chinaValue}=require('./china-value');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {featuresAt,names:baselineNames}=require('./model-features');
const {selectPublicFeatures,publicFeaturesAt,catalogFingerprint}=require('./model-public-features');
const {assertAligned,visibleCloseFactors}=require('./historical-session');
const {ledgerBacktest}=require('./research-v2-position-ledger-backtest');
const {applyRiskFilter}=require('./risk-filter');
const {createHash}=require('node:crypto');
const {validateUniverseHistory,universeObservation}=require('../core/historical-universe');
const {validateExecutionRisk,executionCapacity}=require('../core/execution-risk');
const {validateModelFilters,evaluateModelFilters}=require('./model-selection-conditions');
const {scanUniverse}=require('./research-v2-universe-scanner');

const defaultModels=['ridge','extraTrees','histBoost'];
const supportedModels=[...defaultModels,'lightgbm','xgboost'];

function modelExperiment(options) {
  const {stocks,splitDay,source='imported',holdDays=1}=options;
  const featureSet=options.featureSet??'baseline-v1';
  const extraNames=selectPublicFeatures(featureSet),names=[...baselineNames,...extraNames];
  const featureFingerprints=new Map();
  const models=options.models===undefined?defaultModels:options.models;
  if(!Array.isArray(models)||!models.length||new Set(models).size!==models.length||
      models.some(name=>!supportedModels.includes(name))) throw Error('模型列表为空、重复或包含不支持的模型');
  const modelFilters=options.modelFilters===undefined?{}:options.modelFilters;
  validateModelFilters(modelFilters);
  validateUniverseHistory(options.universeHistory);
  validateExecutionRisk(options);
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
  const sampleAudit={training:{considered:0,accepted:0,rejected:{}},evaluation:{considered:0,accepted:0,rejected:{}}};
  const reject=(audit,reasons)=>{for(const reason of reasons)audit.rejected[reason]=(audit.rejected[reason]||0)+1;};
  let lastLabelDay=null;
  for(let day=60;day<=end;day++){
    // The two signal days whose labels cross the split are purged entirely.
    const phase=day>=splitDay?'evaluation':day+2<splitDay?'training':null;
    if(!phase)continue;
    const audit=sampleAudit[phase];
    for(const stock of stocks){
      audit.considered++;
      const symbol=String(stock.symbol||stock.code);
      const bar=stock.bars[day];
      if(!universeObservation(options.universeHistory,symbol,bar.date).eligible){
        reject(audit,['NO_POINT_IN_TIME_MEMBERSHIP']);continue;
      }
      const risk=applyRiskFilter({...visibleCloseFactors(bar),isST:bar.isST??stock.isST,
        suspended:bar.suspended??stock.suspended,tradable:bar.tradable??stock.tradable});
      if(!risk.pass){reject(audit,['SIGNAL_RISK_REJECTED']);continue;}
      let features=featuresAt(stock.bars,day);
      if(!features){reject(audit,['FEATURES_UNAVAILABLE']);continue;}
      if(extraNames.length){
        const observed=publicFeaturesAt(stock,day,options.tradingDates);
        if(extraNames.some(name=>!Number.isFinite(observed.values[name]))){
          reject(audit,['PUBLIC_FACTOR_EVIDENCE_UNAVAILABLE']);continue;
        }
        features={...features,...observed.values};
        const fingerprints=featureFingerprints.get(symbol)||[];
        fingerprints.push([day,observed.provenance.inputSha256]);featureFingerprints.set(symbol,fingerprints);
      }
      const conditions=evaluateModelFilters(stock.bars,day,features,modelFilters);
      if(!conditions.pass){reject(audit,conditions.reasons);continue;}
      if(!executionCapacity(stock,bar,1,1,{minPriorTurnover:options.minPriorTurnover}).shares){
        reject(audit,['PRIOR_TURNOVER_TOO_LOW_OR_UNKNOWN']);continue;
      }
      // Convert tiny liquidity units with a fixed, predeclared transform;
      // tree split tolerances must not silently discard a valid 1/CNY input.
      const vector=names.map(n=>features[n]*(n==='amihud_illiq20_rmb'?1e8:1));
      if(vector.some(v=>!Number.isFinite(v))){reject(audit,['NONFINITE_MODEL_INPUT']);continue;}
      if(day>=splitDay){
        rows.push({day,symbol,features});
        test.push(vector);
      }else if(day+2<splitDay){
        const [entry,exit]=stock.bars.slice(day+1,day+3);
        if(!universeObservation(options.universeHistory,symbol,entry.date,{at:'open'}).eligible){
          reject(audit,['NO_ENTRY_POINT_IN_TIME_MEMBERSHIP']);continue;
        }
        if(![entry,exit].every(b=>Number.isFinite(b.open)&&b.open>0&&b.volume>0&&!b.suspended)){
          reject(audit,['LABEL_UNAVAILABLE']);continue;
        }
        x.push(vector);y.push(exit.open/entry.open-1);trainingDays.add(day);lastLabelDay=day+2;
      }
      audit.accepted++;
    }
  }
  if(x.length<40||trainingDays.size<20||!rows.length)throw Error('有效训练数据需至少40行、20个信号日，并有可评估样本');
  const fit=spawnSync(process.env.V6_MODEL_PYTHON||'python3',[path.join(__dirname,'../../tools/fit-market-models.py')],{
    input:JSON.stringify({x,y,test,models}),encoding:'utf8',timeout:180000,maxBuffer:128*1024*1024,
    env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1',MKL_NUM_THREADS:'1'}});
  if(fit.error||fit.status!==0)throw Error('模型训练失败 '+(fit.error?.message||fit.stderr.trim()));
  const {version,scores,modelVersions}=JSON.parse(fit.stdout);
  if(!scores||models.some(name=>!Array.isArray(scores[name])||scores[name].length!==rows.length||
      scores[name].some(score=>!Number.isFinite(score)))) throw Error('模型预测数量或数值无效');
  const strategies=[...models,'momentum','lowVol'];
  const byDay=new Map();
  for(const [i,row] of rows.entries()){
    row.scores={momentum:row.features.momentum60Skip5,lowVol:-row.features.volatility20};
    for(const name of models)row.scores[name]=scores[name][i];
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
  const hasFilters=Object.keys(modelFilters).length>0||options.minPriorTurnover!=null;
  const originalSelector=hasFilters?(input,day)=>{
    const eligible=new Set((byDay.get(day)||[]).map(row=>row.symbol));
    return scanUniverse({stocks:input.filter(stock=>eligible.has(String(stock.symbol||stock.code))),
      now:Date.UTC(2020,0,1)+day*86400000,maxAgeMs:options.maxAgeMs??86400000})
      .items.filter(stock=>stock.tradable).map(stock=>stock.symbol);
  }:null;
  const summaries={v6Original:ledgerBacktest({...base,selectCandidates:originalSelector}).metrics};
  for(const name of strategies){
    const result=ledgerBacktest({...base,selectCandidates:(_input,day)=>
      (byDay.get(day)||[]).filter(r=>Number.isFinite(r.scores[name])).sort((a,b)=>b.scores[name]-a.scores[name]||a.symbol.localeCompare(b.symbol)).map(r=>r.symbol)});
    summaries[name]=result.metrics;
  }
  const datasetSha256=createHash('sha256').update(JSON.stringify({stocks:stocks.map(stock=>
    (extraNames.length?(()=>{const {factorHistory,...raw}=stock;return {...raw,bars:stock.bars.slice(0,end+1),publicFeatureFingerprints:featureFingerprints.get(String(stock.symbol||stock.code))||[]};})():{...stock,bars:stock.bars.slice(0,end+1)})),universeHistory:options.universeHistory??null})).digest('hex');
  const ledgerDefaults={initialCash:100000,topN:3,holdDays:1,feeBps:8,slippageBps:10,sellTaxBps:5,
    lotSize:100,maxAgeMs:86400000,strictMarks:true,stopLossPct:null,maxPositionPct:100,
    drawdownAlertPct:null,maxDrawdownPausePct:null,maxDailyLossPausePct:null,maxParticipationPct:null,
    minPriorTurnover:null,feeSchedules:null,riskPolicy:null,settlements:null};
  const backtest=Object.fromEntries(Object.entries(ledgerDefaults).map(([key,value])=>
    [key,options[key]===undefined?value:options[key]]));
  backtest.tradingDates=options.tradingDates??dates;
  backtest.externalEntryEligibility=typeof options.entryEligibility==='function';
  return {source,verifiedLive:false,autoTrade:false,sklearn:version,modelVersions,features:names,
    protocol:{featureSet,featureInputTransforms:extraNames.includes('amihud_illiq20_rmb')?{amihud_illiq20_rmb:{multiplier:1e8,unit:'per-100-million-CNY'}}:{},publicFactorCatalogFingerprint:extraNames.length?catalogFingerprint:null,models:[...models],modelFilters:{...modelFilters},minPriorTurnover:options.minPriorTurnover??null,
      datasetSha256,universeMode:options.universeHistory?'provided-unverified':'legacy-unverified',
      target:'next-open-to-following-open-gross-return',splitDay,end,backtest},sampleAudit,
    valueSignalDays,trainingRows:x.length,trainingDays:trainingDays.size,lastTrainingLabelDate:dates[lastLabelDay],
    firstEvaluationDate:dates[splitDay],asOf:dates[end],latest:byDay.get(end)||[],summaries,
    note:'回归模型预测未扣费的次日至再次日开盘收益，仅用于排序而非胜率或可实现收益。规则对照和原V6使用同一研究条件与账本参数；成交限制和费用由各组账本独立执行。'};
}
module.exports={modelExperiment};
