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
 if(!COUNTRY.test(country||'')||!INDICATOR.test(indicator||'')||
  !Number.isSafeInteger(startYear)||!Number.isSafeInteger(endYear)||
  !YEAR.test(String(startYear))||!YEAR.test(String(endYear))||
  startYear>endYear||endYear-startYear>60||
  endYear>new Date(now+8*3600000).getUTCFullYear()||
  !Number.isSafeInteger(now)||now<=0)
  throw Error('世界银行数据国家、指标、时间区间或采集时钟不合法');
}
function parseWorldBankResponse(payload,{country,indicator,startYear,endYear,observedAt}){
 if(!Array.isArray(payload)||payload.length!==2||!Array.isArray(payload[1])||
  payload[1].length>endYear-startYear+1||Number(payload[0]?.pages)!==1)
  throw Error('World Bank指标响应结构或分页越界');
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
 return {schemaVersion:1,mode:'macro-official-api-research',provider:'worldbank',
  upstreamGroup:'worldbank',sourceUrl:'https://api.worldbank.org/v2',
  country,indicator,startYear,endYear,observedAt,rows,
  sourceRevisionKnown:false,publicationVintageVerified:false,
  tradable:false,canTrade:false,canNotify:false,verifiedLive:false,verifiedExternal:false,
  warning:'World Bank官方API的数值和年份不是市场实时行情，公布/修订历史未知；必须按数据集许可署名，不可用于回测中的未来信息'};
}
async function collectWorldBankIndicator({country,indicator,startYear,endYear,now=Date.now(),
 fetchImpl=globalThis.fetch,timeoutMs=10000}={}){
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
 let bytes;
 if(response.body&&typeof response.body[Symbol.asyncIterator]==='function'){
  let total=0;const chunks=[];
  for await(const chunk of response.body){
   total+=chunk.length;if(total>128*1024)throw Error('World Bank响应超过128KiB');
   chunks.push(chunk);
  }
  bytes=Buffer.concat(chunks).toString('utf8');
 }else{
  const str=await response.text();
  if(Buffer.byteLength(str)>128*1024)throw Error('World Bank响应超过128KiB');
  bytes=str;
 }
 return parseWorldBankResponse(JSON.parse(bytes),{country,indicator,startYear,endYear,observedAt:now});
}
module.exports={validate,parseWorldBankResponse,collectWorldBankIndicator};
