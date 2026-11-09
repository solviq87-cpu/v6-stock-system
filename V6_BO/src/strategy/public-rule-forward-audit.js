'use strict';
/** Frozen-rule, time-separated forward audit. No optimization, order placement,
 * future-data selection, production promotion or hidden loss filtering. */
const crypto=require('node:crypto');
const {validateDataset}=require('../core/historical-validation');
const {atLockedLimit}=require('./walk-forward-backtest');
const {catalog,evaluateOpenSourceRules}=require('./open-source-research-signals');
const {catalog:linkedCatalog,evaluateLinkedResearch}=require('./linked-factor-research');
const {catalog:qualityCatalog,evaluateQualityMomentumResearch}=require('./quality-volume-reversal-research');
const {assessMarketShock}=require('../core/market-shock-learning-gate');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=x=>Number(x.toFixed(4));
const horizonsDefault=[1,5,20,60];
const dateOK=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&
 Number.isFinite(Date.parse(d+'T00:00:00Z'))&&
 new Date(Date.parse(d+'T00:00:00Z')).toISOString().slice(0,10)===d;
function policy(input={}){
 const o={windows:2,testDays:25,gapDays:2,horizons:horizonsDefault,
  feeBps:8,slippageBps:10,sellTaxBps:5,...input};
 if(!Number.isSafeInteger(o.windows)||o.windows<1||o.windows>8||
    !Number.isSafeInteger(o.testDays)||o.testDays<5||o.testDays>100||
    !Number.isSafeInteger(o.gapDays)||o.gapDays<1||o.gapDays>20||
    !Array.isArray(o.horizons)||!o.horizons.length||o.horizons.length>4||
    o.horizons.some(h=>!Number.isSafeInteger(h)||h<1||h>60)||
    new Set(o.horizons).size!==o.horizons.length)
    throw Error('独立战法未来验证窗口或隔离期参数无效');
 for(const key of ['feeBps','slippageBps','sellTaxBps'])
  if(!finite(o[key])||o[key]<0||o[key]>200)
    throw Error('研究交易成本参数无效');
 if(o.feeBps<8||o.slippageBps<10||o.sellTaxBps<5)
  throw Error('研究成本不能低于统一基线');
 if(o.includeLinkedRules!==undefined&&typeof o.includeLinkedRules!=='boolean')
  throw Error('附加战法验证开关必须为布尔值');
 if(o.includeQualityRules!==undefined&&typeof o.includeQualityRules!=='boolean')
  throw Error('质量量价战法验证开关必须为布尔值');
 if(o.linkedSeries!==undefined&&
    (!o.linkedSeries||typeof o.linkedSeries!=='object'||Array.isArray(o.linkedSeries)||
     Object.keys(o.linkedSeries).length>20||
     Object.keys(o.linkedSeries).some(code=>!/^\d{6}$/.test(code))))
   throw Error('相对动量来源序列需要最多20只证券的代码映射');
 if(o.marketContexts!==undefined&&
    (!o.marketContexts||typeof o.marketContexts!=='object'||Array.isArray(o.marketContexts)||
     Object.keys(o.marketContexts).length>400||Object.keys(o.marketContexts).some(d=>!dateOK(d))))
   throw Error('市场环境须为日期索引且不超过400日');
 return o;
}
function marketAt(date,marketContexts){
 const context=marketContexts?.[date];
 if(!context)return 'unknown';
 try{
  const asOf=Date.parse(date+'T15:00:00+08:00');
  const gate=assessMarketShock(context,{asOf});
  return gate.status==='observed-unverified'?gate.regime:'unknown';
 }catch{return 'unknown';}
}
function linkedContextOnDate(series,day,tradeDate){
 if(!series||typeof series!=='object')return undefined;
 // Slicing by signal index is a strict anti-lookahead boundary; data supplied
 // for days after the signal date is never passed to the strategy evaluator.
 const marketBars=Array.isArray(series.market?.bars)?series.market.bars.slice(day-20,day+1):[];
 const sectorBars=Array.isArray(series.sector?.bars)?series.sector.bars.slice(day-20,day+1):[];
 return {schemaVersion:1,source:series.source,provider:series.provider,asOf:tradeDate,
  market:{id:series.market?.id,source:series.market?.source,bars:marketBars},
  sector:{name:series.sector?.name,source:series.sector?.source,bars:sectorBars}};
}
function attemptTrade(stock,index,horizon,config){
 const bars=stock.bars,entryIndex=index+1,exitIndex=entryIndex+horizon;
 const close=(status,reason)=>({status,reason});
 if(exitIndex>=bars.length)return close('pending','需要更多已完成的后续交易日');
 const signal=bars[index],entry=bars[entryIndex],exit=bars[exitIndex];
 if(stock.corporateActionsVerified!==true)
  return close('unverified-corporate-actions','公司行为对账未完成，不计算净收益');
 if(!finite(stock.limitPct)||stock.limitPct<=0||stock.limitPct>30||
    !['main','chinext','star','bse'].includes(stock.market)||
    stock.noPriceLimit===true||stock.ipoNoLimit===true)
  return close('unknown-price-limit','缺少可核对的证券板块或适用涨跌停制度');
 const interval=bars.slice(index,exitIndex+1);
 if(interval.some(b=>b.suspended===true||b.isST===true||b.tradable===false||
    b.noPriceLimit===true||b.ipoNoLimit===true||b.volume<=0))
  return close('blocked-session','信号到卖出期间存在停牌、ST或零成交等风险');
 if(stock.isST===true||stock.suspended===true||stock.tradable===false)
  return close('blocked-security','证券存在交易风险');
 if(atLockedLimit(entry,signal,stock,'buy').blocked)
  return close('blocked-entry','次日开盘可能封板，不能假设买入成交');
 if(atLockedLimit(exit,bars[exitIndex-1],stock,'sell').blocked)
  return close('blocked-exit','卖出日可能一字跌停，不可从样本中删去');
 if(!finite(entry.open)||entry.open<=0||!finite(exit.open)||exit.open<=0)
  return close('invalid-execution-price','进出场价格无效');
 const entryPrice=entry.open*(1+config.slippageBps/10000);
 const exitPrice=exit.open*(1-config.slippageBps/10000);
 const feeFactor=Math.pow(1-config.feeBps/10000,2)*(1-config.sellTaxBps/10000);
 return {status:'modeled',entryDate:entry.date,exitDate:exit.date,
  entryPrice:round(entryPrice),exitPrice:round(exitPrice),
  grossReturnPct:round((exit.open/entry.open-1)*100),
  netReturnPct:round((exitPrice/entryPrice*feeFactor-1)*100),
  evidence:'unverified-historical-next-open-model',canTrade:false};
}
function summarise(events){
 const entries=events.filter(r=>r.status==='modeled');
 const count=entries.length;
 const blocked={};
 for(const row of events)if(row.status!=='modeled')
  blocked[row.status]=(blocked[row.status]||0)+1;
 return {signals:events.length,modeled:count,blocked,
  winRatePct:count?round(100*entries.filter(r=>r.netReturnPct>0).length/count):null,
  averageNetReturnPct:count?round(entries.reduce((s,r)=>s+r.netReturnPct,0)/count):null,
  worstNetReturnPct:count?Math.min(...entries.map(r=>r.netReturnPct)):null,
  realizedTradingReturn:false,statisticallyCertified:false};
}
/**
 * A horizon is one modeled outcome, not another independent signal.
 * Count co-hits only once per security + signal date, before any outcome filtering.
 * Family labels are conservative research groupings, not proof of independence.
 */
