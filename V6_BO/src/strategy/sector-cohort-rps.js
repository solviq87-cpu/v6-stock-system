'use strict';
// Strict, read-only 20-session cross-sectional sector percentile within the
// supplied research cohort. Never substitutes for all-market RPS or flow data.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=x=>Number(x.toFixed(4));
const dateOK=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&
 Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(Date.parse(d+'T00:00:00Z')).toISOString().slice(0,10)===d;
function evaluateSectorCohortRps(history,{factorContexts={}}={}){
 const no=(reason,excludedStocks=0)=>({schemaVersion:1,status:'unknown',
  scope:'provided-history-cohort-only',reason,distinctSectorCount:0,
  includedStocks:0,excludedStocks,bySymbol:{},sectors:[],verifiedLive:false,
  weightsChanged:false,autoPromotion:false,canTrade:false});
 if(history?.source!=='imported'||!Array.isArray(history.stocks)||
    !factorContexts||typeof factorContexts!=='object'||Array.isArray(factorContexts))
  return no('需要显式声明来源的历史股票样本和逐股板块序列');
 const rows=[],all=history.stocks;
 let excluded=0,basis=null,benchmark=null;
 const same=(a,b)=>a.length===b.length&&a.every((n,i)=>Math.abs(n-b[i])<=1e-8*Math.max(1,Math.abs(n),Math.abs(b[i])));
 for(const stock of all){
  const symbol=String(stock?.symbol||stock?.code||'');
  const bars=stock?.bars;
  const c=Object.hasOwn(factorContexts,symbol)?factorContexts[symbol]:null;
  if(!/^\d{6}$/.test(symbol)||!Array.isArray(bars)||bars.length<21||
     !c||c.schemaVersion!==1||c.source!=='imported'||
     typeof c.provider!=='string'||!c.provider.trim()||c.provider.length>120||
     ['simulated','synthetic','fixture','mock','test'].includes(c.provider.trim().toLowerCase())||
     !c.market||!c.sector||!['shanghai','shenzhen','chinext'].includes(c.market.id)||
     c.market.source!==c.provider||c.sector.source!==c.provider||
     c.market.simulated===true||c.sector.simulated===true||
     typeof c.sector.name!=='string'||!c.sector.name.trim()||c.sector.name.length>80||
     !dateOK(c.asOf)||c.asOf!==bars.at(-1)?.date){
   excluded++;continue;
  }
  const dateSlice=bars.slice(-21).map(x=>x.date);
  if(dateSlice.some((d,i)=>!dateOK(d)||(i>0&&d<=dateSlice[i-1]))){
   excluded++;continue;
  }
  const prices={};
  let bad=false;
  for(const field of ['market','sector']){
   const list=c[field].bars;
   if(!Array.isArray(list)||list.length!==21||
      list.some((bar,i)=>!bar||bar.date!==dateSlice[i]||!finite(bar.close)||bar.close<=0)){
    bad=true;break;
   }
   prices[field]=list.map(x=>x.close);
  }
  if(bad){excluded++;continue;}
  const rowBasis=c.provider+'|'+c.market.id+'|'+dateSlice.join(',');
  if(basis!==null&&basis!==rowBasis)return no('板块横向比较的来源、指数基准或交易日历不一致',all.length);
  if(benchmark!==null&&!same(benchmark,prices.market))
   return no('同一来源的指数基准数据互相冲突',all.length);
  basis=rowBasis;benchmark=prices.market;
  rows.push({symbol,sector:c.sector.name.trim(),prices:prices.sector,
   return20Pct:round((prices.sector.at(-1)/prices.sector[0]-1)*100)});
 }
 const sectorMap=new Map(),conflicts=new Set();
 for(const r of rows){
  if(conflicts.has(r.sector))continue;
  const previous=sectorMap.get(r.sector);
  if(previous&&!same(previous.prices,r.prices)){
   conflicts.add(r.sector);sectorMap.delete(r.sector);
  }else if(previous)previous.symbols.push(r.symbol);
  else sectorMap.set(r.sector,{sector:r.sector,prices:r.prices,
    return20Pct:r.return20Pct,symbols:[r.symbol]});
 }
 const sectors=[...sectorMap.values()];
 if(sectors.length<3)return no('至少需要三个不同且序列一致的板块才能计算样本内分位',all.length);
 const n=sectors.length;
 for(const row of sectors){
  const less=sectors.filter(x=>x.return20Pct<row.return20Pct).length;
  const tied=sectors.filter(x=>x.return20Pct===row.return20Pct).length;
  row.rpsPct=round(100*(less+(tied-1)/2)/(n-1));
 }
 const bySymbol={};
 for(const row of sectors){
  for(const symbol of row.symbols)bySymbol[symbol]={status:'imported-unverified',
   sector:row.sector,return20Pct:row.return20Pct,rpsPct:row.rpsPct,
   cohortSectors:n,asOf:history.stocks[0]?.bars?.at(-1)?.date||null};
 }
 const ranked=sectors.sort((a,b)=>b.rpsPct-a.rpsPct||a.sector.localeCompare(b.sector))
  .map(({sector,return20Pct,rpsPct,symbols})=>({sector,return20Pct,rpsPct,representedStocks:symbols.length}));
 return {schemaVersion:1,status:'imported-unverified',
  scope:'provided-history-cohort-only',asOf:history.stocks[0]?.bars?.at(-1)?.date||null,
  provider:basis?.split('|')[0]||null,benchmarkId:basis?.split('|')[1]||null,
  distinctSectorCount:n,includedStocks:Object.keys(bySymbol).length,
  excludedStocks:all.length-Object.keys(bySymbol).length,
  conflictingSectors:[...conflicts].sort(),sectors:ranked,bySymbol,
  verifiedLive:false,weightsChanged:false,autoPromotion:false,canTrade:false,
  note:'仅对已导入的可比板块做20交易日历史收益分位；不代表全市场RPS、真实资金流或上涨因果，也不会改变选股权重。'};
}
module.exports={evaluateSectorCohortRps};
