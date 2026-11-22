import {isTestSample,sampleMatches} from './sample-quality.mjs';

export const qualityOptions={all:'全部质量',standard:'标准样本',blackSwan:'仅黑天鹅',extreme:'仅极端行情',excludeBlackSwan:'排除黑天鹅',excludeExtreme:'排除极端行情'};
export const setOptions={all:'全部样本集',research:'正式研究',test:'测试样本'};
export const flatTemplates=['情绪退潮回避','指数破位回避','连续亏损停手','事件或假期风险','没有模式内机会','其他已记录原因'];
const array=v=>Array.isArray(v)?v:[];
const wall=t=>new Date(t+8*36e5).toISOString().slice(0,16).replace('T',' ');
const dateOK=d=>typeof d==='string'&&/^\d{4}-\d\d-\d\d$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const f=v=>typeof v==='number'&&Number.isFinite(v);
const identity={'000985':'中证全指','000001':'上证指数','399006':'创业板指'};
export const benchNames=identity;
export function selectedSample(row,quality='all',set='all'){
 if(!Object.hasOwn(qualityOptions,quality)||!Object.hasOwn(setOptions,set))return false;
 return sampleMatches(row,quality)&&(set==='all'||isTestSample(row)===(set==='test'));
}
export const sampleLabel=r=>isTestSample(r)?'测试样本':(r.sampleSet==='real'?'正式研究':r.sampleSet)||r.sourceSet||'正式研究';
export const recordSource=r=>r.sampleSource||r.source||r.sourceType||r.sourceSet||'人工研究记录';
const closed=t=>String(t.exitTime||t.exitDate||t.date||'').slice(0,10);
const pct=(d,p)=>(d/p-1)*100;
export function flatBenchmark(state,record,asOf=Date.now()){
 const {start,end,benchmark}=record,market=new Map();
 const remarks={name:identity[benchmark],start,end,basis:'区间首日开盘至末日收盘；收盘序列峰谷回撤'};
 if(!remarks.name||!dateOK(start)||!dateOK(end)||start>end||!Number.isFinite(asOf))return {...remarks,reason:'区间或指数无效'};
 const add=(b,source,knownAt)=>{
  if(!dateOK(b.date)||b.date<start||b.date>end||!source||!Number.isSafeInteger(knownAt)||knownAt>asOf||
      knownAt<Date.parse(b.date+'T15:00:00+08:00')||!f(b.close)||b.close<=0)return;
  if(!market.has(source))market.set(source,new Map());const byDay=market.get(source),prev=byDay.get(b.date);
  if(!prev||knownAt>prev.knownAt)byDay.set(b.date,{date:b.date,open:b.open,close:b.close,knownAt});
 };
 for(const b of array(state.bars))if(b.role==='index'&&b.period==='日K'&&b.code===benchmark&&isTestSample(b)===isTestSample(record)&&(!b.priceBasis||b.priceBasis==='unadjusted'))add(b,b.source,b.knownAt);
 if(benchmark==='000985'&&!isTestSample(record))for(const m of [...array(state.marketHistory),...array(state.market)]){
  const e=m.indexEvidence;if(!e||!/^中证全指(?:指数)?$/.test(e.name||''))continue;
  for(const b of array(e.rows))add(b,e.source,e.receivedAt);
 }
 const valid=[...market].map(([source,series])=>({source,rows:[...series.values()].sort((a,b)=>a.date.localeCompare(b.date))}))
  .filter(r=>r.rows[0]?.date===start&&r.rows.at(-1)?.date===end&&f(r.rows[0].open)&&r.rows[0].open>0)
  .sort((a,b)=>b.rows.length-a.rows.length||a.source.localeCompare(b.source));
 if(!valid.length)return {...remarks,reason:'未取得同源的区间首日开盘与末日收盘'};
 const {rows,source}=valid[0];let peak=rows[0].open,dd=0;
 for(const b of rows){peak=Math.max(peak,b.close);dd=Math.max(dd,(1-b.close/peak)*100);}
 return {...remarks,source,knownAt:Math.max(...rows.map(r=>r.knownAt)),observed:rows.length,returnPct:pct(rows.at(-1).close,rows[0].open),sampledDrawdownPct:dd};
}
export function flatConflicts(state,record){
 const test=state.scope==='demo'||isTestSample(record);
 return array(state.trades).filter(t=>isTestSample(t)===test&&String(t.entryTime||t.date||'').slice(0,10)<=record.end&&closed(t)>=record.start);
}
export function journalAction(state,action,p){
 if(action!=='journal:flat')throw Error('未知日志操作');
 if(!dateOK(p.start)||!dateOK(p.end)||p.start>p.end||p.end+' 15:00'>wall(Date.now()))throw Error('请选择已收盘的空仓起止交易日');
 if(!flatTemplates.includes(p.template)||!Object.hasOwn(identity,p.benchmark))throw Error('请选择空仓模板和基准指数');
 const reason=String(p.reason||'').trim(),watch=String(p.watch||'').trim();
 if(!reason||reason.length>1000||watch.length>1000)throw Error('请填写 1 至 1000 字空仓原因，观察条件最多 1000 字');
 if(array(state.flatRecords).some(r=>r.start<=p.end&&r.end>=p.start))throw Error('相同日期已含空仓记录，无法重复计算');
 if(flatConflicts(state,p).length)throw Error('已登记交易与该区间重叠，需先核对持仓');
 let reportedPnl=null;
 if(p.reportedPnl!=null&&String(p.reportedPnl).trim()!==''){
  if(!/^-?\d+(\.\d{1,2})?$/.test(String(p.reportedPnl))||Math.abs(Number(p.reportedPnl))>1e12)throw Error('手记账户盈亏金额无效');
  reportedPnl=Number(p.reportedPnl);
 }
 const r={id:crypto.randomUUID(),start:p.start,end:p.end,benchmark:p.benchmark,template:p.template,reason,watch,reportedPnl,source:'人工空仓手记',sampleSet:state.scope==='demo'?'test':'real',createdAt:new Date().toISOString()};
 (state.flatRecords||=[]).push(r);return r;
}
export function flatLines(state,record,asOf=Date.now()){
 const b=flatBenchmark(state,record,asOf),conflicts=flatConflicts(state,record);
 const txt=[record.start+' 至 '+record.end+' · '+record.template+' · '+record.reason,
  '记录来源 '+record.source+'；录入 '+record.createdAt+(conflicts.length?'；与随后归档的 '+conflicts.length+' 笔交易区间重叠，请核查':'；现有交易样本没有覆盖该区间的持仓记录'),
  '账户盈亏（人工自报） '+(f(record.reportedPnl)?record.reportedPnl.toFixed(2)+' 元':'未填写')];
 txt.push(b.reason?'指数反事实 · '+b.reason:'空仓对照 · '+b.name+' 区间变动 '+b.returnPct.toFixed(2)+'%，观察到的收盘峰谷回撤 '+b.sampledDrawdownPct.toFixed(2)+'%。首日开盘为起点，覆盖 '+b.observed+' 个交易日收盘，来源 '+b.source+'，取得 '+wall(b.knownAt)+'。该回撤仅为持有指数的情景结果。');
 if(record.watch)txt.push('恢复观察条件 · '+record.watch);
 return txt;
}
