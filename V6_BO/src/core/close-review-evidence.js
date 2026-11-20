'use strict';

const {requestResearchBytes}=require('./research-curl-bytes');
const {fetchReviewLimitPool}=require('./public-market-context');
const {normalizeDay,normalizeReasonEvidence,reasonMatchesDay}=require('./limit-reason-evidence');
const height=row=>Number.isSafeInteger(row.consecutiveLimits)&&row.consecutiveLimits>0?row.consecutiveLimits:null;

function summarizePromotion(sealed,previous){
 if(!sealed?.complete||!previous?.complete||previous.tradeDate>=sealed.tradeDate||
    sealed.records.some(row=>height(row)===null)||previous.records.some(row=>height(row)===null))return null;
 const today=new Map(sealed.records.map(row=>[row.symbol,row]));
 const stages=new Map();
 const failed=[];
 for(const row of previous.records){
  const level=height(row),current=today.get(row.symbol);
  const stage=stages.get(level)||{level,total:0,promoted:0};
  stage.total++;
  if(current&&height(current)===level+1)stage.promoted++;
  else if(level>=2)failed.push({code:row.symbol,name:row.name,level});
  stages.set(level,stage);
 }
 return {previousDay:previous.tradeDate,stages:[...stages.values()].sort((a,b)=>b.level-a.level),failed};
}

function seatFrom(row,day){
 const code=String(row?.SECURITY_CODE||'').trim();
 const dept=String(row?.OPERATEDEPT_NAME||'').trim();
 const reason=String(row?.EXPLANATION||row?.EXPLAIN||'').trim();
 const number=value=>typeof value==='number'||typeof value==='string'&&value.trim()?Number(value):NaN;
 const buy=number(row?.BUY),sell=number(row?.SELL);
 const net=number(row?.NET??(buy-sell));
 if(!/^\d{6}$/.test(code)||!dept||normalizeDay(String(row?.TRADE_DATE||'').slice(0,10))!==day||!Number.isFinite(net))return null;
 const category=/机构专用/.test(dept)?'机构专用':/股通专用/.test(dept)?'互联互通':'营业部';
 return {code,name:String(row.SECURITY_NAME_ABBR||code).trim(),dept,category,net,reason};
}

async function northTurnover(day,get){
 // Eastmoney's DEAL_AMT is in CNY millions. Type 001 is Shanghai;
 // type 003 is Shenzhen. Never use net flow or quota fields here.
 const fetch=async type=>{
  const params=new URLSearchParams({reportName:'RPT_MUTUAL_DEAL_HISTORY',columns:'MUTUAL_TYPE,TRADE_DATE,DEAL_AMT',
   sortColumns:'TRADE_DATE',sortTypes:'-1',pageSize:'8',pageNumber:'1',filter:'(MUTUAL_TYPE="'+type+'")'});
  const data=await get('https://datacenter-web.eastmoney.com/api/data/v1/get?'+params,8500);
  const row=data?.result?.data?.find(item=>item.MUTUAL_TYPE===type&&normalizeDay(String(item.TRADE_DATE).slice(0,10))===day);
  return typeof row?.DEAL_AMT==='number'&&Number.isFinite(row.DEAL_AMT)&&row.DEAL_AMT>=0?row.DEAL_AMT:null;
 };
 const [sh,sz]=await Promise.all([fetch('001'),fetch('003')]);
 return sh===null||sz===null?null:(sh+sz)*1e6;
}

function marketTurnover(rows,day){
 const close=Date.parse(day+'T15:00:00+08:00');
 const end=Date.parse(day+'T23:59:59+08:00');
 if(!Array.isArray(rows))return null;
 const parts=['1.000001','0.399001'].map(code=>rows?.find(row=>row.code===code&&row.tradeDate===day&&
  row.quoteAt>=close&&row.quoteAt<=end&&Number.isSafeInteger(row.turnoverAmountYuan)&&row.turnoverAmountYuan>0));
 return parts.every(Boolean)?parts.reduce((sum,row)=>sum+row.turnoverAmountYuan,0):null;
}

