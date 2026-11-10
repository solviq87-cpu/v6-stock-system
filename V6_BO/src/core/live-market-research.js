'use strict';
/** One-fetch live-source research pipeline. Does not alter production candidate ranks. */
const {fetchEastmoneySnapshot}=require('./eastmoney-market-snapshot');
const {analyzeMarketBreadth}=require('./market-breadth');
const {classifyObservedMarket}=require('./observed-market-regime');
const {joinObservedCandidates}=require('./live-candidate-bridge');
const {assessCandidateEvidence}=require('./research-risk-gate');
const {auditSnapshotQuoteTimes}=require('./market-snapshot-quote-time');
async function researchLiveMarket({fetchSnapshot=fetchEastmoneySnapshot,now=Date.now(),scores,scoreSource,scoreDate,minCoverage=0.8,candidates=[]}={}){
 const snapshot=await fetchSnapshot({now,clock:Date.now});
 const options={asOf:now,minCoverage};
 const breadth=analyzeMarketBreadth(snapshot,options);
 const regime=breadth.usable&&scores!==undefined
  ?classifyObservedMarket(snapshot,{...options,scores,scoreSource,scoreDate})
  :{usable:false,reason:breadth.usable?'未提交独立市场评分，暂不判定市场环境':breadth.reason,regime:null,weights:null};
 const completedAt=Date.parse(snapshot.retrievedAt||'');
 const timingClock=Number.isSafeInteger(completedAt)&&completedAt>0?completedAt:now;
 const candidateIntersection=joinObservedCandidates(snapshot,breadth,candidates,{asOf:timingClock});
 const quoteTimeAudit=auditSnapshotQuoteTimes(snapshot,{asOf:timingClock});
 return {verifiedLive:false,rankingModified:false,
  snapshotMetadata:{date:snapshot.date,source:snapshot.source,verifiedLive:false,startedAt:snapshot.startedAt,retrievedAt:snapshot.retrievedAt,samplingDurationMs:snapshot.samplingDurationMs,
   universeSize:snapshot.universeSize,pages:snapshot.pages,
   sourceCoverage:snapshot.sourceCoverage??null,warning:snapshot.warning},
  breadth,regime,candidateIntersection,quoteTimeAudit,
  riskEvidence:assessCandidateEvidence(snapshot,breadth,regime,candidates,candidateIntersection,{requireOriginalQuoteTime:true}),
  note:'公开行情请求日期不等于逐股原始报价时点，缺f124原始时间不可判为近期可信行情；供应商自报时间也不是交易所认证'};
}
module.exports={researchLiveMarket};
