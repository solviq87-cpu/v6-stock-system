// All-A evidence is anchored to the signal cutoff in China time. A receipt from
// a later replay can describe the current review but cannot relabel an old signal.
const num=Number.isFinite;
const positive=x=>num(x)&&x>0;
const trend=x=>['多头','震荡','空头'].includes(x);
const pct=(a,b)=>100*(a/b-1);
const fmt=x=>Number(x.toFixed(2));
const dayOf=x=>String(x||'').slice(0,10);
function timestamp(value){
  if(Number.isSafeInteger(value))return value;
  if(typeof value!=='string')return NaN;
  if(/^\d{4}-\d\d-\d\d$/.test(value))return Date.parse(value+'T15:00:00+08:00');
  const local=value.replace(' ','T');
  if(/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(local))return Date.parse(local+'+08:00');
  return /(?:Z|[+-]\d\d:\d\d)$/.test(local)?Date.parse(local):NaN;
}
function visible(row,at){
  if(!row)return false;
  const marks=[row.knownAt,row.availableAt].filter(x=>x!=null);
  if(!marks.length)return timestamp(row.date)<=at;
  return marks.every(x=>timestamp(x)<=at);
}
function priorWeekday(day){
  const d=new Date(day+'T12:00:00Z');
  do{d.setUTCDate(d.getUTCDate()-1);}while([6,0].includes(d.getUTCDay()));
  return d.toISOString().slice(0,10);
}
function consecutive(rows){
  return rows.every((r,i)=>!i||rows[i-1].date===(r.previousDay||priorWeekday(r.date)));
}
function ohlc(r){
  return !!r&&[r.open,r.close,r.high,r.low].every(positive)&&r.high>=Math.max(r.open,r.close)&&r.low<=Math.min(r.open,r.close);
}

