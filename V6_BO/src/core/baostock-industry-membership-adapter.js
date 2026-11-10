'use strict';
/**
 * Adapt a documented BaoStock query_stock_industry export into the frozen
 * member contract of sector-breadth-market-bridge. Does NOT fetch quotes,
 * deduce official sector index prices, or confer a data usage license.
 */
const crypto=require('node:crypto');
const {aShareCalendarDate}=require('./a-share-calendar');
const validDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
const validCode=x=>typeof x==='string'&&/^(?:sh\.(?:60|68)\d{4}|sz\.(?:00|30)\d{4})$/.test(x);
const code=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const validName=x=>typeof x==='string'&&x.length>0&&x.length<=80&&!/[\u0000-\u001f<>]/.test(x);
const millis=x=>Number.isSafeInteger(x)&&x>946684800000&&x<4102444800000;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function adaptBaoStockIndustryMembership(raw,snapshot,{minCoverage=.8,maxVersionAgeDays=28}={}){
 const fail=reason=>({schemaVersion:1,status:'unknown',reason,memberCount:0,sectors:[],
   canTrade:false,providerLicenseIndependentlyVerified:false,verifiedLive:false});
 if(typeof minCoverage!=='number'||!Number.isFinite(minCoverage)||minCoverage<.8||minCoverage>1||
  !Number.isInteger(maxVersionAgeDays)||maxVersionAgeDays<1||maxVersionAgeDays>28)
  return fail('invalid-coverage-or-age-options');
 const tradeDate=snapshot?.date,started=Date.parse(snapshot?.startedAt||''),
  ended=Date.parse(snapshot?.retrievedAt||'');
 if(!validDate(tradeDate)||snapshot?.source!=='eastmoney-clist-unverified-live'||
  !millis(started)||!millis(ended)||started>ended||
  aShareCalendarDate(started)!==tradeDate||aShareCalendarDate(ended)!==tradeDate||
  !Number.isInteger(snapshot?.universeSize)||snapshot.universeSize<15||
  !Array.isArray(snapshot?.stocks)||snapshot.stocks.length>snapshot.universeSize||
  snapshot.stocks.length/snapshot.universeSize<minCoverage)
  return fail('dated-complete-quote-snapshot-required');
 if(raw?.schemaVersion!==1||raw?.source!=='baostock:query_stock_industry'||
  raw.completed!==true||!['证监会行业分类','申万一级行业'].includes(raw.standard)||
  !validDate(raw.updateDate)||raw.updateDate>tradeDate||
  !millis(raw.observedAt)||raw.observedAt>started||
  aShareCalendarDate(raw.observedAt)!==tradeDate||
  !Array.isArray(raw.rows)||raw.rows.length<15||raw.rows.length>10000||
  raw.declaredRows!==raw.rows.length)
  return fail('classification-completeness-standard-or-freeze-invalid');
 const ageDays=(Date.parse(tradeDate+'T00:00:00Z')-
  Date.parse(raw.updateDate+'T00:00:00Z'))/86400000;
 if(ageDays>maxVersionAgeDays)return fail('industry-version-too-old');
 const groups=new Map(),classified=new Set(),securities=new Set();
 for(const item of raw.rows){
  if(!validCode(item?.code)||item.industryClassification!==raw.standard||
   item.updateDate!==raw.updateDate||typeof item.industry!=='string'||
   item.industry.length>80||/[\u0000-\u001f<>]/.test(item.industry))
   return fail('classification-row-or-standard-invalid');
  const symbol=item.code.slice(3);
  if(classified.has(symbol))return fail('duplicated-constituent-classification');
  classified.add(symbol);
  const industry=item.industry.trim();
  if(industry){
   if(!validName(industry))return fail('invalid-industry-name');
   if(!groups.has(industry))groups.set(industry,new Set());
   groups.get(industry).add(symbol);
   securities.add(symbol);
  }
 }
 const quoteIds=new Set();
 for(const item of snapshot.stocks){
  if(!code(item?.code)||quoteIds.has(item.code))
   return fail('duplicate-or-invalid-quote-symbol');
  quoteIds.add(item.code);
 }
 const represented=[...quoteIds].filter(symbol=>securities.has(symbol)).length;
 const coverage=represented/snapshot.universeSize;
 if(coverage<minCoverage)
  return fail('classification-market-coverage-insufficient');
 const sectors=[];
 for(const [name,set] of groups){
  // Previous research bridge requires >=5 frozen members per board.
  if(set.size<5)continue;
  const code='BS_'+hash([raw.standard,name]).slice(0,12).toUpperCase();
  sectors.push({code,name,category:'industry',
   memberCount:set.size,members:[...set].sort()});
 }
 if(sectors.length<3||sectors.length>300)return fail('insufficient-comparable-industry-groups');
 sectors.sort((a,b)=>a.code.localeCompare(b.code));
 if(new Set(sectors.map(x=>x.code)).size!==sectors.length)
  return fail('sector-code-collision');
 const fingerprint=hash({standard:raw.standard,updateDate:raw.updateDate,
  rows:[...raw.rows].sort((a,b)=>a.code.localeCompare(b.code))});
 const standardId=raw.standard==='证监会行业分类'?'csrc':'sw1';
 const membership={schemaVersion:1,source:'imported',
  provider:'baostock:query_stock_industry',tradeDate,
  classificationVersion:'baostock-'+standardId+'-'+raw.updateDate+'-'+fingerprint.slice(0,12),
  observedAt:raw.observedAt,sectors,
  provenance:{originalSource:raw.source,standard:raw.standard,
   classificationDate:raw.updateDate,classifiedStocks:classified.size,
   marketMappedStocks:represented,marketCoveragePct:Number((coverage*100).toFixed(3)),
   fingerprint,sourceObservedAt:raw.observedAt,quoteSource:snapshot.source,
   providerLicenseIndependentlyVerified:false,exchangeVerified:false},
  canTrade:false};
 return {schemaVersion:1,status:'imported-unverified',tradeDate,
  sectorCount:sectors.length,stockCount:represented,
  marketCoveragePct:Number((coverage*100).toFixed(3)),
  membership,providerLicenseIndependentlyVerified:false,verifiedLive:false,canTrade:false,
  note:'仅为在行情采集前冻结的BaoStock行业成员，不代表行业官方指数涨幅；原始分类与报价来源分别溯源，数据许可未独立核验'};
}
module.exports={adaptBaoStockIndustryMembership};
