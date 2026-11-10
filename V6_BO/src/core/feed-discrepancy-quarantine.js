'use strict';
/** Offline evidence grouping only. Two feeds cannot identify the truthful provider. */
const HASH=/^[a-f0-9]{64}$/;
const MODES=new Set(['qfq','hfq','unadjusted']);
const validLabel=x=>typeof x==='string'&&x.length>0&&x.length<=128&&x===x.trim()&&!/[\x00-\x1f\x7f]/.test(x);
function classifyFeedDiscrepancies(reports,{minimumReports=3,minimumFailures=2}={}){
 if(!Number.isSafeInteger(minimumReports)||minimumReports<1||minimumReports>1000||
    !Number.isSafeInteger(minimumFailures)||minimumFailures<1||minimumFailures>minimumReports)
  throw Error('隔离门槛无效');
 if(!Array.isArray(reports)||reports.length>1000)throw Error('行情核对记录无效');
 const groups=new Map();
 for(const report of reports){
  if(!report||report.schemaVersion!==1||
     report.mode!=='independent-feed-shape-and-value-consensus'||
     report.canTrade!==false||report.verifiedExternal!==false||report.releaseReady!==false||
     typeof report.consensus!=='boolean'||!Number.isSafeInteger(report.discrepancies)||
     report.discrepancies<0||report.consensus!==(report.discrepancies===0)||
     !Number.isSafeInteger(report.comparedBars)||report.comparedBars<=0||
     !MODES.has(report.priceAdjustmentMode)||
     typeof report.timestampComparable!=='boolean'||
     (report.timestampComparable?
       (!Number.isSafeInteger(report.observationSkewMs)||report.observationSkewMs<0||report.observationSkewMs>300000):
       report.observationSkewMs!==null))
   throw Error('缺少可信的双源核对记录结构或状态自相矛盾');
  const a=report.primary,b=report.secondary;
  if(!validLabel(a?.provider)||!validLabel(b?.provider)||a.provider===b.provider||
     !validLabel(a.datasetId)||!validLabel(b.datasetId)||
     !HASH.test(a.fingerprint||'')||!HASH.test(b.fingerprint||''))
   throw Error('双源供应商身份、数据集或来源指纹无效');
  // JSON keys avoid collisions when provider labels themselves contain separators.
  const providers=[a.provider,b.provider].sort();
  const groupKey=JSON.stringify([providers,report.priceAdjustmentMode]);
  if(!groups.has(groupKey))groups.set(groupKey,{
   pair:providers.join(' / '),providers,adjustmentMode:report.priceAdjustmentMode,
   reports:0,failures:0,duplicatesIgnored:0,timestampedReports:0,seen:new Map()
  });
  const group=groups.get(groupKey);
  const evidenceKey=JSON.stringify([a,b].sort((x,y)=>x.provider.localeCompare(y.provider))
   .map(x=>[x.provider,x.datasetId,x.fingerprint]));
  const prior=group.seen.get(evidenceKey);
  if(prior){
   if(prior.consensus!==report.consensus||prior.discrepancies!==report.discrepancies||
      prior.comparedBars!==report.comparedBars||
      prior.timestampComparable!==report.timestampComparable||
      prior.observationSkewMs!==report.observationSkewMs)
    throw Error('同一来源指纹的核对证据相互矛盾');
   group.duplicatesIgnored++;
   continue;
  }
  group.seen.set(evidenceKey,{
   consensus:report.consensus,discrepancies:report.discrepancies,
   comparedBars:report.comparedBars,timestampComparable:report.timestampComparable,
   observationSkewMs:report.observationSkewMs
  });
  group.reports++;
  if(!report.consensus)group.failures++;
  if(report.timestampComparable)group.timestampedReports++;
 }
 const pairs=[...groups.values()].map(({seen,...item})=>({
  ...item,
  status:item.reports<minimumReports?'insufficient-evidence':
    item.failures>=minimumFailures?'quarantined-pair':'observed-pair',
  attribution:'unknown',providerIndependenceVerified:false,
  canAutoSelectProvider:false,canTrade:false
 })).sort((a,b)=>a.pair.localeCompare(b.pair)||a.adjustmentMode.localeCompare(b.adjustmentMode));
 return {schemaVersion:1,mode:'research-feed-pair-quarantine',pairs,
  canTrade:false,canAutoSelectProvider:false,providerIndependenceVerified:false,
  warning:'仅按不同指纹证据分组，不能证明跨交易日独立、供应商身份或哪个报价正确；隔离是研究标签，不停用供应商、不推断最终价格'};
}
module.exports={classifyFeedDiscrepancies};
