'use strict';
const {evaluateMarketSectorResilience}=require('./market-sector-resilience');
// All market/sector context is imported, time-scoped and unverified.
// This module never alters official stock selection, position alerts or paper orders.
const dateOk=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
 Number.isFinite(Date.parse(value+'T00:00:00Z'))&&
 new Date(Date.parse(value+'T00:00:00Z')).toISOString().slice(0,10)===value;
const scoreOk=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100;
const chinaDate=now=>new Date(now+8*3600000).toISOString().slice(0,10);
const safeName=value=>typeof value==='string'?value.slice(0,80):'';
const validObserved=(e,{asOf,date,maxAgeMs=1200000})=>
 e&&typeof e==='object'&&!Array.isArray(e)&&dateOk(e.tradeDate)&&e.tradeDate===date&&
 typeof e.source==='string'&&e.source.trim().length>0&&e.source.length<=120&&
 typeof e.observedAt==='number'&&Number.isFinite(e.observedAt)&&e.observedAt>0&&
 e.observedAt<=asOf&&asOf-e.observedAt<=maxAgeMs&&chinaDate(e.observedAt)===date;
function evaluateLinkage({symbol,patterns,issuerEvidence,quality,bars,linkage,asOf=Date.now()}={}){
 const empty={mode:'research-only',symbol:String(symbol||''),marketStatus:'unknown',sectorStatus:'unknown',
  market:'未知',sector:'未知',marketBreadth:null,sectorStrength:null,
  positiveContextCount:0,weakContextCount:0,technicalHitCount:patterns?.positiveCount||0,
  technicalRiskCount:patterns?.riskCount||0,
  riskConflict:false,risks:[],support:[],canTrade:false,scoreBonus:0,
  note:'市场与板块证据独立于原策略，只有同日且时效有效的观测才能建立研究联动'};
 if(!Number.isFinite(asOf)||asOf<=0||!/^\d{6}$/.test(empty.symbol))
  return {...empty,reason:'股票代码或评估时钟无效'};
 const last=Array.isArray(bars)?bars.at(-1):null;
 if(!quality?.usable||!dateOk(last?.date))
  return {...empty,reason:'K线没有可验证的完整日期或行情质量不合格'};
 const date=last.date,now=asOf;
 const m=linkage?.market,sector=linkage?.sectors?.[empty.symbol];
 const out={...empty,tradeDate:date};
 // Extra imported index/sector percent-change research is strictly optional.
 // Existing breadth/sector score rules and official candidate scoring remain unchanged.
 if(m?.indices!==undefined||sector?.changePct!==undefined)
  out.resilienceResearch=evaluateMarketSectorResilience({market:m,sector,tradeDate:date,asOf:now});
 const marketValid=validObserved(m,{asOf:now,date})&&
   scoreOk(m.breadthScore)&&typeof m.coverage==='number'&&Number.isFinite(m.coverage)&&m.coverage>=.8&&m.coverage<=1;
 if(marketValid){
  out.marketStatus='observed-unverified';out.market='已导入（未独立核验）';
  out.marketBreadth=m.breadthScore;
  if(m.breadthScore>=60){out.positiveContextCount++;out.support.push('同日市场上涨家数比例≥60%');}
  else if(m.breadthScore<=40){out.weakContextCount++;out.risks.push('同日市场上涨家数比例≤40%');}
 }else if(m&&typeof m==='object'){out.marketStatus='stale-or-invalid';}
 const sectorValid=validObserved(sector,{asOf:now,date})&&
   scoreOk(sector.relativeStrengthScore)&&typeof sector.name==='string'&&sector.name.trim().length>0&&sector.name.length<=80;
 if(sectorValid){
  out.sectorStatus='observed-unverified';out.sector=safeName(sector.name);
  out.sectorStrength=sector.relativeStrengthScore;
  if(sector.relativeStrengthScore>=70){out.positiveContextCount++;out.support.push('所属板块相对强度≥70');}
  else if(sector.relativeStrengthScore<=30){out.weakContextCount++;out.risks.push('所属板块相对强度≤30');}
 }else if(sector&&typeof sector==='object'){out.sectorStatus='stale-or-invalid';}
 const issuerRisks=(issuerEvidence?.riskClues?.length||0)+(issuerEvidence?.conflicts?.length||0);
 if(issuerRisks){out.risks.push('存在未核实的上市公司公告风险线索');}
 if(out.technicalRiskCount)out.risks.push('存在看跌K线形态');
 const bullish=out.technicalHitCount>0;
 out.riskConflict=bullish&&out.risks.length>0;
 out.multipleDomainSupport=bullish&&out.positiveContextCount===2;
 out.sourceStatus='研究样本独立输入，非经认证实时行情';
 out.sectorSource=sectorValid?sector.source:null;
 out.marketSource=marketValid?m.source:null;
 return out;
}
function buildLinkagePools(items=[]){
 const pools={'市场板块同向观察池':[],'多维风险核对池':[]};
 for(const item of items){
  const l=item?.linkageResearch;
  if(!l||!item?.quality?.usable||!item?.quality?.fresh)continue;
  const row={symbol:item.symbol,name:item.name,technicalHits:l.technicalHitCount,
   contextSupport:l.positiveContextCount,risks:l.risks.slice(),
   marketStatus:l.marketStatus,sectorStatus:l.sectorStatus,note:'研究观察，不构成交易指令'};
  if(l.multipleDomainSupport&&!item.blockedBySafety&&!item.quality.simulated)
   pools['市场板块同向观察池'].push(row);
  if(l.riskConflict)pools['多维风险核对池'].push(row);
 }
 for(const rows of Object.values(pools))rows.sort((a,b)=>b.contextSupport-a.contextSupport||a.symbol.localeCompare(b.symbol));
 return pools;
}
module.exports={evaluateLinkage,buildLinkagePools,validObserved};
