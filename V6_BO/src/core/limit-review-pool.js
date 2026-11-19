'use strict';
const {normalizeDay}=require('./limit-reason-evidence');
function auditLimitPoolRows(rows,{totalCount,source='eastmoney',tradeDate,receivedAt}={}){
 const input=Array.isArray(rows)?rows:[],seen=new Set();let invalidCount=0,duplicateCount=0;
 for(const row of input){if(!row||!/^\d{6}$/.test(row.code||'')){invalidCount++;continue;}if(seen.has(row.code))duplicateCount++;else seen.add(row.code);}
 const declared=typeof totalCount==='number'?totalCount:typeof totalCount==='string'&&/^\d+$/.test(totalCount)?Number(totalCount):null;
 const total=Number.isSafeInteger(declared)&&declared>=0?declared:null;
 return {source,tradeDate:normalizeDay(tradeDate),receivedAt:receivedAt??null,totalCount:total,fetchedCount:input.length,
  uniqueCount:seen.size,duplicateCount,invalidCount,providerComplete:total!==null&&total===input.length&&invalidCount===0&&duplicateCount===0,
  completenessScope:'provider-response-only',wholeMarketCertified:false};
}
function buildLimitReviewPool(input,{providerMeta,tradeDate,isStrategyExcluded=()=>false,isRecommendationExcluded=()=>false}={}){
 const all=Array.isArray(input)?input:[],providerRows=all.filter(row=>row?.src==='em'),seen=new Set(),rows=[];
 for(const row of all){if(!row||!/^\d{6}$/.test(row.code||'')||seen.has(row.code))continue;seen.add(row.code);
  const strategyExcluded=!!isStrategyExcluded(row),recommendationExcluded=!!isRecommendationExcluded(row);
  rows.push({...row,canTrade:false,canNotify:false,strategyExcluded,recommendationExcluded,
   strategyExclusionReason:strategyExcluded?'existing-limit-tally-policy':null,
   recommendationExclusionReason:recommendationExcluded?'existing-name-policy':null});
 }
 const meta=auditLimitPoolRows(providerRows,{totalCount:providerMeta?.totalCount,tradeDate,receivedAt:providerMeta?.receivedAt});
 return {rows,meta:{...meta,status:rows.length?'ready':'unavailable',rowCount:rows.length,
  derivedCount:rows.filter(row=>row.src==='derive').length,source:providerRows.length?'eastmoney':'dated-stock-reconstruction',
  readOnly:true,canTrade:false,canNotify:false}};
}
module.exports={auditLimitPoolRows,buildLimitReviewPool};

