import * as shared from './structure-core.js';
import {asTime} from './structure-events.mjs';
import {isTestSample} from './sample-quality.mjs';
const {groupPool,canonicalTheme}=shared.default||globalThis.V6ShortlineStructure;
const stockCode=v=>typeof v==='string'&&/^\d{6}$/.test(v);
const dayOk=d=>typeof d==='string'&&/^\d{4}-\d\d-\d\d$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d&&![0,6].includes(new Date(d).getUTCDay());
const pos=v=>Number.isFinite(v)&&v>0;
const pct=(a,b)=>100*(a/b-1);
const rounded=n=>Number(n.toFixed(4));
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const closeAt=d=>asTime(d+' 15:00'),openAt=d=>asTime(d+' 09:30');
const wall=ms=>new Date(ms+8*36e5).toISOString().slice(0,16).replace('T',' ');
const bounded=(values,max)=>Array.isArray(values)?values.slice(-max):[];
const sourceName=x=>typeof x==='string'&&x.trim()&&x.length<=200;

function recorded(row,earliest,cutoff){
 const time=asTime(row?.knownAt);
 return Number.isSafeInteger(time)&&time>=earliest&&time<=cutoff&&(!row.availableAt||asTime(row.availableAt)<=time);
}
function marketDays(state,day,cutoff,demo){
 const days=new Map(), market=Array.isArray(state.market)?state.market:[];
 // Canonical market rows are sorted by date by the store; revisions are appended separately.
 let lo=0,hi=market.length;
 while(lo<hi){
  const mid=Math.floor((lo+hi)/2);
  if((market[mid]?.date||'')<=day)lo=mid+1;else hi=mid;
 }
 for(const m of [...bounded(state.marketHistory,80),...market.slice(Math.max(0,lo-80),lo)]){
  if(!dayOk(m?.date)||m.date>day||isTestSample(m)!==demo||!recorded(m,closeAt(m.date),cutoff))continue;
  const old=days.get(m.date);if(!old||asTime(old.knownAt)<=asTime(m.knownAt))days.set(m.date,m);
 }
 return days;
}
// The pool and its complete, pre-open membership are frozen separately from today's returns.
function returnSide(frame,members){
 const outcomes=members.map(m=>frame.outcomes?.[m.code]);
 if(outcomes.some(o=>!o||!Number.isFinite(o.change)||o.change< -100||!sourceName(o.source)||
    !recorded(o,closeAt(frame.date),frame.knownAt)))return null;
 if(new Set(outcomes.map(o=>o.source)).size!==1)return null;
 return {values:outcomes.map(o=>o.change),source:outcomes[0].source,knownAt:Math.max(...outcomes.map(o=>asTime(o.knownAt)))};
}
function poolFactors(observation,days,at,demo,add){
 const {day,code}=observation,m=days.get(day),prev=days.get(m?.previousDay);
 if(!prev||!dayOk(m.previousDay)||m.previousDay>=day)return;
 function frames(row,latest){
  return bounded(row.structurePools,8).filter(f=>f?.date===row.date&&f.complete===true&&sourceName(f.source)&&sourceName(f.provider)&&sourceName(f.scope)&&
   isTestSample(f)===demo&&recorded(f,closeAt(row.date),latest)&&Array.isArray(f.sealed)&&f.sealed.length>=1&&f.sealed.length<=512&&
   f.totalCount===f.sealed.length&&f.sealed.every(s=>stockCode(s?.code)&&Number.isSafeInteger(s.level)&&s.level>=1&&s.level<=100)&&
   new Set(f.sealed.map(s=>s.code)).size===f.sealed.length);
 }
 const old=frames(prev,Math.min(at,openAt(day))),today=frames(m,at);
 let tl=false,qx=false;
 for(const f of today){
  if(f.previousDay!==prev.date)continue;
  const prior=old.filter(p=>p.provider===f.provider&&p.scope===f.scope);
  if(prior.length!==1)continue;
  const p=prior[0],base={scope:f.scope,cohortDate:p.date,cohortKnownAt:p.knownAt};
  if(!tl){
   const groups=groupPool(p).filter(g=>g.kind==='theme'&&g.complete&&g.leader&&g.members.length>=2&&g.members.some(x=>x.code===code));
   const target=canonicalTheme(observation.stock?.theme||'');
   const g=groups.find(r=>r.name===target)||(groups.length===1?groups[0]:null);
   if(g){
    const side=returnSide(f,g.members);if(side){
     const leaderIndex=g.members.findIndex(v=>v.code===g.leader.code),others=side.values.filter((_,i)=>i!==leaderIndex),gap=side.values[leaderIndex]-mean(others);
     add('TL-01',gap,'百分点',Math.max(side.knownAt,p.knownAt,f.knownAt,m.knownAt,prev.knownAt),p.source+' / '+side.source,
      g.name+'前日已核龙头 '+g.leader.code+' 当日收盘涨跌幅减同队列其他 '+others.length+' 只的等权均幅',
      {...base,theme:g.name,leaderCode:g.leader.code,observed:g.members.length,total:g.members.length});tl=true;
    }
   }
  }
  if(!qx){
   const height=Math.max(...p.sealed.map(s=>s.level)),leaders=p.sealed.filter(s=>s.level===height);
   const side=height>=2&&returnSide(f,leaders);
   if(side&&mean(side.values)<0){
    add('QX-01',mean(side.values),'%',Math.max(side.knownAt,p.knownAt,f.knownAt,m.knownAt,prev.knownAt),p.source+' / '+side.source,
     '前日 '+height+' 板最高队列当日收盘等权均幅，'+side.values.filter(v=>v<0).length+'/'+leaders.length+' 只下跌；仅为该队列反馈',
     {...base,height,observed:leaders.length,total:leaders.length,cohortCodes:leaders.map(x=>x.code)});qx=true;
   }
  }
  if(tl&&qx)break;
 }
}
const methods=new Set(['上一交易日冻结成分的当日收盘涨幅等权平均','同源昨日池全部成员有收盘价并与上日逐股名单完全对应']);
function cohortMetric(row,key,at){
 const e=row?.fieldSources?.[key];
 if(!row||!dayOk(row.previousDay)||row.previousDay>=row.date||!Number.isFinite(row[key])||row[key]< -100||!e||!methods.has(e.method)||
     e.previousDay!==row.previousDay||!Number.isSafeInteger(e.n)||e.n<=0||!Array.isArray(e.sources)||!e.sources.length)return null;
 const cohort=e.sources.find(s=>s?.tradeDate===row.previousDay&&sourceName(s.source)&&sourceName(s.scope)&&
  Number.isSafeInteger(s.receivedAt)&&s.receivedAt>=closeAt(row.previousDay)&&s.receivedAt<=Math.min(at,openAt(row.date)));
 const outcome=e.sources.find(s=>s?.tradeDate===row.date&&sourceName(s.source)&&sourceName(s.scope)&&Number.isSafeInteger(s.receivedAt)&&s.receivedAt>=closeAt(row.date));
 if(!cohort||!outcome||e.sources.some(s=>!sourceName(s?.source)||!Number.isSafeInteger(s?.receivedAt)||!dayOk(s.tradeDate)||s.tradeDate>row.date||s.receivedAt<closeAt(s.tradeDate)||s.receivedAt>at))return null;
 const knownAt=Math.max(row.knownAt,...e.sources.map(s=>s.receivedAt),e.knownAt??0);
 if(!Number.isSafeInteger(knownAt)||knownAt>at)return null;
 const source=e.source||[...new Set(e.sources.map(s=>s.source))].join(' / ');
 return {value:row[key],knownAt,n:e.n,source,scope:cohort.scope,method:JSON.stringify([cohort.source,cohort.scope,outcome.source,outcome.scope,e.method])};
}
function dailyFactors(state,observation,days,cutoff,demo,add){
 const {code,day}=observation,m=days.get(day),prev=days.get(m?.previousDay);
 const curPremium=cohortMetric(m,'premium',cutoff),oldPremium=cohortMetric(prev,'premium',cutoff);
 const leader=cohortMetric(m,'leader',cutoff),proof=m?.fieldSources?.leader;
 if(leader&&leader.value<0&&Number.isInteger(proof.height)&&proof.height>=2&&Array.isArray(proof.codes)&&proof.codes.length===leader.n&&
    proof.codes.every(stockCode)&&new Set(proof.codes).size===leader.n)
  add('QX-01',leader.value,'%',leader.knownAt,leader.source,'按原交易日名单复核，前日 '+proof.height+' 板高标队列当日收盘等权均幅；只描述该队列反馈',
   {scope:leader.scope,cohortDate:m.previousDay,height:proof.height,observed:leader.n,total:leader.n,cohortCodes:proof.codes.slice()});
 if(curPremium&&oldPremium&&curPremium.method===oldPremium.method&&oldPremium.value<0&&curPremium.value>oldPremium.value)
  add('QX-03',curPremium.value-oldPremium.value,'百分点',Math.max(curPremium.knownAt,oldPremium.knownAt),curPremium.source,
   '连续两交易日按各自冻结的昨日涨停池计算等权收盘溢价，从 '+rounded(oldPremium.value)+'% 回升到 '+rounded(curPremium.value)+'%',
   {previousDay:prev.date,scope:curPremium.scope,observed:curPremium.n,previousObserved:oldPremium.n});
 const chain=new Map();let date=day;
 for(let i=0;i<12&&days.has(date);i++){
  chain.set(date,days.get(date));const p=days.get(date).previousDay;if(!dayOk(p)||p>=date)break;date=p;
 }
 if(chain.size<2)return;
 const stages=new Map();
 for(const b of bounded(state.bars,4096)){
  if(b?.period!=='日K'||b.role!=='stock'||b.code!==code||!chain.has(b.date)||!sourceName(b.source)||!sourceName(b.sector)||isTestSample(b)!==demo||
     !recorded(b,closeAt(b.date),cutoff))continue;
  if(stages.has(b.date)){stages.set(b.date,null);continue;}stages.set(b.date,b);
 }
 const today=stages.get(day);
 if(today?.themeCycle!=='发酵')return;
 let count=0,known=0,nextDay='';
 for(const [d,market] of chain){
  const b=stages.get(d);if(!sourceName(market.source)||!b||b.source!==today.source||b.sector!==today.sector||nextDay&&b.knownAt>openAt(nextDay))return;
  known=Math.max(known,b.knownAt,market.knownAt);count++;
  if(b.themeCycle==='启动'&&count>=2){
   add('TL-05',count,'个交易日',known,today.source,today.sector+' 从已标注启动日连续至本日发酵，含启动日；沿归档前交易日链计数',
    {scope:today.sector,startDate:d,observed:count,total:count});return;
  }
  if(b.themeCycle!=='发酵')return;nextDay=d;
 }
}
function capitalFactor(observation,at,demo,add){
 const q=observation.stock?.capitalSnapshot;
 if(!q||isTestSample(q)!==demo||q.code!==observation.code||q.tradeDate!==observation.day||q.unit!=='CNY'||!['eastmoney','tencent'].includes(q.source)||
    !pos(q.amountCny)||!pos(q.floatCapCny)||!Number.isSafeInteger(q.quoteAt)||q.quoteAt<closeAt(q.tradeDate)||
    wall(q.quoteAt).slice(0,10)!==q.tradeDate||!recorded(q,q.quoteAt,at))return;
 add('LX-03',100*q.amountCny/q.floatCapCny,'%',q.knownAt,q.source,'同一收盘报价的当日成交额（元）÷流通市值（元）',
  {scope:'个股收盘行情',amountCny:q.amountCny,floatCapCny:q.floatCapCny,quoteAt:q.quoteAt,observed:1,total:1});
}

