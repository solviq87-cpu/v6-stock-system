'use strict';
/**
 * Read-only linkage of historical cash/share settlement claims to the EXACT
 * public vendor JSON rows archived by public-stock-status-evidence.
 * A hash verifies local byte/row integrity; it does not authenticate a vendor,
 * prove the original announcement publication instant, or authorize trades.
 */
const crypto=require('node:crypto');
const {validateSettlement}=require('./corporate-settlements');
const MAX_WIRE=2*1024*1024,MAX_PAGES=8,MAX_EVENTS=500;
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const chinaDay=t=>new Date(t+8*3600000).toISOString().slice(0,10);
const validDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const sourceFields=['REPORT_DATE','PLAN_NOTICE_DATE','EQUITY_RECORD_DATE',
 'EX_DIVIDEND_DATE','NOTICE_DATE','PUBLISH_DATE'];
function invalid(message){throw Error('公司行为源证据核验拒绝：'+message);}
function rawDate(value){
 if(value==null||value==='')return null;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?: (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)?$/.test(value))
  invalid('源日期字段格式');
 const date=value.slice(0,10);
 if(!validDay(date))invalid('源日期不存在');
 return date;
}
function readWire(entry,symbol,now){
 if(entry?.source!=='eastmoney:dividendEvents'||!Number.isSafeInteger(entry.receivedAt)||
    entry.receivedAt<=0||entry.receivedAt>now||
    entry.encoding!=='base64'||typeof entry.data!=='string'||
    entry.data.length>Math.ceil(MAX_WIRE*4/3)+8||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.data))
  invalid('来源标签、采集时点或响应编码');
 const bytes=Buffer.from(entry.data,'base64');
 if(bytes.length>MAX_WIRE||bytes.length!==entry.byteLength||
    bytes.toString('base64')!==entry.data||digest(bytes)!==entry.sha256)
  invalid('原始响应字节或 SHA256 指纹不一致');
 let url;
 try{url=new URL(entry.url);}catch{invalid('响应地址无效');}
 if(url.origin+url.pathname!=='https://datacenter-web.eastmoney.com/api/data/v1/get'||
    url.searchParams.get('reportName')!=='RPT_SHAREBONUS_DET'||
    url.searchParams.get('filter')!=='(SECURITY_CODE="'+symbol+'")'||
    url.username||url.password||url.hash)
  invalid('来源 URL 或证券身份不一致');
 const page=Number(url.searchParams.get('pageNumber'));
 if(!Number.isSafeInteger(page)||page<1||page>MAX_PAGES)
  invalid('原始分页序号无效');
 let doc;
 try{doc=JSON.parse(bytes.toString('utf8'));}catch{invalid('原始响应不是JSON');}
 const response=doc?.result;
 if(doc?.success!==true||!Array.isArray(response?.data)||
    !Number.isSafeInteger(response.count)||response.count<0||
    !Number.isSafeInteger(response.pages)||response.pages<0||
    response.data.length>500)
  invalid('原始响应业务结构不完整');
 return {page,wireHash:entry.sha256,receivedAt:entry.receivedAt,
  declaredCount:response.count,declaredPages:response.pages,rows:response.data};
}
function auditCorporateSourceLinkage({capture,settlements=[],now=Date.now()}={}){
 if(!Number.isSafeInteger(now)||now<=0||capture?.schemaVersion!==1||
    capture.source!=='public-stock-status-evidence'||
    typeof capture.symbol!=='string'||!/^\d{6}$/.test(capture.symbol)||
    capture.researchOnly!==true||capture.canTrade!==false||
    capture.verifiedLive!==false||
    !Number.isSafeInteger(capture.startedAt)||capture.startedAt<=0||
    !Number.isSafeInteger(capture.observedAt)||capture.observedAt<capture.startedAt||
    capture.observedAt>now||!Array.isArray(capture.rawEvidence)||
    !Array.isArray(settlements)||settlements.length>MAX_EVENTS)
  invalid('归档状态、研究权限、股票或检查时间');
 const group=capture.dividendEvents;
 const base={schemaVersion:1,mode:'corporate-source-row-linkage-research',
  symbol:capture.symbol,checkedAt:new Date(now).toISOString(),
  source:'eastmoney-dividend-event-report',sourceAuthenticated:false,
  exchangeVerified:false,originalPublicationInstantVerified:false,
  corporateActionsVerified:false,pointInTimeBacktestReady:false,
  canApplySettlement:false,canTrade:false,canNotify:false,
  note:'只证明本地存档原字节、提取字段和结算ID的对应关系。公告日期可能仅有日精度；首次采集不能倒填历史，分红到账日不等于除权日。'};
 if(!group||group.status!=='observed-unverified'||group.coverage?.complete!==true||
    !Array.isArray(group.records))
  return {...base,status:'source-coverage-incomplete',sourceRowCount:0,
   settlementCount:settlements.length,bySettlement:[],rawEvidenceHashes:[]};
 const evidence=capture.rawEvidence.filter(e=>e?.source==='eastmoney:dividendEvents');
 if(evidence.length<1||evidence.length>MAX_PAGES)
  invalid('完整报告未附所需的原始供应商分页');
 const parsed=evidence.map(e=>readWire(e,capture.symbol,now)).sort((a,b)=>a.page-b.page);
 const expectedPages=Math.max(1,parsed[0].declaredPages);
 if(expectedPages!==parsed.length||group.coverage.fetchedPages!==parsed.length||
    group.coverage.pages!==parsed[0].declaredPages)
  invalid('原始分页覆盖不完整');
 const rows=new Map();let count=0;
 for(let i=0;i<parsed.length;i++){
  const wire=parsed[i];
  if(wire.page!==i+1||wire.declaredPages!==parsed[0].declaredPages||
     wire.declaredCount!==parsed[0].declaredCount||
     wire.receivedAt>capture.observedAt||wire.receivedAt<capture.startedAt)
   invalid('分页、总数或原始观察时间相互矛盾');
  for(const row of wire.rows){
   if(!row||typeof row!=='object'||Array.isArray(row)||
      row.SECURITY_CODE!==capture.symbol||
      (row.SECUCODE!==undefined&&!['.SH','.SZ','.BJ'].some(suffix=>
       row.SECUCODE===capture.symbol+suffix)))
    invalid('原始股票身份与查询对象不一致');
   const id=digest(Buffer.from(JSON.stringify(row)));
   if(rows.has(id))invalid('原始记录重复');
   const dates=Object.fromEntries(sourceFields.map(k=>[k,rawDate(row[k])]));
   rows.set(id,{id,knownAt:wire.receivedAt,dates,rawRow:row,wireHash:wire.wireHash});
   count++;
  }
 }
 if(count!==parsed[0].declaredCount||count!==group.coverage.fetchedCount||
    count!==group.records.length||count!==group.coverage.declaredCount)
  invalid('原始总数与规范化记录数量不匹配');
 const remaining=new Set(rows.keys());
 for(const normalized of group.records){
  const stored=rows.get(normalized?.sourceRecordId);
  if(!stored||!remaining.has(stored.id)||
     normalized.symbol!==capture.symbol||
     normalized.knownAt!==stored.knownAt)
   invalid('规范化证券、记录指纹或获知时间与原始行不一致');
  for(const field of sourceFields){
   if((normalized.vendorDates?.[field]?.raw??null)!==(stored.rawRow[field]??null))
    invalid('规范化源日期与原始字段不一致：'+field);
   const raw=stored.rawRow[field];
   const precision=raw==null||raw===''?null:
    raw.length===10||raw.endsWith(' 00:00:00')?'date':
    'vendor-datetime-seconds-timezone-unspecified';
   if((normalized.vendorDates?.[field]?.precision??null)!==precision||
      (normalized.vendorDates?.[field]?.publicationInstant??null)!==null)
    invalid('公告日期精度不一致或伪造源时间：'+field);
  }
  for(const [field,sourceField] of [
   ['exDividendDate','EX_DIVIDEND_DATE'],['equityRecordDate','EQUITY_RECORD_DATE'],
   ['planNoticeDate','PLAN_NOTICE_DATE'],['publishDate','PUBLISH_DATE']]){
   if(normalized[field]!==stored.dates[sourceField])
    invalid('规范化声明日期与原始日期不一致：'+field);
  }
  remaining.delete(stored.id);
 }
 const bySettlement=[],eventIds=new Set();
 for(const e of settlements){
  if(eventIds.has(e?.eventId))invalid('历史结算事件ID重复');
  eventIds.add(e?.eventId);
  try{validateSettlement(e,{now});}catch{invalid('结算事件本身的结构或生效时点不合法');}
  const issues=[],stored=rows.get(e.sourceRecordId);
  if(e.symbol!==capture.symbol)issues.push('DIFFERENT_SECURITY');
  if(e.provider!=='eastmoney')issues.push('PROVIDER_NOT_IDENTICAL');
  if(!stored)issues.push('UNLINKED_SOURCE_RECORD');
  let dateRelation='unknown',observedBeforeOpen=false,knownAt=null;
  if(stored){
   const dates=stored.dates,recordDay=dates.EQUITY_RECORD_DATE,
    exDay=dates.EX_DIVIDEND_DATE;
   knownAt=stored.knownAt;
   const openAt=Date.parse(e.effectiveDate+'T09:30:00+08:00');
   observedBeforeOpen=knownAt<=openAt;
   if(!observedBeforeOpen)issues.push('SOURCE_OBSERVED_AFTER_EFFECTIVE_OPEN');
   if(Date.parse(e.publishedAt)>openAt)issues.push('CLAIMED_PUBLICATION_AFTER_OPEN');
   if(recordDay===null||exDay===null)issues.push('MISSING_RECORD_OR_EX_DATE');
   if(recordDay&&exDay&&recordDay>=exDay)issues.push('RECORD_DATE_NOT_BEFORE_EX_DATE');
   if(dates.PLAN_NOTICE_DATE&&exDay&&dates.PLAN_NOTICE_DATE>exDay)
    issues.push('VENDOR_NOTICE_AFTER_EX_DATE');
   dateRelation=e.effectiveDate===exDay?'matches-reported-ex-date':
    'effective-date-role-not-proven-by-this-report';
   if(dateRelation!=='matches-reported-ex-date')
    issues.push('CASH_OR_SHARE_EFFECTIVE_DATE_NOT_PROVEN');
   // Vendor report dates may be midnight placeholders, NEVER a verified instant.
   if(dates.PUBLISH_DATE&&chinaDay(Date.parse(e.publishedAt))<dates.PUBLISH_DATE)
    issues.push('CLAIMED_PUBLICATION_BEFORE_REPORTED_DATE');
  }
  bySettlement.push({eventId:e.eventId,kind:e.kind,symbol:e.symbol,
   sourceRecordId:e.sourceRecordId,sourceKnownAt:knownAt,
   reportedRecordDate:stored?.dates.EQUITY_RECORD_DATE??null,
   reportedExDate:stored?.dates.EX_DIVIDEND_DATE??null,
   effectiveDate:e.effectiveDate,dateRelation,observedBeforeOpen,
   status:issues.length?'not-point-in-time-supported':'matched-row-only-not-certified',
   issues,verifiedExternal:false,canApplySettlement:false});
 }
 const linked=bySettlement.filter(x=>x.status==='matched-row-only-not-certified').length;
 return {...base,status:bySettlement.some(x=>x.issues.length)?
  'requires-source-review':'raw-row-linkage-consistent-unverified',
  sourceRowCount:rows.size,settlementCount:settlements.length,
  linkedSourceRows:linked,bySettlement,rawEvidenceHashes:parsed.map(x=>x.wireHash),
  sourceRowsMatchRawBytes:true,
  // Source data and date-only report fields never equal exchange authority.
  canApplySettlement:false};
}
module.exports={auditCorporateSourceLinkage};
