// The private archive holds actual provider receipts. Dated observations may
// arrive days after the exchange session; their receipt time stays intact.
import {labelHistory,debounceLearningSamples,HORIZONS} from './kline-factor-engine.js';

const finite=Number.isFinite;
const nullable=n=>finite(n)?n:null;
const beijingDay=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
const validDay=d=>typeof d==='string'&&/^\d{4}-\d\d-\d\d$/.test(d)&&finite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
function instant(value){
  if(Number.isSafeInteger(value)&&value>0&&finite(new Date(value).getTime()))return value;
  if(typeof value!=='string'||!validDay(value.slice(0,10)))return NaN;
  if(validDay(value))return Date.parse(value+'T15:00:00+08:00');
  if(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d$/.test(value))return Date.parse(value.replace(' ','T')+':00+08:00');
  if(/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value))return Date.parse(value);
  return NaN;
}
function receipt(r,now){
  if(!r||!validDay(r.date)||typeof r.source!=='string'||!r.source.trim()||!finite(now))return null;
  // Weekend labels cannot identify completed A-share daily cash sessions.
  if([0,6].includes(new Date(r.date+'T00:00:00Z').getUTCDay()))return null;
  const times=[r.knownAt,r.availableAt].filter(x=>x!=null).map(instant);
  const at=times.length&&times.every(finite)?Math.max(...times):NaN;
  return at>=Date.parse(r.date+'T15:00:00+08:00')&&at<=now?at:null;
}
const exactTime=value=>!validDay(value)&&finite(instant(value));
function dailyLearningEligible(r){
  // A release or later cache clock cannot turn an intraday bar into a settled
  // one. Keep the declared availability boundary, but require the original
  // receipt itself to pass the same 15:10 China-market daily safety gate.
  const clocks=[r.knownAt,r.availableAt].filter(x=>x!=null);
  return clocks.length>0&&clocks.every(exactTime)&&instant(r.knownAt??r.availableAt)>=Date.parse(r.date+'T15:10:00+08:00');
}
const evidenceFields=['open','high','low','close','volume','amount','turnover','volumeRatio','priceBasis','volumeUnit','secid',
  'sector','limitUp','leaderRank','blackSwan','repeatable','suspended','regulation','crowding','badNews','liquidity','mismatch','chipPeak','trappedRatio','chipTurn'];
