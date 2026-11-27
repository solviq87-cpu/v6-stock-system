const finite=value=>typeof value==='number'&&Number.isFinite(value);
const time=value=>Number.isSafeInteger(value)&&value>0&&value<8e15;
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
 Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const artificial=/simulat|synthetic|fixture|mock|demo/i;
const flags=['synthetic','mock','fixture','simulated'];
const identityFields=['open','close','high','low','volume','amount','code','source','priceBasis','knownAt','availableAt'];
const sourceText=v=>typeof v==='string'&&v.trim()&&!artificial.test(v);
// Legacy knownAt is an integer receipt. An explicitly supplied availableAt
// may additionally be an ISO timestamp with its original UTC offset.
function availableTime(value){
 if(time(value))return value;
 if(typeof value!=='string'||!validDay(value.slice(0,10))||
  !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return NaN;
 const at=Date.parse(value);return time(at)?at:NaN;
}

// A mini chart is still data: its receipt must identify the security, basis and
// actual retrieval time. It cannot borrow a decision's current quote clock.
export function readDecisionMiniKline(result,{code,day,now=Date.now()}={}){
 if(!time(now)||!validDay(day)||day>new Date(now+28800000).toISOString().slice(0,10)||
  typeof code!=='string'||!/^\d{6}$/.test(code)||result?.ok!==true||result.code!==code)throw Error('日 K 返回的股票、日期或请求状态不一致');
 const evidence=result.dataQuality||{},source=evidence.source||result.source,receivedAt=evidence.receivedAt;
 if(typeof source!=='string'||!source.trim())throw Error('日 K 缺少原始数据源');
 if(!sourceText(source)||result.source!=null&&!sourceText(result.source)||flags.some(key=>result[key]===true||evidence[key]===true))
  throw Error('日 K 为演示或模拟来源，未用于决策卡');
 if(!time(receivedAt))throw Error('日 K 缺少原始抓取时点');
 if(receivedAt>now)throw Error('日 K 抓取时点位于未来');
 if(evidence.priceBasis!=='qfq'||result.priceBasis!=null&&result.priceBasis!=='qfq')throw Error('日 K 未核实为前复权口径');
 if(result.receivedAt!=null&&result.receivedAt!==receivedAt)throw Error('日 K 原始抓取时点冲突');
 const input=result.rows??result.data;
 if(!Array.isArray(input))throw Error('日 K 缺少有效历史记录');
 const byDay=new Map();
 for(const row of input){
  if(!validDay(row?.date))throw Error('日 K 日期无效');
  if(row.date>day)continue;
  if(row.code!=null&&row.code!==code||row.priceBasis!=null&&row.priceBasis!=='qfq'||
   row.source!=null&&!sourceText(row.source)||flags.some(key=>row[key]===true))throw Error('日 K 逐行证券、来源或价格口径冲突');
  if(!['open','close','high','low'].every(key=>finite(row[key])&&row[key]>0)||row.high<Math.max(row.open,row.close)||
   row.low>Math.min(row.open,row.close)||row.high<row.low)throw Error('日 K 存在不完整或相互矛盾的价位');
  const start=Date.parse(row.date+'T00:00:00+08:00'),available=row.availableAt==null?null:availableTime(row.availableAt);
  if(start>receivedAt||row.knownAt!=null&&(!time(row.knownAt)||row.knownAt<start||row.knownAt>receivedAt)||
   available!==null&&(!time(available)||available<start||available>receivedAt||row.knownAt!=null&&available<row.knownAt))
   throw Error('日 K 交易日与原始可得时点不一致');
  const prior=byDay.get(row.date);
  if(prior&&identityFields.some(key=>(prior[key]??null)!==(row[key]??null)))throw Error('同一交易日的日 K 存在冲突');
  if(!prior)byDay.set(row.date,row);
 }
 const rows=[...byDay.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-24);
 if(!rows.length)throw Error('本股在所选日期之前没有可核实日 K');
 return {rows,source,receivedAt,priceBasis:'qfq',sourceTimeKind:'dated-daily-bars'};
}
