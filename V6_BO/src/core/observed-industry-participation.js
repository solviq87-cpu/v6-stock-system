'use strict';
/**
 * Read-only observed INDUSTRY constituent participation.
 * Join explicit BaoStock industry classification to the existing one-fetch
 * quote snapshot. Membership and quotes keep SEPARATE provenance; no board
 * index return, original quote time, money flow or trading authorization is inferred.
 */
const {aShareCalendarDate}=require('./a-share-calendar');
const validDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const milli=x=>Number.isSafeInteger(x)&&x>=946684800000&&x<4102444800000;
const codeOK=x=>typeof x==='string'&&/^(?:sh\.(?:60|68)\d{4}|sz\.(?:00|30)\d{4})$/.test(x);
const symbolOK=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const nameOK=x=>typeof x==='string'&&x.trim().length>0&&x.length<=80&&!/[\u0000-\u001f<>]/.test(x);
const safeSource=x=>typeof x==='string'&&x.length<=120&&x.trim().length>0&&
 !/(?:^|[-_\s:])(?:fixture|synthetic|simulated|mock|test)(?:$|[-_\s:])/i.test(x);
const round=x=>Number(x.toFixed(3));
const clamp=(x,lo=0,hi=100)=>Math.max(lo,Math.min(hi,x));
function median(input){
 const a=[...input].sort((x,y)=>x-y),n=a.length;
 return n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2;
}
function insufficient(reason,extra={}){
 return {schemaVersion:1,mode:'research-only',status:'insufficient-evidence',
  scope:'observed-industry-constituents-not-board-index',reason,
  industrySource:'baostock:query_stock_industry',quoteSource:null,
  providerLicenseVerified:false,exchangeVerified:false,verifiedLive:false,
  canTrade:false,weightsChanged:false,rankingModified:false,autoPromotion:false,
  sectors:[],bySymbol:{},...extra};
}
function evaluateObservedIndustryParticipation({snapshot,classification,asOf=Date.now(),
  maxQuoteAgeMs=120000,maxSnapshotAgeMs=180000,minCoverage=.8,maxIndustryAgeDays=28}={}){
 if(!milli(asOf)||!Number.isSafeInteger(maxQuoteAgeMs)||maxQuoteAgeMs<1000||maxQuoteAgeMs>300000||
  !Number.isSafeInteger(maxSnapshotAgeMs)||maxSnapshotAgeMs<1000||maxSnapshotAgeMs>300000||
  !finite(minCoverage)||minCoverage<.5||minCoverage>1||
  !Number.isInteger(maxIndustryAgeDays)||maxIndustryAgeDays<1||maxIndustryAgeDays>60)
  return insufficient('invalid-evaluation-options');
 const tradeDate=snapshot?.date;
 const received=typeof snapshot?.retrievedAt==='string'?Date.parse(snapshot.retrievedAt):NaN;
 if(!validDate(tradeDate)||tradeDate!==aShareCalendarDate(asOf)||
  !safeSource(snapshot?.source)||!Number.isInteger(snapshot?.universeSize)||snapshot.universeSize<15||
  !Array.isArray(snapshot?.stocks)||snapshot.stocks.length>10000||
  !milli(received)||new Date(received).toISOString()!==snapshot.retrievedAt||
  received>asOf||asOf-received>maxSnapshotAgeMs||
  aShareCalendarDate(received)!==tradeDate)
  return insufficient('quote-snapshot-date-source-or-retrieval-invalid');
 if(classification?.schemaVersion!==1||classification.source!=='baostock:query_stock_industry'||
  classification.completed!==true||classification.standard!=='证监会行业分类'||
  !validDate(classification.updateDate)||classification.updateDate>tradeDate||
  !milli(classification.observedAt)||classification.observedAt>asOf||
  aShareCalendarDate(classification.observedAt)<classification.updateDate||
  !Array.isArray(classification.rows)||classification.rows.length>10000||
  !Number.isInteger(classification.declaredRows)||
  classification.declaredRows!==classification.rows.length||
  classification.rows.length<15)
  return insufficient('classification-source-completeness-or-date-invalid',{tradeDate});
 const industryAgeDays=(Date.parse(tradeDate+'T00:00:00Z')-
   Date.parse(classification.updateDate+'T00:00:00Z'))/86400000;
 if(industryAgeDays>maxIndustryAgeDays)
  return insufficient('classification-update-too-old',{tradeDate,classificationDate:classification.updateDate,industryAgeDays});
 const membership=new Map(),groups=new Map();
 for(const row of classification.rows){
  if(!codeOK(row?.code)||!validDate(row?.updateDate)||
   row.updateDate!==classification.updateDate||
   row.industryClassification!==classification.standard||
   typeof row.industry!=='string'||row.industry.length>80||
   /[\u0000-\u001f<>]/.test(row.industry)||membership.has(row.code.slice(3)))
   return insufficient('industry-member-code-standard-or-date-conflict',{tradeDate});
  const symbol=row.code.slice(3),industry=row.industry.trim();
  membership.set(symbol,industry||null);
  if(industry){
   if(!groups.has(industry))groups.set(industry,[]);
   groups.get(industry).push(symbol);
  }
 }
 const quoteCodes=new Map();
 for(const q of snapshot.stocks){
  if(!symbolOK(q?.code)||quoteCodes.has(q.code))return insufficient('duplicate-or-invalid-quote-symbol',{tradeDate});
  quoteCodes.set(q.code,q);
 }
 if(quoteCodes.size>snapshot.universeSize)
  return insufficient('quote-universe-count-conflict',{tradeDate});
 const quotes=new Map();
 for(const [symbol,q] of quoteCodes){
  if(q.suspended===true||!finite(q.pctChange)||q.pctChange< -100||q.pctChange>100||
   !milli(q.vendorQuoteAt)||q.vendorQuoteAt>received||
   received-q.vendorQuoteAt>maxQuoteAgeMs||aShareCalendarDate(q.vendorQuoteAt)!==tradeDate)continue;
  quotes.set(symbol,q.pctChange);
 }
 const quoteCoverage=quotes.size/snapshot.universeSize;
 if(quoteCoverage<minCoverage)
  return insufficient('original-quote-time-market-coverage-insufficient',{
   tradeDate,quoteSource:snapshot.source,marketQuoteCoveragePct:round(100*quoteCoverage)});
 // Both the overall classifier and the surviving current quotes must cover
 // the declared market. Otherwise a partial membership table could yield a
 // deceptively convincing "top 3 industry" ranking.
 const membershipCoverage=[...quoteCodes.keys()].filter(x=>membership.get(x)).length/snapshot.universeSize;
 if(membershipCoverage<minCoverage)
  return insufficient('industry-membership-market-coverage-insufficient',{
   tradeDate,quoteSource:snapshot.source,industryCoveragePct:round(100*membershipCoverage)});
 const marketMedian=median([...quotes.values()]),sectors=[],excluded=[],bySymbol=Object.create(null);
 for(const [name,members] of groups){
  const observations=members.filter(code=>quotes.has(code))
   .map(code=>({symbol:code,changePct:quotes.get(code)}));
  const coverage=observations.length/members.length;
  if(members.length<5||observations.length<5||coverage<minCoverage){
   excluded.push({name,reason:'industry-constituent-coverage-insufficient',
    totalMembers:members.length,covered:observations.length,coveragePct:round(coverage*100)});
   continue;
  }
  const changes=observations.map(x=>x.changePct),med=median(changes);
  const up=changes.filter(x=>x>0).length,down=changes.filter(x=>x<0).length,flat=changes.length-up-down;
  const strong=changes.filter(x=>x>=2).length;
  const positive=changes.filter(x=>x>0).sort((a,b)=>b-a);
  const positiveTotal=positive.reduce((a,b)=>a+b,0);
  const topTwoShare=positiveTotal>0?positive.slice(0,2).reduce((a,b)=>a+b,0)/positiveTotal:null;
  const breadthPct=100*up/changes.length,excess=med-marketMedian;
  const penalty=topTwoShare!==null&&topTwoShare>=.7?12:0;
  const score=round(clamp(.4*breadthPct+.25*clamp(50+10*excess)+
   .2*(100*strong/changes.length)+.15*clamp(50+10*med)-penalty));
  const label=topTwoShare!==null&&topTwoShare>=.7&&up>0?'leader-concentrated':
   breadthPct>=60&&med>0&&excess>0&&score>=65?'broad-participation':
   breadthPct>=50&&med>0?'mixed-positive':
   breadthPct<40&&med<0?'weak':'mixed';
  const leaders=observations.filter(x=>x.changePct>0)
   .sort((a,b)=>b.changePct-a.changePct||a.symbol.localeCompare(b.symbol)).slice(0,3);
  const row={industry:name,memberCount:members.length,observed:observations.length,
   coveragePct:round(coverage*100),up,down,flat,strongUp:strong,
   upPct:round(breadthPct),medianStockChangePct:round(med),
   excessStockMedianPct:round(excess),topTwoPositiveSharePct:topTwoShare===null?null:round(topTwoShare*100),
   leaders,score,label,officialBoardChangePct:null,
   reason:'行业成分股等权观察，非行业指数涨幅；阈值未经样本外验证'};
  sectors.push(row);
  for(const x of observations)bySymbol[x.symbol]={
   industry:name,score,label,source:'derived-industry-participation',
   originalQuoteSource:snapshot.source,classificationSource:classification.source,
   verifiedLive:false,canTrade:false};
 }
 sectors.sort((a,b)=>b.score-a.score||b.upPct-a.upPct||a.industry.localeCompare(b.industry,'zh'));
 const sufficient=sectors.length>=3;
 // Even with one or two valid groups report measurements, but do NOT rank.
 if(sufficient)sectors.forEach((s,i)=>{s.rank=i+1;s.rankDenominator=sectors.length;});
 return {schemaVersion:1,mode:'research-only',status:sufficient?'observed-unverified':'insufficient-comparison',
  scope:'observed-industry-constituents-not-board-index',tradeDate,asOf,
  quoteSource:snapshot.source,industrySource:classification.source,
  classificationDate:classification.updateDate,classificationObservedAt:classification.observedAt,
  quoteRetrievedAt:received,marketQuoteCoveragePct:round(100*quoteCoverage),
  industryCoveragePct:round(100*membershipCoverage),marketStockMedianPct:round(marketMedian),
  validIndustries:sectors.length,excludedIndustries:excluded,
  sectors,bySymbol,officialBoardChangeAvailable:false,
  providerLicenseVerified:false,exchangeVerified:false,verifiedLive:false,
  canTrade:false,weightsChanged:false,rankingModified:false,autoPromotion:false,
  note:'BaoStock行业分类与独立报价供应商的来源始终分开；仅同日逐股原始报价时间参与，行业成分股等权分布不等于行业指数涨幅；没有外部取数及供应商商业许可认证。'};
}
module.exports={evaluateObservedIndustryParticipation};
