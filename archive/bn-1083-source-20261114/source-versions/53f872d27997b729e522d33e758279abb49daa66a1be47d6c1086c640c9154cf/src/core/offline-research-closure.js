'use strict';
/** Reproducible offline research closure: validated OHLCV -> snapshot -> research ranking -> ledger evaluation.
 * This is NOT a production trading signal or verified live market feed. */
const crypto=require('node:crypto');
const {validateDataset,runValidatedBacktest}=require('./historical-validation');
const {scanUniverse}=require('../strategy/universe-scanner');
const {replayPaperAccount}=require('./paper-replay');
function runOfflineResearchClosure(history,{now}={}){
 const dataset=validateDataset(history);
 const end=history.stocks[0].bars.length-1;
 const last=history.stocks[0].bars[end];
 const asOf=last.date||null;
 const timestamp=Number.isFinite(now)?now:asOf?Date.parse(asOf+'T15:00:00+08:00'):Date.now();
 const stocks=history.stocks.map(s=>{
  const b=s.bars[end],prev=s.bars[end-1];
  return {...s,bars:s.bars.slice(0,end+1),feed:{source:history.source,timestamp},
   price:b.close,close:b.close,volume:b.volume,pctChange:prev.close>0?(b.close/prev.close-1)*100:null};
 });
 const scan=scanUniverse({stocks,now:timestamp,maxAgeMs:86400000});
 const validation=runValidatedBacktest(history);
 const paper=replayPaperAccount(history,{startDay:Math.max(31,Math.min(history.start??31,dataset.barsPerStock-2))});
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify(history)).digest('hex');
 const ranked=scan.items.map((x,i)=>({rank:i+1,code:x.symbol,name:x.name,
  score:Number.isFinite(x.score)?x.score:null,eligibleForResearch:x.tradable,
  quality:{usable:x.quality.usable,errors:x.quality.errors},
  risk:x.strategy?.riskFilter||null,explanation:x.strategy?.playbookAnalysis||null,
  executable:false}));
 return {schemaVersion:1,mode:'offline-research-only',canTrade:false,verifiedLive:false,
  source:history.source,asOf,dataset,fingerprint,ranking:ranked,
  paper:{mode:paper.mode,metrics:paper.metrics,orders:paper.orders,equity:paper.equity,signals:paper.signals,positions:paper.positions,warnings:paper.warnings},
  backtest:{status:validation.status,metrics:validation.metrics,holdout:validation.holdout,
   warnings:validation.warnings,openPositions:validation.openPositions,assumptions:validation.assumptions},
  gate:{eligible:false,blockers:['历史回测不代表未来收益','未完成真实行情来源核验','未完成模拟盘持续对照和人工风控验收']},
  note:'研究排行与回测使用同一份经校验的历史数据；不发出下单指令，不修改原有线上排名'};
}
module.exports={runOfflineResearchClosure};
