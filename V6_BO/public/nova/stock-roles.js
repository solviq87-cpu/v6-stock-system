import {h} from './ui.js';

const labels={leader:'龙头',coLead:'并列龙头',deputy:'龙二',mid:'中军',follow:'跟风',pioneer:'首板先锋'};
const level=r=>r.level??r.limitUpCount??r.lb;
const positive=n=>Number.isFinite(n)&&n>0;
const seal=t=>{
 if(typeof t!=='string')return null;
 const digits=t.replaceAll(':','');
 return /^(?:09|1[0-5])[0-5]\d[0-5]\d$/.test(digits)?digits.replace(/(..)(..)(..)/,'$1:$2:$3'):null;
};
const role=(key,evidence)=>({key,label:labels[key],evidence});
export const recordedRole=(row,group)=>Object.hasOwn(labels,row?.role)?role(row.role,group+' · 同日板块分类记录'):null;
export function groupRoles(rows,group,total=rows.length){
 const result=new Map(),scope=group+'同日涨停组 '+rows.length+' 只';
 const seen=new Set(rows.map(r=>r.code));
 for(const r of rows)if(r.code&&recordedRole(r,group))result.set(r.code,recordedRole(r,group));
 if(rows.length<2||total!==rows.length||seen.size!==rows.length||rows.some(r=>!/^\d{6}$/.test(r.code)))return result;
 // The dated supplier classification may include non-limit sector members.
 if(result.size)return result;
 const heights=rows.map(level),max=Math.max(...heights);
 if(heights.every(x=>Number.isInteger(x)&&x>=1)){
  const top=rows.filter(r=>level(r)===max),lower=rows.filter(r=>level(r)<max);
  if(max>=2){
   for(const r of top)result.set(r.code,role(top.length===1?'leader':'coLead',scope+'；'+max+'连板，'+(top.length===1?'组内唯一最高':'组内并列最高')));
   const second=Math.max(...lower.map(level)),secondRows=lower.filter(r=>level(r)===second);
   if(second>=2&&secondRows.length===1)result.set(secondRows[0].code,role('deputy',scope+'；'+second+'连板，组内板次第二'));
   const topTimes=top.map(r=>seal(r.firstSeal));
   if(topTimes.every(Boolean)){
    const first=topTimes.sort()[0];
    for(const r of lower)if(!result.has(r.code)&&seal(r.firstSeal)>first){
     result.set(r.code,role('follow',scope+'；'+level(r)+'板低于最高'+max+'板，'+seal(r.firstSeal)+'封板晚于前排'+first));
    }
   }
  }
  if(max===1&&rows.every(r=>seal(r.firstSeal))){
   const times=rows.map(r=>seal(r.firstSeal)).sort(),front=rows.filter(r=>seal(r.firstSeal)===times[0]);
   if(front.length===1&&!result.has(front[0].code))result.set(front[0].code,role('pioneer',scope+'；同为首板，'+times[0]+'率先封板'));
  }
 }
 if(rows.every(r=>positive(r.amount)&&positive(r.floatCap))){
  const amount=Math.max(...rows.map(r=>r.amount)),cap=Math.max(...rows.map(r=>r.floatCap));
  const mid=rows.filter(r=>r.amount===amount&&r.floatCap===cap);
  if(mid.length===1&&rows.filter(r=>r.amount===amount).length===1&&rows.filter(r=>r.floatCap===cap).length===1){
   const r=mid[0],why=scope+'；成交额 '+(amount/1e8).toFixed(2)+' 亿、流通市值 '+(cap/1e8).toFixed(2)+' 亿，均居首位';
   const old=result.get(r.code);
   if(old&&['leader','coLead','deputy','pioneer'].includes(old.key))result.set(r.code,{...old,also:role('mid',why)});
   else result.set(r.code,role('mid',why));
  }
 }
 return result;
}
const compactDay=s=>typeof s==='string'?s.replace(/^(\d{4})(\d\d)(\d\d)$/,'$1-$2-$3'):'';
const cache=new WeakMap();
export function sectorRoles(state,day,sector){
 if(!state||!day)return new Map();
 const existing=cache.get(state);if(existing?.day===day)return sector?existing.groups.get(sector)||new Map():existing.roles;
 const watch=state.marketRecovery?.closeWatch,rows=watch?.day===day&&watch.complete?watch.items:[];
 const dataByCode=new Map((rows||[]).map(r=>[r.code,r]));
 let groups=compactDay(state.snapshotFieldDays?.ztBySector||state.ztDay)===day?state.ztBySector:null;
 if(!groups?.length){
  const sectors=new Map();
  for(const r of rows||[])if(r.sector){if(!sectors.has(r.sector))sectors.set(r.sector,[]);sectors.get(r.sector).push(r);}
  groups=[...sectors].map(([sector,stocks])=>({sector,stocks,count:stocks.length}));
 }
 const roles=new Map(),byGroup=new Map();
 for(const group of groups||[]){
  const members=(group.stocks||[]).map(r=>({...dataByCode.get(r.code),...r}));
  const groupMap=groupRoles(members,group.sector,group.count??members.length);
  byGroup.set(group.sector,groupMap);
  for(const [code,info] of groupMap)if(!roles.has(code))roles.set(code,info);
 }
 cache.set(state,{day,roles,groups:byGroup});return sector?byGroup.get(sector)||new Map():roles;
}
export function roleBadge(info){
 if(!info)return null;
 const badge=r=>h('span',{class:'fy-role-badge','data-role':r.key,title:r.evidence,'aria-label':r.label+'，'+r.evidence},r.label);
 return info.also?h('span',{class:'fy-role-pair'},badge(info),badge(info.also)):badge(info);
}
export function observedBadge(row,fact){
 if(Number.isFinite(row.score))return {value:String(Math.round(row.score*10)/10),caption:'评分'};
 if(Number.isFinite(row.prob)){
  const kind=row.probKind;
  const caption=kind==='score'||kind==='ranking-score'?'规则评分':kind==='historical-event-frequency'?'历史事件频率':
   kind==='model-estimate'?'模型估计（未校准）':'研究值（类型待核验）';
  return {value:String(Math.round(row.prob*10)/10),caption};
 }
 if(fact?.status==='炸板'||fact?.status==='未晋级'||fact?.status==='停牌')return {value:fact.status,caption:fact.tier};
 const boards=level(row);
 if(Number.isInteger(boards)&&boards>0)return {value:boards===1?'首板':boards+'连板',caption:fact?.performance||'收盘记录'};
 if(fact?.status)return {value:fact.performance||fact.status,caption:fact.tier};
 if(typeof row.result==='string'&&row.result.trim()&&!/[待未]评估|待核验|未知|待判定/.test(row.result))return {value:row.result,caption:'原状态'};
 return null;
}