function summarizeSignalOverlap(events,activeCatalog,horizons){
 const ruleFamily=new Map(activeCatalog.map(r=>[r.id,r.family||'public-technical']));
 const daily=new Map();
 for(const event of events){
  if(event.horizon!==horizons[0])continue;
  const key=event.symbol+'|'+event.signalDate;
  if(!daily.has(key))daily.set(key,new Map());
  daily.get(key).set(event.ruleId,ruleFamily.get(event.ruleId)||'unclassified');
 }
 const byRule=Object.fromEntries(activeCatalog.map(r=>[r.id,{
  signalDays:0,isolatedDays:0,sameFamilyOverlapDays:0,otherFamilyOverlapDays:0,
  suggestedWeightAction:'unchanged'
 }]));
 let rawRuleSignals=0,independentFamilyExposures=0,multiRuleStockDays=0;
 let sameFamilyOverlapStockDays=0,crossFamilyOverlapStockDays=0;
 for(const rules of daily.values()){
  const entries=[...rules.entries()],families=new Set(entries.map(x=>x[1]));
  rawRuleSignals+=entries.length;
  independentFamilyExposures+=families.size;
  if(entries.length>1)multiRuleStockDays++;
  if(entries.length>families.size)sameFamilyOverlapStockDays++;
  if(families.size>1)crossFamilyOverlapStockDays++;
  for(const [id,family] of entries){
   const row=byRule[id];
   if(!row)continue;
   row.signalDays++;
   const same=entries.some(([other,f])=>other!==id&&f===family);
   const other=entries.some(([,f])=>f!==family);
   if(same)row.sameFamilyOverlapDays++;
   if(other)row.otherFamilyOverlapDays++;
   if(entries.length===1)row.isolatedDays++;
  }
 }
 for(const row of Object.values(byRule)){
  row.reviewNote=row.signalDays===0?'未获得可评估信号，不做升降权建议':
   row.sameFamilyOverlapDays>0?'存在同家族重叠，先去相关及扩充独立样本，不建议据此升权':
   '仅统计信号共现，须另做样本外、成本及数据真实性验证后才可评审权重';
 }
 return {schemaVersion:1,status:'descriptive-only',horizonDeduped:true,
  unit:'unique-symbol-trading-day',rawRuleSignals,uniqueStockDays:daily.size,
  independentFamilyExposures,
  sameFamilyDuplicateSignals:rawRuleSignals-independentFamilyExposures,
  multiRuleStockDays,sameFamilyOverlapStockDays,crossFamilyOverlapStockDays,
  byRule,weightsChanged:false,autoPromotion:false,
  caveat:'同日不同策略家族仅为不同证据类别，不代表统计独立；亏损和无法成交的信号不删去。'};
}

