'use strict';
// Optional original frozen-cohort evidence, never a new quote collector.
// Relative size within the supplied cohort is not an all-market style index.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const stamp=x=>Number.isSafeInteger(x)&&x>0&&x<8e15;
const label=x=>typeof x==='string'&&x.trim()===x&&x.length>0&&x.length<=200;
const code=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const day=t=>new Date(t+28800000).toISOString().slice(0,10);
const mean=xs=>xs.length?xs.reduce((s,x)=>s+x/xs.length,0):null;
const round=x=>finite(x)?Number(x.toFixed(6)):null;
const flags={researchOnly:true,canTrade:false,canTrain:false,autoPromotion:false,independentEconomicValueVerified:false};
function normalizeSizeEvidence(e,{symbol,tradeDate,signalAt,provider,datasetId}={}){
 if(!e||typeof e!=='object'||Array.isArray(e)||!code(symbol)||e.symbol!==symbol||e.tradeDate!==tradeDate||
  e.source!==provider||e.datasetId!==datasetId||!label(provider)||!label(datasetId)||!label(e.evidenceId)||
  e.basis!=='total-market-cap'||e.unit!=='CNY'||!finite(e.valueYuan)||e.valueYuan<=0||e.valueYuan>1e17||
  !stamp(signalAt)||!stamp(e.observedAt)||!stamp(e.knownAt)||e.observedAt>e.knownAt||e.knownAt>signalAt||
  day(signalAt)!==tradeDate||day(e.observedAt)!==tradeDate||
  ['synthetic','simulated','fixture','retracted','sourceConflict'].some(k=>e[k]===true))return null;
 return {symbol,tradeDate,source:provider,datasetId,evidenceId:e.evidenceId,basis:e.basis,unit:e.unit,
  valueYuan:e.valueYuan,observedAt:e.observedAt,knownAt:e.knownAt};
}
function buildSizePartition(rows,{provider,datasetId,signalDay}={}){
 const out={status:'unknown',reason:'INCOMPLETE_ORIGINAL_SIZE_COHORT',expected:Array.isArray(rows)?rows.length:null,
  observed:0,groups:[],signalDay:signalDay??null,source:provider??null,datasetId:datasetId??null,...flags};
 if(!Array.isArray(rows)||rows.length<6||rows.length>500||rows.some(x=>!code(x?.symbol)))return out;
 // Repeated original signals for one security must not increase its weight.
 const bySymbol=new Map(),invalid=new Set();
 for(const row of rows){
  const v=normalizeSizeEvidence(row.sizeEvidence,{symbol:row.symbol,tradeDate:signalDay,signalAt:row.signalAt,provider,datasetId});
  if(!v){invalid.add(row.symbol);continue;}
  const before=bySymbol.get(row.symbol);
  if(before&&JSON.stringify(before)!==JSON.stringify(v))invalid.add(row.symbol);
  else if(!before)bySymbol.set(row.symbol,v);
 }
 const expected=new Set(rows.map(r=>r.symbol)).size,observed=[...bySymbol.keys()].filter(s=>!invalid.has(s)).length;
 Object.assign(out,{expected,observed,originalSignalCount:rows.length,duplicateSignalCount:rows.length-expected});
 if(expected<6||observed!==expected)return out;
 const sorted=[...bySymbol.values()].sort((a,b)=>a.valueYuan-b.valueYuan||a.symbol.localeCompare(b.symbol)),mid=Math.floor(sorted.length/2);
 if(sorted[mid-1].valueYuan===sorted[mid].valueYuan)return {...out,observed,reason:'SIZE_BOUNDARY_TIE'};
 return {...out,status:'declared-point-in-time-partition',reason:null,observed,
  groups:[{id:'relatively-smaller',members:sorted.slice(0,mid)},{id:'relatively-larger',members:sorted.slice(mid)}],
  note:'固定按完整原冻结候选截面排序二分；缺值和边界并列不猜；成熟结果不参与分组。'};
}
function compareSizeVersions(days,ids,versions,score){
 const out={status:'unknown',reason:'NO_COMPARABLE_FROZEN_SIZE_WINDOWS',expectedDays:Array.isArray(days)?Math.min(days.length,20):0,pairedDays:0,rows:[],...flags};
 if(!Array.isArray(days)||days.length>400||!Array.isArray(ids)||typeof score!=='function')return out;
 const names=['original','accepted','proposed'];
 for(const name of names)if(!versions?.[name]||ids.some(id=>!finite(versions[name][id])||versions[name][id]<=0))return out;
 for(const d of days.slice(-20)){
  const p=d?.sizePartition,observed=d?.rows;
  if(p?.status!=='declared-point-in-time-partition'||!Array.isArray(observed)||
     observed.some(r=>!code(r?.symbol)||!finite(r.returnPct))||new Set(observed.map(r=>r.symbol)).size!==observed.length)continue;
  // The two fixed groups must form one disjoint original cohort. A
  // duplicate member can otherwise hide an omitted member in the summed
  // matched denominators; it would contaminate both group IC and spread.
  if(p.signalDay!==d.day||!Array.isArray(p.groups)||p.groups.length!==2||
     p.groups[0]?.id!=='relatively-smaller'||p.groups[1]?.id!=='relatively-larger'||
     p.groups.some(g=>!Array.isArray(g.members)||!g.members.length||g.members.some(m=>!code(m?.symbol))))continue;
  const members=p.groups.flatMap(g=>g.members.map(m=>m.symbol));
  if(members.length<6||new Set(members).size!==members.length||p.expected!==members.length||p.observed!==members.length||
     p.groups[0].members.length!==Math.floor(members.length/2))continue;
  const groups=p.groups.map(g=>{const members=new Set(g.members.map(m=>m.symbol)),matched=observed.filter(r=>members.has(r.symbol));
   return {id:g.id,expected:members.size,observed:matched.length,meanGrossPriceReturnPct:round(mean(matched.map(r=>r.returnPct))),matched};});
  if(groups.length!==2||groups.reduce((n,g)=>n+g.observed,0)!==observed.length||groups.some(g=>g.observed<5||g.observed!==g.expected))continue;
  const results={};
  for(const name of names){
   const w=versions[name],overall=score([{...d,rows:observed}],ids,w),perGroup=groups.map(g=>score([{...d,rows:g.matched}],ids,w));
   const valid=x=>x?.days===1&&finite(x.meanIC)&&Math.abs(x.meanIC)<=1;
   if(!valid(overall)||!perGroup.every(valid))break;
   results[name]={matchedIC:round(overall.meanIC),equalGroupIC:round(mean(perGroup.map(x=>x.meanIC))),groupIC:perGroup.map(x=>round(x.meanIC))};
  }
  if(Object.keys(results).length!==3)continue;
  out.rows.push({day:d.day,targetDate:d.targetDate,groups:groups.map(({matched,...g})=>g),
   smallerMinusLargerGrossPct:round(groups[0].meanGrossPriceReturnPct-groups[1].meanGrossPriceReturnPct),versions:results,netReturnCertified:false});
 }
 return {...out,status:out.rows.length?'paired-size-research':'unknown',reason:out.rows.length?null:out.reason,
  pairedDays:out.rows.length,independentHoldoutCertified:false,
  note:'复用F12原三版本同一成熟H5窗口和IC评分器；分组在结果前固定；组间毛价格差不是净收益或因果归因。'};
}
// Prior size is a historical reference, never a current classification.
// Only an explicit, already known, nonconflicting original calendar edge
// permits the adjacent prior trading session; never subtract weekdays.
function sizeReferenceDays(calendar,asOf){
 if(!stamp(asOf))return [];
 const current=day(asOf),out=[current];
 if(!Array.isArray(calendar?.days)||calendar.days.length>10000)return out;
 const dates=calendar.days;
 if(dates.some((d,i)=>typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||
  !Number.isFinite(Date.parse(d+'T00:00:00Z'))||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d||i&&dates[i-1]>=d))return out;
 const index=dates.indexOf(current),prior=index>0?dates[index-1]:null;
 const edge=prior&&calendar.nextEvidenceByDay?.[prior];
 if(prior&&edge?.nextTradingDay===current&&label(edge.source)&&stamp(edge.knownAt)&&edge.knownAt<=asOf&&
  Array.isArray(calendar.conflictingDays)&&!calendar.conflictingDays.includes(prior)&&!calendar.conflictingDays.includes(current))out.push(prior);
 return out;
}
module.exports={normalizeSizeEvidence,buildSizePartition,compareSizeVersions,sizeReferenceDays};