function mergeLimitReviewPools({eastmoneyRows=[],eastmoneyMeta,cls,previousRows=[],previousMeta,tradeDate,
 isStrategyExcluded,isRecommendationExcluded}={}){
 const day=normalizeDay(tradeDate);
 let emRows=day?eastmoneyRows.filter(row=>row&&normalizeDay(row.tradeDate)===day&&
  (row.src==='derive'||normalizeDay(row.sourceTradeDate)===day)):[];
 const currentEmAudit=auditLimitPoolRows(emRows.filter(row=>row.src==='em'),{totalCount:eastmoneyMeta?.totalCount,tradeDate:day,receivedAt:eastmoneyMeta?.receivedAt});
 const clsAccepted=!!day&&cls?.status==='available'&&cls.complete===true&&normalizeDay(cls.tradeDate)===day&&Array.isArray(cls.items)&&
  cls.items.every(row=>normalizeDay(row.tradeDate)===day&&normalizeDay(row.sourceTradeDate)===day);
 const attemptedSources=[{...currentEmAudit,status:emRows.some(row=>row.src==='em')?(currentEmAudit.providerComplete?'available':'partial'):'unavailable',includesST:'provider-defined'},
  {source:'cls',tradeDate:normalizeDay(cls?.tradeDate),totalCount:cls?.totalCount??null,fetchedCount:cls?.fetchedCount??0,
   uniqueCount:cls?.uniqueCount??0,receivedAt:cls?.receivedAt??null,providerComplete:clsAccepted,completenessScope:cls?.scope||'provider-up-pool-including-st',
   includesST:true,status:clsAccepted?'available':!day?'unavailable':cls?.status||'unavailable'}];
 if(!emRows.length&&!clsAccepted&&previousRows.length){
  const retainedSources=(previousMeta?.sources||[]).filter(source=>source.providerComplete).map(source=>source.source);
  return {rows:previousRows.map(row=>({...row,heldRecord:true,heldSources:row.sources||[],currentSourceConfirmed:false,recordStatus:'held-source-observation',
    sourceStatuses:Object.fromEntries((row.sources||[]).map(source=>[source,'retained'])),reasonSourceStatus:'retained'})),
   meta:{...previousMeta,status:'retained',partial:true,retainedSources,heldRecordCount:previousRows.length,
    sources:(previousMeta?.sources||[]).map(source=>({...source,status:source.providerComplete?'retained':source.status,
      lastAttempt:attemptedSources.find(attempt=>attempt.source===source.source)})),lastAttempt:{requestedDate:day,sources:attemptedSources}}};
 }
 const oldSource=name=>normalizeDay(previousMeta?.tradeDate)===day?(previousMeta.sources||[]).find(source=>source.source===name&&normalizeDay(source.tradeDate)===day&&
  (source.providerComplete||name==='eastmoney'&&previousRows.some(row=>(row.sources||[]).includes('eastmoney')&&normalizeDay(row.tradeDate)===day))):null;
 const oldEm=oldSource('eastmoney'),oldCls=oldSource('cls');
 const currentEmCodes=new Set(emRows.filter(row=>row.src==='em'&&/^\d{6}$/.test(row.code||'')).map(row=>row.code)),heldEmCodes=new Set();
 if(!currentEmAudit.providerComplete&&oldEm){
  const missing=previousRows.filter(row=>(row.sources||[]).includes('eastmoney')&&normalizeDay(row.tradeDate)===day&&!currentEmCodes.has(row.code));
  for(const row of missing)heldEmCodes.add(row.code);
  emRows=[...emRows,...missing.map(row=>({...row,src:'em',sources:['eastmoney']}))];
 }
 const emAudit=oldEm&&!currentEmAudit.providerComplete&&!currentEmCodes.size
  ?{...oldEm,status:'retained',lastAttempt:attemptedSources[0]}
  :{...attemptedSources[0],retainedRecordCount:heldEmCodes.size};
 const clsRows=clsAccepted?cls.items:oldCls?previousRows.filter(row=>(row.sources||[]).includes('cls')).map(row=>({...row,
  ...(row.clsObservation||{}),src:'cls',sources:['cls'],quoteAt:null})):[];
 const clsMeta=oldCls&&!clsAccepted?{...oldCls,status:'retained',lastAttempt:attemptedSources[1]}:attemptedSources[1];
 const sources=[emAudit,clsMeta],union=new Map();
 for(const row of emRows){if(!/^\d{6}$/.test(row.code||'')||union.has(row.code))continue;
  union.set(row.code,{...row,sources:[row.src==='em'?'eastmoney':row.src||'unknown'],sectorTags:row.sector?[row.sector]:[]});}
 for(const row of clsRows){
  const old=union.get(row.code),tags=[...(old?.sectorTags||[]),...(row.sectorTags||[]).map(tag=>typeof tag==='string'?tag:tag?.name).filter(Boolean),...(row.sector?[row.sector]:[])];
  const reason=row.reasonDateStatus==='matched'&&row.reasonTradeDate===day&&row.reasonSource==='cls'&&row.reason;
  union.set(row.code,{...(old||row),sources:[...new Set([...(old?.sources||[]),'cls'])],sectorTags:[...new Set(tags)],plates:row.plates||[],
   clsObservation:{source:'cls',tradeDate:row.tradeDate,price:row.price,pct:row.pct,sourceEventAt:row.sourceEventAt,rawEventTime:row.rawEventTime,receivedAt:row.receivedAt},
   ...(reason?{reason:row.reason,reasonTradeDate:row.reasonTradeDate,reasonSource:'cls',reasonDateStatus:'matched',
     reasonDateBasis:'provider-pool-event-time',reasonSourceTimestamp:row.sourceEventAt,reasonReceivedAt:row.receivedAt}:{}),
   isST:old?.isST??row.isST??null,reasonSourceStatus:clsMeta.status});
 }
 const retainedSources=[...new Set([...sources.filter(source=>source.status==='retained').map(source=>source.source),...(heldEmCodes.size?['eastmoney']:[])])];
 for(const row of union.values()){
  row.sourceStatuses=Object.fromEntries(sources.filter(source=>row.sources.includes(source.source)).map(source=>[source.source,source.status]));
  if(heldEmCodes.has(row.code))row.sourceStatuses.eastmoney='retained';
  row.heldSources=row.sources.filter(source=>row.sourceStatuses[source]==='retained');
  row.currentSourceConfirmed=row.sources.some(source=>['available','partial'].includes(row.sourceStatuses[source]));
  row.heldRecord=row.heldSources.length>0&&!row.currentSourceConfirmed;
  if(row.heldRecord)row.reasonSourceStatus='retained';
  row.recordStatus=row.heldRecord?'held-source-observation':row.currentSourceConfirmed?'observed-provider-record':'dated-stock-reconstruction';
 }
 const full=buildLimitReviewPool([...union.values()],{providerMeta:eastmoneyMeta,tradeDate:day,isStrategyExcluded,isRecommendationExcluded});
 const emCodes=new Set(emRows.filter(row=>row.src==='em'&&/^\d{6}$/.test(row.code||'')).map(row=>row.code)),clsCodes=new Set(clsRows.map(row=>row.code));
 const intersectionCount=[...emCodes].filter(code=>clsCodes.has(code)).length;
 const activeSources=sources.filter(source=>['available','partial','retained'].includes(source.status));
 return {rows:full.rows,meta:{...full.meta,tradeDate:day,source:activeSources.map(source=>source.source).join('+')||full.meta.source,sources,
  totalCount:null,fetchedCount:sources.reduce((sum,source)=>sum+(source.fetchedCount||0),0),fetchedCountBasis:'sum-of-provider-records',
  uniqueCount:full.rows.length,intersectionCount,eastmoneyOnlyCount:emCodes.size-intersectionCount,clsOnlyCount:clsCodes.size-intersectionCount,
  eastmoneyOnlyCodes:[...emCodes].filter(code=>!clsCodes.has(code)),clsOnlyCodes:[...clsCodes].filter(code=>!emCodes.has(code)),
  missingReasonCount:full.rows.filter(row=>!require('./limit-reason-evidence').reasonMatchesDay(row,day)).length,
  observedSTCount:full.rows.filter(row=>row.isST===true||/^\*?ST/i.test(row.name||'')).length,
  retainedSources,heldRecordCount:full.rows.filter(row=>row.heldRecord).length,
  heldSourceRecordCount:full.rows.filter(row=>row.heldSources?.length).length,
  confirmationSemantics:'source-response-for-recorded-date-not-live-price',
  partial:!currentEmAudit.providerComplete||!clsAccepted,providerComplete:emAudit.providerComplete&&clsMeta.providerComplete,
  completenessScope:'observed-provider-union',wholeMarketCertified:false}};
}
function selectLimitReviewDisplay(current,display){
 const meta=current?.ztReviewPoolMeta,day=normalizeDay(meta?.tradeDate),old=normalizeDay(display?.ztReviewPoolMeta?.tradeDate);
 if(day&&(!old||day>=old)&&Array.isArray(current.ztReviewPool)&&current.ztReviewPool.length&&
  current.ztReviewPool.every(row=>normalizeDay(row.tradeDate)===day)){
  return {...display,ztReviewPool:current.ztReviewPool,ztReviewPoolMeta:meta};
 }
 return display;
}
module.exports.mergeLimitReviewPools=mergeLimitReviewPools;
module.exports.selectLimitReviewDisplay=selectLimitReviewDisplay;
