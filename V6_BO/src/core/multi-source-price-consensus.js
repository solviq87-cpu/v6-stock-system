'use strict';
/**
 * Research-only A-share quote consensus. Never create a synthetic execution
 * price, substitute stale prices or imply independent exchange-certified feeds.
 */
const {probePublicQuotes,projectProbe}=require('./public-quote-probe');
const {session}=require('./quote-dual-source-diagnostic');
const {fetchItickStockQuote}=require('./itick-stock-quote');
const PUBLIC_IDS=['tencent','eastmoney','sina'];
const bps=(a,b)=>10000*Math.abs(a-b)/Math.max(a,b);
const chinaDay=t=>new Date(t+8*3600000).toISOString().slice(0,10);
const validCode=code=>typeof code==='string'&&/^(?:60|68|00|30)\d{4}$/.test(code);
function options({priceToleranceBps,timeGapMs,maxAgeMs}){
 if(!Number.isFinite(priceToleranceBps)||priceToleranceBps<0||priceToleranceBps>100||
  !Number.isSafeInteger(timeGapMs)||timeGapMs<0||timeGapMs>15000||
  !Number.isSafeInteger(maxAgeMs)||maxAgeMs<1000||maxAgeMs>30000)
  throw Error('多源报价核对阈值无效');
}
function fuseMultiSourcePrices({code,now,sources,priceToleranceBps=30,timeGapMs=5000,maxAgeMs=15000}={}){
 if(!validCode(code)||!Number.isSafeInteger(now)||now<=0||
  !Array.isArray(sources)||sources.length<1||sources.length>8)
  throw Error('股票代码、时间或来源列表无效');
 options({priceToleranceBps,timeGapMs,maxAgeMs});
 const providers=new Set(),valid=[],sourceStatuses=[];
 const expectedExchange=code.startsWith('6')?'SH':'SZ';
 for(const s of sources){
  if(!s||typeof s.id!=='string'||!/^[a-z][a-z0-9-]{0,39}$/.test(s.id)||providers.has(s.id))
   throw Error('来源缺失或重复');
  providers.add(s.id);
  const q=s.quote;
  let reason='unavailable';
  if(s.status==='unconfigured')reason='unconfigured';
  else if(s.status==='dated-snapshot')reason='dated-snapshot';
  else if(s.status==='fresh-unverified'){
   if(!q||q.code!==code||q.exchange!==expectedExchange||q.currency!=='CNY'||
    q.adjustment!=='unadjusted'||!['normal','market-state-unverified'].includes(q.status)||
    !Number.isFinite(q.price)||q.price<=0||!Number.isFinite(q.previousClose)||
    q.previousClose<=0||!Number.isSafeInteger(q.quoteAt)||q.quoteAt<=0)
    reason='invalid-quote';
   else if(q.quoteAt>now)reason='future-quote';
   else if(now-q.quoteAt>maxAgeMs)reason='stale-quote';
   else if(chinaDay(q.quoteAt)!==chinaDay(now))reason='different-market-day';
   else {reason='eligible-for-comparison';valid.push({id:s.id,price:q.price,quoteAt:q.quoteAt});}
  }else if(s.status==='unavailable')reason='unavailable';
  else reason='invalid-status';
  const quoteAt=Number.isSafeInteger(q?.quoteAt)&&q.quoteAt>0?q.quoteAt:null;
  const observedPrice=Number.isFinite(q?.price)&&q.price>0?q.price:null;
  sourceStatuses.push({provider:s.id,status:reason,
   quoteAt,quoteAgeMs:quoteAt===null?null:now-quoteAt,
   observedPrice,inConsensus:false});
 }
 const base={schemaVersion:1,mode:'multi-source-price-consensus-research',
  code,checkedAt:new Date(now).toISOString(),referencePrice:null,representativeProvider:null,
  supportingProviders:[],sourceCount:sources.length,eligibleCount:valid.length,
  sourceStatuses,priceToleranceBps,timeGapMs,maxAgeMs,
  exchangeCalendarVerified:false,providerLicensed:false,certifiedLive:false,
  canTrade:false,canNotify:false,
  note:'仅比较逐股、同交易日且时间接近的供应商报价；逐源原始价格/时点保留，异常价格不自动乘除比例或取平均；缺失/冲突不输出统一价格，不认证独立性或许可。'};
 // This checks weekday clocks only; a statutory holiday can look like a session.
 if(!session(now))return {...base,status:'outside-weekday-session-window'};
 if(valid.length<2)return {...base,status:'insufficient-comparable-sources'};
 const quorum=valid.length<=3?2:Math.floor(valid.length/2)+1;
 const groups=[];
 for(let mask=1;mask<(1<<valid.length);mask++){
  const group=valid.filter((_,i)=>(mask&(1<<i))!==0);
  if(group.length<quorum)continue;
  const times=group.map(x=>x.quoteAt),prices=group.map(x=>x.price);
  if(Math.max(...times)-Math.min(...times)>timeGapMs||
     bps(Math.min(...prices),Math.max(...prices))>priceToleranceBps)continue;
  groups.push(group);
 }
 if(!groups.length)return {...base,status:'source-price-or-time-conflict'};
 const size=Math.max(...groups.map(x=>x.length));
 const best=groups.filter(g=>g.length===size);
 // Equally sized but different coherent sets have no unambiguous winner.
 if(best.length!==1)return {...base,status:'ambiguous-price-groups'};
 const matched=best[0],ids=new Set(matched.map(x=>x.id));
 for(const status of sourceStatuses)status.inConsensus=ids.has(status.provider);
 const representative=[...matched].sort((a,b)=>b.quoteAt-a.quoteAt||a.id.localeCompare(b.id))[0];
 return {...base,status:matched.length===valid.length?'sources-agree-unverified':'partial-source-agreement-unverified',
  // An observed price from one confirming provider, NEVER an invented average.
  referencePrice:representative.price,representativeProvider:representative.id,
  quoteAt:representative.quoteAt,
  supportingProviders:[...ids].sort(),
  matchedCount:matched.length,disagreeingProviders:valid.filter(x=>!ids.has(x.id)).map(x=>x.id).sort(),
  maxMatchedPriceGapBps:Number(bps(Math.min(...matched.map(x=>x.price)),Math.max(...matched.map(x=>x.price))).toFixed(3))};
}
async function checkMultiPublicPrices(config={}){
 const {code,now=Date.now(),probe=probePublicQuotes,
  extraSources=[],itickToken,fetchItick=fetchItickStockQuote,
  priceToleranceBps=30,timeGapMs=5000,maxAgeMs=15000}=config;
 // An explicitly supplied clock is a deliberate deterministic test/replay clock.
 // Live diagnostics must evaluate freshness after network work, not at request start.
 const currentClock=Object.hasOwn(config,'clock')?config.clock:
  (Object.hasOwn(config,'now')?()=>now:Date.now);
 if(!validCode(code)||!Number.isSafeInteger(now)||now<=0||
  typeof probe!=='function'||typeof fetchItick!=='function'||
  typeof currentClock!=='function'||
  !Array.isArray(extraSources)||extraSources.length>4)
  throw Error('多源股票诊断参数无效');
 // Never probe a known closed clock window. This is not an exchange holiday calendar.
 if(!session(now))return fuseMultiSourcePrices({code,now,
  sources:PUBLIC_IDS.map(id=>({id,status:'unavailable'}))
   .concat([{id:'itick',status:'unconfigured'}],extraSources),
  priceToleranceBps,timeGapMs,maxAgeMs});
 // A single optional adapter or public probe exception must not abort the
 // complete research result. Errors are downgraded to explicitly unavailable.
 let projected;
 try{
  const raw=await probe({code,providers:PUBLIC_IDS});
  projected=projectProbe(raw,currentClock());
 }catch{projected={sources:[]};}
 const sources=PUBLIC_IDS.map(id=>{
  const s=projected.sources.find(item=>item.id===id);
  return s?{id,status:s.status,quote:s.quote}: {id,status:'unavailable'};
 });
 // Public-source work can span an exchange lunch or close boundary.
 // Do not contact a paid/quota-limited optional provider after the window ends.
 const publicFinishedAt=currentClock();
 if(!session(publicFinishedAt))
  return fuseMultiSourcePrices({code,now:publicFinishedAt,
   sources:[...sources,{id:'itick',status:'unconfigured'},...extraSources],
   priceToleranceBps,timeGapMs,maxAgeMs});
 // Official iTick is opt-in and needs an operator token, never embedded in code.
 let itick;
 try{itick=await fetchItick({code,token:itickToken,now:currentClock()});}
 catch{itick=null;}
 if(!itick||itick.id!=='itick'||!['fresh-unverified','dated-snapshot','unavailable','unconfigured'].includes(itick.status))
  itick={id:'itick',status:'unavailable'};
 return fuseMultiSourcePrices({code,now:currentClock(),sources:[...sources,itick,...extraSources],
  priceToleranceBps,timeGapMs,maxAgeMs});
}
module.exports={fuseMultiSourcePrices,checkMultiPublicPrices};
