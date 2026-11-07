'use strict';
/** Provenance-aware market-regime adapter. No synthetic breadth or hidden neutral fallback. */
const {analyzeMarketBreadth}=require('./market-breadth');
const {classifyMarket}=require('./market-regime');
const SCORE_KEYS=['indexTrendScore','marketVolumeScore','riskScore','volatilityScore','sentimentScore'];
function classifyObservedMarket(snapshot, options={}){
 const breadth=analyzeMarketBreadth(snapshot,options);
 if(!breadth.usable)return {usable:false,reason:breadth.reason,breadth,regime:null,weights:null};
 const scores=options.scores;
 if(!scores||typeof scores!=='object'||Array.isArray(scores))
  return {usable:false,reason:'缺少独立来源的市场环境评分',breadth,regime:null,weights:null};
 const missing=SCORE_KEYS.filter(k=>typeof scores[k]!=='number'||!Number.isFinite(scores[k])||scores[k]<0||scores[k]>100);
 if(missing.length)return {usable:false,reason:'市场环境评分缺失或越界: '+missing.join(','),breadth,regime:null,weights:null};
 if(typeof options.scoreSource!=='string'||!options.scoreSource.trim())
  return {usable:false,reason:'市场环境评分缺少来源',breadth,regime:null,weights:null};
 if(options.scoreDate!==breadth.date)
  return {usable:false,reason:'市场环境评分日期与股票快照不一致',breadth,regime:null,weights:null};
 const classified=classifyMarket({...scores,breadthScore:breadth.breadthScore});
 return {usable:true,date:breadth.date,source:breadth.source,scoreSource:options.scoreSource,breadth,
  regime:classified.regime,attackScore:classified.attackScore,defensiveScore:classified.defensiveScore,
  weights:classified.weights,inputs:classified.inputs,
  note:'仅为研究环境分类；不自动更改现有选股阈值或权重'};
}
module.exports={classifyObservedMarket,SCORE_KEYS};
