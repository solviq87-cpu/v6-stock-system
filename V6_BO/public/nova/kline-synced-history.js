// The private archive holds actual provider receipts. Dated observations may
// arrive days after the exchange session; their receipt time stays intact.
import {labelHistory,HORIZONS} from './kline-factor-engine.js';

const finite=Number.isFinite;
const nullable=n=>finite(n)?n:null;
const beijingDay=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
const validDay=d=>typeof d==='string'&&/^\d{4}-\d\d-\d\d$/.test(d)&&finite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
function instant(value){
  if(Number.isSafeInteger(value)&&value>0)return value;
  if(typeof value!=='string')return NaN;
  if(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d$/.test(value))return Date.parse(value.replace(' ','T')+':00+08:00');
  if(/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value))return Date.parse(value);
  return NaN;
}
function receipt(r,now){
  const at=instant(r.knownAt??r.availableAt);
  return validDay(r.date)&&r.source&&at>=Date.parse(r.date+'T15:00:00+08:00')&&at<=now?at:null;
}
function isPriceBar(r){
  return [r.open,r.high,r.low,r.close].every(x=>finite(x)&&x>0)&&r.high>=Math.max(r.open,r.close)&&r.low<=Math.min(r.open,r.close)&&finite(r.volume)&&r.volume>=0;
}
function continuousWeekdays(start,end,dates){
  for(let t=Date.parse(start)+86400000;t<=Date.parse(end);t+=86400000){
    const d=new Date(t);
    if(![0,6].includes(d.getUTCDay())&&!dates.has(d.toISOString().slice(0,10)))return false;
  }
  return true;
}
export function syncedDataset(state,now=Date.now()){
  const stocks=new Map(),markets=new Map(),sectors=new Map(),indexBars=new Map();
  const add=(map,key,item)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(item);};
  for(const r of state.bars||[]){
    const at=receipt(r,now);
    if(!at||r.period!=='日K'||!isPriceBar(r))continue;
    const row={...r,at,asOf:new Date(at).toISOString(),amount:nullable(r.amount),turnover:nullable(r.turnover),volumeRatio:nullable(r.volumeRatio)};
    if(r.role==='stock'&&String(r.source).startsWith('V6/')&&r.priceBasis==='unadjusted'&&r.volumeUnit==='shares'&&/^\d{6}$/.test(r.code))add(stocks,r.code,row);
    if(r.role==='sector'&&r.sector)add(sectors,r.sector+'|'+r.date,row);
    if(r.role==='index'&&['000985','1.000985','ALL_A'].includes(r.code))add(indexBars,r.date,row);
  }
  for(const list of stocks.values())list.sort((a,b)=>a.date.localeCompare(b.date));
  for(const r of [...(state.marketHistory||[]),...(state.market||[])]){
    const at=receipt(r,now);
    if(at)add(markets,r.date,{...r,at});
  }
  const checks=new Map();
  for(const c of state.checks||[]){
    if(c.sourceFingerprint&&c.method==='行情自动识别'){
      // The frozen cutoff is stored to minute precision by the source. Never
      // extend it to the end of the minute or substitute the save timestamp.
      const at=instant(c.asOf);
      if(finite(at)&&at<=now&&beijingDay(at)===c.date)add(checks,c.code+'|'+c.date,at);
    }
  }
  const last=state.v6Observation;
  const observation=last&&finite(last.observedAtMs)&&last.observedAtMs<=now?last:null;
  return {stocks,markets,sectors,indexBars,checks,now,revision:state.revision,observation};
}
function latest(rows,until){
  return (rows||[]).reduce((best,r)=>r.at<=until&&(!best||r.at>best.at)?r:best,null);
}
function marketAt(data,date,until){
  const m=latest(data.markets.get(date),until),b=latest(data.indexBars.get(date),until);
  if(!m&&!b)return null;
  const at=Math.max(m?.at||0,b?.at||0);
  return {date,code:'ALL_A',type:'market',marketTrend:m?.trend||null,up:nullable(m?.adv),down:nullable(m?.dec),
    close:nullable(b?.close),amount:finite(m?.amount)?m.amount*1e8:nullable(b?.amount),support:m?.indexPosition||null,
    asOf:new Date(at).toISOString(),source:[m?.source,b?.source].filter(Boolean).join(' / '),themes:Array.isArray(m?.themes)?m.themes:[]};
}
function sectorAt(data,r,m,until){
  const last=data.observation,ob=last?.code===r.code&&last.day===r.date&&last.observedAtMs<=until&&last.latestClosed===true?last:null;
  const group=m?.themes.find(t=>Array.isArray(t.members)&&t.members.some(x=>x.code===r.code));
  const name=r.sector||group?.name||ob?.stock?.sector;
  if(!name)return null;
  const b=latest(data.sectors.get(name+'|'+r.date),until),g=group?.name===name?group:null;
  if(!b&&!g&&!ob?.stock?.sector)return null;
  return {date:r.date,code:name,type:'sector',close:nullable(b?.close),sectorStage:b?.themeCycle||null,tier:g?.ladder??b?.tier??ob?.stock?.ladder??null,
    assistCount:nullable(g?.assists??b?.sectorAssists??ob?.stock?.sectorAssists),sectorDays:nullable(b?.themeDays),source:[g?m.source:null,b?.source,ob?'V6 收盘归档':null].filter(Boolean).join(' / '),
    asOf:new Date(Math.max(g?Date.parse(m.asOf):0,b?.at||0,ob?.observedAtMs||0)).toISOString()};
}
// Keep late historical bars available to today's chart and indicators. Only a
// same-session receipt or same-session frozen decision can create a sample for
// that historical session. Outcomes never enter the feature window.
export function syncedSeries(data,code){
  const rows=data.stocks.get(code)||[],samples=[],dates=new Set([...data.markets.keys(),...data.indexBars.keys()]);
  let late=0;
  for(let i=0;i<rows.length;i++){
    const bar=rows[i],closes=data.checks.get(code+'|'+bar.date)||[];
    const until=closes.filter(at=>at>=bar.at).sort((a,b)=>a-b)[0]??bar.at;
    if(beijingDay(until)!==bar.date){late++;continue;}
    const past=rows.slice(Math.max(0,i-60),i+1).filter(r=>r.at<=until);
    const window=past.concat(rows.slice(i+1,i+1+Math.max(...HORIZONS))),market=[],sector=[];
    const normalized=window.map(r=>{
      const boundary=r.date<=bar.date?until:data.now,m=marketAt(data,r.date,boundary),s=sectorAt(data,r,m,boundary);
      if(m)market.push(m);if(s)sector.push(s);
      return {...r,type:'stock',sector:s?.code||r.sector||'',blackSwan:typeof r.blackSwan==='boolean'?r.blackSwan:null,repeatable:typeof r.repeatable==='boolean'?r.repeatable:null};
    });
    const sample=labelHistory(normalized,sector,market)[past.length-1];
    // The private archive may have only scattered daily market captures.
    // A sparse calendar cannot establish the Nth subsequent trading session.
    const present=new Set(market.map(m=>m.date));
    sample.observed=sample.observed.map(o=>o&&continuousWeekdays(bar.date,o.endDate,present)?o:null);
    sample.signalAvailableAt=new Date(until).toISOString();samples.push(sample);
  }
  const last=rows.at(-1),market=last?marketAt(data,last.date,data.now):null;
  return {rows,samples,late,marketDays:dates.size,market,sector:last?sectorAt(data,last,market,data.now):null};
}
