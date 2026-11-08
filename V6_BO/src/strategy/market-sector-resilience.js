'use strict';
// Read-only market→sector relative resilience. All input is user-supplied,
// same-day and timestamp-limited. No fallback guesses, score changes or orders.
const CORE=Object.freeze(['shanghai','shenzhen','chinext']);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const chinaDay=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
const dateOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
  Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
  new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
const fixed=x=>Number(x.toFixed(3));
function valid(e,{date,asOf,maxAgeMs,provider}){
 return !!(e&&typeof e==='object'&&!Array.isArray(e)&&
   dateOK(e.tradeDate)&&e.tradeDate===date&&
   typeof e.source==='string'&&e.source.trim()&&e.source.length<=120&&
   (provider===undefined||e.source===provider)&&
   e.simulated!==true&&e.mode!=='simulation'&&
   finite(e.observedAt)&&e.observedAt>0&&e.observedAt<=asOf&&
   asOf-e.observedAt<=maxAgeMs&&chinaDay(e.observedAt)===date);
}
function evaluateMarketSectorResilience({
  market,sector,tradeDate,asOf=Date.now(),maxAgeMs=1200000
}={}){
 const result={mode:'research-only',status:'unverified',marketRegime:'unknown',
   sectorRegime:'unknown',asOf,tradeDate:dateOK(tradeDate)?tradeDate:null,
   marketIndexChanges:{},sectorChangePct:null,relativeToCorePct:null,
   upBreadthPct:null,marketSource:null,sectorSource:null,
   risks:[],support:[],scoreBonus:0,weightsChanged:false,canTrade:false,
   verifiedLive:false,adjustLearningWeights:false,
   note:'境内主要指数与板块涨跌幅独立研究联动；相对表现不证明资金流向或上涨因果'};
 const no=(reason)=>({...result,reason});
 if(!dateOK(tradeDate)||!finite(asOf)||asOf<=0||
   !Number.isSafeInteger(maxAgeMs)||maxAgeMs<1||maxAgeMs>86400000||
   chinaDay(asOf)!==tradeDate)return no('clock-or-date-invalid');
 if(!valid(market,{date:tradeDate,asOf,maxAgeMs})||
    !finite(market.breadthScore)||market.breadthScore<0||market.breadthScore>100||
    !finite(market.coverage)||market.coverage<.8||market.coverage>1)
   return no('market-breadth-or-source-invalid');
 const indices=market.indices;
 if(!indices||typeof indices!=='object'||Array.isArray(indices))return no('indices-missing');
 const observed={};
 for(const id of [...CORE,'a50']){
   const row=indices[id];
   if(row===undefined)continue;
   if(!valid(row,{date:tradeDate,asOf,maxAgeMs,provider:market.source})||
      !finite(row.changePct)||row.changePct< -100||row.changePct>100)
      return no('invalid-index-'+id);
   observed[id]=row.changePct;
 }
 const core=CORE.map(id=>observed[id]).filter(finite);
 if(core.length<2)return no('core-index-evidence-insufficient');
 const mean=core.reduce((a,b)=>a+b,0)/core.length;
 const falling=core.filter(v=>v<=-2).length;
 const severe=core.filter(v=>v<=-3).length;
 const rising=core.filter(v=>v>=1).length;
 const upPct=market.breadthScore;
 const regime=severe>=2&&upPct<=25?'systemic-selloff-observed':
   falling>=2&&upPct<=35?'broad-selloff-observed':
   rising>=2&&upPct>=60?'broad-advance-observed':'mixed-observed';
 const base={...result,status:'market-observed-sector-unverified',
   marketRegime:regime,upBreadthPct:upPct,
   marketIndexChanges:observed,marketSource:market.source,
   coreBenchmarkChangePct:fixed(mean),fallingIndexCount:falling,severeIndexCount:severe};
 if(!valid(sector,{date:tradeDate,asOf,maxAgeMs})||
   !finite(sector.changePct)||sector.changePct< -100||sector.changePct>100||
   typeof sector.name!=='string'||!sector.name.trim()||sector.name.length>80)
   return {...base,reason:'sector-change-or-source-invalid'};
 const relative=sector.changePct-mean,sectorChange=sector.changePct;
 const selloff=regime==='systemic-selloff-observed'||regime==='broad-selloff-observed';
 const countertrend=selloff&&sectorChange>0&&relative>=2;
 const resilient=selloff&&sectorChange<=0&&relative>=2;
 const weak=sectorChange<=mean-2;
 const label=countertrend?'countertrend-observed':
   resilient?'relative-resilience-observed':
   weak?'sector-underperforming-observed':'sector-mixed-observed';
 const support=[];
 const risks=[];
 if(countertrend)support.push('大盘显著下跌而板块上涨，研究观察其逆势强度');
 if(resilient)support.push('大盘显著下跌且板块相对抗跌，但板块本身仍可能亏损');
 if(weak)risks.push('板块弱于同期核心指数均值至少2个百分点');
 if(selloff)risks.push('市场处于系统性或广泛下跌观察阶段，不能直接据此判定因子失效');
 return {...base,status:'market-sector-observed-unverified',
   sectorRegime:label,sectorName:sector.name,sectorChangePct:sectorChange,
   relativeToCorePct:fixed(relative),sectorSource:sector.source,
   risks,support,reason:'research-thresholds-not-validated',
   thresholds:{fallingIndexPct:-2,severeIndexPct:-3,minDeclines:2,
     weakBreadthPct:35,severeBreadthPct:25,sectorOutperformancePct:2}};
}
module.exports={evaluateMarketSectorResilience};