export function addIndexEvidence({b,market={},sector={},marketSeries=[],asOf},facts){
  const day=dayOf(b?.date),at=timestamp(asOf??b?.date);
  if(!num(at)||!num(timestamp(day))||!visible(b,at)||market.date!==day||!visible(market,at))return facts;
  function record(keys,pass,source){
    for(const key of keys.split(' '))facts.set(key,{pass:!!pass,source:day+' · '+source});
  }
  const change=market.indexChange, breadth=Number.isSafeInteger(market.adv)&&market.adv>=0&&
    Number.isSafeInteger(market.dec)&&market.dec>=0&&market.adv+market.dec>0;
  const advancing=breadth&&market.adv/(market.adv+market.dec)>=2/3;
  const breadthSource='上涨 '+market.adv+' 家，下跌 '+market.dec+' 家（上涨占比至少 2/3 视为普涨）';
  const all=market.trend,sh=market.sh,cy=market.cy;
  for(const [key,label,value] of [['80:0','全A',all],['80:1','上证',sh],['80:2','创业板',cy]])
    if(trend(value))record(key,true,label+'趋势 '+value);
  if(trend(all)&&trend(sh))record('71:0',all==='多头'&&sh==='多头','全A '+all+'，上证 '+sh);
  if(trend(all))record('83:1',all==='空头','全A均线趋势 '+all);
  if(trend(all)&&trend(sh)&&trend(cy))record('80:4',sh!==cy&&all!==cy,'全A '+all+'，上证 '+sh+'，创业板 '+cy+'（三指数分化门槛）');
  if(breadth&&num(change)){
    record('95:0',change>0&&market.dec>market.adv,'全A '+fmt(change)+'%，'+breadthSource);
    record('84:1',advancing,breadthSource);
    if(trend(all)&&trend(sh)&&trend(cy))record('80:3',advancing&&all==='多头'&&sh==='多头'&&cy==='多头',breadthSource+'，三指数趋势 '+[all,sh,cy].join('/'));
  }
  const sec=((!sector.date||dayOf(sector.date)===day)&&visible({...sector,date:sector.date||b.date},at))&&num(sector.change)?sector.change:null;
  if(num(sec)){
    record('75:0',sec>=2,'同期板块涨幅 '+fmt(sec)+'%（强势门槛 2%）');
    if(num(change)){
      record('90:0',sec>0&&change<0,'板块 '+fmt(sec)+'%，全A '+fmt(change)+'%');
      if(b.sector&&market.theme&&market.themeType)record('89:0',b.sector===market.theme&&market.themeType==='主线'&&sec>0&&change>0,'标的题材 '+b.sector+'，当日'+market.themeType+' '+market.theme+'，板块 '+fmt(sec)+'%，指数 '+fmt(change)+'%');
    }
  }
  if(num(change))record('90:1',change<0,'全A单日涨幅 '+fmt(change)+'%');
  if(market.volume==='放量上涨'||market.volume==='缩量上涨'){
    record('94:0',market.volume==='放量上涨','全A量价记录 '+market.volume);
    record('94:1',market.volume==='缩量上涨','全A量价记录 '+market.volume);
  }

  const days=new Map();
  for(const m of marketSeries){
    if(dayOf(m?.date)<=day&&visible(m,at)&&(!days.has(m.date)||timestamp(m.knownAt??m.availableAt??m.date)>=timestamp(days.get(m.date).knownAt??days.get(m.date).availableAt??m.date)))days.set(m.date,m);
  }
  days.set(day,market);
  const recent=[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-3);
  function streak(moves,source){
    const falling=moves.every(d=>d<0),rising=moves.every(d=>d>0);
    record('91:0 75:1',falling,source);
    if(trend(all))record('83:0',all==='空头'&&falling,source+'，全A趋势 '+all);
    record('92:0',rising,source);
    if(trend(all))record('71:1',all==='空头'&&falling,source+'，全A趋势 '+all);
    record('74:1',moves[1]<=0&&moves[2]>0,source+'，全A由跌转升');
  }
  if(recent.length===3&&consecutive(recent)&&recent.every(d=>num(d.indexChange))){
    const moves=recent.map(d=>d.indexChange);
    streak(moves,'近三个交易日全A涨幅 '+moves.map(fmt).join('/')+'%');
  }
  if(num(market.premium))record('78:1',market.premium>=1,'昨日涨停股今日溢价 '+fmt(market.premium)+'%（门槛 1%）');

  const evidence=market.indexEvidence;
  if(!evidence||!/^中证全指(?:指数)?$/.test(evidence.name)||!evidence.source||
    !(timestamp(evidence.receivedAt)<=at)||!Array.isArray(evidence.rows))return facts;
  // A full-day provider snapshot cannot be consumed before its own session close.
  if(at<timestamp(day))return facts;
  const rows=evidence.rows.filter(r=>r&&r.date<=day&&positive(r.close)&&visible(r,at));
  if(rows.at(-1)?.date!==day||rows.some((r,i)=>i>0&&r.date<=rows[i-1].date))return facts;
  const last=rows.at(-1),prev=rows.at(-2),last3=rows.slice(-3),last4=rows.slice(-4);
  const prefix=evidence.name+' '+evidence.source+'；';
  const put=(ids,value,text)=>record(ids,value,prefix+text);
  const ma3=last3.length===3&&consecutive(last3)&&last3.every(r=>positive(r.ma20)&&positive(r.ma5));
  if(ma3){
    const supported=last3.every(r=>r.close>=r.ma20);
    put('81:0',supported,'近三日收盘均站上MA20校验，收盘 '+last3.map(r=>fmt(r.close)).join('/')+'，MA20 '+last3.map(r=>fmt(r.ma20)).join('/'));
  }
  if(!prev||!consecutive([prev,last]))return facts;
  const move=pct(last.close,prev.close),vr=last.volumeRatio,body=ohlc(last)?pct(last.close,last.open):null;
  if(positive(vr)){
    put('94:0',move>0&&vr>=1.2,'全A涨幅 '+fmt(move)+'%，相对前五日均量 '+fmt(vr)+' 倍');
    put('94:1',move>0&&vr<=.8,'全A涨幅 '+fmt(move)+'%，相对前五日均量 '+fmt(vr)+' 倍');
    if(num(body)){
      const heavy=move<=-2&&body<=-1.5&&vr>=1.2;
      put('72:0 72:1 85:0',heavy,'涨幅 '+fmt(move)+'%，K线实体 '+fmt(body)+'%，量比 '+fmt(vr)+'；放量长阴须同时跌 ≥2%、阴实体 ≥1.5%、量比 ≥1.2');
      put('84:0',move>=1&&body>0&&vr>=1.2,'全A涨幅 '+fmt(move)+'%，阳线实体 '+fmt(body)+'%，量比 '+fmt(vr));
    }
  }
  if(positive(last.ma20)&&positive(prev.ma20))
    put('76:0',prev.close>=prev.ma20&&last.close<last.ma20,'前收/前MA20 '+fmt(prev.close)+'/'+fmt(prev.ma20)+'，现收/MA20 '+fmt(last.close)+'/'+fmt(last.ma20));
  if(last4.length===4&&consecutive(last4)){
    const moves=last3.map((r,i)=>pct(r.close,last4[i].close)),source='近三交易日指数涨幅 '+moves.map(fmt).join('/')+'%';
    streak(moves,prefix+source);
    if(ma3){
      put('81:1',last3.every((r,i)=>!i||r.ma5>last3[i-1].ma5),'近三日MA5 '+last3.map(r=>fmt(r.ma5)).join('/'));
      put('78:0',moves.every(d=>d>0)&&last3.every((r,i)=>r.close>=r.ma5&&(!i||r.ma5>last3[i-1].ma5)),source+'，MA5 '+last3.map(r=>fmt(r.ma5)).join('/'));
    }
    const alternates=moves[0]*moves[1]<0&&moves[1]*moves[2]<0;
    put('82:0',alternates,source+'，检查三日涨跌交替');
    if(last3.every(r=>positive(r.volumeRatio))){
      const shrinking=last3.every(r=>r.volumeRatio<=.8),drifting=moves.every(d=>d<0&&d>-2);
      put('73:0',shrinking,'近三日量比 '+last3.map(r=>fmt(r.volumeRatio)).join('/'));
      put('86:0',shrinking&&moves.every(d=>d<0),source+'，量比 '+last3.map(r=>fmt(r.volumeRatio)).join('/'));
      put('86:1',shrinking&&drifting,source+'，三日量比 '+last3.map(r=>fmt(r.volumeRatio)).join('/'));
      put('82:1',alternates&&last3.every(r=>r.volumeRatio>.8&&r.volumeRatio<1.2),source+'，近三日量比 '+last3.map(r=>fmt(r.volumeRatio)).join('/'));
    }
    if(last4.every(ohlc)){
      const amplitude=last3.map((r,i)=>100*(r.high-r.low)/last4[i].close);
      put('73:1',amplitude[2]<amplitude[1]&&amplitude[1]<amplitude[0],'近三日振幅 '+amplitude.map(fmt).join('/')+'%');
      const lows=last3.map(r=>r.low),higher=lows[2]>=lows[1]&&lows[1]<=lows[0],steady=last.close>=last.open&&last.close>=prev.close;
      const recovering=moves.slice(0,2).some(x=>x<0)&&higher&&steady;
      put('87:0',recovering,'最近三日低点 '+lows.map(fmt).join('/'));
      put('87:1',recovering,'低点 '+lows.map(fmt).join('/')+'，今日开/收 '+fmt(last.open)+'/'+fmt(last.close));
      put('87:2',recovering&&moves[0]<0&&moves[1]>moves[0]&&moves[2]>moves[1],source);
      put('77:0',Math.min(moves[0],moves[1])<=-2&&higher&&steady,source+'，今日低点企稳、收阳检查');
    }
  }
  const trace=rows.slice(-20);
  if(trace.length>=2&&trace.every(ohlc)&&consecutive(trace)){
    let downGap=null,upSupport=null;
    for(let i=1;i<trace.length;i++){
      const a=trace[i-1],c=trace[i],since=trace.slice(i);
      if(c.high<a.low&&since.every(r=>r.high<a.low))downGap={date:c.date,edge:a.low};
      if(c.low>a.high&&since.length>1&&since.every(r=>r.low>=a.high)&&last.low<=c.low&&last.close>c.low)upSupport={date:c.date,edge:a.high};
    }
    // A limited window only proves a detected gap. It cannot rule out older gaps.
    if(downGap)put('93:0',true,downGap.date+' 向下缺口，至今最高未触及前日低点 '+fmt(downGap.edge));
    if(upSupport)put('93:1',true,upSupport.date+' 向上缺口，回踩保持前高支撑 '+fmt(upSupport.edge));
  }
  const prior20=rows.slice(-21,-1);
  if(prior20.length===20&&ohlc(last)&&prior20.every(ohlc)&&consecutive([...prior20,last])){
    const ceiling=Math.max(...prior20.map(r=>r.high)),low=Math.min(...prior20.slice(-5).map(r=>r.low));
    const rebound=last.close>=low*1.02,near=last.high>=ceiling*.99&&last.close<=ceiling;
    put('88:0',rebound&&near,'前20日高点 '+fmt(ceiling)+'，近5日低点 '+fmt(low)+'，今日最高/收盘 '+fmt(last.high)+'/'+fmt(last.close)+'（反弹至少2%，距前高1%以内）');
    if(positive(vr))put('88:1',rebound&&near&&vr>=1.2&&Math.abs(move)<=.5,'前高 '+fmt(ceiling)+' 附近检验量价，量比 '+fmt(vr)+'，涨幅 '+fmt(move)+'%');
  }
  // Position alone cannot prove a trapped-holder zone, or market-wide capitulation.
  return facts;
}
