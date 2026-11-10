'use strict';
/** Pure research-only anomaly quarantine. Two feeds cannot establish which is true. */
function classifyFeedDiscrepancies(reports,{minimumReports=3,minimumFailures=2}={}){
 if(!Number.isSafeInteger(minimumReports)||minimumReports<1||minimumReports>1000||!Number.isSafeInteger(minimumFailures)||minimumFailures<1||minimumFailures>minimumReports)throw Error('隔离门槛无效');
 if(!Array.isArray(reports)||reports.length>1000)throw Error('行情核对记录无效');
 const counts=new Map();
 for(const report of reports){
  if(!report||report.mode!=='independent-feed-shape-and-value-consensus'||report.canTrade!==false||report.verifiedExternal!==false||typeof report.consensus!=='boolean'||!Number.isSafeInteger(report.discrepancies)||report.discrepancies<0)throw Error('缺少可信的双源核对记录结构');
  const a=report.primary?.provider,b=report.secondary?.provider;
  if(typeof a!=='string'||!a.trim()||typeof b!=='string'||!b.trim()||a===b)throw Error('双源供应商身份无效');
  const key=[a,b].sort().join(' / ');
  const current=counts.get(key)||{pair:key,reports:0,failures:0};
  current.reports++;
  if(!report.consensus||report.discrepancies>0)current.failures++;
  counts.set(key,current);
 }
 const pairs=[...counts.values()].sort((a,b)=>a.pair.localeCompare(b.pair)).map(x=>({
  ...x,status:x.reports<minimumReports?'insufficient-evidence':x.failures>=minimumFailures?'quarantined-pair':'observed-pair',
  attribution:'unknown',canAutoSelectProvider:false,canTrade:false
 }));
 return {schemaVersion:1,mode:'research-feed-pair-quarantine',pairs,canTrade:false,canAutoSelectProvider:false,
  warning:'两源冲突不能确定哪一方错误；只隔离供应商组合，不自动封禁单个供应商或选择最终价格'};
}
module.exports={classifyFeedDiscrepancies};
