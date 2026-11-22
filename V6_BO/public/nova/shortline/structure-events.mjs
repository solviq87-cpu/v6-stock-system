import {sampleMatches,isTestSample} from './sample-quality.mjs';
const finite=Number.isFinite;
const inDay=(b,day)=>b.date?.slice(0,10)===day;
export function asTime(value){
  if(finite(value))return value;
  const str=String(value||'').replace(' ','T');
  if(!/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)?)?$/.test(str))return NaN;
  return Date.parse(str.length===10?str+'T15:00:00+08:00':/[Zz]|[+-]\d\d:\d\d$/.test(str)?str:str+'+08:00');
}
const visible=(b,at)=>{const known=asTime(b.knownAt??b.availableAt);return Number.isFinite(known)&&known>=asTime(b.date)&&known<=at;};
const r2=x=>Math.round(x*100)/100;
function intraday(bars,day,at){
  return bars.filter(b=>inDay(b,day)&&b.date.length>10&&visible(b,at)&&asTime(b.date)<=at&&b.close>0&&b.high>=b.close&&b.low<=b.close)
    .sort((a,b)=>a.date.localeCompare(b.date));
}
function interval(b){return /^1(?:分(?:钟)?K?|m|min)$/i.test(b.period||'')?1:/^5(?:分(?:钟)?K?|m|min)$/i.test(b.period||'')?5:null;}
function adjacent(a,b){
  const n=interval(a);return n&&n===interval(b)&&asTime(b.date)-asTime(a.date)===n*60000;
}
export function sectorIdsFor(stock,day,bars,at){
  const refs=stock.refs||[],ids=new Set();
  for(const ref of refs){
    if(ref.provider==='eastmoney'&&/^BK\d{4}$/.test(ref.boardId||''))ids.add(ref.boardId);
    if(ref.provider==='eastmoney'&&ref.kind==='industry'){
      for(const row of bars)if(row.role==='sector'&&inDay(row,day)&&visible(row,at)&&row.source&&/^90\.BK\d{4}$/.test(row.secid||'')&&row.name===ref.rawName&&row.secid==='90.'+row.code)ids.add(row.code);
    }
  }
  return [...ids];
}
export function classifyBreak(stock,day,allBars,at,sectorIds=[]){
  const sourceBars=intraday(allBars,day,at);
  const stockBars=sourceBars.filter(b=>b.code===stock.code&&(!b.role||b.role==='stock'));
  const limit=stock.upLimit||stockBars.find(b=>b.limitUp>0)?.limitUp;
  const result={code:stock.code,name:stock.name||stock.code,status:'未判定',evidence:[],missing:[],eventTime:null};
  if(!(limit>0)){result.missing.push('同日实际涨停价');return result;}
  const candidates=[];
  for(let i=1;i<stockBars.length;i++){
    const prev=stockBars[i-1],row=stockBars[i];
    if(prev.close===limit&&row.close<limit&&adjacent(prev,row))candidates.push([prev,row]);
  }
  if(!candidates.length){result.missing.push('同频连续、先收于涨停后开板的分时K');return result;}
  const [prev,row]=candidates[0],point=asTime(row.date);
  result.eventTime=row.date;result.evidence.push('从 '+prev.date.slice(11)+' 收在涨停到 '+row.date.slice(11)+' 低于涨停');
  const labels=[];
  // Executed sells also deplete a bid queue. A shrinking displayed bid alone
  // is insufficient evidence of a cancellation.
  const cancellations=[...(stock.orderEvents||[]),...stockBars.flatMap(b=>Array.isArray(b.orderEvents)?b.orderEvents:[])].filter(e=>e.type==='cancel'&&e.side==='buy'&&e.price===limit&&e.code===stock.code&&e.source&&e.quantity>0&&e.queueBefore>=e.quantity&&
    asTime(e.knownAt)>=asTime(e.time)&&asTime(e.knownAt)<=at&&asTime(e.time)>asTime(prev.date)&&asTime(e.time)<=point&&e.quantity/e.queueBefore>=0.5);
  if(cancellations.length){labels.push('封单后撤炸板');result.evidence.push('开板区间内可核查的买一撤单占撤单前封单至少 50%');}
  else result.missing.push('有原时点、方向、数量和队列基数的撤单明细');
  const period=interval(row),after=stockBars.filter(b=>b.date>row.date&&interval(b)===period).slice(0,2);
  if(after.length===2&&adjacent(row,after[0])&&adjacent(after[0],after[1])&&after.every(b=>b.high<limit)&&after[1].close<after[0].close&&after[0].close<row.close){
    labels.push('承接不足炸板');result.evidence.push('开板后连续两根同频K未回封且收盘价逐根降低');
  }else result.missing.push('开板后两根同频K持续走低的承接证据');
  const sectorSet=new Set(sectorIds.filter(Boolean));
  const bySector=new Map();
  for(const b of sourceBars)if(b.role==='sector'&&sectorSet.has(b.code)&&interval(b)===period){
    if(!bySector.has(b.code))bySector.set(b.code,[]);bySector.get(b.code).push(b);
  }
  for(const [id,bars] of bySector){
    const i=bars.findIndex(b=>b.date===row.date);
    if(i<1||!adjacent(bars[i-1],bars[i]))continue;
    const fall=100*(bars[i].close/bars[i-1].close-1);
    if(fall<=-1){labels.push('板块跳水带崩炸板');result.evidence.push(id+' 同区间收跌 '+r2(fall)+'%，记录同步下挫');break;}
  }
  if(!labels.includes('板块跳水带崩炸板'))result.missing.push('同一已核板块在开板区间跌幅至少 1% 的分时证据');
  if(labels.length)result.status=labels.join(' / ');return result;
}

