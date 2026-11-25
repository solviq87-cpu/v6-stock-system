const finite=value=>typeof value==='number'&&Number.isFinite(value);
const time=value=>Number.isSafeInteger(value)&&value>0;
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
 Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;

// A mini chart is still data: its receipt must identify the security, basis and
// actual retrieval time. It cannot borrow a decision's current quote clock.
export function readDecisionMiniKline(result,{code,day,now=Date.now()}={}){
 if(!validDay(day)||result?.ok!==true||result.code!==code)throw Error('日 K 返回的股票或请求状态不一致');
 const evidence=result.dataQuality||{},source=evidence.source||result.source,receivedAt=evidence.receivedAt;
 if(typeof source!=='string'||!source.trim())throw Error('日 K 缺少原始数据源');
 if(/synthetic|fixture|mock|demo/i.test(source)||['synthetic','mock','fixture','simulated'].some(key=>result[key]===true||evidence[key]===true))throw Error('日 K 为演示或模拟来源，未用于决策卡');
 if(!time(receivedAt))throw Error('日 K 缺少原始抓取时点');
 if(receivedAt>now)throw Error('日 K 抓取时点位于未来');
 if(evidence.priceBasis!=='qfq')throw Error('日 K 未核实为前复权口径');
 const byDay=new Map();
 for(const row of result.rows||result.data||[]){
  if(!validDay(row?.date)||row.date>day)continue;
  if(!['open','close','high','low'].every(key=>finite(row[key])&&row[key]>0)||row.high<Math.max(row.open,row.close)||
   row.low>Math.min(row.open,row.close)||row.high<row.low)throw Error('日 K 存在不完整或相互矛盾的价位');
  if(Date.parse(row.date+'T00:00:00+08:00')>receivedAt||row.knownAt!=null&&(!time(row.knownAt)||row.knownAt>now||row.knownAt>receivedAt))throw Error('日 K 交易日与原始可得时点不一致');
  const prior=byDay.get(row.date);
  if(prior&&['open','close','high','low'].some(key=>prior[key]!==row[key]))throw Error('同一交易日的日 K 存在冲突');
  byDay.set(row.date,row);
 }
 const rows=[...byDay.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-24);
 if(!rows.length)throw Error('本股在所选日期之前没有可核实日 K');
 return {rows,source,receivedAt,priceBasis:'qfq',sourceTimeKind:'dated-daily-bars'};
}