// Preserve the first usable receipt. A later contradictory observation is
// not a reviewed correction: quarantine it from that point onward, without
// changing the sample that was frozen before the contradiction arrived.
function stockAt(versions,until,learning=true){
  const visible=versions.filter(r=>r.at<=until),final=visible.filter(r=>r.learningEligible);
  const candidates=final.length||learning?final:visible;
  if(!candidates.length)return {row:null,conflict:false};
  for(const field of evidenceFields){
    const values=new Set(candidates.map(r=>r[field]).filter(v=>v!=null));
    if(values.size>1)return {row:null,conflict:true};
  }
  // Equal receipts must not choose different metadata by file order.
  const first=candidates[0],ties=candidates.filter(r=>r.at===first.at);
  if(ties.some(r=>evidenceFields.some(k=>(r[k]??null)!==(first[k]??null))))return {row:null,conflict:true};
  return {row:first,conflict:false};
}
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const contextKey=r=>JSON.stringify(stable(Object.fromEntries(['open','high','low','close','volume','amount','trend','adv','dec','indexPosition','themes','themeCycle','tier','sectorAssists','themeDays','priceBasis','volumeUnit','secid'].map(k=>[k,r[k]??null]))));
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
  const stocks=new Map(),stockVersions=new Map(),markets=new Map(),sectors=new Map(),indexBars=new Map();
  const add=(map,key,item)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(item);};
  for(const r of Array.isArray(state.bars)?state.bars:[]){
    const at=receipt(r,now);
    if(!at||r.period!=='日K'||!isPriceBar(r))continue;
    const row={...r,at,asOf:new Date(at).toISOString(),amount:nullable(r.amount),turnover:nullable(r.turnover),volumeRatio:nullable(r.volumeRatio),learningEligible:dailyLearningEligible(r)};
    if(r.role==='stock'&&r.source.startsWith('V6/')&&r.priceBasis==='unadjusted'&&r.volumeUnit==='shares'&&typeof r.code==='string'&&/^\d{6}$/.test(r.code)&&
       Number.isSafeInteger(r.volume)&&(r.secid==null||r.secid===(r.code.startsWith('6')?'1.':'0.')+r.code)){
      if(!stockVersions.has(r.code))stockVersions.set(r.code,new Map());
      add(stockVersions.get(r.code),r.date,row);
    }
    if(row.learningEligible&&(r.priceBasis==null||r.priceBasis==='unadjusted')){
      if(r.role==='sector'&&r.sector)add(sectors,r.sector+'|'+r.date,row);
      if(r.role==='index'&&['000985','1.000985','ALL_A'].includes(r.code))add(indexBars,r.date,row);
    }
  }
  for(const [code,days] of stockVersions){
    const visible=[];
    for(const [date,versions] of [...days].sort((a,b)=>a[0].localeCompare(b[0]))){
      versions.sort((a,b)=>a.at-b.at||a.source.localeCompare(b.source));
      const picked=stockAt(versions,now,false);
      if(picked.row)visible.push(picked.row);
    }
    if(visible.length)stocks.set(code,visible);
  }
  for(const r of [...(Array.isArray(state.marketHistory)?state.marketHistory:[]),...(Array.isArray(state.market)?state.market:[])]){
    const at=receipt(r,now);
    if(at&&[r.knownAt,r.availableAt].filter(x=>x!=null).every(exactTime))add(markets,r.date,{...r,at});
  }
  const checks=new Map();
  for(const c of Array.isArray(state.checks)?state.checks:[]){
    if(c?.sourceFingerprint&&c.method==='行情自动识别'&&exactTime(c.asOf)){
      // The frozen cutoff is stored to minute precision by the source. Never
      // extend it to the end of the minute or substitute the save timestamp.
      const at=instant(c.asOf);
      if(finite(at)&&at<=now&&beijingDay(at)===c.date)add(checks,c.code+'|'+c.date,at);
    }
  }
  const last=state.v6Observation;
  const observation=last&&finite(last.observedAtMs)&&last.observedAtMs<=now?last:null;
  return {stocks,stockVersions,markets,sectors,indexBars,checks,now,revision:state.revision,observation};
}
function latest(rows,until){
  const visible=(rows||[]).filter(r=>r.at<=until);
  if(!visible.length)return null;
  const at=Math.max(...visible.map(r=>r.at)),ties=visible.filter(r=>r.at===at);
  return ties.some(r=>contextKey(r)!==contextKey(ties[0]))?null:ties.slice().sort((a,b)=>a.source.localeCompare(b.source))[0];
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
  const group=m?.themes.find(t=>t&&Array.isArray(t.members)&&t.members.some(x=>x?.code===r.code));
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
  const versions=data.stockVersions?.get(code)||new Map(rows.map(r=>[r.date,[r]]));
  const days=[...versions].sort((a,b)=>a[0].localeCompare(b[0]));
  let late=0,provisional=0,conflictDates=0,blockedSamples=0;
  for(let i=0;i<days.length;i++){
    const [date,revisions]=days[i],first=revisions.find(r=>r.learningEligible);
    if(stockAt(revisions,data.now,false).conflict)conflictDates++;
    if(!first){provisional++;continue;}
    const closes=data.checks.get(code+'|'+date)||[];
    const until=closes.filter(at=>at>=first.at).sort((a,b)=>a-b)[0]??first.at;
    if(beijingDay(until)!==date){late++;continue;}
    const current=stockAt(revisions,until);
    if(!current.row){blockedSamples++;continue;}
    const bar=current.row,past=[];
    let conflicted=false;
    for(let j=i-1;j>=0&&past.length<60;j--){
      const visible=stockAt(days[j][1],until);
      if(visible.conflict){conflicted=true;break;}
      if(visible.row)past.push(visible.row);
    }
    // Do not compress a known contradictory historical bar into the feature
    // window; it needs review before this later signal can be certified.
    if(conflicted){blockedSamples++;continue;}
    past.reverse();past.push(bar);
    const future=days.slice(i+1,i+1+Math.max(...HORIZONS)).map(([,list])=>stockAt(list,data.now).row).filter(Boolean);
    const window=past.concat(future),market=[],sector=[];
    const normalized=window.map(r=>{
      const boundary=r.date<=bar.date?until:data.now,m=marketAt(data,r.date,boundary),s=sectorAt(data,r,m,boundary);
      if(m)market.push(m);if(s)sector.push(s);
      return {...r,type:'stock',sector:s?.code||r.sector||'',blackSwan:typeof r.blackSwan==='boolean'?r.blackSwan:null,repeatable:typeof r.repeatable==='boolean'?r.repeatable:null};
    });
    const sample=labelHistory(normalized,sector,market,[],{decisionAt:new Map([[bar.date,until]]),deferWindow:true})[past.length-1];
    const present=new Set(market.map(m=>m.date));
    sample.observed=sample.observed.map(o=>o&&continuousWeekdays(bar.date,o.endDate,present)?o:null);
    sample.signalAvailableAt=new Date(until).toISOString();samples.push(sample);
  }
  const last=rows.at(-1),market=last?marketAt(data,last.date,data.now):null;
  const timeline=days.map(([,list])=>list.find(r=>r.learningEligible)||list[0]);
  return {rows,samples:debounceLearningSamples(samples,timeline,{isVisible:(r,cutoff)=>!!stockAt(versions.get(r.date)||[],cutoff).row}),late,provisional,conflictDates,blockedSamples,marketDays:dates.size,market,sector:last?sectorAt(data,last,market,data.now):null};
}