function minuteFactors(state,observation,at,demo,add){
 const {day,code}=observation,groups=new Map(),start=openAt(day);
 // Only the first half-hour is compared. A gap, ambiguous revision, or mixed
 // source/interval cannot be patched with a different tape.
 const tape=observation.minuteBars??state.v6Observation?.minuteBars;
 const input=Array.isArray(tape)&&tape.length?bounded(tape,1200):bounded(state.bars,4096);
 for(const b of input){
  if(b?.role!=='stock'||b.code!==code||b.date?.slice(0,10)!==day||isTestSample(b)!==demo||!sourceName(b.source)||
     b.priceBasis!=='unadjusted'||b.volumeUnit!=='shares'||!['1m','5m','1分钟','5分钟'].includes(b.period))continue;
  const step=b.period.startsWith('1')?1:5,minutes=(asTime(b.date)-start)/60000;
  if(!Number.isInteger(minutes)||minutes<step||minutes>30||minutes%step)continue;
  const key=b.source+'/'+step;if(!groups.has(key))groups.set(key,{source:b.source,step,slots:new Map()});
  const slots=groups.get(key).slots;
  if(!recorded(b,start+minutes*60000,at))continue;
  if(slots.has(minutes)||![b.open,b.high,b.low,b.close,b.volume].every(pos)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)){
   slots.set(minutes,null);continue;
  }
  slots.set(minutes,b);
 }
 const usable=[];
 for(const {source,step,slots} of groups.values()){
  const bars=[];
  for(let n=step;n<=30;n+=step){const b=slots.get(n);if(!b)break;bars.push(b);}
  if(bars.length*step>=15)usable.push({source,step,bars});
 }
 usable.sort((a,b)=>a.step-b.step||a.source.localeCompare(b.source));
 const feed=usable[0];if(!feed)return;
 const {source,step,bars}=feed,n=15/step,first=bars.slice(0,n),opening=first[0].open,mid=first.at(-1).close;
 const known=items=>Math.max(...items.map(b=>b.knownAt)),meta={scope:'个股开盘分时',interval:step+'分钟',windowStart:day+' 09:30'};
 if(mid<opening)add('JP-03',100*(1-mid/opening),'%',known(first),source,'首个有成交区间开盘价至 09:45 收盘的回落幅度',
  {...meta,windowEnd:day+' 09:45',opening,ending:mid,observed:n,total:n});
 if(bars.length<2*n)return;
 const second=bars.slice(n),finish=second.at(-1).close;
 const volume=items=>items.reduce((total,b)=>total+b.volume,0),v1=volume(first),v2=volume(second);
 if(mid>opening&&finish>mid&&v2>v1)add('LX-02',v2/v1,'倍',known(bars),source,'09:30–09:45、09:45–10:00 两段收盘价依次上升，后一段成交股数÷前一段成交股数',
  {...meta,windowEnd:day+' 10:00',firstVolumeShares:v1,secondVolumeShares:v2,observed:2*n,total:2*n});
 // In the validated V6 Eastmoney/Sina minute adapter "amount" is CNY and
 // "volume" is shares. Other data needs an explicit currency designation.
 const explicit=b=>b.amountUnit==='CNY'||b.amountCny!=null||['V6/eastmoney','V6/sina'].includes(source);
 const infos=[];let qty=0,turnover=0,found=null;
 for(let i=0;i<bars.length;i++){
  const b=bars[i],amount=b.amountCny??b.amount;
  if(!explicit(b)||!pos(amount)||amount/b.volume<b.low-0.011||amount/b.volume>b.high+0.011)return;
  const before=qty>0?turnover/qty:null;
  turnover+=amount;qty+=b.volume;const vwap=turnover/qty;
  const prior=infos.at(-1);
  if(i*step>=15&&prior?.before!=null&&prior.bar.low<=prior.before&&prior.bar.high>=prior.before&&
     b.low>=prior.bar.low&&b.close>prior.bar.close&&b.close>=vwap){
   found={bar:b,retest:prior.bar,before:prior.before,after:vwap,index:i};
  }
  infos.push({bar:b,before});
 }
 if(found)add('LX-01',pct(found.bar.close,found.after),'%',known(bars),source,
  '前一时段触及此前累计成交均价，后一时段低点未下移、收盘回升；收盘相对累计成交均价偏离',
  {...meta,windowEnd:day+' 10:00',eventAt:found.bar.date,retestAt:found.retest.date,previousVwapCny:rounded(found.before),vwapCny:rounded(found.after),observed:bars.length,total:bars.length});
}
export function observeDerivedFactors(state,observation=state?.v6Observation){
 if(!state||!observation||!stockCode(observation.code)||!dayOk(observation.day)||!Number.isSafeInteger(observation.observedAtMs))return {};
 const {day,code,observedAtMs}=observation,at=Math.min(Date.now(),observedAtMs,
  observation.latestClosed===true&&observation.latestClosedDay===day?Infinity:closeAt(day));
 if(at<openAt(day)||observedAtMs>Date.now()||observation.stock?.code&&observation.stock.code!==code)return {};
 const out={},demo=state.scope==='demo',days=marketDays(state,day,at,demo);
 function add(key,value,unit,knownAt,source,detail,extra){
  if(out[key]||!Number.isFinite(value)||!Number.isSafeInteger(knownAt)||knownAt>at)return;
  out[key]={symbol:code,factorCode:key,tradeDate:day,value:rounded(value),unit,knownAt,source,sampleSet:demo?'test':'real',
   text:detail+' '+rounded(value)+unit+'；来源 '+source+'，取得 '+wall(knownAt),...extra};
 }
 poolFactors(observation,days,at,demo,add);
 dailyFactors(state,observation,days,at,demo,add);
 capitalFactor(observation,at,demo,add);
 minuteFactors(state,observation,at,demo,add);
 return out;
}
