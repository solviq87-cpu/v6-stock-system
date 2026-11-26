import {selectSignalWindow} from './shortline/signal-window.mjs';
import {settingsAt} from './shortline/settings.mjs';
/**
 * V6 historical K-line research engine. Point-in-time observations only.
 * No production weights, trade permissions or broker interfaces are exposed.
 * Signal-date features never consume future bars. Outcomes are observational
 * close-to-future-price excursions, NOT executable trading P/L.
 */
export const HORIZONS = Object.freeze([1, 2, 3, 5]);
const MAX_TEXT = 6 * 1024 * 1024;
const MAX_ROWS = 90000;
const known = x => typeof x === 'number' && Number.isFinite(x);
const round = (n, p = 4) => known(n) ? +n.toFixed(p) : null;
const n = value => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const x = Number(String(value).replace(/[,%，\s]/g, ''));
  return Number.isFinite(x) ? x : null;
};
const bool = x => {
  const s = String(x ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', '是', '有', '已确认'].includes(s)) return true;
  if (['0', 'false', 'no', '否', '无', '已排除'].includes(s)) return false;
  return null;
};
const day = x => {
  const s = String(x ?? '').trim().replace(/\//g, '-');
  const d = /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s;
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) &&
    new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d ? d : null;
};

/** Bounded RFC4180 reader; preserves quoted commas, escaped quotes and newlines. */
export function parseCSV(text) {
  if (typeof text !== 'string' || !text.trim() || new TextEncoder().encode(text).length > MAX_TEXT)
    throw Error('CSV为空或超过6MiB上限');
  const rows = [], row = []; let field = '', quoted = false, after = false;
  const push = () => { row.push(field); field = ''; after = false; };
  const end = () => { push(); if (row.some(v => v !== '')) rows.push(row.splice(0)); else row.length = 0;
    if (rows.length > MAX_ROWS) throw Error('CSV超过9万行上限'); };
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; after = true; }
      else field += c;
    } else if (c === '"' && field === '' && !after) quoted = true;
    else if (c === ',' && !quoted) push();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; end(); }
    else if (after && c === ' ') continue;
    else if (after || c === '"') throw Error('CSV存在未正确转义的双引号');
    else field += c;
  }
  if (quoted) throw Error('CSV存在未闭合的引号');
  if (field !== '' || row.length) end();
  if (rows.length < 2) throw Error('CSV至少包含表头和一行数据');
  const keys = rows.shift().map(x => x.trim());
  if (keys.some(x => !x) || new Set(keys).size !== keys.length) throw Error('CSV表头为空或重复');
  if (rows.some(r => r.length !== keys.length)) throw Error('CSV列数不一致');
  return rows.map((r, index) => ({...Object.fromEntries(keys.map((key, i) => [key, r[i].trim()])), __line: index + 2}));
}
const ALIASES = {
  code:['代码','股票代码','证券代码','symbol','code'], name:['名称','股票名称','证券名称','name'],
  date:['日期','交易日期','K线日期','date','tradeDate'], period:['周期','K线周期','period'],
  open:['开盘','开盘价','open'], high:['最高','最高价','high'], low:['最低','最低价','low'], close:['收盘','收盘价','close'],
  volume:['成交量','volume'], amount:['成交额','amount','turnoverAmount'], turnover:['换手率','turnover','turnoverPct'],
  volumeRatio:['量比','volumeRatio'], sector:['所属板块','板块','题材','sector'],
  source:['来源','数据源','source','provider'], asOf:['来源时点','数据截至','observedAt','asOf'],
  limitUp:['涨停价','limitUpPrice','limitUp'], leaderRank:['龙头排名','leaderRank'],
  assistCount:['助攻数量','assistCount'], tier:['板块梯队','tier'], sectorStage:['题材阶段','sectorStage','phase'],
  sectorDays:['题材启动天数','sectorDays'], up:['上涨家数','up','advancers'], down:['下跌家数','down','decliners'],
  marketTrend:['大盘趋势','全A趋势','marketTrend','trend'], support:['指数支撑压力','支撑压力位','support'],
  blackSwan:['黑天鹅','blackSwan'], repeatable:['可重复标准样本','repeatable'], suspended:['停牌','是否停牌','suspended'],
  regulation:['监管风险','regulation'], crowding:['高拥挤','crowding'], badNews:['利空公告','badNews'],
  liquidity:['流动性风险','liquidityRisk'], mismatch:['周期错配','cycleMismatch'],
  chipPeak:['筹码峰','chipPeak'], trappedRatio:['上方套牢盘占比','trappedRatio'], chipTurn:['筹码交换程度','chipTurn'],
  intradayAt:['分时日期时间','timestamp','datetime']
};
function attr(row, key) { for (const alias of ALIASES[key]) if (Object.hasOwn(row, alias)) return row[alias]; return ''; }
function assertOHLC(row) {
  if (![row.open, row.high, row.low, row.close].every(x => known(x) && x > 0) ||
      row.high < Math.max(row.open, row.close) || row.low > Math.min(row.open, row.close))
    throw Error(`第${row.line}行 OHLC 不合法`);
  for (const key of ['volume','amount','turnover','volumeRatio']) if (known(row[key]) && row[key] < 0)
    throw Error(`第${row.line}行 ${key} 不合法`);
}
export function normalizeCSV(text, type = 'stock') {
  if (!['stock','sector','market','minute'].includes(type)) throw Error('未知CSV类型');
  const chinaToday = new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10);
  const rows = parseCSV(text).map(r => {
    const stamp = attr(r,'intradayAt');
    const date = day(attr(r,'date')||(type==='minute'?stamp.slice(0,10):'')), code = type === 'market' ? 'ALL_A' : ['stock','minute'].includes(type) ? attr(r,'code') : attr(r,'sector');
    if (!date || !code || (['stock','minute'].includes(type) && !/^\d{6}$/.test(code))) throw Error(`第${r.__line}行日期或代码无效`);
    if (date > chinaToday) throw Error(`第${r.__line}行属于未来交易日期，不可进入历史学习`);
    const out = {type, date, code, name:attr(r,'name'), period:attr(r,'period')||'日K',line:r.__line,
      open:n(attr(r,'open')), high:n(attr(r,'high')), low:n(attr(r,'low')), close:n(attr(r,'close')),
      volume:n(attr(r,'volume')), amount:n(attr(r,'amount')), turnover:n(attr(r,'turnover')),
      volumeRatio:n(attr(r,'volumeRatio')), sector:attr(r,'sector'), source:attr(r,'source')||null,
      asOf:attr(r,'asOf')||null, limitUp:n(attr(r,'limitUp')), leaderRank:n(attr(r,'leaderRank')),
      assistCount:n(attr(r,'assistCount')), tier:attr(r,'tier')||null,
      sectorStage:attr(r,'sectorStage')||null, sectorDays:n(attr(r,'sectorDays')),
      up:n(attr(r,'up')), down:n(attr(r,'down')), marketTrend:attr(r,'marketTrend')||null,
      support:attr(r,'support')||null, blackSwan:bool(attr(r,'blackSwan')),
      repeatable:bool(attr(r,'repeatable')), suspended:bool(attr(r,'suspended')), regulation:bool(attr(r,'regulation')),
      crowding:bool(attr(r,'crowding')), badNews:bool(attr(r,'badNews')),
      liquidity:bool(attr(r,'liquidity')), mismatch:bool(attr(r,'mismatch')),
      chipPeak:n(attr(r,'chipPeak')), trappedRatio:n(attr(r,'trappedRatio')),
      chipTurn:n(attr(r,'chipTurn')), intradayAt:attr(r,'intradayAt')||null};
    if (type === 'stock' && !['日K','day','1d','D'].includes(out.period)) throw Error(`第${r.__line}行非日K，分时CSV需独立分钟线验证`);
    if (type === 'minute') {
      if (!['1分钟','5分钟','1m','5m'].includes(out.period)) throw Error(`第${r.__line}行分时周期无效，禁止把5分钟冒充1分钟`);
      if (!new RegExp(`^${out.date}[ T]\\d{2}:\\d{2}`).test(stamp)) throw Error(`第${r.__line}行缺少同日分钟原始时刻`);
      const time=stamp.slice(11,16);if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) || !((time>='09:30'&&time<='11:30')||(time>='13:00'&&time<='15:00'))) throw Error(`第${r.__line}行不在A股分时交易时段`);
      out.time=time;
    }
    if (type === 'stock' || type === 'minute' || ['open','high','low','close'].every(x => out[x] !== null)) assertOHLC(out);
    if (type !== 'stock' && out.close !== null && out.close <= 0) throw Error(`第${r.__line}行指数或板块收盘价无效`);
    if (out.limitUp !== null && out.limitUp < out.close * 0.8) throw Error(`第${r.__line}行涨停价无效`);
    return out;
  });
  const seen = new Set();
  for (const r of rows) { const k = `${r.code}|${r.date}${type==='minute'?'|'+r.period+'|'+r.time:''}`; if (seen.has(k)) throw Error(`${type}存在重复键 ${k}`); seen.add(k); }
  return rows.sort((a,b)=>a.date.localeCompare(b.date)||a.code.localeCompare(b.code)||(a.time||'').localeCompare(b.time||''));
}
const avg = rows => rows.length && rows.every(known) ? rows.reduce((a,b)=>a+b,0)/rows.length : null;
const ratio = (a,b) => known(a)&&known(b)&&b>0 ? a/b : null;
const pct = (a,b) => known(a)&&known(b)&&b>0 ? round(100*(a/b-1)) : null;
function closeAtLimit(r) { return known(r?.limitUp) && known(r.close) ? Math.round(r.close*100) === Math.round(r.limitUp*100) : null; }
// A date prefix is not an evidence timestamp. Daily inputs must declare a valid,
// completed Shanghai session; this validates the declaration, not its provider.
function originalClock(row){
  if(!row?.source||typeof row.asOf!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(row.asOf)||!day(row.asOf.slice(0,10)))return NaN;
  return Date.parse(row.asOf);
}
function historyVisible(row,cutoff){
  const t=originalClock(row);
  return Number.isFinite(t)&&t>=Date.parse(row.date+'T15:00:00+08:00')&&t<=cutoff;
}
function completedEvidence(row,date,cutoff=Date.now()){
  return historyVisible(row,cutoff)&&new Date(originalClock(row)+8*3600000).toISOString().slice(0,10)===date;
}
const OUTCOME_NAMES = {'首板套利':'first-board','连板接力':'relay','断板反包':'reclaim','龙头首阴':'leader-red','弱转强':'weak-strong','二波启动':'second-wave','龙头战法':'leader'};
function features(rows,i,market,sector){
  const r=rows[i],prev=rows[i-1],max=Math.max(r.high-r.low,0.0000001),five=rows.slice(Math.max(0,i-4),i+1),ten=rows.slice(Math.max(0,i-9),i+1),twenty=rows.slice(Math.max(0,i-19),i+1),prior=rows.slice(Math.max(0,i-20),i),sixty=rows.slice(Math.max(0,i-59),i+1);
  const ma5=five.length===5?avg(five.map(x=>x.close)):null,ma10=ten.length===10?avg(ten.map(x=>x.close)):null,ma20=twenty.length===20?avg(twenty.map(x=>x.close)):null;
  const prevV=rows.slice(Math.max(0,i-5),i).map(x=>x.volume),rv=prevV.length===5?ratio(r.volume,avg(prevV)):null;
  let volumeTag=null;
  if(known(rv))volumeTag=rv>=3?'爆量':rv>=1.5?'放量':rv<.67?'缩量':'平量';
  const change=pct(r.close,prev?.close),body=pct(r.close,r.open),upper=(r.high-Math.max(r.open,r.close))/max,lower=(Math.min(r.open,r.close)-r.low)/max;
  let candle=known(body)?Math.abs(r.close-r.open)/max<.10?'十字星':body>=5?'大阳线':body<=-5?'大阴线':upper>=.5?'长上影':lower>=.5?'长下影':body>0?'阳线':'阴线':null;
  const gap=pct(r.open,prev?.close);if(known(gap)&&Math.abs(gap)>=1.5)candle+=(gap>0?' · 跳空高开':' · 跳空低开');
  const loc=sixty.length>=30&&sixty.every(x=>known(x.high)&&known(x.low))?ratio(r.close-Math.min(...sixty.map(x=>x.low)),Math.max(...sixty.map(x=>x.high))-Math.min(...sixty.map(x=>x.low))):null;
  const maState=[ma5,ma10,ma20].every(known)?ma5>ma10&&ma10>ma20?'多头排列':ma5<ma10&&ma10<ma20?'空头排列':'缠绕震荡':null;
  const platform=prior.length===20? r.close>Math.max(...prior.map(x=>x.high))*1.01?'突破':r.close<Math.min(...prior.map(x=>x.low))*.99?'破位':
     (Math.max(...prior.map(x=>x.high))/Math.min(...prior.map(x=>x.low))<1.12?'横盘箱体':'震荡') : null;
  const priceVolume=known(change)&&known(rv)?`${change>=0?'价涨':'价跌'}${rv>=1?'量增':'量缩'}`:null;
  const last4=rows.slice(Math.max(0,i-3),i+1).map(x=>x.volume);
  const volumeTrend=last4.length===4&&last4.every(known)? last4.every((v,j)=>j===0||v>last4[j-1]*1.05)?'持续放量':last4.every((v,j)=>j===0||v<last4[j-1]*.95)?'持续缩量':'非单边量能':null;
  const mtrend=market?.marketTrend||null,stage=sector?.sectorStage||null;
  const resonance=known(change)&&market&&sector&&known(market.close)&&known(sector.close)&&known(market.prevClose)&&known(sector.prevClose)
    ? change>0&&market.close>market.prevClose&&sector.close>sector.prevClose : null;
  const risk=[];
  for(const [key,label] of [['regulation','监管'],['crowding','高拥挤'],['badNews','利空公告'],['liquidity','流动性'],['mismatch','周期错配']])
    if(r[key]===true)risk.push(label);
  if(known(r.turnover)&&r.turnover>35)risk.push('换手异常');
  return {candle,body,change,gap,position:known(loc)?loc<.33?'低位':loc>.67?'高位':'中位':null,
    maState,ma5,ma10,ma20,maDistance5:pct(r.close,ma5),maDistance10:pct(r.close,ma10),maDistance20:pct(r.close,ma20),
    platform,volumeTag,volumeTrend,relativeVolume:rv,priceVolume,chipPeak:r.chipPeak,trappedRatio:r.trappedRatio,chipTurn:r.chipTurn,
    marketTrend:mtrend,marketAmount:market?.amount??null,advance:market?.up??null,decline:market?.down??null,
    indexSupport:market?.support??null,resonance,sectorStage:stage,sectorTier:sector?.tier??null,assistCount:sector?.assistCount??null,
    sectorDays:sector?.sectorDays??null,leaderRank:r.leaderRank,risk,priceBasis:'未经复权/成交可用性认证的导入观察价',
    stockSource:r.source,sectorSource:sector?.source??null,marketSource:market?.source??null};
}
function intradayEvidence(minuteBars,prev,limitUp) {
  if(!minuteBars?.length||!prev||!known(prev.close))return null;
  let seq=[...minuteBars].sort((a,b)=>a.time.localeCompare(b.time));
  const periods=[...new Set(seq.map(x=>x.period))];
  if(periods.length!==1)return null;
  const step=periods[0].includes('5')?5:1,size=240/step;
  // Declared start-stamped and end-stamped series both exist. Require a
  // complete grid of the chosen convention; an auction anchor is separate.
  if(seq.length===size+1&&seq[0].time==='09:30')seq=seq.slice(1);
  const offset=seq[0]?.time==='09:30'?0:step;
  if(seq.length!==size||!seq.every((r,i)=>{
    const minute=(i<size/2?570:780)+(i%(size/2))*step+offset;
    return r.time===String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
  }))return null;
  const low=Math.min(...seq.filter(x=>x.time<='13:30').map(x=>x.low));
  const intermediate=seq.filter(x=>x.time>='10:30'&&x.time<='14:00');
  const half=known(limitUp)&&intermediate.some(x=>x.close>=prev.close*1.03&&x.close<limitUp*.99);
  const late=seq.filter(x=>x.time>='14:30'),early=seq.filter(x=>x.time<'14:30');
  const earlyVolume=avg(early.map(x=>x.volume)),lateVolume=avg(late.map(x=>x.volume));
  const finish=seq.at(-1).close;
  return {period:periods[0],bars:seq.length,coverage:'原始分时覆盖检查通过，未独立认证源',
    lowBuy:low<=prev.close*.98&&finish>=prev.close*1.005,half:half===true,
    tail:late.length>=5&&known(earlyVolume)&&known(lateVolume)&&lateVolume>earlyVolume*1.5&&finish>late[0].open*1.01};
}
function candidateSignals(rows,i,f,intraday){
  const r=rows[i],p=rows[i-1],p2=rows[i-2],p3=rows[i-3],seals=closeAtLimit(r),prevSeal=closeAtLimit(p),twoSeal=closeAtLimit(p2),threeSeal=closeAtLimit(p3);
  const out=[],add=(name,phase,why)=>out.push({name,key:OUTCOME_NAMES[name],phase,why,verification:'收盘形态候选，未经完整战法原生评估器确认'});
  if(seals===true&&prevSeal===false&&known(f.relativeVolume)&&f.relativeVolume>=1.2)add('首板套利','确认信号','首板封收盘涨停且放量');
  if(seals===true&&prevSeal===true&&twoSeal===true)add('连板接力','加速信号','连续涨停收盘，未确认次日可成交');
  if(twoSeal===true&&prevSeal===false&&known(f.change)&&f.change>=3&&r.close>p.high&&known(f.relativeVolume)&&f.relativeVolume>=1)add('断板反包','确认信号','前期封板、断板后放量越过昨日高点');
  if(prevSeal===true&&twoSeal===true&&r.close<r.open&&r.leaderRank===1)add('龙头首阴','试错信号','连板后的首阴与当日龙头名次为导入声明');
  if(known(f.body)&&f.body>=2&&known(p?.open)&&p.close<p.open&&known(f.gap)&&f.gap>0.5&&known(f.relativeVolume)&&f.relativeVolume>=1.3)add('弱转强','确认信号','昨日阴线、今日高开并放量收强，仅收盘可知');
  if(f.platform==='突破'&&f.maState==='多头排列'&&known(f.relativeVolume)&&f.relativeVolume>=1.5)add('二波启动','试错信号','量价突破与多头均线，尚需独立核实二波结构');
  if(r.leaderRank===1&&f.sectorStage==='发酵'&&known(f.relativeVolume)&&f.relativeVolume>=1.5&&seals===true)add('龙头战法','确认信号','导入的龙头辨识与同期题材发酵、收盘封板');
  if(intraday?.half)add('半路','试错信号','完整分时记录出现中途强势，未核实当时撮合与板块领先性');
  if(intraday?.lowBuy&&f.sectorStage!=='退潮')add('分歧低吸','试错信号','盘中低点与收盘修复，仅事后形态，不代表可成交低点');
  if(intraday?.tail)add('尾盘套利','试错信号','尾段成交量增与价格改善，未认证尾盘可成交性');
  return out;
}
function excursions(rows, i, horizon, marketTradingDays, dayIndex, barsByDate, marketByDate) {
  // A stock can suspend for days. N following stock bars are NOT necessarily N
  // market trading days. Require corresponding stock OHLC for every market date.
  const at=dayIndex.get(rows[i].date);
  if(at===undefined||at+horizon>=marketTradingDays.length)return null;
  const after=marketTradingDays.slice(at+1,at+horizon+1).map(d=>barsByDate.get(d));
  if(after.some(x=>!x||x.suspended===true||x.volume===0||!completedEvidence(x,x.date)||!completedEvidence(marketByDate.get(x.date),x.date)))return null;
  const base=rows[i].close,high=Math.max(...after.map(x=>x.high)),low=Math.min(...after.map(x=>x.low));
  let peak=base,draw=0;
  for(const x of after){peak=Math.max(peak,x.close);draw=Math.max(draw,100*(peak-x.close)/peak);}
  return {horizon,containsShock:after.some(x=>x.blackSwan===true||x.repeatable===false),
    knownAt:new Date(Math.max(...after.flatMap(x=>[originalClock(x),originalClock(marketByDate.get(x.date))]))).toISOString(),
    endDate:after.at(-1).date,highestPct:pct(high,base),lowestPct:pct(low,base),closePct:pct(after.at(-1).close,base),
    pathMaxDrawdownPct:round(draw),drawdownBasis:'仅每日收盘价的峰谷回撤（非日内最大回撤）',
    calendarBasis:'导入全A日期序列，尚未由权威交易日历独立校准',entry:'信号收盘价观察基准，无次日成交模拟',
    sealed:null,closedAtLimit:closeAtLimit(after[0]),broken:closeAtLimit(rows[i])===null||closeAtLimit(after[0])===null?null:closeAtLimit(rows[i])===true&&closeAtLimit(after[0])===false,
    rebound:null,secondWave:null,limitDownCrash:null};
}
function indexed(rows) { const by=new Map();for(const r of rows){if(!by.has(r.code))by.set(r.code,[]);by.get(r.code).push(r);}return by; }
export function labelHistory(stocks, sectors = [], markets = [], minutes = [],{decisionAt,deferWindow=false}={}) {
  if (!Array.isArray(stocks)||!stocks.length)throw Error('需要至少一条历史日K');
  const sectorMap=indexed(sectors),minuteMap=new Map();
  for(const x of minutes){const key=`${x.code}|${x.date}`;if(!minuteMap.has(key))minuteMap.set(key,[]);minuteMap.get(key).push(x);}
  const marketRows=[...markets].sort((a,b)=>a.date.localeCompare(b.date));
  for(let i=0;i<marketRows.length;i++)marketRows[i]={...marketRows[i],prevClose:i&&historyVisible(marketRows[i-1],originalClock(marketRows[i]))?marketRows[i-1].close:null};
  const mm=new Map(marketRows.map(x=>[x.date,x]));
  const marketTradingDays=marketRows.map(x=>x.date),dayIndex=new Map(marketTradingDays.map((d,i)=>[d,i]));
  const sc=new Map();for(const [key,rows] of sectorMap){const sorted=[...rows].sort((a,b)=>a.date.localeCompare(b.date));sc.set(key,new Map(sorted.map((r,i)=>[r.date,{...r,prevClose:i&&historyVisible(sorted[i-1],originalClock(r))?sorted[i-1].close:null}])));}
  const samples=[];
  for(const [code,rows] of indexed(stocks)){
    rows.sort((a,b)=>a.date.localeCompare(b.date));
    const barsByDate=new Map(rows.map(x=>[x.date,x]));
    for(let i=0;i<rows.length;i++){
      const r=rows[i],at=decisionAt?.get(r.date)??originalClock(r);
      const certified=completedEvidence(r,r.date,at)&&Number.isFinite(at)&&at<=Date.now();
      const contextBefore=row=>certified&&completedEvidence(row,r.date,at)?row:null;
      const m=contextBefore(mm.get(r.date)),s=contextBefore(sc.get(r.sector)?.get(r.date));
      const past=[];
      for(let j=i-1;certified&&j>=0&&past.length<60;j--)if(historyVisible(rows[j],at))past.push(rows[j]);
      const current=certified?r:{date:r.date,open:r.open,high:r.high,low:r.low,close:r.close,volume:r.volume,source:r.source};
      const series=past.reverse().concat(current),last=series.length-1;
      const f=features(series,last,m,s);
      const supplied=minuteMap.get(code+'|'+r.date)||[];
      const usable=certified?supplied.filter(x=>x.source&&(!x.asOf||
        originalClock(x)>=Date.parse(x.date+'T'+x.time+':00+08:00')&&originalClock(x)<=at)):[];
      const intraday=intradayEvidence(usable,series[last-1],r.limitUp);
      // A bar timestamp is an exchange observation, not proof of receipt.
      // Time-only minute CSVs remain viewable; candidate rules require receipts.
      if(intraday)intraday.receiptsVerified=usable.every(x=>Number.isFinite(originalClock(x)));
      const risk=f.risk,quality=r.blackSwan===true?'black-swan':r.repeatable===true&&r.blackSwan===false&&r.suspended!==true&&r.volume!==0&&m&&s?'standard':'pending-review';
      samples.push({id:code+'|'+r.date,code,name:r.name,date:r.date,bar:{...r},sector:s,market:m,
        signalAvailableAt:certified?new Date(at).toISOString():null,
        labels:{...f,intraday:intraday||null},signals:certified?candidateSignals(series,last,f,intraday?.receiptsVerified?intraday:null):[],
        risk,quality,observed:HORIZONS.map(n=>certified?excursions(rows,i,n,marketTradingDays,dayIndex,barsByDate,mm):null),
        history:series.slice(-20).map(b=>({date:b.date,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume}))});
    }
  }
  samples.sort((a,b)=>a.date.localeCompare(b.date)||a.code.localeCompare(b.code));
  return deferWindow?samples:debounceLearningSamples(samples,stocks);
}
export function debounceLearningSamples(samples,bars,{isVisible=historyVisible}={}){
  const groups=indexed(bars),timelines=new Map(),width=settingsAt({}).debounceBars;
  return samples.map(sample=>{
    if(!sample.signals.length)return sample;
    if(!timelines.has(sample.code)){
      const series=groups.get(sample.code).slice().sort((a,b)=>a.date.localeCompare(b.date));
      timelines.set(sample.code,{series,index:new Map(series.map((b,i)=>[b.date,i])),accepted:new Map()});
    }
    const {series,index,accepted}=timelines.get(sample.code);
    const {keep,suppressed}=selectSignalWindow(sample.signals.map(x=>x.name),index.get(sample.date),series,accepted,Date.parse(sample.signalAvailableAt),width,isVisible);
    return {...sample,signals:sample.signals.filter(x=>keep.includes(x.name)),debounceBars:width,suppressedStrategies:suppressed};
  });
}
export function applyCorrections(samples, corrections = []) {
  const bySample=new Map();
  for(const x of corrections){
    if(!x||!/^\d{6}\|\d{4}-\d{2}-\d{2}$/.test(x.id)||typeof x.strategy!=='string'||!x.reason?.trim()||!['add','remove'].includes(x.action))throw Error('人工修正缺少样本、战法、动作或原因');
    if(!bySample.has(x.id))bySample.set(x.id,new Map());
    bySample.get(x.id).set(x.strategy,x);
  }
  return samples.map(s=>{
    let signals=s.signals.map(x=>({...x}));
    const local=bySample.get(s.id);
    for(const c of local?.values()||[]){
      const existing=signals.find(x=>x.name===c.strategy);
      if(c.action==='remove')signals=signals.filter(x=>x.name!==c.strategy);
      else if(!existing)signals.push({name:c.strategy,key:'manual',phase:'人工校正',why:c.reason,verification:'人工标注，未独立核验'});
    }
    return {...s,signals,...(local?.size?{hasRetrospectiveAnnotation:true}:{})};
  });
}
const wilson=(win,total)=>{if(!total)return null;const p=win/total,z=1.96,den=1+z*z/total,mid=(p+z*z/(2*total))/den,margin=z*Math.sqrt((p*(1-p)+z*z/(4*total))/total)/den;return {lowPct:round(100*(mid-margin),2),highPct:round(100*(mid+margin),2)};};
function summarize(rows,horizon=3){
  const trades=rows.map(s=>({sample:s,outcome:s.observed.find(o=>o?.horizon===horizon)})).filter(x=>x.outcome);
  const wins=trades.filter(x=>x.outcome.closePct>0).length, pos=trades.reduce((sum,x)=>sum+Math.max(0,x.outcome.closePct),0),neg=trades.reduce((sum,x)=>sum+Math.max(0,-x.outcome.closePct),0);
  const returns=trades.map(x=>x.outcome.closePct).sort((a,b)=>a-b),winReturns=returns.filter(x=>x>0),lossReturns=returns.filter(x=>x<0);
  const distribution=Object.fromEntries([['≤-10%',x=>x<=-10],['-10%~-5%',x=>x>-10&&x<=-5],['-5%~0%',x=>x>-5&&x<=0],['0%~5%',x=>x>0&&x<=5],['5%~10%',x=>x>5&&x<=10],['>10%',x=>x>10]].map(([key,where])=>[key,returns.filter(where).length]));
  return {total:rows.length,matured:trades.length,winRatePct:trades.length?round(100*wins/trades.length,2):null,
    winRate95: wilson(wins,trades.length),averagePct:trades.length?round(avg(trades.map(x=>x.outcome.closePct)),3):null,
    profitFactor:neg?round(pos/neg,3):null,payoffRatio:lossReturns.length&&winReturns.length?round(avg(winReturns)/Math.abs(avg(lossReturns)),3):null,
    minPct:returns.length?returns[0]:null,p10Pct:returns.length?returns[Math.floor((returns.length-1)*.1)]:null,
    medianPct:returns.length?returns[Math.floor((returns.length-1)*.5)]:null,distribution,loss5Pct:trades.length?round(100*trades.filter(x=>x.outcome.closePct<=-5).length/trades.length,2):null,
    maxPathDrawdownPct:trades.length?round(Math.max(...trades.map(x=>x.outcome.pathMaxDrawdownPct)),2):null,
    period:horizon,note:'观察收益：信号收盘为基准，不含成交、交易成本与账户最大回撤'};
}
export function freezeSplit(samples,{embargo=5}={}){
  if(!Number.isInteger(embargo)||embargo<0||embargo>20)throw Error('统计参数无效');
  const dates=[...new Set(samples.map(s=>s.date))].sort(),at=Math.floor(dates.length*.8);
  return Object.freeze({trainingEnd:dates[Math.max(0,at-embargo-1)]||null,holdoutStart:dates[at]||null,embargoTradingDates:embargo});
}
export function analyzeFactors(samples,{horizon=3,minimum=20,embargo=5,split}={}){
  if(!HORIZONS.includes(horizon)||!Number.isInteger(minimum)||minimum<1||!Number.isInteger(embargo)||embargo<0||embargo>20)throw Error('统计参数无效');
  const boundaries=split??freezeSplit(samples,{embargo}),{trainingEnd:trainEnd,holdoutStart:cut}=boundaries;
  if(!Number.isInteger(boundaries.embargoTradingDates)||boundaries.embargoTradingDates<0||boundaries.embargoTradingDates>20||
    (samples.length&&(!day(trainEnd)||!day(cut)||trainEnd>cut)))throw Error('冻结样本外区间无效');
  const valid=samples.filter(s=>s.quality==='standard' && s.signals.length && s.observed.find(o=>o?.horizon===horizon&&!o.containsShock));
  const train=valid.filter(s=>s.date<trainEnd&&s.observed.find(o=>o?.horizon===horizon)?.endDate<trainEnd),holdout=valid.filter(s=>s.date>=cut);
  const allSignals=samples.filter(s=>s.signals.length);
  const groups=(items, keyFn)=>{
    const by=new Map();for(const s of items)for(const key of [...new Set(keyFn(s).filter(Boolean))]){if(!by.has(key))by.set(key,[]);by.get(key).push(s);}
    return [...by].map(([key,rows])=>({key,...summarize(rows,horizon),qualified:rows.length>=minimum})).sort((a,b)=>b.matured-a.matured||a.key.localeCompare(b.key));
  };
  const factorKeys=s=>[
    ...s.signals.map(x=>`战法:${x.name}`),`K形态:${s.labels.candle}`,`量能:${s.labels.volumeTag}`,
    `量价:${s.labels.priceVolume}`,`市场:${s.labels.marketTrend}`,`题材:${s.labels.sectorStage}`,
    `共振:${s.labels.resonance===null?'未知':s.labels.resonance?'有':'无'}`,
    ...s.risk.map(x=>`风险:${x}`)];
  const combos=s=>s.signals.map(x=>`${x.name} × ${s.labels.candle||'未知K'} × ${s.labels.volumeTag||'未知量'} × ${s.labels.marketTrend||'未知市'} × ${s.labels.sectorStage||'未知题材'}`);
  const factors=groups(train,factorKeys),combinations=groups(train,combos),outSample=groups(holdout,factorKeys);
  const baseWin=summarize(train,horizon).winRatePct;
  const researchWeights=factors.map(x=>({...x,shadowWeight: x.matured>=minimum && baseWin!==null && x.winRatePct!==null
      ? round(Math.max(-.3,Math.min(.3, (x.winRatePct-baseWin)/100 * x.matured/(x.matured+50))),4):null,
      note:'探索性经验差异，仅训练窗生成；无实盘权重写入'}));
  const negatives=factors.concat(combinations).filter(x=>x.matured>=minimum&&x.loss5Pct>=30).map(x=>({...x,warning:'历史高亏损关联，不等于因果关系'}));
  const annotated=samples.some(s=>s.hasRetrospectiveAnnotation);
  return {schemaVersion:1,canTrade:false,productionWeightsChanged:false,verifiedLive:false,eligibleForPromotion:false,
    studyBasis:annotated?'人工事后标注的教学对照':'自动候选收盘价观察',
    trainingUsesRetrospectiveAnnotations:annotated,
    horizon,minimum,split:{trainingEnd:trainEnd,holdoutStart:cut,embargoTradingDates:boundaries.embargoTradingDates},
    counts:{bars:samples.length,signalBars:allSignals.length,blackSwans:samples.filter(x=>x.quality==='black-swan').length,
      pending:samples.filter(x=>x.quality==='pending-review').length,training:train.length,holdout:holdout.length},
    descriptive:summarize(allSignals,horizon),training:summarize(train,horizon),outOfSample:summarize(holdout,horizon),
    factors:researchWeights,combinations,negativeCombinations:negatives,holdoutFactors:outSample,
    limitations:[...(annotated?['本次显式传入经人工修改的研究集，仅用于事后教学比较，结果不得用于训练或晋级']:[]),'黑天鹅与待人工复核质量样本不参与研究权重','统计因子只基于事前信息，后续标签只作结果','有重叠持有期的样本，非独立交易','后续N日依据导入全A交易日期序列；股票停牌或无对应K线则结果未知' ,'权重只用于研究展示，不写生产策略','缺失的筹码/分钟线/市场/板块字段保持未知','未认证源与未复权可成交价格不能用于生产验证']};
}
