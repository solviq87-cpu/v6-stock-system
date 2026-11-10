'use strict';
/**
 * Intraday SECTOR breadth research using a common, dated stock quote snapshot.
 * Board % change is never treated as proof that its constituent stocks rose.
 * Provider-reported timestamps are necessary but NOT exchange certification.
 */
const {aShareCalendarDate}=require('./a-share-calendar');
const CODE=/^\d{6}$/;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const dateOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const round=x=>Number(x.toFixed(2));
const clip=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
function median(values){
 const a=[...values].sort((x,y)=>x-y),m=a.length>>1;
 return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function empty(reason,extra={}){
 return {schemaVersion:1,status:'insufficient-evidence',reason,
  verifiedLive:false,canTrade:false,rankingModified:false,weightsChanged:false,
  scope:'intraday-research-only',sectors:{industry:[],concept:[]},...extra};
}
function observedAtOK(at,date,asOf,maxAgeMs){
 return Number.isSafeInteger(at)&&at>0&&at<=asOf&&asOf-at<=maxAgeMs&&aShareCalendarDate(at)===date;
}
function evaluateSectorBreadthStrength({snapshot,sectorObservations,asOf=Date.now(),maxAgeMs=300000,minCoverage=.8}={}){
 const validOptions=Number.isSafeInteger(asOf)&&asOf>0&&Number.isSafeInteger(maxAgeMs)&&
  maxAgeMs>=1000&&maxAgeMs<=1200000&&finite(minCoverage)&&minCoverage>=.5&&minCoverage<=1;
 if(!validOptions)return empty('invalid-analysis-options');
 const date=snapshot?.date;
 if(!dateOK(date)||date!==sectorObservations?.tradeDate||aShareCalendarDate(asOf)!==date||
   typeof snapshot?.source!=='string'||!snapshot.source.trim()||
   typeof sectorObservations?.source!=='string'||!sectorObservations.source.trim()||
   !observedAtOK(sectorObservations?.observedAt,date,asOf,maxAgeMs)||
   !Number.isInteger(snapshot?.universeSize)||snapshot.universeSize<1||
   !Array.isArray(snapshot?.stocks)||!Array.isArray(sectorObservations?.sectors)||
   sectorObservations.sectors.length>500)
  return empty('source-date-or-observation-invalid');
 const byCode=new Map();
 for(const stock of snapshot.stocks){
  const code=String(stock?.code??'');
  if(!CODE.test(code)||byCode.has(code))return empty('invalid-or-duplicate-stock-code');
  byCode.set(code,stock);
 }
 if(byCode.size>snapshot.universeSize)return empty('snapshot-exceeds-universe-size');
 const recent=new Map();
 for(const [code,stock] of byCode){
  if(stock?.suspended===true||!finite(stock?.pctChange)||stock.pctChange < -100||stock.pctChange>100||
    !observedAtOK(stock.vendorQuoteAt,date,asOf,maxAgeMs))continue;
  recent.set(code,stock.pctChange);
 }
 const marketCoverage=recent.size/snapshot.universeSize;
 if(marketCoverage<minCoverage||recent.size<5)
  return empty('market-fresh-coverage-insufficient',{marketCoverage:round(marketCoverage*100),marketObserved:recent.size});
 const marketMedian=median([...recent.values()]);
 const out={industry:[],concept:[]},excluded=[];
 const ids=new Set();
 for(const board of sectorObservations.sectors){
  const kind=board?.kind,code=String(board?.code??''),name=board?.name;
  const id=kind+':'+code;
  if(!['industry','concept'].includes(kind)||typeof code!=='string'||!/^BK\d{3,8}$/.test(code)||
    typeof name!=='string'||!name.trim()||name.length>80||ids.has(id)){
   excluded.push({code,reason:'invalid-or-duplicate-board-identity'});continue;
  }
  ids.add(id);
  if(board.source!==sectorObservations.source||board.tradeDate!==date||
    !observedAtOK(board.observedAt,date,asOf,maxAgeMs)||
    !finite(board.changePct)||board.changePct< -100||board.changePct>100||
    !Number.isInteger(board.totalMembers)||board.totalMembers<5||board.totalMembers>6000||
    !Array.isArray(board.memberCodes)||board.memberCodes.length>board.totalMembers||
    board.memberCodes.length>6000){
   excluded.push({code,reason:'board-quote-or-membership-invalid'});continue;
  }
  const members=new Set();let invalid=false;
  for(const raw of board.memberCodes){
   const symbol=String(raw);
   if(!CODE.test(symbol)||members.has(symbol)){invalid=true;break;}
   members.add(symbol);
  }
  if(invalid){excluded.push({code,reason:'invalid-or-duplicate-board-members'});continue;}
  const quotes=[...members].filter(x=>recent.has(x)).map(x=>({code:x,pctChange:recent.get(x)}));
  const coverage=quotes.length/board.totalMembers;
  if(quotes.length<5||coverage<minCoverage){
   excluded.push({code,reason:'board-fresh-coverage-insufficient',coveragePct:round(coverage*100)});continue;
  }
  const changes=quotes.map(x=>x.pctChange),up=changes.filter(x=>x>0).length,
   down=changes.filter(x=>x<0).length,flat=changes.length-up-down,
   med=median(changes),strong=changes.filter(x=>x>=2).length;
  const positive=changes.filter(x=>x>0).sort((a,b)=>b-a);
  const sum=positive.reduce((a,b)=>a+b,0);
  const concentration=sum>0?positive.slice(0,3).reduce((a,b)=>a+b,0)/sum:null;
  const breadth=100*up/quotes.length,relative=med-marketMedian;
  const penalty=quotes.length>=8&&concentration!==null?8*clip((concentration-.5)/.5,0,1):0;
  const score=round(clip(.35*breadth+.30*clip(50+15*relative,0,100)+
   .20*clip(50+10*med,0,100)+.15*(100*strong/quotes.length)-penalty,0,100));
  const narrow=board.changePct>0&&(breadth<50||med<=0);
  const label=narrow?'narrow-led':
   board.changePct>0&&breadth>=60&&med>0&&relative>0&&score>=70?'broad-leading':
   board.changePct>0&&breadth>=50&&med>0&&score>=60?'watch':'mixed';
  const leaders=quotes.sort((a,b)=>b.pctChange-a.pctChange||a.code.localeCompare(b.code)).slice(0,3);
  out[kind].push({code,name,kind,changePct:board.changePct,score,label,
   up,down,flat,strongUp:strong,observed:changes.length,totalMembers:board.totalMembers,
   coveragePct:round(coverage*100),upPct:round(breadth),medianPct:round(med),
   excessMedianPct:round(relative),topThreePositiveSharePct:concentration===null?null:round(concentration*100),
   leaders,reason:narrow?'板块上涨但成分股中位数或上涨比例不足，疑似少数股票驱动':
    label==='broad-leading'?'板块上涨、上涨家数过半且个股中位涨幅跑赢全市场':
    '尚不足以认定板块普遍强势'});
 }
 for(const list of Object.values(out))list.sort((a,b)=>b.score-a.score||b.changePct-a.changePct||a.code.localeCompare(b.code));
 const validCount=out.industry.length+out.concept.length;
 return {schemaVersion:1,status:validCount>=2?'observed-unverified':'insufficient-comparison',
  tradeDate:date,asOf,stockSource:snapshot.source,sectorSource:sectorObservations.source,
  marketMedianPct:round(marketMedian),marketCoveragePct:round(marketCoverage*100),
  marketObserved:recent.size,validSectors:validCount,excludedSectors:excluded,
  sectors:out,verifiedLive:false,canTrade:false,rankingModified:false,weightsChanged:false,
  scope:'intraday-research-only',
  note:'只按本批已知成员比较行业或概念，概念股可能重叠。供应商原始时间不等于交易所认证；不推断涨停或资金净流入；分数和阈值尚未经样本外验证。'};
}
module.exports={evaluateSectorBreadthStrength};
