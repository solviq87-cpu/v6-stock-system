'use strict';
// Evidence archive only. These reports do not certify daily tradability or the
// absence of corporate actions, and never populate the strict history flags.
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),{createHash}=require('node:crypto'),{performance}=require('node:perf_hooks');
const run=promisify(execFile),MAX_BYTES=2*1024*1024,MAX_REQUESTS=8,MAX_TOTAL_MS=35000;
const EM='https://datacenter-web.eastmoney.com/api/data/v1/get',TX='https://qt.gtimg.cn/q=';
const REPORTS={dividendEvents:'RPT_SHAREBONUS_DET',suspensionAnnouncements:'RPT_CUSTOM_SUSPEND_DATA_INTERFACE'};
const REFERENCES={dividendEvents:'https://github.com/akfamily/akshare/blob/main/akshare/stock/issue/stock_fhps_em.py',suspensionAnnouncements:'https://github.com/akfamily/akshare/blob/main/akshare/stock/issue/stock_tfp_em.py',priceLimits:'https://github.com/shidenggui/easyquotation/blob/master/easyquotation/tencent.py'};
const symbolOK=s=>typeof s==='string'&&/^(?:(?:600|601|603|605|688|000|001|002|003|300|301)\d{3}|(?:43|83|87|88|92)\d{4})$/.test(s);
const dateOK=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const chinaDay=t=>new Date(t+28800000).toISOString().slice(0,10);
const market=s=>s.startsWith('6')?'sh':/^[03]/.test(s)?'sz':'bj';
const issue=(code,message)=>Object.assign(new Error(message),{code});
const sha=b=>createHash('sha256').update(b).digest('hex');
const numeric=v=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v)&&Number.isFinite(Number(v))?Number(v):null;
const text=v=>typeof v==='string'?v.slice(0,2000):null;
function clockValue(clock){const t=clock();if(!Number.isSafeInteger(t)||t<=0)throw issue('invalid-clock','采集时钟无效');return t;}
function reportUrl(kind,symbol,date,page){
 return EM+'?'+new URLSearchParams({sortColumns:kind==='dividendEvents'?'REPORT_DATE':'SUSPEND_START_DATE',sortTypes:'-1',pageSize:'500',pageNumber:String(page),reportName:REPORTS[kind],columns:'ALL',source:'WEB',client:'WEB',filter:kind==='dividendEvents'?`(SECURITY_CODE="${symbol}")`:`(MARKET="全部")(DATETIME='${date}')`});
}
function validateUrl(target){
 const u=new URL(target);if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)throw issue('invalid-endpoint','禁止任意URL');
 if(u.origin==='https://qt.gtimg.cn'){
  const m=/^\/q=(sh|sz|bj)(\d{6})$/.exec(u.pathname);
  if(!m||!symbolOK(m[2])||market(m[2])!==m[1]||u.search)throw issue('invalid-endpoint','腾讯地址仅允许单只A股');return;
 }
 if(u.origin+u.pathname!==EM)throw issue('invalid-endpoint','禁止任意URL');
 const p=u.searchParams,kind=Object.keys(REPORTS).find(k=>REPORTS[k]===p.get('reportName'));
 const dividend=/^\(SECURITY_CODE="(\d{6})"\)$/.exec(p.get('filter')||''),suspension=/^\(MARKET="全部"\)\(DATETIME='(\d{4}-\d{2}-\d{2})'\)$/.exec(p.get('filter')||'');
 if(!kind||kind==='dividendEvents'&&(!dividend||!symbolOK(dividend[1]))||kind==='suspensionAnnouncements'&&(!suspension||!dateOK(suspension[1])))throw issue('invalid-endpoint','仅允许固定证券/日期报告');
 const page=Number(p.get('pageNumber'));
 const expected=reportUrl(kind,dividend?.[1]||'600000',suspension?.[1]||'2000-01-01',page);
 if(!Number.isSafeInteger(page)||page<1||page>MAX_REQUESTS||u.href!==expected)throw issue('invalid-endpoint','报告参数不在固定白名单');
}
async function requestPublicStockStatusRaw(target,{timeoutMs=12000,processTimeoutMs=13000}={}){
 validateUrl(target);
 const transfer=Math.max(1,Math.min(12000,timeoutMs)),processLimit=Math.max(1,Math.min(13000,processTimeoutMs));
 const {stdout}=await run('curl',['--fail','--silent','--show-error','--max-time',String(transfer/1000),'--max-filesize',String(MAX_BYTES),'--proto','=https','--user-agent','Mozilla/5.0',target],{timeout:processLimit,maxBuffer:MAX_BYTES,encoding:'buffer'});
 return {raw:stdout};
}
function temporal(value){
 if(value==null||value==='')return {raw:value??null,date:null,precision:null,publicationInstant:null};
 if(typeof value!=='string')throw issue('invalid-date','报告日期字段不是原始字符串');
 const date=value.slice(0,10);
 if(!dateOK(date)||!/^\d{4}-\d{2}-\d{2}(?: [0-2]\d:[0-5]\d:[0-5]\d)?$/.test(value)||value.length>10&&+value.slice(11,13)>23)throw issue('invalid-date','报告日期字段无效');
 return {raw:value,date,precision:value.length===10||value.endsWith(' 00:00:00')?'date':'vendor-datetime-seconds-timezone-unspecified',publicationInstant:null};
}
function record(kind,row,symbol,receivedAt){
 if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.SECURITY_CODE!=='string'||!/^\d{6}$/.test(row.SECURITY_CODE)||row.SECUCODE!==undefined&&!(typeof row.SECUCODE==='string'&&new RegExp('^'+row.SECURITY_CODE+'\\.(?:SH|SZ|BJ)$').test(row.SECUCODE)))throw issue('source-identity','报告缺少有效证券身份');
 if(kind==='dividendEvents'&&row.SECURITY_CODE!==symbol)throw issue('source-identity','分红报告证券不一致');
 if(row.SECURITY_CODE!==symbol)return null;
 const fields=kind==='dividendEvents'?['REPORT_DATE','PLAN_NOTICE_DATE','EQUITY_RECORD_DATE','EX_DIVIDEND_DATE','NOTICE_DATE','PUBLISH_DATE']:['SUSPEND_START_TIME','SUSPEND_END_TIME','SUSPEND_START_DATE','PREDICT_RESUME_DATE'];
 const vendorDates=Object.fromEntries(fields.map(k=>[k,temporal(row[k])])),base={symbol,name:text(row.SECURITY_NAME_ABBR),knownAt:receivedAt,vendorDates};
 if(kind==='dividendEvents')return {...base,reportDate:vendorDates.REPORT_DATE.date,exDividendDate:vendorDates.EX_DIVIDEND_DATE.date,equityRecordDate:vendorDates.EQUITY_RECORD_DATE.date,planNoticeDate:vendorDates.PLAN_NOTICE_DATE.date,noticeDate:vendorDates.NOTICE_DATE.date,publishDate:vendorDates.PUBLISH_DATE.date,planText:text(row.IMPL_PLAN_PROFILE),progress:text(row.ASSIGN_PROGRESS),pretaxBonusRmb:numeric(row.PRETAX_BONUS_RMB),scope:'vendor-dividend-and-bonus-plans; not-all-corporate-actions'};
 return {...base,suspendStartDate:vendorDates.SUSPEND_START_DATE.date,suspendStartTime:vendorDates.SUSPEND_START_TIME.raw,suspendEndTime:vendorDates.SUSPEND_END_TIME.raw,predictResumeDate:vendorDates.PREDICT_RESUME_DATE.date,announcementTime:null,reason:text(row.SUSPEND_REASON),durationText:text(row.SUSPEND_EXPIRE),scope:'vendor-suspension-announcements-and-plans; not-a-daily-trading-status-table'};
}
function quoteLimits(raw,symbol,date,receivedAt){
 const key=market(symbol)+symbol,body=new TextDecoder('gb18030').decode(raw),m=new RegExp('^\\s*v_'+key+'="([^"\\r\\n]*)";?\\s*$').exec(body);
 if(!m)throw issue('source-identity','腾讯报价文本或证券不匹配');
 const f=m[1].split('~');if(f[2]!==symbol||!/^\d{14}$/.test(f[30]||''))throw issue('source-identity','腾讯报价证券/原始时间无效');
 const s=f[30],iso=`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)}+08:00`,quoteAt=Date.parse(iso);
 if(!Number.isSafeInteger(quoteAt)||new Date(quoteAt+28800000).toISOString().replace(/[-:T]/g,'').slice(0,14)!==s||quoteAt>receivedAt)throw issue('invalid-quote-time','腾讯原始报价时间无效或来自未来');
 const up=numeric(f[47]),down=numeric(f[48]);if(up===null||down===null||down<=0||up<=down)throw issue('missing-price-limits','腾讯没有有效实际涨跌停价');
 const tradeDate=chinaDay(quoteAt),openAt=Date.parse(date+'T09:30:00+08:00'),sameDay=tradeDate===date;
 return {status:sameDay?'observed-unverified':'dated-snapshot',source:'tencent',symbol,tradeDate,quoteAt,receivedAt,limitUpPrice:up,limitDownPrice:down,limitKnownAt:receivedAt,preopenObserved:sameDay&&chinaDay(receivedAt)===date&&receivedAt<openAt,sourceTimestamp:quoteAt,fieldMappingSource:REFERENCES.priceLimits,scope:'vendor-current-quote; not-historical-price-limits'};
}
async function fetchPublicStockStatusEvidence({symbol,date}={}, {now=Date.now,requestJson=requestPublicStockStatusRaw}={}){
 if(!symbolOK(symbol))throw Error('A股代码无效');
 const clock=typeof now==='function'?now:()=>now,startedAt=clockValue(clock);date=date===undefined?chinaDay(startedAt):date;
 if(!dateOK(date)||date>chinaDay(startedAt))throw Error('查询日期无效或来自未来');
 const errors=[],rawEvidence=[],deadline=performance.now()+MAX_TOTAL_MS,queue=[];let active=0,requestCount=0;
 const addError=(source,e)=>errors.push({source,code:typeof e.code==='string'?e.code:'source-failed',message:String(e.stderr||e.message||e).trim().slice(0,240)});
 function pump(){while(active<2&&queue.length){const job=queue.shift();active++;job().finally(()=>{active--;pump();});}}
 function fetchRaw(target,source){return new Promise((resolve,reject)=>{queue.push(async()=>{
  let timer;
  try{
   const remaining=Math.floor(deadline-performance.now());if(remaining<=0)throw issue('total-time-budget','证据采集超过35秒总预算');if(requestCount>=MAX_REQUESTS)throw issue('request-budget','证据采集超过8次总请求预算');requestCount++;
   const response=await Promise.race([requestJson(target,{maxBytes:MAX_BYTES,timeoutMs:Math.min(12000,remaining),processTimeoutMs:Math.min(13000,remaining)}),new Promise((_,fail)=>{timer=setTimeout(()=>fail(issue('request-timeout','证据请求超时')),Math.min(13000,remaining));})]);
   const receivedAt=clockValue(clock);if(receivedAt<startedAt)throw issue('invalid-clock','响应接收时钟早于请求');
   if(!response||!(Buffer.isBuffer(response.raw)||typeof response.raw==='string'))throw issue('missing-raw-bytes','证据请求必须返回原始字节');
   const raw=Buffer.isBuffer(response.raw)?response.raw:Buffer.from(response.raw,'utf8');if(raw.length>MAX_BYTES)throw issue('response-too-large','证据响应超过2MiB');
   rawEvidence.push({encoding:'base64',data:raw.toString('base64'),sha256:sha(raw),byteLength:raw.length,source,url:target,receivedAt});resolve({raw,receivedAt});
  }catch(e){reject(e);}finally{clearTimeout(timer);}
 });pump();});}
 async function reports(kind){
  const result={status:'unknown',source:'eastmoney',records:[],coverage:{declaredCount:null,fetchedCount:0,pages:null,fetchedPages:0,complete:false},absenceClaim:null,sourceTimestamp:null,fieldMappingSource:REFERENCES[kind]};
  const seen=new Set();let stable=true,declaredPages=null,declaredCount=null;
  try{
   for(let page=1;page<=MAX_REQUESTS;page++){
    const {raw,receivedAt}=await fetchRaw(reportUrl(kind,symbol,date,page),'eastmoney:'+kind),j=JSON.parse(raw.toString('utf8')),d=j?.result;
    if(j?.success!==true||!d||!Array.isArray(d.data)||d.data.length>500)throw issue('invalid-report','东财报告缺少有效结果');
    if(!Number.isSafeInteger(d.count)||d.count<0||!Number.isSafeInteger(d.pages)||d.pages<0||d.pages===0&&d.count!==0)throw issue('missing-coverage','东财报告缺少明确分页与总数');
    if(page===1){declaredPages=d.pages;declaredCount=d.count;result.coverage.declaredCount=d.count;result.coverage.pages=d.pages;}
    else if(d.pages!==declaredPages||d.count!==declaredCount)stable=false;
    result.coverage.fetchedPages++;result.coverage.fetchedCount+=d.data.length;
    for(const row of d.data){const parsed=record(kind,row,symbol,receivedAt),signature=JSON.stringify(row);if(seen.has(signature)){stable=false;continue;}seen.add(signature);if(parsed)result.records.push(parsed);}
    if(!stable)throw issue('unstable-pagination','报告分页总数变化或记录重复');
    if(page>=Math.max(1,declaredPages))break;
   }
   result.coverage.complete=stable&&result.coverage.fetchedPages===Math.max(1,declaredPages)&&result.coverage.fetchedCount===declaredCount&&seen.size===declaredCount;
   result.status=result.coverage.complete?'observed-unverified':'partial';
   if(!result.coverage.complete)addError(kind,issue('incomplete-pagination','报告未完整获取全部声明分页/记录'));
  }catch(e){result.status=result.coverage.fetchedPages?'partial':'unknown';addError(kind,e);}
  return result;
 }
 const [dividendEvents,suspensionAnnouncements,priceLimits]=await Promise.all([reports('dividendEvents'),reports('suspensionAnnouncements'),(async()=>{
  try{const {raw,receivedAt}=await fetchRaw(TX+market(symbol)+symbol,'tencent:priceLimits');return quoteLimits(raw,symbol,date,receivedAt);}catch(e){addError('priceLimits',e);return {status:'unknown',source:'tencent',symbol,tradeDate:null,quoteAt:null,receivedAt:null,limitUpPrice:null,limitDownPrice:null,limitKnownAt:null,preopenObserved:false};}
 })()]);
 return {schemaVersion:1,source:'public-stock-status-evidence',symbol,status:[dividendEvents,suspensionAnnouncements,priceLimits].some(v=>v.status==='observed-unverified')?'observed-unverified':'unknown',startedAt,observedAt:clockValue(clock),requestedDate:date,dividendEvents,suspensionAnnouncements,priceLimits,errors,rawEvidence,requestCount,bounds:{maxRequests:MAX_REQUESTS,maxConcurrency:2,totalTimeoutMs:MAX_TOTAL_MS,maxResponseBytes:MAX_BYTES},uncertainties:['公告和计划不等于逐日交易状态；未出现不证明可交易或非ST','分红送配只覆盖供应商事件范围，不证明不存在所有公司行动','公告原文日期精度保留；knownAt只表示本系统实际收到响应的时间','盘后/跨日限价仅归档；只有目标日盘前实际收到的同日报价才标preopenObserved','供应商时间、完整性和数据许可未获交易所独立认证'],researchOnly:true,verifiedLive:false,canTrade:false,canNotify:false};
}
module.exports={fetchPublicStockStatusEvidence,requestPublicStockStatusRaw};
