#!/usr/bin/env node
'use strict';

// Read-only, one-shot acquisition. The product does not invoke this on refresh.
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {aShareCalendarDate}=require('../src/core/a-share-calendar');
const {normalizeDay}=require('../src/core/limit-reason-evidence');
const {timestamp:quoteTimestamp}=require('../src/core/public-market');
const {parseThsRealhead}=require('../src/core/ths-snapshot-evidence');
const {requestResearchBytes,createResearchRequest}=require('../src/core/research-curl-bytes');

const minuteLabel=index=>String(Math.floor(index/60)).padStart(2,'0')+':'+String(index%60).padStart(2,'0');
const marketMinutes=[...Array.from({length:120},(_,i)=>minuteLabel(571+i)),
 ...Array.from({length:120},(_,i)=>minuteLabel(781+i))];
const minuteSet=new Set(marketMinutes);
const fiveMinutes=marketMinutes.filter(minute=>Number(minute.slice(3))%5===0);
const fiveMinuteSet=new Set(fiveMinutes);
const timestamp=(tradeDate,minute)=>Date.parse(tradeDate+'T'+minute+':00+08:00');
const symbolCode=code=>/^(?:60|68|00|30)\d{4}$/.test(code)?(code.startsWith('6')?'sh':'sz')+code:null;
const price=value=>typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value)&&Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;

function sourceUrls(symbol){
 return {
  tencent:'https://web.ifzq.gtimg.cn/appstock/app/minute/query?'+new URLSearchParams({code:symbol}),
  sina:'https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20series=/CN_MarketDataService.getKLineData?'+
   new URLSearchParams({symbol,scale:'5',ma:'no',datalen:'48'}),
  ths:'https://d.10jqka.com.cn/v6/realhead/hs_'+symbol.slice(2)+'/last.js'
 };
}

function sourceResult(rows,expected,reportedDates,tradeDate){
 const captured=rows.size;
 return {status:captured===expected?'complete':reportedDates.includes(tradeDate)?'partial':reportedDates.length?'date-mismatch':'empty',reportedDates,
  expected,captured,rows:[...rows.values()].sort((a,b)=>a.minute.localeCompare(b.minute))};
}

function tencentRows(json,symbol,tradeDate,receivedAt){
 const data=json?.data?.[symbol],raw=data?.data,quote=data?.qt?.[symbol];
 if(json?.code!==0||quote?.[2]!==symbol.slice(2)||!Array.isArray(raw?.data)||raw.data.length>300||
    typeof raw.date!=='string'||!/^\d{8}$/.test(raw.date)||!normalizeDay(raw.date))throw Error('腾讯证券或分时原始交易日无效');
 const sourceDay=normalizeDay(raw.date),rows=new Map();
 if(sourceDay===tradeDate)for(const line of raw.data){
  const fields=typeof line==='string'?line.trim().split(/\s+/):[];
  if(!/^\d{4}$/.test(fields[0]||''))throw Error('腾讯分钟格式异常');
  const minute=fields[0].slice(0,2)+':'+fields[0].slice(2);
  // Tencent also emits session anchors and post-close records. Count the 240 closing minutes only.
  if(!minuteSet.has(minute))continue;
  const close=price(fields[1]),at=timestamp(tradeDate,minute);
  if(close===null||at>receivedAt||rows.has(minute))throw Error('腾讯分钟价格、时间或唯一性异常');
  rows.set(minute,{minute,at,close});
 }
 const rawQuoteTime=quote?.[30];
 let priorClose=null;
 if(sourceDay===tradeDate&&typeof rawQuoteTime==='string'&&rawQuoteTime.startsWith(raw.date)){
  try{if(quoteTimestamp(rawQuoteTime)<=receivedAt)priorClose=price(quote[4]);}
  catch{/* The dated minute series remains usable without its previous-close reference. */}
 }
 return {...sourceResult(rows,marketMinutes.length,[sourceDay],tradeDate),identity:'provider-code',priorClose};
}

function sinaRows(json,tradeDate,receivedAt){
 if(!Array.isArray(json)||json.length>48)throw Error('新浪五分钟响应不是有界记录数组');
 const reportedDates=new Set(),rows=new Map();
 for(const bar of json){
  const match=/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}):00$/.exec(bar?.day||'');
  if(!match||normalizeDay(match[1])!==match[1])throw Error('新浪五分钟原始交易日无效');
  const [,day,minute]=match;
  reportedDates.add(day);
  if(day!==tradeDate)continue;
  const at=timestamp(tradeDate,minute),close=price(bar.close);
  if(!fiveMinuteSet.has(minute)||close===null||at>receivedAt||rows.has(minute))throw Error('新浪五分钟价格、时间或唯一性异常');
  rows.set(minute,{minute,at,close});
 }
 return {...sourceResult(rows,fiveMinutes.length,[...reportedDates].sort(),tradeDate),identity:'requested-symbol'};
}