function evaluatePublicRuleForwardAudit(history,opts={}){
 const p=policy(opts),ds=validateDataset(history);
 if(!['imported','fixture','simulated'].includes(history.source))
  throw Error('只接受明确来源的离线研究数据');
 if(ds.stocks>20||ds.barsPerStock>400)throw Error('新战法样本外验证限制20只股票和每只400根K线');
 if(!ds.lastDate)throw Error('新战法样本外验证需要逐日日期');
 if(history.priceAdjustment?.mode!=='unadjusted'||
    !history.priceAdjustment?.provider)
  throw Error('需明确未复权价格及提供者出处才能进行次日开盘价格审计');
 const activeCatalog=[...catalog,
  ...(p.includeLinkedRules===true?linkedCatalog:[]),
  ...(p.includeQualityRules===true?qualityCatalog:[])];
 const n=ds.barsPerStock,maxH=Math.max(...p.horizons);
 const first=n-maxH-p.windows*p.testDays-1;
 if(first<40+p.gapDays)throw Error('历史样本不足：需完整预热、隔离窗口和未来持有期');
 const dateList=history.stocks[0].bars.map(b=>b.date);
 const firstIndex={};
 const events=[],folds=[];
 const diagnosticRules=[
  ...(p.includeLinkedRules===true?linkedCatalog:[]),
  ...(p.includeQualityRules===true?qualityCatalog:[])
 ];
 const ruleInputDiagnostics=diagnosticRules.length?
  Object.fromEntries(diagnosticRules.map(rule=>[rule.id,
   {candidateDays:0,notMatchedDays:0,unverifiedInputDays:0,blockedDays:0}])):null;
 for(let k=0;k<p.windows;k++){
  const start=first+k*p.testDays,end=start+p.testDays-1;
  const foldEvents=[];
  for(const stock of history.stocks){
   const code=String(stock.symbol||stock.code);
   for(let day=start;day<=end;day++){
    const rows=stock.bars.slice(0,day+1);
    const signals=evaluateOpenSourceRules({...stock,bars:rows});
    const extra=p.includeLinkedRules===true?
     evaluateLinkedResearch({...stock,bars:rows},{
      marketContext:linkedContextOnDate(p.linkedSeries?.[code],day,rows.at(-1).date),
      marketRisk:marketAt(rows.at(-1).date,p.marketContexts)==='systemic-selloff'?'risk_off':'unknown'
     }).strategies:[];
    const quality=p.includeQualityRules===true?
     evaluateQualityMomentumResearch({...stock,bars:rows},{
      marketRisk:marketAt(rows.at(-1).date,p.marketContexts)==='systemic-selloff'?'risk_off':'unknown'
     }).strategies:[];
    if(ruleInputDiagnostics)for(const x of [...extra,...quality]){
      const field={candidate:'candidateDays',not_matched:'notMatchedDays',
       insufficient_data:'unverifiedInputDays',risk_blocked:'blockedDays'}[x.status];
      if(field)ruleInputDiagnostics[x.id][field]++;
    }
    for(const candidate of [...signals.strategies,...extra,...quality]){
     if(candidate.status!=='candidate')continue;
     const tradeDate=rows.at(-1).date;
     const marketRegime=marketAt(tradeDate,p.marketContexts);
     for(const horizon of p.horizons){
      const outcome=attemptTrade(stock,day,horizon,p);
      const record={fold:k+1,symbol:code,signalDate:tradeDate,ruleId:candidate.id,
       horizon,marketRegime,...outcome};
      foldEvents.push(record);
      events.push(record);
     }
    }
   }
  }
  const horizonRows={};
  for(const h of p.horizons)horizonRows[h]={};
  for(const rule of activeCatalog)
   for(const h of p.horizons)horizonRows[h][rule.id]=summarise(foldEvents.filter(x=>x.horizon===h&&x.ruleId===rule.id));
  folds.push({fold:k+1,frozenRuleParameters:true,optimizedOnTraining:false,
   trainEndDate:dateList[start-p.gapDays-1],embargoSessions:p.gapDays,
   testStartDate:dateList[start],testEndDate:dateList[end],
   statistics:horizonRows});
 }
 const rules=activeCatalog.map(rule=>({
  id:rule.id,label:rule.label,source:rule.source,parameterTuning:'none',
  byHorizon:Object.fromEntries(p.horizons.map(h=>[h,summarise(events.filter(e=>e.ruleId===rule.id&&e.horizon===h))])),
  byMarketRegime:Object.fromEntries(
   [...new Set(events.filter(e=>e.ruleId===rule.id).map(e=>e.marketRegime))].sort()
    .map(regime=>[regime,Object.fromEntries(p.horizons.map(h=>[h,summarise(events.filter(e=>e.ruleId===rule.id&&e.marketRegime===regime&&e.horizon===h))]))])
  )}));
 const inputFingerprint=crypto.createHash('sha256').update(JSON.stringify(history)).digest('hex');
 return {schemaVersion:1,mode:'frozen-public-rule-forward-audit',
  historicalOnly:true,verifiedLive:false,canTrade:false,
  weightsChanged:false,autoPromotion:false,source:history.source,
  provider:history.provider||null,datasetFingerprint:inputFingerprint,
  dataset:{stocks:ds.stocks,barsPerStock:ds.barsPerStock,lastDate:ds.lastDate},
  configuration:{windows:p.windows,testDays:p.testDays,gapDays:p.gapDays,horizons:p.horizons.slice(),
   feeBps:p.feeBps,slippageBps:p.slippageBps,sellTaxBps:p.sellTaxBps,
   ...(p.includeLinkedRules===true?{includeLinkedRules:true}: {}),
   ...(p.includeQualityRules===true?{includeQualityRules:true}: {})}, 
  folds,rules,events,
  ...(p.includeLinkedRules===true||p.includeQualityRules===true?
    {overlapDiagnostics:summarizeSignalOverlap(events,activeCatalog,p.horizons)}:{}),
  ...(ruleInputDiagnostics?{ruleInputDiagnostics}:{}),
  sampleIntegrity:{eventsRetained:events.length,
   blockedEventsRetained:events.filter(e=>e.status!=='modeled').length,
   marketUnknownCount:events.filter(e=>e.marketRegime==='unknown').length},
  limitations:['固定规则仅做隔离日期窗口的回放；没有在训练段拟合参数，不能宣称完成模型训练或策略有效性认证',
   '每个信号独立以次日开盘假设买入、至少再隔一个交易日开盘卖出；净收益只是成本化模型，不是撮合成交或组合收益',
   '买卖受阻及公司行为未验收的样本保留且不计成胜率；卖出受阻不得视为无风险退出',
   '同股连续命中和多个规则可能高度相关，统计样本不等于独立观察',
   '进口数据来源、停复牌、涨跌停参数、公司行为核验未经过外部独立对账；无足够证据时净收益为空',
   '行情暴跌样本继续保留，不据一次回撤自动淘汰策略、修改因子权重或生成实盘委托',
   '额外战法仅在显式includeLinkedRules时评价；指数/板块序列按信号日切片，缺少21日对齐记录时相对动量不命中，未证实收益不得晋级']};
}
module.exports={evaluatePublicRuleForwardAudit};
