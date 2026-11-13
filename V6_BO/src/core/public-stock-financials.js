'use strict';
// Fixed public F10 endpoints, with raw-byte receipts and conservative availability.
const {createHash}=require('node:crypto');
const {requestResearchBytes,createResearchRequest,restrictionFields}=require('./research-curl-bytes');
const MAX_BYTES=512*1024;
const codeOK=s=>typeof s==='string'&&/^(?:60|68|00|30)\d{4}$/.test(s);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const date=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\d(?: 00:00:00)?$/.test(x)&&day(x.slice(0,10))?x.slice(0,10):null;
const flags={researchOnly:true,canTrade:false,canNotify:false,verifiedExternal:false};
const reference='https://github.com/akfamily/akshare/blob/main/akshare/stock/issue/stock_finance_sina.py';
function targetFor(symbol,kind){
 if(!codeOK(symbol)||!['period','quarter'].includes(kind))throw Error('财务请求身份无效');
 const filter='(SECUCODE="'+symbol+(symbol.startsWith('6')?'.SH':'.SZ')+'")';
 return kind==='period'?'https://datacenter.eastmoney.com/securities/api/data/get?'+new URLSearchParams({type:'RPT_F10_FINANCE_MAINFINADATA',sty:'APP_F10_MAINFINADATA',quoteColumns:'',filter,p:'1',ps:'12',sr:'-1',st:'REPORT_DATE',source:'HSF10',client:'PC'}):
  'https://datacenter.eastmoney.com/securities/api/data/v1/get?'+new URLSearchParams({reportName:'RPT_F10_QTR_MAINFINADATA',columns:'ALL',quoteColumns:'',filter,pageNumber:'1',pageSize:'12',sortTypes:'-1',sortColumns:'REPORT_DATE',source:'HSF10',client:'PC'});
}
async function requestFinancialBytes(target,options={}){
 const u=new URL(target),filter=u.searchParams.get('filter'),match=/^\(SECUCODE="(\d{6})\.(SH|SZ)"\)$/.exec(filter||'');
 if(!match||!['period','quarter'].some(k=>target===targetFor(match[1],k)))throw Error('禁止任意财务URL或参数');
 return requestResearchBytes(target,{...options,maxBytes:MAX_BYTES});
}
function parseFinancials(raw,{symbol,kind,receivedAt,period}){
 if(!codeOK(symbol)||!['period','quarter'].includes(kind)||!Number.isSafeInteger(receivedAt)||receivedAt<=0)throw Error('财务解析参数无效');
 const bytes=Buffer.isBuffer(raw)?raw:typeof raw==='string'?Buffer.from(raw):null;
 if(!bytes||bytes.length>MAX_BYTES)throw Error('缺少有界财务原始字节');
 const j=JSON.parse(bytes.toString('utf8')),today=new Date(receivedAt+28800000).toISOString().slice(0,10);
 if(j.success!==true||!Array.isArray(j.result?.data)||j.result.data.length>12)throw Error('财务响应错误或行数超限');
 const expected=symbol+(symbol.startsWith('6')?'.SH':'.SZ'),records=[],dates=new Set();
 for(const r of j.result.data){
  if(!r||r.SECURITY_CODE!==symbol||r.SECUCODE!==expected||(kind==='period'&&r.CURRENCY!=='CNY'))throw Error('财务证券或币种不一致');
  const reportDate=date(r.REPORT_DATE);
  // Quarter endpoint omits publication dates/currency: require the same report in the period receipt.
  const anchor=kind==='quarter'&&period?.symbol===symbol&&period.kind==='period'&&period.receivedAt<=receivedAt&&period.records?.find(x=>x.reportDate===reportDate);
  if(kind==='quarter'&&!anchor)throw Error('单季数据缺少同报告期证据');
  const publicationDate=kind==='quarter'?anchor.publicationDate:date(r.NOTICE_DATE),updatedDate=kind==='quarter'?anchor.updatedDate:date(r.UPDATE_DATE);
  if(!reportDate||!publicationDate||!/-((03-31)|(06-30)|(09-30)|(12-31))$/.test(reportDate)||publicationDate<reportDate||publicationDate>today||
    reportDate>today||!updatedDate||updatedDate>today||updatedDate<publicationDate||dates.has(reportDate))throw Error('财报日期、重复修订或可得性不明');
  dates.add(reportDate);
  const values=Object.fromEntries(['ROEJQ','ZCFZL','PARENTNETPROFITTZ','TOTALOPERATEREVETZ','NCO_NETPROFIT'].map(k=>[k,finite(r[k])?r[k]:null]));
  records.push({reportDate,publicationDate,updatedDate,periodKind:kind,currency:'CNY',publicationBasis:kind==='quarter'?'same-report-period-receipt':'supplier-row',values});
 }
 records.sort((a,b)=>a.reportDate.localeCompare(b.reportDate));
 return {symbol,kind,source:'eastmoney-financials',status:records.length?'observed-unverified':'unknown',receivedAt,
  rawHash:createHash('sha256').update(bytes).digest('hex'),...(kind==='quarter'?{periodRawHash:period.rawHash}:{}),records,reference,
  availabilityBasis:'local-receipt-of-this-revision; publication-and-update-have-date-precision',...flags};
}
async function fetchPublicStockFinancials({symbol}={},dependencies={}){
 if(!codeOK(symbol))throw Error('仅支持已核对接口的沪深A股代码');
 const {requestJson=requestFinancialBytes,requestGovernor,now=Date.now}=dependencies;
 const request=createResearchRequest(requestJson,requestFinancialBytes,requestGovernor),clock=()=>typeof now==='function'?now():now;
 const datasets={},errors=[],rawEvidence=[];
 for(const kind of ['period','quarter']){
  try{
   const url=targetFor(symbol,kind),response=await request(url,{maxBytes:MAX_BYTES}),receivedAt=clock();
   const raw=Buffer.isBuffer(response.raw)?response.raw:typeof response.raw==='string'?Buffer.from(response.raw):null;
   if(!raw||raw.length>MAX_BYTES)throw Error('财务响应无有效原始字节');
   const rawHash=createHash('sha256').update(raw).digest('hex');
   rawEvidence.push({source:'eastmoney-financials',url,receivedAt,encoding:'base64',data:raw.toString('base64'),sha256:rawHash,byteLength:raw.length});
   datasets[kind]=parseFinancials(raw,{symbol,kind,receivedAt,period:datasets.period});
  }catch(error){errors.push({kind,code:typeof error.code==='string'?error.code:'financial-source-invalid',...restrictionFields(error)});
   if(error.code==='MARKET_RESTRICTED')break;
  }
 }
 return {schemaVersion:1,symbol,source:'eastmoney-financials',datasets,errors,rawEvidence,...flags};
}
function financialFeatures(financials,{code,asOf}){
 if(financials?.symbol!==code||financials.source!=='eastmoney-financials'||financials.simulated===true||financials.retracted===true)return {};
 const output={},valid=d=>d&&d.simulated!==true&&d.retracted!==true&&d.symbol===code&&d.status==='observed-unverified'&&d.source==='eastmoney-financials'&&
  /^[a-f0-9]{64}$/.test(d.rawHash||'')&&Number.isSafeInteger(d.receivedAt)&&d.receivedAt>0&&d.receivedAt<=asOf&&Array.isArray(d.records)&&d.records.length<=12&&d.records.every((r,i)=>r&&day(r.reportDate)&&day(r.publicationDate)&&day(r.updatedDate)&&r.publicationDate>=r.reportDate&&r.updatedDate>=r.publicationDate&&r.updatedDate<=new Date(d.receivedAt+28800000).toISOString().slice(0,10)&&r.values&&typeof r.values==='object'&&(!i||r.reportDate>d.records[i-1].reportDate));
 const put=(field,value,d,r)=>{if(finite(value))output[field]={code,value,unit:field==='operatingCashToProfit'?'ratio':'percent',source:'eastmoney-financials',
  evidenceId:d.rawHash+':'+(d.periodRawHash||'')+':'+r.reportDate+':'+field,observedAt:Date.parse(r.reportDate+'T23:59:59+08:00'),availableAt:d.receivedAt,recordedAt:d.receivedAt,
  reportDate:r.reportDate,publicationDate:r.publicationDate,updatedDate:r.updatedDate,periodKind:d.kind,verifiedExternal:false};};
 const period=financials.datasets?.period,quarter=financials.datasets?.quarter;
 if(valid(period)&&period.kind==='period'&&period.records.length){
  const r=period.records.at(-1),prior=period.records.find(p=>p.reportDate===String(Number(r.reportDate.slice(0,4))-1)+r.reportDate.slice(4));
  put('roePct',r.values.ROEJQ,period,r);put('debtAssetsPct',r.values.ZCFZL,period,r);
  if(prior)put('roePriorYearPct',prior.values.ROEJQ,period,prior);
  // ROE is the actual report-period cumulative percentage, never annualized.
  // NCO_NETPROFIT and FCFF fields remain unmapped until source unit semantics are verified.
 }
 if(valid(quarter)&&valid(period)&&quarter.periodRawHash===period.rawHash&&quarter.receivedAt>=period.receivedAt&&quarter.kind==='quarter'&&quarter.records.length){
  const r=quarter.records.at(-1),p=quarter.records.at(-2);
  put('earningsGrowthPct',r.values.PARENTNETPROFITTZ,quarter,r);put('revenueGrowthPct',r.values.TOTALOPERATEREVETZ,quarter,r);
  const ordinal=d=>Number(d.slice(0,4))*4+Number(d.slice(5,7))/3;
  if(p&&ordinal(r.reportDate)-ordinal(p.reportDate)===1&&finite(r.values.PARENTNETPROFITTZ)&&finite(p.values.PARENTNETPROFITTZ))put('earningsGrowthAccelerationPct',r.values.PARENTNETPROFITTZ-p.values.PARENTNETPROFITTZ,quarter,r);
 }
 return output;
}
module.exports={targetFor,requestFinancialBytes,parseFinancials,fetchPublicStockFinancials,financialFeatures};
