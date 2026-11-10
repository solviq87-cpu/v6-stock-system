'use strict';
/**
 * One-snapshot bridge. Reuse quotes already obtained by
 * eastmoney-market-snapshot; NEVER fetch a second time, infer quote timestamps,
 * or present an equal-weight member proxy as a provider-published sector index.
 */
const {aShareCalendarDate}=require('./a-share-calendar');
const {classifyQuoteTime}=require('./market-snapshot-quote-time');
const {evaluateDailySectorStrength}=require('../strategy/daily-sector-strength');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const pct=x=>finite(x)&&x>=-100&&x<=100;
const providerOK=x=>typeof x==='string'&&x.length>0&&x.length<=120&&
 !/(^|[-_\s:])(test|mock|fixture|synthetic|simulated)([-_\s:]|$)/i.test(x);
const symbolOK=x=>typeof x==='string'&&/^\d{6}$/.test(x);
function bridgeExistingMarketSector(snapshot,membership,{asOf,maxQuoteAgeMs=300000,minMarketCoverage=.8}={}){
 const unknown=reason=>({schemaVersion:1,status:'unknown',reason,
  verifiedLive:false,weightsChanged:false,autoPromotion:false,canTrade:false,
  rankingModified:false,returnMethod:'equal-weight-constituents-proxy',
  study:null,note:'缺少可核实的同日成分股时点、行情覆盖率或有效分类版本，不生成强势排名'});
 if(!Number.isSafeInteger(maxQuoteAgeMs)||maxQuoteAgeMs<1000||maxQuoteAgeMs>300000||
   !finite(minMarketCoverage)||minMarketCoverage<.8||minMarketCoverage>1)
  return unknown('invalid-evidence-thresholds');
 // Exactly the existing snapshot source contract; no scraping or secondary quote calls.
 if(!snapshot||snapshot.source!=='eastmoney-clist-unverified-live'||
   !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.date||'')||
   !Number.isSafeInteger(snapshot.universeSize)||snapshot.universeSize<5||
   !Array.isArray(snapshot.stocks)||snapshot.stocks.length>10000||
   snapshot.stocks.length>snapshot.universeSize)
  return unknown('existing-market-snapshot-invalid');
 const start=Date.parse(snapshot.startedAt||''),end=Date.parse(snapshot.retrievedAt||'');
 const time=asOf??end;
 if(!Number.isSafeInteger(time)||time<=0||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
   start>end||end-start>120000||time<end||time-end>600000||
   aShareCalendarDate(time)!==snapshot.date||aShareCalendarDate(start)!==snapshot.date||
   aShareCalendarDate(end)!==snapshot.date)
  return unknown('snapshot-clock-session-invalid');
 if(!membership||membership.schemaVersion!==1||membership.source!=='imported'||
   !providerOK(membership.provider)||membership.tradeDate!==snapshot.date||
   !providerOK(membership.classificationVersion)||
   !Number.isSafeInteger(membership.observedAt)||membership.observedAt<=0||
   membership.observedAt>start||aShareCalendarDate(membership.observedAt)!==snapshot.date||
   !Array.isArray(membership.sectors)||membership.sectors.length>300)
  return unknown('membership-version-or-point-in-time-invalid');
 const quotes=new Map();
 for(const s of snapshot.stocks){
  if(!symbolOK(s?.code)||quotes.has(s.code))
   return unknown('duplicated-or-malformed-market-symbol');
  if(s.source!==undefined&&s.source!==snapshot.source)
   return unknown('mixed-provider-symbol-evidence');
  const timestamp=classifyQuoteTime(s,{requestDate:snapshot.date,
   retrievedAt:time,maxAgeMs:maxQuoteAgeMs});
  if(timestamp.quoteTimeStatus!=='recent-source-unverified'||!pct(s.pctChange))
   continue;
  quotes.set(s.code,{symbol:s.code,changePct:s.pctChange,
   tradeDate:snapshot.date,observedAt:timestamp.quoteAt,source:snapshot.source,
   tradingStatus:'trading',
   ...(typeof s.limitUp==='boolean'?{isLimitUp:s.limitUp}:{})});
 }
 if(quotes.size<5||quotes.size/snapshot.universeSize<minMarketCoverage)
  return unknown('fresh-market-quote-coverage-insufficient');
 const marketProxy=Array.from(quotes.values()).reduce((total,s)=>total+s.changePct,0)/quotes.size;
 const sectors=[],seenSectorIds=new Set();
 for(const item of membership.sectors){
  const id=String(item?.category)+'|'+String(item?.code);
  if(seenSectorIds.has(id))return unknown('duplicated-sector-membership');
  seenSectorIds.add(id);
  if(!['industry','concept'].includes(item?.category)||
    typeof item.code!=='string'||!/^[A-Za-z0-9_-]{2,30}$/.test(item.code)||
    typeof item.name!=='string'||!item.name.trim()||item.name.length>80||
    !Array.isArray(item.members)||item.members.length<5||item.members.length>10000||
    item.memberCount!==item.members.length||new Set(item.members).size!==item.members.length||
    item.members.some(s=>!symbolOK(s)))
   return unknown('membership-members-invalid');
  const members=item.members.map(symbol=>quotes.get(symbol)).filter(Boolean);
  // Every member has a frozen mapping. Unavailable quotes stay absent;
  // the underlying study enforces >=80% coverage, no inferred 0% returns.
  const sectorPct=members.length?
   members.reduce((total,s)=>total+s.changePct,0)/members.length:null;
  sectors.push({category:item.category,code:item.code,name:item.name,
   tradeDate:snapshot.date,source:snapshot.source,observedAt:time,
   memberCount:item.memberCount,changePct:sectorPct,stocks:members});
 }
 const derived={source:'imported',provider:snapshot.source,
  tradeDate:snapshot.date,observedAt:time,marketChangePct:marketProxy,sectors};
 const study=evaluateDailySectorStrength(derived,{asOf:time,tradeDate:snapshot.date,
  maxAgeMs:Math.max(maxQuoteAgeMs,end-start+1000)});
 if(study.status!=='imported-unverified')return unknown('downstream-study-'+study.reason);
 return {schemaVersion:1,status:'imported-unverified',tradeDate:snapshot.date,
  observedAt:time,quoteProvider:snapshot.source,
  membershipProvider:membership.provider,classificationVersion:membership.classificationVersion,
  freshQuotes:quotes.size,universeSize:snapshot.universeSize,
  marketQuoteCoveragePct:Number((quotes.size/snapshot.universeSize*100).toFixed(3)),
  returnMethod:'equal-weight-constituents-proxy',
  benchmarkMethod:'equal-weight-valid-constituents-universe',
  membershipFrozenAt:membership.observedAt,
  study:{...study,returnMethod:'equal-weight-constituents-proxy',
   benchmarkMethod:'equal-weight-valid-constituents-universe',
   classificationVersion:membership.classificationVersion,
   note:study.note+'；板块与大盘涨幅均为有效个股等权代理，非板块指数或交易所基准'},
  verifiedLive:false,weightsChanged:false,autoPromotion:false,canTrade:false,
  rankingModified:false,
  note:'仅重用已取得的全市场快照和冻结板块成员，逐票f124原时点门禁；未认证实时或分类许可；不更改任何正式选股/账户路径'};
}
module.exports={bridgeExistingMarketSector};