function reasonFromF10(html,day){
 const hits=[];
 for(const row of String(html).split(/<tr\b/i)){
  const content=row.split(/<\/tr\s*>/i)[0];
  if(!content.includes('异动提醒')||!content.includes('触及涨停'))continue;
  const date=content.match(/(?:[?&]|&amp;)w=(\d{4}-\d{2}-\d{2})(?:%|[&"'])/i)?.[1]||
   content.match(/<td\b[^>]*>\s*(\d{4}-\d{2}-\d{2})\s*<\/td>/i)?.[1];
  if(date!==day)continue;
  const text=content.match(/分析或为[：:]\s*([^<>]{1,180})/)?.[1]?.trim();
  if(text)hits.push(text.replaceAll('&amp;','&').replaceAll('&nbsp;',' ').trim());
 }
 const unique=[...new Set(hits)];
 return unique.length===1?unique[0]:null;
}

async function fetchF10Reason(code,day){
 if(!/^\d{6}$/.test(code))return null;
 const url='https://basic.10jqka.com.cn/'+code+'/event.html';
 const result=await requestResearchBytes(url,{timeoutMs:4500,maxBytes:1024*1024});
 const charset=/charset\s*=\s*["']?utf-8/i.test(result.raw.subarray(0,4096).toString('ascii'))?'utf-8':'gbk';
 const text=reasonFromF10(new TextDecoder(charset).decode(result.raw),day);
 return text?{code,text,source:'同花顺 F10',url}:null;
}

function createCloseReviewReader({market,fetchPool=fetchReviewLimitPool,fetchReason=fetchF10Reason,clock=Date.now}){
 let cache, pending;
 return async function read(day,previousDay,{seatsReady}){
  const key=day+':'+seatsReady;
  if(cache?.key===key&&clock()-cache.at<5*60000)return cache.report;
  if(pending?.key===key)return pending.task;
  const prior=cache?.report?.sealed;
  const retainedPrevious=prior?.tradeDate===previousDay&&prior?.complete?prior:null;
  const task=(async()=>{
   const seats=new Map();
   const [reasonResult,sealedResult,brokenResult,previousResult,downResult,northResult,indexResult,seatResult]=await Promise.allSettled([
    market.fetchZtReason(day,{deadline:clock()+16000}),
    fetchPool(day,'sealed'),fetchPool(day,'broken'),previousDay?fetchPool(previousDay,'sealed'):null,
    market.fetchDTCount(day.replaceAll('-','')),northTurnover(day,market.get),market.fetchIdxRt(),
    seatsReady?market.fetchLhb(day,{deadline:clock()+16000,onSeat:raw=>{
     const row=seatFrom(raw,day);
     if(row)seats.set(JSON.stringify(row),row);
    }}):null
   ]);
   const result=x=>x.status==='fulfilled'?x.value:null;
   const sealed=result(sealedResult),broken=result(brokenResult),down=result(downResult);
   const previous=result(previousResult)?.complete?result(previousResult):retainedPrevious;
   const sealedCodes=new Set(sealed?.records.map(row=>row.symbol));
   const compatible=sealed?.complete&&broken?.complete&&!broken.records.some(row=>sealedCodes.has(row.symbol));
   const touched=compatible?sealed.records.length+broken.records.length:0;
   const reasons=[];
   for(const [code,row] of result(reasonResult)||[]){
    const normalized=normalizeReasonEvidence(row,{requestedDate:day,receivedAt:clock(),source:'ths'});
    if(/^\d{6}$/.test(code)&&reasonMatchesDay(normalized,day))reasons.push({code,text:normalized.reason,source:'同花顺涨停聚焦'});
   }
   const primaryCount=reasons.length;
   const known=new Set(reasons.map(row=>row.code));
   const priority=(sealed?.records||[]).filter(row=>!known.has(row.symbol))
    .sort((a,b)=>(height(b)||0)-(height(a)||0)||(b.amountCny||0)-(a.amountCny||0)).slice(0,4);
   const backups=await Promise.allSettled(priority.map(row=>fetchReason(row.symbol,day)));
   for(const response of backups){
    const row=result(response);
    if(row)reasons.push(row);
   }
   const reasonChannels={primaryCount,f10Count:reasons.length-primaryCount,f10Attempted:priority.length};
   const report={day,source:'东方财富',sealed,broken,reasons,reasonChannels,northTurnover:result(northResult),marketTurnover:marketTurnover(result(indexResult),day),
    sealRate:touched?sealed.records.length/touched:null,
    promotion:summarizePromotion(sealed,previous),
    down:normalizeDay(String(down?.qdate||''))===day&&Number.isSafeInteger(down?.tc)&&down.tc>=0?down.tc:null,
    seats:[...seats.values()].sort((a,b)=>Math.abs(b.net)-Math.abs(a.net)),
    seatsStatus:!seatsReady?'pending':!seats.size?'unavailable':seatResult.status==='rejected'?'partial':'observed'};
   if(pending?.task===task)cache={key,at:clock(),report};
   return report;
  })();
  pending={key,task};
  try{return await task;}finally{if(pending?.task===task)pending=null;}
 };
}

module.exports={createCloseReviewReader,summarizePromotion,seatFrom,marketTurnover,reasonFromF10};
