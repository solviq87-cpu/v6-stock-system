'use strict';
/**
 * Opt-in official World Bank Indicator API V2 RESEARCH ingestion.
 * The API reports data-years, not the original publication/vintage timestamp.
 * Never treat response receipt as point-in-time knowledge or as a quote.
 */
const ENDPOINT='https://api.worldbank.org';
const YEAR=/^(?:19|20)\d{2}$/;
const COUNTRY=/^[A-Z]{3}$/;
const INDICATOR=/^[A-Z][A-Z0-9.]{2,39}$/;
function validate({country,indicator,startYear,endYear,now=Date.now()}={}){
 if(typeof country!=='string'||!COUNTRY.test(country)||typeof indicator!=='string'||!INDICATOR.test(indicator)||
  !Number.isSafeInteger(startYear)||!Number.isSafeInteger(endYear)||
  !YEAR.test(String(startYear))||!YEAR.test(String(endYear))||
  startYear>endYear||endYear-startYear>60||
  !Number.isSafeInteger(now)||now<=0||now>8e15||
  endYear>new Date(now+8*3600000).getUTCFullYear())
  throw Error('世界银行数据国家、指标、时间区间或采集时钟不合法');
}
// Accept explicit decimal metadata strings from the API, not JS coercions.
const metadataCount=v=>{
 if(typeof v!=='number'&&(typeof v!=='string'||!/^\d{1,16}$/.test(v)))return null;
 const n=Number(v);return Number.isSafeInteger(n)&&n>=0?n:null;
};
function parseWorldBankResponse(payload,{country,indicator,startYear,endYear,observedAt}={}){
 if(!Number.isSafeInteger(observedAt)||observedAt<=0||observedAt>8e15)throw Error('World Bank接收时钟无效');
 validate({country,indicator,startYear,endYear,now:observedAt});
 if(!Array.isArray(payload)||payload.length!==2||!Array.isArray(payload[1])||
  payload[1].length>endYear-startYear+1||metadataCount(payload[0]?.pages)!==1)
  throw Error('World Bank指标响应结构或分页越界');
 const meta=payload[0],length=payload[1].length;
 if(meta.page!==undefined&&metadataCount(meta.page)!==1||
    meta.total!==undefined&&metadataCount(meta.total)!==length||
    meta.per_page!==undefined&&(metadataCount(meta.per_page)===null||metadataCount(meta.per_page)<Math.max(1,length)))
  throw Error('World Bank分页元数据与实际行数矛盾');
 const seen=new Set(),rows=[];
 for(const x of payload[1]){
  if(!x||x.countryiso3code!==country||x.indicator?.id!==indicator||
    typeof x.date!=='string'||!YEAR.test(x.date)||seen.has(x.date)||
    Number(x.date)<startYear||Number(x.date)>endYear||
    !(x.value===null||(typeof x.value==='number'&&Number.isFinite(x.value))))
   throw Error('World Bank响应代码、年份、数值或缺失值异常');
  seen.add(x.date);
  // A real zero stays zero, a missing value stays NULL. Do not fill gaps.
  rows.push({year:Number(x.date),value:x.value,
   sourceCountry:country,indicator,unit:'provider-declared-unknown',
   providerPublishedAt:null,collectorObservedAt:observedAt,
   publicationVintageVerified:false});
 }
 if(!rows.length)throw Error('世界银行在请求区间无记录');
 rows.sort((a,b)=>a.year-b.year);
 const omittedYears=Array.from({length:endYear-startYear+1},(_,i)=>startYear+i).filter(year=>!seen.has(String(year)));
 const knownValueYears=rows.filter(row=>row.value!==null).length;
 return {schemaVersion:1,mode:'macro-official-api-research',provider:'worldbank',
  upstreamGroup:'worldbank',sourceUrl:'https://api.worldbank.org/v2',
  country,indicator,startYear,endYear,observedAt,rows,
  coverage:{requestedYears:endYear-startYear+1,returnedYears:rows.length,knownValueYears,
   explicitMissingValueYears:rows.length-knownValueYears,omittedYears,
   yearRowsComplete:omittedYears.length===0,allValuesKnown:omittedYears.length===0&&knownValueYears===rows.length,
   publicationCoverageVerified:false},
  sourceRevisionKnown:false,publicationVintageVerified:false,
  tradable:false,canTrade:false,canNotify:false,verifiedLive:false,verifiedExternal:false,
  warning:'World Bank官方API的数值和年份不是市场实时行情，公布/修订历史未知；必须按数据集许可署名，不可用于回测中的未来信息'};
}
async function collectWorldBankIndicator({country,indicator,startYear,endYear,clock=Date.now,now=clock(),
 fetchImpl=globalThis.fetch,timeoutMs=10000,archiveRoot}={}){
 validate({country,indicator,startYear,endYear,now});
 if(typeof fetchImpl!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<250||timeoutMs>20000)
  throw Error('采集器参数无效');
 const url=new URL('/v2/country/'+country+'/indicator/'+indicator,ENDPOINT);
 url.searchParams.set('format','json');
 url.searchParams.set('date',startYear+':'+endYear);
 url.searchParams.set('per_page','100');
 const response=await fetchImpl(url.href,{method:'GET',redirect:'error',
  signal:AbortSignal.timeout(timeoutMs),headers:{Accept:'application/json'}});
 if(!response?.ok)throw Error('World Bank官方API返回HTTP '+(response?.status||'unknown'));
 const type=response.headers?.get?.('content-type');
 if(type&&!/^(?:application\/json|application\/[\w.+-]+\+json)(?:;|\s*$)/i.test(type))
  throw Error('World Bank返回非JSON结构');
 let bytes,rawBytes,byteBasis;
 if(response.body&&typeof response.body[Symbol.asyncIterator]==='function'){
  let total=0;const chunks=[];
  for await(const chunk of response.body){
   total+=chunk.length;if(total>128*1024)throw Error('World Bank响应超过128KiB');
   chunks.push(chunk);
  }
  rawBytes=Buffer.concat(chunks);bytes=rawBytes.toString('utf8');byteBasis='response-body';
 }else{
  const str=await response.text();
  if(Buffer.byteLength(str)>128*1024)throw Error('World Bank响应超过128KiB');
  bytes=str;rawBytes=Buffer.from(str,'utf8');byteBasis='decoded-body-text';
 }
 const observedAt=clock();
 if(!Number.isSafeInteger(observedAt)||observedAt<now||observedAt>8e15)throw Error('World Bank接收时钟无效或早于请求');
 const result={...parseWorldBankResponse(JSON.parse(bytes),{country,indicator,startYear,endYear,observedAt}),requestStartedAt:now,observationTimeBasis:'local-body-receipt'};
 return archiveRoot===undefined?result:require('./market-data-evidence').archiveBackgroundResult(result,{root:archiveRoot,raw:rawBytes,byteBasis,scope:{country,indicator,startYear,endYear}});
}
function annualBackgroundComparison(snapshot){
 const currentYear=snapshot.endYear,previousYear=currentYear-1;
 const valueFor=year=>{
  const rows=snapshot.rows.filter(r=>r.year===year);
  return rows.length===1&&typeof rows[0].value==='number'&&Number.isFinite(rows[0].value)?rows[0].value:null;
 };
 const currentValue=valueFor(currentYear),previousValue=previousYear>=snapshot.startYear?valueFor(previousYear):null;
 const difference=currentValue!==null&&previousValue!==null?currentValue-previousValue:null;
 const delta=Number.isFinite(difference)?difference:null;
 return {status:delta===null?'unknown':'descriptive-local-snapshot',currentYear,previousYear,currentValue,previousValue,delta,
  direction:delta===null?'unknown':delta>0?'increase':delta<0?'decrease':'unchanged',unit:null,creditEconomicState:null,expectationGap:null,
  sourcePublicationVintageVerified:false,pointInTimeBacktestReady:false,canTrade:false,
  note:'同一已归档年度指标的原数值差，不是同比增长率、实时资金或经济状态；历史首次公布及修订时间未知'};
}
module.exports={validate,parseWorldBankResponse,collectWorldBankIndicator,annualBackgroundComparison};
