'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');

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

function thsDailyBrief(html,day,knownAt){
 if(normalizeDay(day)!==day||!Number.isSafeInteger(knownAt)||knownAt<Date.parse(day+'T15:00:00+08:00'))return null;
 const packet=String(html);
 // The page first sets a static default, then assigns its actual session.
 const date=[...packet.matchAll(/\bGlobal\.date\s*=\s*["'](\d{8})["']/g)].at(-1)?.[1];
 if(normalizeDay(date)!==day||!packet.includes('复盘必读'))return null;
 const block=id=>{
  const value=packet.match(new RegExp('<div\\s+id=["\']block_'+id+'["\'][^>]*>([\\s\\S]{1,3500}?)<\\/div>','i'))?.[1]||'';
  return value.replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
 };
 const summary=block(1887),focus=block(1890);
 if(!summary||!/(?:收盘|收报|收涨|收跌)/.test(summary))return null;
 return {day,knownAt,source:'同花顺每日复盘',summary:summary.slice(0,220),
  themes:[...new Set(focus.split(/[、，,；;]/).map(s=>s.trim()).filter(s=>s&&s.length<=36))].slice(0,12),
  url:'https://stock.10jqka.com.cn/fupan/'+date+'.shtml'};
}
async function fetchThsDailyBrief(day,clock=Date.now){
 if(normalizeDay(day)!==day)return null;
 const root='https://stock.10jqka.com.cn/fupan/';
 for(const url of [root+day.replaceAll('-','')+'.shtml',root]){
  try{
   const response=await requestResearchBytes(url,{timeoutMs:5500,maxBytes:512*1024});
   const encoding=/charset\s*=\s*["']?utf-8/i.test(response.raw.subarray(0,4096).toString('ascii'))?'utf-8':'gbk';
   const brief=thsDailyBrief(new TextDecoder(encoding).decode(response.raw),day,clock());
   if(brief)return brief;
  }catch(error){if(error?.code==='MARKET_RESTRICTED')break;}
 }
 return null;
}

async function fetchF10Reason(code,day){
 if(!/^\d{6}$/.test(code))return null;
 const url='https://basic.10jqka.com.cn/'+code+'/event.html';
 const result=await requestResearchBytes(url,{timeoutMs:4500,maxBytes:1024*1024});
 const charset=/charset\s*=\s*["']?utf-8/i.test(result.raw.subarray(0,4096).toString('ascii'))?'utf-8':'gbk';
 const text=reasonFromF10(new TextDecoder(charset).decode(result.raw),day);
 return text?{code,text,source:'同花顺 F10',url}:null;
}

const retryInterval=2*60000;
const readyInterval=5*60000;
const keepSessions=4;
const maxStoreBytes=8*1024*1024;
const poolMatches=(pool,day)=>Boolean(day&&pool?.tradeDate===day&&Array.isArray(pool.records));
const completePool=(pool,day)=>poolMatches(pool,day)&&pool.complete===true&&pool.totalCount===pool.records.length;

function promotionPool(pool){
 if(!completePool(pool,normalizeDay(pool?.tradeDate))||pool.records.length>10000)return null;
 const seen=new Set();
 const records=[];
 for(const row of pool.records){
  const symbol=row?.symbol;
  if(!/^\d{6}$/.test(symbol||'')||seen.has(symbol)||height(row)===null)return null;
  seen.add(symbol);
  records.push({symbol,name:typeof row.name==='string'?row.name.slice(0,80):null,consecutiveLimits:height(row)});
 }
 return {tradeDate:pool.tradeDate,complete:true,totalCount:records.length,records};
}

function createPromotionStore(file){
 let initial=[];
 if(file){
  try{
   if(fs.statSync(file).size>maxStoreBytes)throw Error('snapshot exceeds size limit');
   const source=JSON.parse(fs.readFileSync(file,'utf8'));
   if(source?.version!==1||!Array.isArray(source.pools)||source.pools.length>keepSessions)throw Error('unexpected snapshot schema');
   initial=source.pools.map(promotionPool).filter(Boolean);
  }catch(error){
   if(error.code!=='ENOENT')console.warn('[close-review] previous-session snapshot could not be read:',error.message);
  }
 }
 let pools=new Map(initial.map(pool=>[pool.tradeDate,pool]));
 let saved=file?JSON.stringify([...pools.values()]):'';
 return {
  get:day=>pools.get(day)||null,
  remember(...observations){
   for(const observation of observations){
    const pool=promotionPool(observation);
    if(pool)pools.set(pool.tradeDate,pool);
   }
   pools=new Map([...pools].sort(([a],[b])=>b.localeCompare(a)).slice(0,keepSessions));
   if(!file||!pools.size)return;
   const next=JSON.stringify([...pools.values()]);
   if(next===saved)return;
   const temp=file+'.'+randomUUID()+'.tmp';
   try{
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(temp,JSON.stringify({version:1,pools:[...pools.values()]}),{flag:'wx',mode:0o600});
    fs.renameSync(temp,file);
    saved=next;
   }catch(error){
    console.warn('[close-review] previous-session snapshot could not be saved:',error.message);
    try{fs.unlinkSync(temp);}catch{}
   }
  }
 };
}

function createCloseReviewReader({market,fetchPool=fetchReviewLimitPool,fetchReason=fetchF10Reason,fetchBrief,clock=Date.now,poolFile}){
 const previousPools=createPromotionStore(poolFile);
 const days=new Map(), pending=new Map();
 return async function read(day,previousDay,{seatsReady}){
  const key=day+':'+seatsReady;
  const cached=days.get(day);
  if(cached?.key===key&&clock()-cached.at<(cached.report.retryAfterMs??readyInterval))return cached.report;
  if(pending.has(key))return pending.get(key);
  const task=(async()=>{
   const seats=new Map();
   const [reasonResult,sealedResult,brokenResult,previousResult,downResult,northResult,indexResult,seatResult,briefResult]=await Promise.allSettled([
    market.fetchZtReason(day,{deadline:clock()+16000}),
    fetchPool(day,'sealed'),fetchPool(day,'broken'),previousDay?fetchPool(previousDay,'sealed'):null,
    market.fetchDTCount(day.replaceAll('-','')),northTurnover(day,market.get),market.fetchIdxRt(),
    seatsReady?market.fetchLhb(day,{deadline:clock()+16000,onSeat:raw=>{
     const row=seatFrom(raw,day);
     if(row)seats.set(JSON.stringify(row),row);
    }}):null, fetchBrief?fetchBrief(day,clock):null
   ]);
   const result=x=>x.status==='fulfilled'?x.value:null;
   const freshSealed=result(sealedResult),freshBroken=result(brokenResult),freshPrevious=result(previousResult);
   const down=result(downResult);
   const reasons=[];
   for(const [code,row] of result(reasonResult)||[]){
    const normalized=normalizeReasonEvidence(row,{requestedDate:day,receivedAt:clock(),source:'ths'});
    if(/^\d{6}$/.test(code)&&reasonMatchesDay(normalized,day))reasons.push({code,text:normalized.reason,source:'同花顺涨停聚焦'});
   }
   const primaryCount=reasons.length;
   const known=new Set([...reasons,...(days.get(day)?.report?.reasons||[])].map(row=>row.code));
   const priority=(poolMatches(freshSealed,day)?freshSealed.records:[]).filter(row=>!known.has(row.symbol))
    .sort((a,b)=>(height(b)||0)-(height(a)||0)||(b.amountCny||0)-(a.amountCny||0)).slice(0,4);
   const backups=await Promise.allSettled(priority.map(row=>fetchReason(row.symbol,day)));
   for(const response of backups){
    const row=result(response);
    if(row)reasons.push(row);
   }
   const reasonChannels={primaryCount,f10Count:reasons.length-primaryCount,f10Attempted:priority.length};
   const priorBatch=days.get(day);
   const older=priorBatch?.report;
   const retained=[];
   function recover(field,value){
    if(value!=null)return value;
    if(older?.[field]==null)return null;
    retained.push(field);
    return older[field];
   }
   function choosePool(field,fresh){
    if(completePool(fresh,day))return fresh;
    if(completePool(older?.[field],day))return recover(field,null);
    return poolMatches(fresh,day)?fresh:null;
   }
   const sealed=choosePool('sealed',freshSealed);
   const broken=choosePool('broken',freshBroken);
   const previous=completePool(freshPrevious,previousDay)?freshPrevious:previousPools.get(previousDay);
   previousPools.remember(completePool(freshSealed,day)?freshSealed:null,previous===freshPrevious?freshPrevious:null);
   const sealedCodes=new Set(sealed?.records.map(row=>row.symbol));
   const compatible=sealed?.complete&&broken?.complete&&!broken.records.some(row=>sealedCodes.has(row.symbol));
   const touched=compatible?sealed.records.length+broken.records.length:0;
   const freshSeatsStatus=!seatsReady?'pending':!seats.size?'unavailable':seatResult.status==='rejected'?'partial':'observed';
   const keepSeats=older?.seats.length&&freshSeatsStatus!=='observed'&&(older.seatsStatus==='observed'||!seats.size);
   if(keepSeats)retained.push('seats');
   const mergedReasons=new Map(reasons.map(row=>[row.code,row]));
   for(const row of older?.reasons||[]){
    const fresh=mergedReasons.get(row.code);
    if(!fresh||fresh.source==='同花顺 F10'&&row.source==='同花顺涨停聚焦'){
     mergedReasons.set(row.code,row);
     if(!retained.includes('reasons'))retained.push('reasons');
    }
   }
   const promotion=summarizePromotion(sealed,previous);
   if(promotion&&previous!==freshPrevious)retained.push('previousPool');
   const freshDown=normalizeDay(String(down?.qdate||''))===day&&Number.isSafeInteger(down?.tc)&&down.tc>=0?down.tc:null;
   const published=seatsReady||priorBatch?.key===day+':true';
   const preservePublication=!seatsReady&&published;
   const finalSeatsStatus=keepSeats||preservePublication?older.seatsStatus:freshSeatsStatus;
   const missingReasons=sealed?.records.length>0&&mergedReasons.size===0;
   const completeNow=compatible&&completePool(freshSealed,day)&&completePool(freshBroken,day)&&freshDown!==null&&
    (!published||finalSeatsStatus==='observed')&&!missingReasons;
   const brief=result(briefResult);
   const report={day,source:'东方财富',thsBrief:recover('thsBrief',brief?.day===day?brief:null),sealed,broken,reasons:[...mergedReasons.values()],reasonChannels,retained,
    retryAfterMs:completeNow?null:retryInterval,northTurnover:recover('northTurnover',result(northResult)),
    marketTurnover:recover('marketTurnover',marketTurnover(result(indexResult),day)),
    sealRate:touched?sealed.records.length/touched:null,promotion,
    down:recover('down',freshDown),
    seats:keepSeats?older.seats:[...seats.values()].sort((a,b)=>Math.abs(b.net)-Math.abs(a.net)),
    seatsStatus:finalSeatsStatus};
   // A request started before the publication threshold may finish after a
   // published request. Reuse its evidence without reverting the cache phase.
   days.set(day,{key:day+':'+published,at:clock(),report});
   if(days.size>keepSessions)days.delete([...days.keys()].sort()[0]);
   return report;
  })();
  pending.set(key,task);
  try{return await task;}finally{pending.delete(key);}
 };
}

module.exports={createCloseReviewReader,summarizePromotion,seatFrom,marketTurnover,reasonFromF10,thsDailyBrief,fetchThsDailyBrief};
