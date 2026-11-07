'use strict';
/** Daily offline research snapshot, derived only from validated persisted history.
 * Strategy evidence is not equivalent to independently verified P&L. */
const crypto=require('node:crypto');
const {validateDataset}=require('./historical-validation');
const {scanUniverse}=require('../strategy/universe-scanner');
const {runValidatedBacktest}=require('./historical-validation');
function dailyResearch(history,{includeBacktest=false}={}){
 const quality=validateDataset(history);
 if(!quality.lastDate)throw Error('每日研究必须使用带交易日期的历史行情');
 const end=quality.barsPerStock-1;
 const timestamp=Date.parse(quality.lastDate+'T15:00:00+08:00');
 const stocks=history.stocks.map(s=>{
  const bar=s.bars[end],prev=s.bars[end-1];
  return {...s,bars:s.bars.slice(0,end+1),price:bar.close,close:bar.close,volume:bar.volume,
   pctChange:(bar.close/prev.close-1)*100,
   feed:{source:history.source,timestamp,simulated:['fixture','simulated'].includes(history.source)}};
 });
 const scan=scanUniverse({stocks,now:timestamp,maxAgeMs:86400000});
 const rankings=scan.items.map((item,index)=>({rank:index+1,symbol:item.symbol,name:item.name,
  score:Number.isFinite(item.score)?item.score:null,eligibleForResearch:item.tradable,
  quality:{usable:item.quality.usable,errors:item.quality.errors,simulated:item.quality.simulated},
  risk:item.strategy?.riskFilter||null,explanation:item.strategy?.playbookAnalysis||null,
  regime:item.strategy?.regime||null,
  evidence:{legacy:item.strategy?.legacyScore??null,extended:item.strategy?.extendedFactors??null,
   ladder:item.ladder||null,myrules:'not-evaluated',bazi:'not-evaluated',python:'not-evaluated'},
  executable:false}));
 const out={schemaVersion:1,mode:'offline-daily-research',asOf:quality.lastDate,
  source:history.source,provider:history.provider||null,datasetId:history.datasetId||null,
  fingerprint:crypto.createHash('sha256').update(JSON.stringify(history)).digest('hex'),
  verifiedLive:false,canTrade:false,total:scan.total,eligible:scan.eligible,
  rankings,gate:{eligible:false,blockers:['行情未完成在线来源核验','四套策略尚未全部完成独立逐日回放','样本外与模拟盘有效性尚未验收']},
  strategyPerformance:{status:'not-verified',reason:'未对每套独立策略完成可复现的逐日样本外收益归因；禁止虚构胜率'},
  note:'研究排名与模拟账户基于相同历史数据；策略证据缺失标记为未评估；禁止真实下单'};
 if(includeBacktest){const result=runValidatedBacktest(history);out.backtest={status:result.status,metrics:result.metrics,holdout:result.holdout,releaseEligible:false};}
 return out;
}
module.exports={dailyResearch};
