'use strict';
// Field mapping checked against AKShare stock/flow/stock_fund_em.py and
// stock/quote/stock_ztb_em.py (main). Capture time is never provider quote time.
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),crypto=require('node:crypto');
const run=promisify(execFile),MAX_BYTES=2*1024*1024;
const FLOW='https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get';
const ZT='https://push2ex.eastmoney.com/getTopicZTPool',ZB='https://push2ex.eastmoney.com/getTopicZBPool';
const SOURCES={flow:'https://github.com/akfamily/akshare/blob/main/akshare/stock/flow/stock_fund_em.py',pools:'https://github.com/akfamily/akshare/blob/main/akshare/stock/quote/stock_ztb_em.py'};
const dateOK=d=>typeof d==='string'&&/^\d{4}-\d\d-\d\d$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const chinaDate=now=>new Date(now+8*3600000).toISOString().slice(0,10);
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const number=x=>{if(typeof x==='number')return Number.isFinite(x)?x:null;if(typeof x!=='string'||! /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(x.trim()))return null;const value=Number(x);return Number.isFinite(value)?value:null;};
const count=x=>Number.isSafeInteger(x)&&x>=0?x:null;
function url(base,params){return base+'?'+new URLSearchParams(params).toString();}
async function requestPublicJson(target){
 const parsed=new URL(target);if(![FLOW,ZT,ZB].includes(parsed.origin+parsed.pathname)||parsed.protocol!=='https:'||parsed.username||parsed.password)throw Error('禁止任意URL');
 const {stdout}=await run('curl',['--fail','--silent','--show-error','--max-time','12','--max-filesize',String(MAX_BYTES),'--proto','=https','--user-agent','Mozilla/5.0','--header','Accept: application/json',target],{timeout:13000,maxBuffer:MAX_BYTES,encoding:'utf8'});
 if(Buffer.byteLength(stdout)>MAX_BYTES)throw Error('响应超过2MiB');return {json:JSON.parse(stdout),raw:stdout};
}
function empty(status='unknown'){return {status,source:'eastmoney',records:[],unit:'CNY',fundsMethod:'vendor-order-size-estimate',interpretation:'vendor-order-size-estimate',fetchedCount:0,totalCount:null,partial:null,sourceTimestamp:null};}
function flowParams(secid,days,market=false){return {lmt:String(days),klt:'101',secid,...(market?{secid2:'0.399001'}:{}),fields1:'f1,f2,f3,f7',fields2:'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65',ut:'b2884a393a59ad64002292a3e90d46a5'};}
function parseFlow(json,{date,historyDays,kind}){
 const rows=json?.data?.klines;if(json?.rc!==0||!Array.isArray(rows)||rows.length>2000)throw Error('资金流响应缺少有效klines或返回错误');
 const records=[],seen=new Set();let invalidCount=0;
 for(const row of rows){
  const parts=typeof row==='string'?row.split(','):[];if(parts.length!==15||!dateOK(parts[0])||seen.has(parts[0])){invalidCount++;continue;}seen.add(parts[0]);if(parts[0]>date)continue;
  const values=parts.slice(1).map(number),record={tradeDate:parts[0],mainNetInflow:values[0],smallNetInflow:values[1],midNetInflow:values[2],bigNetInflow:values[3],superNetInflow:values[4],mainNetInflowPct:values[5],smallNetInflowPct:values[6],midNetInflowPct:values[7],bigNetInflowPct:values[8],superNetInflowPct:values[9]};
  if(kind==='market'){record.shanghaiClose=values[10];record.shanghaiChangePct=values[11];record.shenzhenClose=values[12];record.shenzhenChangePct=values[13];}
  if(kind==='stock'){record.close=values[10];record.changePct=values[11];}
  records.push(record);
 }
 records.sort((a,b)=>a.tradeDate.localeCompare(b.tradeDate));const selected=records.slice(-historyDays);
 return {...empty(),status:selected.length?'observed-unverified':'unknown',records:selected,fetchedCount:rows.length,selectedCount:selected.length,totalCount:null,partial:invalidCount?true:null,invalidCount,lastTradeDate:selected.at(-1)?.tradeDate||null,matchesRequestedDate:selected.at(-1)?.tradeDate===date,completeness:'upstream-does-not-declare-total-history',fieldMappingSource:SOURCES.flow};
}
function poolTime(value){const n=number(value);if(n===null||!Number.isInteger(n))return null;const s=String(n).padStart(6,'0');return s.length===6&&+s.slice(0,2)<24&&+s.slice(2,4)<60&&+s.slice(4,6)<60?s:null;}
function parsePool(json,{date,kind}){
 const data=json?.data;if(json?.rc!==0||!data||!Array.isArray(data.pool)||data.pool.length>10000)throw Error('涨停池响应缺少有效pool或返回错误');
 const q=String(data.qdate??''),tradeDate=/^\d{8}$/.test(q)?q.slice(0,4)+'-'+q.slice(4,6)+'-'+q.slice(6,8):null;
 const totalCount=count(data.tc),seen=new Set(),records=[];let invalidCount=0;
 for(const row of data.pool){
  if(!row||typeof row.c!=='string'||!/^\d{6}$/.test(row.c)||seen.has(row.c)){invalidCount++;continue;}seen.add(row.c);
  const price=number(row.p),limit=number(row.ztp);
  records.push({symbol:row.c,name:typeof row.n==='string'?row.n.slice(0,80):null,price:price===null?null:price/1000,changePct:number(row.zdp),amountCny:number(row.amount),industry:typeof row.hybk==='string'?row.hybk.slice(0,80):null,firstSealTime:poolTime(row.fbt),breakCount:number(row.zbc),...(kind==='sealed'?{lastSealTime:poolTime(row.lbt),sealedFundsCny:number(row.fund),consecutiveLimits:number(row.lbc)}:{limitUpPrice:limit===null?null:limit/1000})});
 }
 const sameDate=dateOK(tradeDate)&&tradeDate===date,complete=sameDate&&totalCount!==null&&totalCount===data.pool.length&&records.length===data.pool.length&&invalidCount===0;
 return {status:complete?'observed-unverified':'partial-evidence',complete,tradeDate,requestedDate:date,records,fetchedCount:data.pool.length,totalCount,partial:!complete,invalidCount,sourceTimestamp:null,dateMatched:sameDate,fieldMappingSource:SOURCES.pools,unit:'CNY',priceScale:'vendor-milliyuan-divided-by-1000'};
}
async function collectPublicContext({date,sectorCode,symbol,historyDays=120}={}, {now=Date.now,requestJson=requestPublicJson}={}){
 const clock=typeof now==='function'?now:()=>now,startedAt=clock();
 if(!Number.isSafeInteger(startedAt)||startedAt<=0)throw Error('采集时钟无效');
 const explicitDate=date!==undefined;date=explicitDate?date:chinaDate(startedAt);if(!dateOK(date)||date>chinaDate(startedAt)||!Number.isSafeInteger(historyDays)||historyDays<1||historyDays>120)throw Error('日期或历史长度无效');
 if(sectorCode!==undefined&&(typeof sectorCode!=='string'||!/^BK\d{4}$/.test(sectorCode)))throw Error('板块代码须为BK四位数字');
 if(symbol!==undefined&&(typeof symbol!=='string'||!/^(?:60|68|00|30|43|83|87|88|92)\d{4}$/.test(symbol)))throw Error('A股代码无效');
 const errors=[],requests=[['marketFlow',url(FLOW,flowParams('1.000001',historyDays,true)),'market']];
 if(sectorCode)requests.push(['sectorFlow',url(FLOW,flowParams('90.'+sectorCode,historyDays)),'sector']);
 if(symbol)requests.push(['stockFlow',url(FLOW,flowParams((symbol.startsWith('6')?'1.':'0.')+symbol,historyDays)),'stock']);
 const values={marketFlow:empty(),sectorFlow:empty('not-requested'),stockFlow:empty('not-requested'),sealed:{status:'unknown',records:[],partial:true,totalCount:null,fetchedCount:0},broken:{status:'unknown',records:[],partial:true,totalCount:null,fetchedCount:0}};
 const fetchOne=async([name,target,kind],poolDate=date)=>{
  try{
   const returned=await requestJson(target,{maxBytes:MAX_BYTES,timeoutMs:12000}),firstObservedAt=clock();
   const wrapped=returned&&Object.hasOwn(returned,'json'),json=wrapped?returned.json:returned,raw=wrapped&&typeof returned.raw==='string'?returned.raw:JSON.stringify(json);
   if(typeof raw!=='string'||Buffer.byteLength(raw)>MAX_BYTES)throw Error('响应超过2MiB或非JSON');
   if(kind!=='pool'){
    const [market,code]=new URL(target).searchParams.get('secid').split('.');
    if(json?.data?.code!==undefined&&String(json.data.code)!==code||json?.data?.market!==undefined&&String(json.data.market)!==market)throw Error('资金流响应证券身份不一致');
   }
   const provenance={source:'eastmoney',endpoint:new URL(target).pathname,requestUrl:target,retrievedAt:firstObservedAt,firstObservedAt,sourceTimestamp:null,rawHash:sha(raw),hashBasis:wrapped&&typeof returned.raw==='string'?'raw-response-bytes':'injected-json-serialization',verifiedLive:false};
   values[name]={...(kind==='pool'?parsePool(json,{date:poolDate,kind:name}):parseFlow(json,{date,historyDays,kind})),...provenance};
  }catch(e){values[name]={...values[name],status:'unknown',error:String(e.stderr||e.message||e).trim().slice(0,240)};errors.push({source:name,message:values[name].error});}
 };
 // The latest observed market date, rather than a guessed calendar, selects
 // the default pool session. Optional flow sources may supply the fallback.
 await Promise.all(requests.map(row=>fetchOne(row)));
 const fallbackDates=[values.sectorFlow.lastTradeDate,values.stockFlow.lastTradeDate].filter(dateOK).sort();
 const observedFlowDate=values.marketFlow.lastTradeDate||fallbackDates.at(-1)||null,poolDate=explicitDate?date:observedFlowDate||date;
 const poolRequests=[['sealed',ZT,10000],['broken',ZB,5000]].map(([name,base,size])=>[name,url(base,{ut:'7eea3edcaed734bea9cbfc24409ed989',dpt:'wz.ztzt',Pageindex:'0',pagesize:String(size),sort:'fbt:asc',date:poolDate.replaceAll('-','')}),'pool']);
 await Promise.all(poolRequests.map(row=>fetchOne(row,poolDate)));
 const z=values.sealed,b=values.broken,overlap=z.records.some(r=>b.records.some(x=>x.symbol===r.symbol)),complete=z.partial===false&&b.partial===false&&z.tradeDate===b.tradeDate&&!overlap,n=z.records.length+b.records.length;
 const limitPools={status:complete?'observed-unverified':'unknown',complete,tradeDate:complete?z.tradeDate:null,sealed:z,broken:b,overlapDetected:overlap,sealRate:complete&&n>0?z.records.length/n:null,breakRate:complete&&n>0?b.records.length/n:null,limitUpToBrokenRatio:complete&&b.records.length>0?z.records.length/b.records.length:null,ratioDefinition:'sealed / unsealed-broken; sealRate=sealed/(sealed+unsealed-broken)',sourceTimestamp:null};
 if(symbol)values.stockFlow.symbol=symbol;if(sectorCode)values.sectorFlow.sectorCode=sectorCode;
 const retrievedAt=clock(),observed=Object.values(values).map(x=>x.firstObservedAt).filter(Number.isSafeInteger);
 const actualDates=[values.marketFlow.lastTradeDate,...fallbackDates,z.tradeDate,b.tradeDate].filter(d=>dateOK(d)&&d<=date).sort();
 const tradeDate=!explicitDate&&observedFlowDate?observedFlowDate:actualDates.at(-1)||null;
 return {schemaVersion:1,source:'eastmoney',startedAt,retrievedAt,firstObservedAt:observed.length?Math.min(...observed):null,tradeDate,requestedDate:date,marketFlow:values.marketFlow,sectorFlow:values.sectorFlow,stockFlow:values.stockFlow,limitPools,errors,researchOnly:true,verifiedLive:false,canTrade:false,canNotify:false,note:'tradeDate来自实际响应日期，requestedDate为查询上限；逐行日期和池响应qdate保留。公共供应商资金按订单大小估算，不证明机构真实资金；不将采集时间当作行情时间。'};
}
let running=false;
async function fetchPublicContext(options,dependencies){
 if(running)throw Error('公共市场研究采集已在运行');running=true;
 try{return await collectPublicContext(options,dependencies);}finally{running=false;}
}
module.exports={fetchPublicContext,requestPublicJson};
