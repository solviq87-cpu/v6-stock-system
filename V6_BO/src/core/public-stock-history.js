'use strict';

// Independent research intake: never use the adjusted display cache in em.js.
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {createHash}=require('node:crypto');
const run=promisify(execFile),MAX_BYTES=2*1024*1024;
const ENDPOINTS={eastmoney:'https://push2his.eastmoney.com/api/qt/stock/kline/get',tencent:'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get'};
const REFERENCES={
 eastmoney:'https://github.com/akfamily/akshare/blob/main/akshare/stock/quote/stock_hist_em.py',
 eastmoneyUnits:'https://github.com/akfamily/akshare/blob/main/docs/data/stock/stock_quote.md#stock_zh_a_hist',
 tencent:'https://github.com/akfamily/akshare/blob/main/akshare/stock/quote/stock_hist_tx.py',
 tencentUnits:'https://github.com/akfamily/akshare/blob/main/akshare/index/index_stock_zh.py#L335-L345'
};
const symbolOK=s=>typeof s==='string'&&/^(?:(?:600|601|603|605|688|000|001|002|003|300|301)\d{3}|(?:43|83|87|88|92)\d{4})$/.test(s);
const dateOK=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const numeric=x=>typeof x==='number'&&Number.isFinite(x)?x:typeof x==='string'&&/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(x)?Number(x):NaN;
const market=s=>s.startsWith('6')?'sh':/^(?:0|3)/.test(s)?'sz':'bj';
const failure=(code,message)=>Object.assign(new Error(message),{code});
function checkedTime(clock){const t=clock();if(!Number.isSafeInteger(t)||t<=0)throw Error('采集时钟无效');return t;}
function targetFor(provider,symbol,days){
 const params=provider==='eastmoney'?{secid:(market(symbol)==='sh'?'1.':'0.')+symbol,klt:'101',fqt:'0',lmt:String(days),end:'20500101',fields1:'f1,f2,f3,f4,f5,f6',fields2:'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'}:{param:`${market(symbol)}${symbol},day,,,${days},`};
 return ENDPOINTS[provider]+'?'+new URLSearchParams(params);
}
async function requestPublicStockJson(target){
 const u=new URL(target),provider=Object.keys(ENDPOINTS).find(p=>ENDPOINTS[p]===u.origin+u.pathname);
 if(!provider||u.protocol!=='https:'||u.username||u.password||u.hash||u.port)throw failure('invalid-endpoint','禁止任意URL');
 const params=u.searchParams;
 if(provider==='eastmoney'){
  const secid=params.get('secid')||'',symbol=secid.slice(2);
  if(!symbolOK(symbol)||secid!==(market(symbol)==='sh'?'1.':'0.')+symbol||params.get('fqt')!=='0'||params.get('klt')!=='101')throw failure('invalid-request','仅允许未复权A股日K');
 }else{
  const match=/^(sh|sz|bj)(\d{6}),day,,,(\d+),$/.exec(params.get('param')||'');
  if(!match||!symbolOK(match[2])||market(match[2])!==match[1])throw failure('invalid-request','仅允许未复权A股日K');
 }
 // execFile preserves inherited proxy/CA settings, uses no shell or retries,
 // follows no redirects, and bounds both transfer and child lifetime.
 const {stdout}=await run('curl',['--fail','--silent','--show-error','--max-time','12','--max-filesize',String(MAX_BYTES),'--proto','=https','--user-agent','Mozilla/5.0','--header','Accept: application/json',target],{timeout:13000,maxBuffer:MAX_BYTES,encoding:'buffer'});
 if(stdout.length>MAX_BYTES)throw failure('response-too-large','响应超过2MiB');
 return {raw:stdout};
}
function decode(returned){
 // A serialized object is not evidence of actual response bytes. Test adapters
 // must supply raw too; parse those bytes rather than trusting a second object.
 if(!returned||!(typeof returned.raw==='string'||Buffer.isBuffer(returned.raw)))throw failure('missing-raw-bytes','缺少原始响应字节');
 const raw=Buffer.isBuffer(returned.raw)?returned.raw:Buffer.from(returned.raw,'utf8');
 if(raw.length>MAX_BYTES)throw failure('response-too-large','响应超过2MiB');
 return {json:JSON.parse(raw.toString('utf8')),rawHash:createHash('sha256').update(raw).digest('hex'),rawByteLength:raw.length,raw};
}
function rowsFor(json,provider,symbol){
 if(provider==='eastmoney'){
  const d=json?.data;
  if(json?.rc!==0||!d||d.code!==symbol||d.market!==(market(symbol)==='sh'?1:0)||!Array.isArray(d.klines))throw failure('source-identity','东财日K错误或证券身份缺失/不一致');
  return {rows:d.klines,name:typeof d.name==='string'?d.name.slice(0,80):null};
 }
 const key=market(symbol)+symbol,d=json?.data?.[key];
 if(json?.code!==0||!d||!Array.isArray(d.day))throw failure('source-identity','腾讯缺少对应证券原始day日K');
 const qt=d.qt?.[key];
 if(qt!==undefined&&(!Array.isArray(qt)||qt[2]!==symbol))throw failure('source-identity','腾讯快照证券身份不一致');
 return {rows:d.day,name:typeof qt?.[1]==='string'?qt[1].slice(0,80):null};
}
function normalize(rows,{provider,symbol,receivedAt,historyDays}){
 if(rows.length>2000)throw failure('too-many-rows','日K行数超过限制');
 const date=new Date(receivedAt+8*3600000).toISOString().slice(0,10),chinaMinute=new Date(receivedAt+8*3600000).getUTCHours()*60+new Date(receivedAt+8*3600000).getUTCMinutes();
 // The old Tencent endpoint has six price/volume fields, optionally followed
 // by a dividend annotation object. Extras are raw evidence, never amount or
 // independently authenticated point-in-time corporate-action evidence.
 // Its board-specific
 // STAR/BSE unit behavior is not established by the newfqkline source above.
 const multiplier=provider==='tencent'&&(symbol.startsWith('688')||market(symbol)==='bj')?null:100;
 const bars=[],unclosedObservations=[],seen=new Map();let previous='',futureCount=0,duplicateCount=0;
 for(const rawRow of rows){
  const row=provider==='eastmoney'?(typeof rawRow==='string'?rawRow.split(','):[]):rawRow;
  if(!Array.isArray(row)||(provider==='eastmoney'?row.length!==11:row.length<6)||!dateOK(row[0]))throw failure('invalid-bar','日K日期或字段结构无效');
  const [open,close,high,low,volume]=row.slice(1,6).map(numeric);
  if(![open,close,high,low].every(x=>Number.isFinite(x)&&x>0)||!Number.isFinite(volume)||volume<0||low>Math.min(open,close)||high<Math.max(open,close)||low>high)throw failure('invalid-bar','日K缺少有效OHLCV或价格范围无效');
  const signature=JSON.stringify(row);
  if(seen.has(row[0])){if(seen.get(row[0])!==signature)throw failure('conflicting-duplicate','重复日期日K冲突');duplicateCount++;continue;}
  if(row[0]<previous)throw failure('unordered-dates','日K日期未递增');
  previous=row[0];seen.set(row[0],signature);
  if(row[0]>date){futureCount++;continue;}
  if(row[0]===date&&chinaMinute<15*60+10){unclosedObservations.push({date:row[0],rawRow,receivedAt,knownAt:receivedAt,reason:'session-not-closed'});continue;}
  if(multiplier===null)continue;
  const shares=volume*multiplier;
  if(!Number.isFinite(shares)||shares>Number.MAX_SAFE_INTEGER)throw failure('invalid-volume','成交量换算超出安全范围');
  const bar={date:row[0],open,high,low,close,volume:shares,knownAt:receivedAt};
  if(provider==='eastmoney'){const amount=numeric(row[6]);if(Number.isFinite(amount)&&amount>=0)bar.amount=amount;}
  bars.push(bar);
 }
 return {bars:bars.slice(-historyDays),unclosedObservations,futureCount,duplicateCount,unitSupported:multiplier!==null,units:{price:'CNY',volume:multiplier===null?'unknown':'shares',sourceVolume:multiplier===null?'unverified-board-unit':'lots-of-100-shares',volumeMultiplier:multiplier,amount:provider==='eastmoney'?'CNY':null}};
}
async function fetchPublicStockHistory({symbol,historyDays=120,provider='auto'}={}, {now=Date.now,requestJson=requestPublicStockJson}={}){
 if(!symbolOK(symbol))throw Error('A股代码无效');
 if(!Number.isSafeInteger(historyDays)||historyDays<1||historyDays>500)throw Error('历史长度须为1至500');
 if(!['auto','eastmoney','tencent'].includes(provider))throw Error('历史供应商无效');
 const clock=typeof now==='function'?now:()=>now,startedAt=checkedTime(clock),errors=[],attempts=[];let lastObservedUnknown=null;
 const base={schemaVersion:1,status:'unknown',source:null,provider:null,requestedProvider:provider,priceBasis:'unadjusted',stock:{symbol,name:null,source:null,provider:null,priceBasis:'unadjusted',observedAt:null,bars:[]},startedAt,retrievedAt:null,sourceTimestamp:null,units:null,provenance:null,rawHash:null,errors,attempts,researchOnly:true,verifiedLive:false,canTrade:false,canNotify:false};
 for(const selected of provider==='auto'?['eastmoney','tencent']:[provider]){
  const target=targetFor(selected,symbol,historyDays);let receivedAt=null,proof=null,decoded=null;
  try{
   const response=await requestJson(target,{maxBytes:MAX_BYTES,timeoutMs:12000});receivedAt=checkedTime(clock);
   if(receivedAt<startedAt)throw failure('invalid-clock','接收时钟早于请求');
   decoded=decode(response);proof={source:selected,provider:selected,requestUrl:target,endpoint:ENDPOINTS[selected],retrievedAt:receivedAt,firstObservedAt:receivedAt,sourceTimestamp:null,rawHash:decoded.rawHash,rawByteLength:decoded.rawByteLength,hashBasis:'raw-response-bytes',fieldMappingSource:REFERENCES[selected],unitMappingSource:REFERENCES[selected+'Units'],supplierFinalityConfirmed:false};
   const {rows,name}=rowsFor(decoded.json,selected,symbol),normalized=normalize(rows,{provider:selected,symbol,receivedAt,historyDays});
   attempts.push({provider:selected,status:normalized.unitSupported&&normalized.bars.length?'observed-unverified':'unknown',...proof});
   const result={...base,status:normalized.unitSupported&&normalized.bars.length?'observed-unverified':'unknown',source:selected,provider:selected,retrievedAt:receivedAt,rawHash:decoded.rawHash,rawEvidence:{encoding:'base64',data:decoded.raw.toString('base64'),sha256:decoded.rawHash,byteLength:decoded.rawByteLength},provenance:proof,units:normalized.units,stock:{symbol,name,source:selected,provider:selected,priceBasis:'unadjusted',observedAt:receivedAt,bars:normalized.bars},unclosedObservations:normalized.unclosedObservations,futureCount:normalized.futureCount,duplicateCount:normalized.duplicateCount,finality:'15:10-China-time-cutoff; supplier-finality-not-confirmed',metadataAvailability:{dailyStatus:'unknown',corporateActions:'unknown',priceLimits:'unknown'},completeness:'upstream-does-not-declare-complete-history'};
   if(!normalized.unitSupported){errors.push({provider:selected,code:'unsupported-unit',message:'此供应商端点的板种成交量单位未核验'});return result;}
   if(normalized.bars.length||selected==='tencent'||provider!=='auto')return result;
   lastObservedUnknown=result;
   errors.push({provider:selected,code:'no-closed-bars',message:'响应没有可收录的已闭合日K'});
  }catch(e){
   const error={provider:selected,code:typeof e.code==='string'?e.code:'source-failed',message:String(e.stderr||e.message||e).trim().slice(0,240)};errors.push(error);attempts.push({provider:selected,status:'unknown',receivedAt,...(proof?{provenance:proof}:{}),error});
   // Keep the same supplier's body, hash, identity and receipt time together,
   // including parseable responses rejected by identity/OHLCV validation.
   if(decoded&&proof)lastObservedUnknown={...base,source:selected,provider:selected,retrievedAt:receivedAt,rawHash:decoded.rawHash,rawEvidence:{encoding:'base64',data:decoded.raw.toString('base64'),sha256:decoded.rawHash,byteLength:decoded.rawByteLength},provenance:proof,stock:{...base.stock,source:selected,provider:selected,observedAt:receivedAt}};
  }
 }
 return lastObservedUnknown||{...base,retrievedAt:checkedTime(clock)};
}
module.exports={fetchPublicStockHistory,requestPublicStockJson};
