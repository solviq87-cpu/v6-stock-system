'use strict';
/**
 * Same-session sector breadth + constituent participation research.
 * Inputs are explicitly imported, unverified snapshots; this module never
 * fetches quotes, guesses missing member returns, writes weights or places orders.
 */
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=x=>Number(x.toFixed(3));
const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,x));
const chinaDay=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
const validDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
const fake=x=>/(?:^|[-_\s:])(?:fixture|synthetic|simulated|mock|test)(?:$|[-_\s:])/i.test(x.trim());
const validProvider=x=>typeof x==='string'&&x.trim().length>0&&x.length<=120&&!fake(x);
const validPct=x=>finite(x)&&x>=-100&&x<=100;
function evaluateDailySectorStrength(snapshot,{asOf=Date.now(),maxAgeMs=1200000,tradeDate}={}){
 const empty={schemaVersion:1,mode:'research-only',status:'unknown',
  scope:'provided-dated-sector-snapshot-only',tradeDate:null,
  provider:null,sectors:[],bySymbol:{},rankedSectorCount:0,
  verifiedLive:false,weightsChanged:false,autoPromotion:false,canTrade:false,
  note:'仅根据同日导入的板块与成分股涨跌分布作描述；不是主力资金流、实时认证或交易建议'};
 const fail=reason=>({...empty,reason});
 if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||
   snapshot.source!=='imported'||!validProvider(snapshot.provider)||
   !validDate(snapshot.tradeDate)||
   (tradeDate!==undefined&&tradeDate!==snapshot.tradeDate)||
   !finite(asOf)||asOf<=0||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<1||maxAgeMs>86400000||
   !finite(snapshot.observedAt)||snapshot.observedAt<=0||
   snapshot.observedAt>asOf||asOf-snapshot.observedAt>maxAgeMs||
   chinaDay(asOf)!==snapshot.tradeDate||chinaDay(snapshot.observedAt)!==snapshot.tradeDate||
   !validPct(snapshot.marketChangePct)||
   !Array.isArray(snapshot.sectors)||snapshot.sectors.length>300)
  return fail('snapshot-date-provenance-coverage-invalid');
 const {provider}=snapshot,day=snapshot.tradeDate;
 const validStamp=row=>row&&typeof row==='object'&&!Array.isArray(row)&&
   row.source===provider&&row.tradeDate===day&&finite(row.observedAt)&&
   row.observedAt>0&&row.observedAt<=snapshot.observedAt&&
   asOf-row.observedAt<=maxAgeMs&&chinaDay(row.observedAt)===day&&row.simulated!==true;
 const result={...empty,status:'imported-unverified',tradeDate:day,provider,
  observedAt:snapshot.observedAt,marketChangePct:snapshot.marketChangePct};
 const rows=[],seenSectors=new Set(),bySymbol=Object.create(null);
 for(const sector of snapshot.sectors){
  const code=sector?.code,name=sector?.name,category=sector?.category;
  const id=String(category)+'|'+String(code);
  const base={code:typeof code==='string'?code:null,
   name:typeof name==='string'?name:null,category,
   status:'unknown',rank:null,score:null,reason:null};
  if(seenSectors.has(id))return fail('duplicated-sector-id');
  seenSectors.add(id);
  if(!['industry','concept'].includes(category)||typeof code!=='string'||
    !/^[A-Za-z0-9_-]{2,30}$/.test(code)||typeof name!=='string'||
    !name.trim()||name.length>80||!validStamp(sector)||!validPct(sector.changePct)||
    !Number.isSafeInteger(sector.memberCount)||sector.memberCount<5||sector.memberCount>10000||
    !Array.isArray(sector.stocks)||sector.stocks.length>sector.memberCount){
    rows.push({...base,reason:'sector-metadata-or-membership-invalid'});continue;
  }
  const seen=new Set(),valid=[];
  let corrupt=false,halted=0;
  for(const stock of sector.stocks){
   const symbol=stock?.symbol;
   if(typeof symbol!=='string'||!/^[0-9]{6}$/.test(symbol)||seen.has(symbol)||
      !validStamp(stock)||
      (stock.isLimitUp!==undefined&&typeof stock.isLimitUp!=='boolean')){
     corrupt=true;break;
   }
   seen.add(symbol);
   if(stock.tradingStatus==='halted'&&stock.changePct===null){halted++;continue;}
   if(stock.tradingStatus!==undefined&&stock.tradingStatus!=='trading'){
     corrupt=true;break;
   }
   if(!validPct(stock.changePct)){corrupt=true;break;}
   valid.push(stock);
  }
  if(corrupt){rows.push({...base,reason:'stock-source-time-return-or-duplication-invalid'});continue;}
  // Coverage counts observed tradable members only. Halted or unobserved members
  // cannot be silently assigned 0% returns or counted as declining stocks.
  const coverage=valid.length/sector.memberCount;
  if(valid.length<5||coverage<.8){
    rows.push({...base,reason:'insufficient-valid-constituent-coverage',
     observedStocks:valid.length,memberCount:sector.memberCount,
     haltedCount:halted,coveragePct:round(coverage*100)});continue;
  }
  const ordered=[...valid].sort((a,b)=>a.changePct-b.changePct);
  const n=ordered.length,up=ordered.filter(s=>s.changePct>0).length,
   down=ordered.filter(s=>s.changePct<0).length,flat=n-up-down;
  const median=n%2?ordered[(n-1)/2].changePct:
    (ordered[n/2-1].changePct+ordered[n/2].changePct)/2;
  const gain=ordered.filter(s=>s.changePct>0).sort((a,b)=>b.changePct-a.changePct);
  const totalPositive=gain.reduce((sum,s)=>sum+s.changePct,0);
  const top2Share=totalPositive>0?
   gain.slice(0,2).reduce((sum,s)=>sum+s.changePct,0)/totalPositive:null;
  const limitUpsKnown=valid.every(s=>typeof s.isLimitUp==='boolean');
  const limitUps=limitUpsKnown?valid.filter(s=>s.isLimitUp).length:null;
  const relative=sector.changePct-snapshot.marketChangePct;
  const parts=[
   [30,clamp(50+8*sector.changePct)],
   [25,up/n*100],
   [20,clamp(50+10*median)],
   [15,clamp(50+8*relative)]
  ];
  if(limitUpsKnown)parts.push([10,clamp(limitUps/sector.memberCount*1000)]);
  const weighted=parts.reduce((acc,[weight,value])=>acc+weight*value,0)/
   parts.reduce((acc,[weight])=>acc+weight,0);
  const concentrationPenalty=top2Share!==null&&top2Share>=.7?12:0;
  const score=round(clamp(weighted-concentrationPenalty));
  const breadth=up/n*100;
  const state=sector.changePct>0&&(breadth<50||top2Share!==null&&top2Share>=.7)?
   'leader-concentrated':
   sector.changePct>0&&relative>0&&breadth>=60&&median>0&&score>=65?
    'broad-strength':
   sector.changePct>0&&breadth>=50?'developing-strength':
   sector.changePct<0&&breadth<40?'weak':'mixed';
  const row={...base,status:limitUpsKnown?'imported-unverified':'partial-evidence',
   changePct:round(sector.changePct),relativeToMarketPct:round(relative),
   observedStocks:n,memberCount:sector.memberCount,haltedCount:halted,
   coveragePct:round(coverage*100),upCount:up,downCount:down,flatCount:flat,
   upPct:round(breadth),medianPct:round(median),
   topTwoPositiveSharePct:top2Share===null?null:round(top2Share*100),
   limitUpCount:limitUps,score,state,
   leaders:gain.slice(0,3).map(s=>({symbol:s.symbol,changePct:round(s.changePct)})),
   warnings:[...(top2Share!==null&&top2Share>=.7?['涨幅集中于两只领涨股，不能视为普涨']:[]),
    ...(!limitUpsKnown?['缺少完整的涨停标记，评分未包含涨停扩散']:[])],
   reason:limitUpsKnown?'research-thresholds-not-validated':'limit-up-evidence-incomplete'};
  rows.push(row);
  for(const stock of valid){
   (bySymbol[stock.symbol]??=[]).push({code,name,category,
    status:row.status,score:row.score,state:row.state,upPct:row.upPct});
  }
 }
 // Do not compare concepts against industries; they overlap and have different universes.
 for(const category of ['industry','concept']){
  const eligible=rows.filter(r=>r.category===category&&r.score!==null)
   .sort((a,b)=>b.score-a.score||b.changePct-a.changePct||a.code.localeCompare(b.code));
  if(eligible.length<3)continue;
  eligible.forEach((row,i)=>{row.rank=i+1;row.rankDenominator=eligible.length;});
 }
 rows.sort((a,b)=>a.category.localeCompare(b.category)||
  (a.rank??Number.MAX_SAFE_INTEGER)-(b.rank??Number.MAX_SAFE_INTEGER)||
  a.name?.localeCompare(b.name||'')||0);
 result.sectors=rows;
 result.rankedSectorCount=rows.filter(row=>row.rank!==null).length;
 result.bySymbol=bySymbol;
 result.evaluatedSectorCount=rows.filter(row=>row.score!==null).length;
 result.invalidSectorCount=rows.length-result.evaluatedSectorCount;
 result.note+='；固定阈值未经样本外验证；概念与行业分开排序，不表示全市场覆盖';
 return result;
}
module.exports={evaluateDailySectorStrength};
