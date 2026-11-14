'use strict';
/** One-fetch live-source research pipeline. Does not alter production candidate ranks. */
const {fetchEastmoneySnapshot}=require('./eastmoney-market-snapshot');
const {analyzeMarketBreadth}=require('./market-breadth');
const {classifyObservedMarket}=require('./observed-market-regime');
const {joinObservedCandidates}=require('./live-candidate-bridge');
async function researchLiveMarket({fetchSnapshot=fetchEastmoneySnapshot,now=Date.now(),scores,scoreSource,scoreDate,minCoverage=0.8,candidates=[]}={}){
 const snapshot=await fetchSnapshot({now});
 const options={asOf:now,minCoverage};
 const breadth=analyzeMarketBreadth(snapshot,options);
 const regime=breadth.usable&&scores!==undefined
  ?classifyObservedMarket(snapshot,{...options,scores,scoreSource,scoreDate})
  :{usable:false,reason:breadth.usable?'未提交独立市场评分，暂不判定市场环境':breadth.reason,regime:null,weights:null};
 return {verifiedLive:false,rankingModified:false,
  snapshotMetadata:{date:snapshot.date,source:snapshot.source,retrievedAt:snapshot.retrievedAt,
   universeSize:snapshot.universeSize,pages:snapshot.pages,warning:snapshot.warning},
  breadth,regime,candidateIntersection:joinObservedCandidates(snapshot,breadth,candidates),
  note:'公开行情请求时间不等于交易所确认的行情时间；市场评分必须独立提供来源及相同日期'};
}
module.exports={researchLiveMarket};