export function highEvents(frames,bars=[],at=Date.now()){
  const days=new Map(frames.filter(f=>f.date&&asTime(f.knownAt)<=at).map(f=>[f.date,f])),events=[];
  const daily=new Map(bars.filter(b=>b.date?.length===10&&(!b.role||b.role==='stock')&&visible(b,at)&&b.high>=b.close&&b.close>0&&b.volume>0).map(b=>[b.date+'/'+b.code,b]));
  const seenBreaks=new Map();
  for(const f of [...days.values()].sort((a,b)=>a.date.localeCompare(b.date))){
    const prior=days.get(f.previousDay);if(!prior||f.provider!==prior.provider||f.scope!==prior.scope)continue;
    const active=new Map((f.sealed||[]).map(r=>[r.code,r]));
    const broken=new Set((f.broken||[]).map(r=>r.code));
    const selected=(prior.sealed||[]).filter(r=>r.level>=2);
    const feedback=[];
    for(const s of selected){
      const today=active.get(s.code),bar=daily.get(f.date+'/'+s.code),observed=f.outcomes?.[s.code];
      const obs=observed&&asTime(observed.knownAt)<=at?observed:null;
      const register=(type,time,why)=>events.push({date:f.date,code:s.code,name:s.name||s.code,type,time,source:obs?.source||f.source,previousLevel:s.level,why});
      const change=obs?.change??today?.change;if(finite(change))feedback.push(change);
      const nuclear=bar?.limitDown>0&&bar.open===bar.limitDown&&bar.close===bar.limitDown;
      if(today){register('续板',today.firstSealTime||null,'昨日 '+s.level+' 板，今日同池收盘封板');continue;}
      if(obs?.sealed!==false&&!broken.has(s.code)&&!(bar?.limitUp>0&&bar.close<bar.limitUp)&&!nuclear)continue;
      register('断板',null,'昨日连续封板，今日有交易且收盘未封涨停');
      seenBreaks.set(f.date+'/'+s.code,{level:s.level,high:bar?.high});
      if(nuclear)register('核按钮','开盘至收盘','原始日K显示开盘与收盘均在当日实际跌停价');
    }
    for(const s of active.values()){
      const old=seenBreaks.get(f.previousDay+'/'+s.code),bar=daily.get(f.date+'/'+s.code);
      if(!old)continue;
      const rebound=old.high>0&&(bar?.close??s.close)>old.high;
      events.push({date:f.date,code:s.code,name:s.name||s.code,type:rebound?'反包':'断板后再封',time:s.firstSealTime||null,previousLevel:old.level,source:f.source,
        why:rebound?'重新封板且收盘越过断板日最高价':'已核实再次封板，尚缺越过断板日高点的确认'});
    }
    if(selected.length)events.push({date:f.date,type:'高标反馈',scope:f.scope,cohort:selected.length,observed:feedback.length,
      mean:feedback.length===selected.length?r2(feedback.reduce((a,b)=>a+b,0)/feedback.length):null,
      marketDelta:f.complete&&prior.complete?(f.totalCount-prior.totalCount):null});
  }
  return events;
}

const styles=['高标连板','低位首板','趋势赛道','超跌反弹'];
function styleOf(s){
  const labels=[s.strategy,...(s.strategies||[])].filter(Boolean).join(' '),f=s.features||{};
  const matches=[];
  if(/连板接力|空间板|高标抱团/.test(labels)&&(/高标抱团|空间板/.test(labels)||s.streak>=3||s.factors?.includes('当前市场最高板')))matches.push(styles[0]);
  if(/首板/.test(labels)&&f.position==='低位')matches.push(styles[1]);
  if(/赛道趋势低吸|趋势突破/.test(labels)&&f.maState==='多头排列'&&(/赛道/.test(labels)||s.factors?.some(x=>x.includes('赛道板块'))))matches.push(styles[2]);
  if(/超跌反弹/.test(labels))matches.push(styles[3]);
  return matches;
}
export function styleRotation(records,day,at,horizon=1,selection='all',sampleSet='all'){
  const until=asTime(at),bucket=new Map(styles.map(s=>[s,[]]));
  const eligible=records.filter(s=>s.date?.length===10&&s.date<=day&&s.strategy&&asTime(s.decisionAt||s.date)<=until&&sampleMatches(s,selection)&&
    (sampleSet==='all'||(sampleSet==='test')===isTestSample(s)));
  const recent=new Set([...new Set(eligible.map(r=>r.date))].sort().slice(-20)),seen=new Set();
  for(const s of eligible){
    if(!recent.has(s.date))continue;
    const outcome=s.outcomes?.[horizon];
    if(!outcome||sampleSet==='real'&&isTestSample(outcome)||!finite(outcome.close)||!outcome.end||outcome.end.slice(0,10)>day||!finite(asTime(outcome.availableAt))||asTime(outcome.availableAt)>until||
      !sampleMatches({...s,blackSwan:s.blackSwan||outcome.blackSwan,extreme:s.extreme||outcome.extreme},selection))continue;
    for(const style of styleOf(s)){
      const id=[s.date,s.code,style].join('/');if(seen.has(id))continue;seen.add(id);bucket.get(style).push(outcome.close);
    }
  }
  const stats=[...bucket].map(([name,values])=>({name,n:values.length,mean:values.length?r2(values.reduce((a,b)=>a+b,0)/values.length):null,
    win:values.length?r2(values.filter(x=>x>0).length*100/values.length):null})).sort((a,b)=>(b.mean??-Infinity)-(a.mean??-Infinity));
  const preferred=stats.every(o=>o.n>=5)&&stats[0].mean>0&&stats[0].mean>stats[1].mean?stats[0].name:null;
  return {stats,preferred};
}
