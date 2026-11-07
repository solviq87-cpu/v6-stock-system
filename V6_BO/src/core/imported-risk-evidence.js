'use strict';
const crypto=require('node:crypto');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const instant=x=>{
 if(typeof x!=='string')return false;
 const m=x.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/);
 return !!m&&date(m[1])&&+m[2]<24&&+m[3]<60&&+m[4]<60&&(m[5]==='Z'||(+m[6]<24&&+m[7]<60))&&Number.isFinite(Date.parse(x));
};
function reject(code,message){const error=Error(message);error.reasonCodes=[code];throw error;}
function validateEvidence(e,now){
 if(!e||e.schemaVersion!==1||e.source!=='imported'||!['sector','previous-close'].includes(e.kind))throw Error('风控证据类型或schema无效');
 for(const k of ['version','provider','sourceRecordId'])if(typeof e[k]!=='string'||!e[k].trim()||e[k].length>160)throw Error('风控证据来源或版本缺失');
 if(!date(e.tradeDate)||!instant(e.publishedAt)||!instant(e.knownAt)||Date.parse(e.publishedAt)>Date.parse(e.knownAt)||Date.parse(e.knownAt)>now||Date.parse(e.knownAt)>Date.parse(e.tradeDate+'T23:59:59.999+08:00'))throw Error('风控证据发布时间或获知时点无效');
 if(e.kind==='sector'){
  if(!date(e.classificationAsOf)||e.classificationAsOf>e.tradeDate||!e.sectors||Array.isArray(e.sectors)||typeof e.sectors!=='object'||!Object.keys(e.sectors).length||Object.keys(e.sectors).length>10000)throw Error('行业证据时点或映射无效');
  for(const [symbol,sector] of Object.entries(e.sectors))if(!/^\d{6}$/.test(symbol)||typeof sector!=='string'||!sector.trim()||sector.length>120)throw Error('行业映射无效');
 }else if(!date(e.observedThrough)||e.observedThrough>=e.tradeDate||![e.priorEquity,e.priorPeak,e.previousEquity].every(Number.isFinite)||e.priorEquity<0||e.priorPeak<=0||e.previousEquity<=0||e.priorPeak<e.priorEquity)throw Error('前收盘证据无效');
 // Store only the explicit schema, never credentials or arbitrary provider payloads.
 const keys=['schemaVersion','source','kind','version','provider','sourceRecordId','tradeDate','publishedAt','knownAt',...(e.kind==='sector'?['classificationAsOf','sectors']:['observedThrough','priorEquity','priorPeak','previousEquity'])];
 const record=Object.fromEntries(keys.map(k=>[k,e[k]]));
 if(record.sectors)record.sectors=Object.fromEntries(Object.entries(record.sectors).sort(([a],[b])=>a.localeCompare(b)));
 return record;
}
function resolveEvidence(records,policy,order,context,now,calendar){
 const result={...context,evidenceRefs:[]};
 for(const [kind,required] of [['sector',policy.maxSectorPct!=null],['previous-close',policy.maxDrawdownPausePct!=null||policy.maxDailyLossPausePct!=null]]){
  if(!required)continue;
  const candidates=records.filter(e=>e.kind===kind&&e.tradeDate===order.tradeDate&&Date.parse(e.knownAt)<=Math.min(now,context?.observedAt??now));
  const e=candidates.sort((a,b)=>Date.parse(a.knownAt)-Date.parse(b.knownAt)).at(-1);
  if(!e)reject('MISSING_IMPORTED_'+(kind==='sector'?'SECTOR':'PRIOR_CLOSE'),'缺少已导入的风控证据: '+kind);
  // Import order must never decide which provider's conflicting facts to trust.
  const latest=candidates.filter(c=>Date.parse(c.knownAt)===Date.parse(e.knownAt));
  const facts=c=>kind==='sector'?{classificationAsOf:c.classificationAsOf,sectors:Object.fromEntries(Object.entries(c.sectors).sort(([a],[b])=>a.localeCompare(b)))}:{observedThrough:c.observedThrough,priorEquity:c.priorEquity,priorPeak:c.priorPeak,previousEquity:c.previousEquity};
  if(latest.some(c=>digest(facts(c))!==digest(facts(e))))reject('AMBIGUOUS_IMPORTED_EVIDENCE','同一时点风控证据冲突: '+kind);
  result.evidenceRefs.push({kind:e.kind,version:e.version,provider:e.provider,sourceRecordId:e.sourceRecordId,fingerprint:digest(e)});
  if(kind==='sector'){result.classificationAsOf=e.classificationAsOf;result.sectors=e.sectors;}
  else{
   if(!calendar)reject('MISSING_RISK_CALENDAR','前收盘证据校验需要交易日历');
   let d=new Date(order.tradeDate+'T00:00:00Z'),prior=null;
   for(let i=0;i<366;i++){d.setUTCDate(d.getUTCDate()-1);const day=d.toISOString().slice(0,10);let open;try{open=calendar.isOpen(day);}catch{reject('RISK_CALENDAR_COVERAGE','前收盘证据所需日历覆盖不足');}if(open){prior=day;break;}}
   if(e.observedThrough!==prior)reject('STALE_PRIOR_CLOSE','前收盘证据不是上一交易日');
   result.previousClose={observedThrough:e.observedThrough,priorEquity:e.priorEquity,priorPeak:e.priorPeak,previousEquity:e.previousEquity};
  }
 }
 return result;
}
function planEvidenceImport(existing,evidenceList,now){
 if(!Array.isArray(evidenceList)||!evidenceList.length||evidenceList.length>100)throw Error('批量证据须为1至100条');
 const records=[...existing],refs=[];let imported=0,unchanged=0;
 for(const evidence of evidenceList){
  const record=validateEvidence(evidence,now);
  const old=records.find(e=>e.kind===record.kind&&e.provider===record.provider&&e.version===record.version);
  if(old){if(digest(validateEvidence(old,now))!==digest(record))throw Error('证据版本不能对应不同内容');unchanged++;}
  else{if(records.length>=1000)throw Error('证据记录达到1000条上限');records.push(record);imported++;}
  refs.push({kind:record.kind,provider:record.provider,version:record.version,fingerprint:digest(old||record)});
 }
 return {records,imported,unchanged,refs};
}
module.exports={validateEvidence,resolveEvidence,digest,planEvidenceImport};
