'use strict';
/** One-fetch live-source research pipeline. Does not alter production candidate ranks. */
const {fetchEastmoneySnapshot}=require('./eastmoney-market-snapshot');
const {analyzeMarketBreadth}=require('./market-breadth');
const {classifyObservedMarket}=require('./observed-market-regime');
const {researchInstant}=require('./observed-market-timing');
const {joinObservedCandidates}=require('./live-candidate-bridge');
const {assessCandidateEvidence}=require('./research-risk-gate');
const {auditSnapshotQuoteTimes}=require('./market-snapshot-quote-time');
const {bridgeExistingMarketSector}=require('./sector-breadth-market-bridge');
const {reviewLiveMarketShadow}=require('./market-shadow-capture');
async function researchLiveMarket({fetchSnapshot=fetchEastmoneySnapshot,now=Date.now(),scores,scoreSource,scoreDate,minCoverage=0.8,candidates=[],sectorMembership,clock,shadowResearch}={}){
 // Physical fetches use the independent system clock; injected replay fixtures
 // remain frozen unless the caller explicitly supplies a trusted test clock.
 const sampleClock=clock??(fetchSnapshot===fetchEastmoneySnapshot?Date.now:()=>now);
 if(typeof sampleClock!=='function'||!Number.isSafeInteger(now)||researchInstant(now)===null)
  throw Error('市场研究采样时钟无效');
 const snapshot=await fetchSnapshot({now,clock:sampleClock});
 const decisionAt=sampleClock();
 if(!Number.isSafeInteger(decisionAt)||researchInstant(decisionAt)===null||decisionAt<now)
  throw Error('市场研究决策时钟无效或倒退');
 const options={asOf:decisionAt,minCoverage};
 const breadth=analyzeMarketBreadth(snapshot,options);
 const regime=breadth.usable&&scores!==undefined
  ?classifyObservedMarket(snapshot,{...options,scores,scoreSource,scoreDate})
  :{usable:false,reason:breadth.usable?'未提交独立市场评分，暂不判定市场环境':breadth.reason,regime:null,weights:null};
 // Never advance a replay/decision clock using a timestamp from the payload.
 const timingClock=decisionAt;
 const candidateIntersection=joinObservedCandidates(snapshot,breadth,candidates,{asOf:timingClock});
 const quoteTimeAudit=auditSnapshotQuoteTimes(snapshot,{asOf:timingClock});
 const sectorBreadth=sectorMembership===undefined?undefined:
  bridgeExistingMarketSector(snapshot,sectorMembership,{asOf:timingClock});
 const riskEvidence=assessCandidateEvidence(snapshot,breadth,regime,candidates,candidateIntersection,{requireOriginalQuoteTime:true});
 const shadowAudit=shadowResearch===undefined?undefined:reviewLiveMarketShadow({snapshot,membership:sectorMembership,candidates,riskEvidence,shadow:shadowResearch,asOf:decisionAt});
 return {verifiedLive:false,rankingModified:false,
  snapshotMetadata:{date:snapshot.date,source:snapshot.source,verifiedLive:false,startedAt:snapshot.startedAt,retrievedAt:snapshot.retrievedAt,samplingDurationMs:snapshot.samplingDurationMs,
   universeSize:snapshot.universeSize,pages:snapshot.pages,
   sourceCoverage:snapshot.sourceCoverage??null,warning:snapshot.warning},
  breadth,regime,candidateIntersection,quoteTimeAudit,
  ...(sectorBreadth===undefined?{}:{sectorBreadth}),
  riskEvidence,
  ...(shadowAudit===undefined?{}:{shadowAudit}),
  note:'公开行情请求日期不等于逐股原始报价时点，缺f124原始时间不可判为近期可信行情；供应商自报时间也不是交易所认证'};
}
module.exports={researchLiveMarket};