function comparePrices(tencent,sina){
 const tx=new Map((tencent.rows||[]).map(row=>[row.minute,row.close]));
 const matched=(sina.rows||[]).filter(row=>tx.has(row.minute)).map(row=>({minute:row.minute,
  tencent:tx.get(row.minute),sina:row.close}));
 const disagreements=matched.filter(row=>row.tencent!==row.sina);
 const matches=matched.length-disagreements.length;
 const close=matched.find(row=>row.minute==='15:00')??null;
 return {coverage:matched.length,expected:fiveMinutes.length,matches,disagreements,
  close,closeAgrees:close?close.tencent===close.sina:null,
  status:disagreements.length?'price-disagreement':matched.length===fiveMinutes.length?'all-compared-prices-agree':
   matched.length?'partial-comparison':'no-common-observations'};
}

async function captureIntraday({tradeDate,codes},{request=requestResearchBytes,requestGovernor,clock=Date.now}={}){
 const now=clock();
 if(typeof tradeDate!=='string'||normalizeDay(tradeDate)!==tradeDate||tradeDate>aShareCalendarDate(now)||
    !Array.isArray(codes)||codes.length<1||codes.length>4||new Set(codes).size!==codes.length||
    codes.some(code=>typeof code!=='string'||!symbolCode(code)))throw Error('需要一个已到达的交易日和 1–4 个不重复的沪深 A 股代码');
 const fetch=createResearchRequest(request,requestResearchBytes,requestGovernor);
 async function collect(source,url,symbol){
  let receipt=null;
  try{
   const {raw,status}=await fetch(url,{maxBytes:500000,timeoutMs:8500});
   const receivedAt=clock();
   if(status!==200||!Buffer.isBuffer(raw)||raw.length>500000||!Number.isSafeInteger(receivedAt)||receivedAt<now)
    throw Error('原始响应或采集时间无效');
   receipt={receivedAt,bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')};
   const text=raw.toString('utf8').trim();
   if(source==='ths'){
    const reading=parseThsRealhead(text,symbol.slice(2),receivedAt);
    if(!reading)throw Error('同花顺快照证券身份无效');
    const {items,providerUpdatedAt,providerTradeDate}=reading;
    const lastPrice=price(items['10']);
    const dated=providerTradeDate===tradeDate;
    return {source,url,...receipt,providerUpdatedAt,providerTradeDate,status:!providerTradeDate?'time-unknown':!dated?'date-mismatch':'daily-snapshot',
     price:dated?lastPrice:null,nativeActiveBuy:dated?items['14']??null:null,nativeActiveSell:dated?items['15']??null:null};
   }
   // Unwrap only a returned array. Never execute provider JavaScript.
   const json=JSON.parse(source==='sina'?(text.match(/\(\s*(\[[\s\S]*\])\s*\)\s*;?$/)?.[1]||text):text);
   const series=source==='tencent'?tencentRows(json,symbol,tradeDate,receivedAt):sinaRows(json,tradeDate,receivedAt);
   return {source,url,...receipt,...series};
  }catch(error){
   const httpStatus=error.status??error.response?.status??null;
   return {source,url,...receipt,status:httpStatus===403||httpStatus===429?'restricted':receipt?'invalid':'unavailable',
    httpStatus,reason:receipt?error.message:error.code||'request-failed'};
  }
 }
 const stocks=[];
 for(const code of codes){
  const symbol=symbolCode(code),urls=sourceUrls(symbol);
  const [tencent,sina,ths]=await Promise.all(Object.keys(urls).map(source=>collect(source,urls[source],symbol)));
  const comparison=comparePrices(tencent,sina);
  const thsCloseReference=ths.price!=null&&ths.providerUpdatedAt>=timestamp(tradeDate,'15:00')&&comparison.close?
   {price:ths.price,providerUpdatedAt:ths.providerUpdatedAt,
    matchesBoth:ths.price===comparison.close.tencent&&ths.price===comparison.close.sina}:null;
  stocks.push({code,tencent,sina,ths,comparison,thsCloseReference});
 }
 return {schemaVersion:1,tradeDate,startedAt:now,receivedAt:clock(),mode:'one-shot-intraday-price-research',
  membershipVerified:false,verifiedLive:false,canTrade:false,stocks};
}

async function main([tradeDate,output,...codes]){
 if(!output||!path.isAbsolute(output)||path.normalize(output).split(path.sep).includes('public'))
  throw Error('用法: node scripts/capture-stock-intraday.js <YYYY-MM-DD> <新的私有绝对JSON路径> <1至4个代码>');
 const destination=path.resolve(output),directory=path.dirname(destination);
 if(await fs.realpath(directory)!==directory)throw Error('输出目录必须为真实绝对路径');
 // Reject an existing output before using any provider budget.
 await fs.lstat(destination).then(()=>{throw Error('报告已存在');},error=>{if(error.code!=='ENOENT')throw error;});
 const report=await captureIntraday({tradeDate,codes});
 const staging=await fs.mkdtemp(path.join(directory,'.intraday-'));
 try{
  const file=path.join(staging,'report.json');
  await fs.writeFile(file,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
  await fs.link(file,destination);
 }finally{await fs.rm(staging,{recursive:true,force:true});}
 process.stdout.write(JSON.stringify({tradeDate,output:destination,stocks:report.stocks.map(({code,tencent,sina,comparison,thsCloseReference})=>({
  code,tencent:tencent.captured??null,sina:sina.captured??null,compared:comparison.coverage,matches:comparison.matches,close:comparison.close,thsCloseReference
 }))})+'\n');
}

if(require.main===module)main(process.argv.slice(2)).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
module.exports={captureIntraday};
