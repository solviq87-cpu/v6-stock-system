'use strict';
/** Provenance-aware market-regime adapter. No synthetic breadth or hidden neutral fallback. */
const {analyzeMarketBreadth}=require('./market-breadth');
const {classifyMarket}=require('./market-regime');
const {researchInstant,assessObservedTiming}=require('./observed-market-timing');
const {describeIndexParticipation}=require('./market-participation');
const SCORE_KEYS=['indexTrendScore','marketVolumeScore','riskScore','volatilityScore','sentimentScore'];
function classifyObservedMarket(snapshot, options={}){
 const cutoff=researchInstant(options.asOf===undefined?Date.now():options.asOf);
 if(cutoff===null)return {usable:false,reason:'研究决策时钟无效',breadth:null,regime:null,weights:null};
 const breadth=analyzeMarketBreadth(snapshot,{...options,asOf:cutoff});
 if(!breadth.usable)return {usable:false,reason:breadth.reason,breadth,regime:null,weights:null};
 // First-row descriptive counts are order-dependent when a quote identity
 // repeats. Never promote such a snapshot to a research regime or weights.
 if(breadth.duplicateCount>0)
  return {usable:false,reason:'股票快照存在重复证券记录，不能确认同一时点市场环境',breadth,regime:null,weights:null};
 const scores=options.scores;
 if(!scores||typeof scores!=='object'||Array.isArray(scores))
  return {usable:false,reason:'缺少独立来源的市场环境评分',breadth,regime:null,weights:null};
 const missing=SCORE_KEYS.filter(k=>typeof scores[k]!=='number'||!Number.isFinite(scores[k])||scores[k]<0||scores[k]>100);
 if(missing.length)return {usable:false,reason:'市场环境评分缺失或越界: '+missing.join(','),breadth,regime:null,weights:null};
 if(typeof options.scoreSource!=='string'||!options.scoreSource.trim())
  return {usable:false,reason:'市场环境评分缺少来源',breadth,regime:null,weights:null};
 if(options.scoreDate!==breadth.date)
  return {usable:false,reason:'市场环境评分日期与股票快照不一致',breadth,regime:null,weights:null};
 const timingEvidence=assessObservedTiming(snapshot,scores,cutoff);
 if(timingEvidence.status==='blocked')
  return {usable:false,reason:timingEvidence.reason,breadth,timingEvidence,regime:null,weights:null};
 const classified=classifyMarket({...scores,breadthScore:breadth.breadthScore});
 return {usable:true,date:breadth.date,source:breadth.source,scoreSource:options.scoreSource,breadth,timingEvidence,
  indexParticipation:describeIndexParticipation(snapshot,breadth,timingEvidence,options.indexObservation),
  regime:classified.regime,attackScore:classified.attackScore,defensiveScore:classified.defensiveScore,
  weights:classified.weights,inputs:classified.inputs,
  note:'仅为研究环境分类；不自动更改现有选股阈值或权重'};
}
module.exports={classifyObservedMarket,SCORE_KEYS};
