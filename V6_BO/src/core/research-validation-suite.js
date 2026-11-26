'use strict';
/** Reproducible, offline, multi-window research evaluation. No trading or promotion. */
const {validateDataset}=require('./historical-validation');
const {ledgerBacktest}=require('../strategy/research-v2-position-ledger-backtest');
const {assertUnadjustedExecutionPriceBasis}=require('./historical-execution-price-basis');
const crypto=require('node:crypto');
const {validateFeeSchedules}=require('./trading-fees');
function evaluateResearchSuite(data,{windows=3,testDays=20,gapDays=1,feeBps=8,slippageBps=10,sellTaxBps=5,topN=3,initialCash=100000,maxPositionPct=30,holdDays=2}={}){
 const provenance=validateDataset(data);
 assertUnadjustedExecutionPriceBasis(data);
 if(!Number.isInteger(windows)||windows<1||windows>12||!Number.isInteger(testDays)||testDays<3||testDays>500||
 !Number.isInteger(gapDays)||gapDays<1||gapDays>20)throw Error('滚动窗口配置无效');
 if(!['imported','fixture','simulated'].includes(data.source))throw Error('数据来源类型未获准用于离线评估');
 for(const s of data.stocks)for(const b of s.bars){
  require('./corporate-actions').corporateAction(b);
  if(b.priceBasis&&b.priceBasis!=='unadjusted')throw Error('交易价格必须使用未复权数据');
 }
 const length=provenance.barsPerStock;
 const first=length-windows*testDays;
 if(first<28+gapDays)throw Error('样本不足以容纳预热期、隔离期和所有样本外窗口');
 // A validated historical dataset is not merely an OHLCV array. Keep its
 // original point-in-time membership, settlement, fee and risk evidence in
 // every fold. The suite's explicit simple cost/sizing parameters retain
 // their existing meaning; dated fees take precedence in the original ledger.
 const context={tradingDates:data.tradingDates??null,universeHistory:data.universeHistory??null,
  settlements:data.settlements??null,feeSchedules:data.feeSchedules??null,riskPolicy:data.riskPolicy??null,
  stopLossPct:data.stopLossPct??null,drawdownAlertPct:data.drawdownAlertPct??null,
  maxDrawdownPausePct:data.maxDrawdownPausePct??null,maxDailyLossPausePct:data.maxDailyLossPausePct??null,
  maxParticipationPct:data.maxParticipationPct??null,minPriorTurnover:data.minPriorTurnover??null};
 validateFeeSchedules(context.feeSchedules);
 // With a dated schedule the ledger ignores the flat commission. Create a
 // separately named research scenario instead of silently omitting stress.
 // Keep the original effective dates, taxes, transfer charges and time gates.
 const stressedFees=context.feeSchedules?.map(row=>({...row,version:row.version+':research-commission-x2',
  source:'derived-research-stress',feeBps:row.feeBps*2,minFee:row.minFee*2}))??null;
 if(stressedFees)try{validateFeeSchedules(stressedFees);}catch{throw Error('两倍佣金压力情景超出原费用配置范围，拒绝静默截断');}
 const options={stocks:data.stocks,source:data.source,feeBps,slippageBps,sellTaxBps,topN,initialCash,maxPositionPct,holdDays,...context};
 const folds=[];
 for(let k=0;k<windows;k++){
  const start=first+k*testDays, end=start+testDays-1;
  const baseline=ledgerBacktest({...options,start,end});
  const stressed=ledgerBacktest({...options,start,end,feeBps:feeBps*2,slippageBps:slippageBps*2,feeSchedules:stressedFees});
  const dates=data.stocks[0].bars;
  folds.push({fold:k+1,trainingEndIndex:start-gapDays-1,embargoDays:gapDays,
   optimizedOnTraining:false,embargoScope:'declared-evaluation-gap-no-model-training',
   testStartIndex:start,testEndIndex:end,startDate:dates[start].date||null,endDate:dates[end].date||null,
   baseline:baseline.metrics,stress:stressed.metrics,
   blockedOrders:baseline.orders.filter(o=>o.status==='blocked').length,
   openPositions:baseline.openPositions.length,
   warnings:baseline.warnings,
   stressReturnDeltaPctPoints:+(stressed.metrics.returnPct-baseline.metrics.returnPct).toFixed(4)});
 }
 const mean=(arr)=>+(arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(4);
 const summary={folds:folds.length,averageReturnPct:mean(folds.map(f=>f.baseline.returnPct)),
  averageStressReturnPct:mean(folds.map(f=>f.stress.returnPct)),
  worstReturnPct:Math.min(...folds.map(f=>f.baseline.returnPct)),
  worstDrawdownPct:Math.max(...folds.map(f=>f.baseline.maxDrawdownPct)),
  positiveWindows:folds.filter(f=>f.baseline.returnPct>0).length,
  closedTrades:folds.reduce((n,f)=>n+f.baseline.closedTrades,0),
  stressedPositiveWindows:folds.filter(f=>f.stress.returnPct>0).length};
 const hash=crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
 return {schemaVersion:1,mode:'offline-research-only',canTrade:false,productionEligible:false,
  dataset:{...provenance,sha256:hash},configuration:{windows,testDays,gapDays,feeBps,slippageBps,sellTaxBps,topN,initialCash,maxPositionPct,holdDays,
   riskPolicy:context.riskPolicy,stopLossPct:context.stopLossPct,drawdownAlertPct:context.drawdownAlertPct,
   maxDrawdownPausePct:context.maxDrawdownPausePct,maxDailyLossPausePct:context.maxDailyLossPausePct,
   maxParticipationPct:context.maxParticipationPct,minPriorTurnover:context.minPriorTurnover,
   calendarMode:context.tradingDates===null?'legacy-unspecified':'supplied-unverified',
   universeMode:context.universeHistory===null?'legacy-unspecified':'supplied-point-in-time-unverified',
   settlementCount:context.settlements?.length??0,feeScheduleVersions:context.feeSchedules?.map(row=>row.version)??null,
   stress:{commissionMultiplier:2,slippageMultiplier:2,sellTaxMultiplier:1,transferMultiplier:1,
    feeScheduleVersions:stressedFees?.map(row=>row.version)??null}},
  folds,summary,limitations:['样本外窗口仅隔离评估区间；尚无训练或调参过程，不得宣称完成策略优化验证；隔离日可用于指标预热，不是已执行的模型训练隔离',
   '扫描器及交易所涨跌停模型为研究近似；不含真实订单簿、复权与企业行为对账',
   '模拟数据和导入数据均未完成独立行情供应商真实性验证','不构成交易信号或生产策略上线许可']};
}
module.exports={evaluateResearchSuite};
