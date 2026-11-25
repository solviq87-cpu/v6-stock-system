// Read-only sector evidence shared by the selected decision and market views.
// Receipt time is never promoted to an upstream funds timestamp.
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const list=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'?value.trim():'';
const time=(value,now)=>Number.isSafeInteger(value)&&value>0&&value<=now;
const provider=value=>['eastmoney','em','东方财富'].includes(text(value).toLowerCase())?'eastmoney':null;
export function sectorDay(value){
 const day=text(value).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),at=Date.parse(day+'T00:00:00Z');
 return /^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(at)&&new Date(at).toISOString().slice(0,10)===day?day:null;
}
function rowKey(row){return text(row.code)||text(row.name||row.sector);}
function classification(selection){
 const row=selection?.row||{},boards=list(row.boards);
 return {names:new Set([row.sector,row.industry,...list(row.themes),...list(row.concepts),...boards.map(b=>b?.name)].map(text).filter(Boolean)),
  codes:new Set([row.sectorCode,row.industryCode,...list(row.sectorCodes),...boards.map(b=>b?.code)].map(text).filter(Boolean))};
}
const matches=(row,membership)=>membership.names.has(text(row.name||row.sector))||membership.codes.has(text(row.code));

export function projectSectorFlows(state={}, {day:requested,now=Date.now()}={}){
 const day=sectorDay(requested),dates=[state.sectorsDay,state.snapshotFieldDays?.sectors].filter(v=>v!=null&&v!=='');
 const known=dates.map(sectorDay),sourceDay=known[0]||null,missing=[];
 if(!day)missing.push('缺少要核对的板块交易日');
 if(!dates.length)missing.push('板块资金原始交易日缺失');
 else if(known.some(d=>!d)||new Set(known).size!==1)missing.push('板块资金快照交易日缺失或相互冲突');
 else if(sourceDay!==day)missing.push('板块资金 '+sourceDay+' 与所选交易日 '+day+' 不同日');
 if(day&&day>new Date(now+28800000).toISOString().slice(0,10))missing.push('所选板块交易日尚未开始');
 const original=Array.isArray(state.sectors)?state.sectors:list(state.sectors?.items),rows=[],rejected=[];
 if(missing.length)return {day,sourceDay,rows,rejected,missing,status:'missing',total:original.length};
 const industry=new Set(list(state.sectorsInd).map(row=>row?.code));
 const duplicates=new Map();
 for(const row of original){
  if(!row||typeof row!=='object')continue;
  const name=text(row.name||row.sector),code=text(row.code),issues=[];
  if(!name)issues.push('板块名称缺失');
  const sources=[row.source,row.upstream].filter(v=>v!=null&&v!=='').map(provider);
  if(!sources.length||sources.some(v=>!v))issues.push('资金来源缺失或不属于已知板块资金口径');
  const units=[row.fundsUnit,row.unit].filter(v=>v!=null&&v!=='');
  if(!units.length||units.some(v=>v!=='CNY'))issues.push('资金单位缺失或不是人民币元');
  if(row.fundsMethod!=='vendor-order-size-estimate')issues.push('主力资金统计口径缺失');
  if(!time(row.retrievedAt,now)||row.retrievedAt<Date.parse(day+'T00:00:00+08:00'))issues.push('资金实际取得时点缺失或无效');
  const rowDates=[row.tradeDate,row.date].filter(v=>v!=null&&v!=='');
  if(rowDates.some(value=>sectorDay(value)!==day))issues.push('板块行交易日与快照不一致');
  if(row.sourceTimestamp!=null&&(!time(row.sourceTimestamp,row.retrievedAt)||
    new Date(row.sourceTimestamp+28800000).toISOString().slice(0,10)!==day))issues.push('源端资金时刻无效或日期不一致');
  if(['synthetic','fixture','mock','simulated'].some(key=>row[key]===true))issues.push('资金记录不是可展示的原始观测');
  const amounts=['mainInflowYuan','netInflowYuan','mainInflow'].map(key=>row[key]).filter(v=>v!=null);
  if(!amounts.length||amounts.some(v=>!finite(v)))issues.push('主力净额缺失或不是已核对数值');
  else if(new Set(amounts).size!==1)issues.push('同一资金行的金额字段相互冲突');
  if(issues.length){rejected.push({code,name,missing:issues});continue;}
  const kind=industry.has(code)||['industry','行业'].includes(row.category||row.kind)?'industry':
   ['concept','theme','概念'].includes(row.category||row.kind)?'theme':'unknown';
  const result={key:rowKey(row),code,name,kind,value:amounts[0],pct:finite(row.pct)?row.pct:null,
   day,source:'eastmoney',unit:'CNY',method:row.fundsMethod,retrievedAt:row.retrievedAt,
   sourceTimestamp:row.sourceTimestamp??null,dateBasis:text(row.dateBasis)||
    (rowDates.length?'供应商原始交易日':'既有板块快照归属日；供应商未提供逐行交易日'),raw:row};
  const previous=duplicates.get(result.key);
  if(previous&&JSON.stringify({...previous,raw:null})!==JSON.stringify({...result,raw:null})){
   rejected.push({code,name,missing:['同一板块存在冲突的资金记录']});duplicates.set(result.key,null);
  }else if(!duplicates.has(result.key))duplicates.set(result.key,result);
 }
 const conflicted=new Set(rejected.filter(row=>row.missing.includes('同一板块存在冲突的资金记录')).map(row=>row.code||row.name));
 for(const [key,row]of duplicates)if(row&&!conflicted.has(key))rows.push(row);
 return {day,sourceDay,rows,rejected,missing,status:rows.length?'observed':'missing',total:original.length};
}

export function projectDecisionSectors(selection,state={},context=null,{now=Date.now(),loading=false,error=''}={}){
 const day=sectorDay(selection?.day),membership=classification(selection);
 const fromContext=context?.ok===true&&sectorDay(context.day)===day;
 const source=fromContext?{sectors:context.rows,sectorsDay:context.sectorsDay,
  snapshotFieldDays:context.snapshotFieldDays,sectorsInd:context.sectorsInd}:state;
 const evidence=projectSectorFlows(source,{day,now}),rows=evidence.rows.filter(row=>matches(row,membership));
 const rejected=evidence.rejected.filter(row=>matches(row,membership));
 const missing=[...evidence.missing,...(fromContext?list(context.missing).filter(v=>typeof v==='string'):[])];
 if(!membership.names.size&&!membership.codes.size)missing.push('该股缺少已记录的题材或行业归属');
 else if(!rows.length&&!evidence.missing.length){
  if(rejected.length)missing.push(...rejected.flatMap(row=>row.missing.map(reason=>row.name+'：'+reason)));
  else missing.push('尚无 '+(day||'所选交易日')+' 对应题材的板块资金记录');
 }
 if(error)missing.push(error);
 return {...evidence,code:selection?.code||'',rows,rejected,missing:[...new Set(missing)],loading,
  status:rows.length?'observed':loading?'loading':'missing',complete:fromContext,
  membership:[...membership.names],coverage:fromContext?context.coverage:null};
}

const readers=new WeakMap();
export function decisionSectorReader(ctx){
 if(readers.has(ctx))return readers.get(ctx);
 const cache=new Map(),listeners=new Set();
 const active=()=>!ctx.signal?.aborted;
 const notify=()=>{if(active())for(const fn of [...listeners])fn();};
 function load(){
  const day=sectorDay(ctx.decisionSelection?.day);
  if(!active()||!day||!ctx.decisionSelection?.code||typeof ctx.api!=='function')return;
  const old=cache.get(day),now=Date.now();
  if(old&&(old.pending||now-old.readAt<15000))return;
  const entry={...old,pending:true,error:'',readAt:now};cache.set(day,entry);
  Promise.resolve().then(()=>ctx.api('/api/decision-sector-context?'+new URLSearchParams({date:day}),{signal:ctx.signal}))
   .then(result=>{
    if(!active()||cache.get(day)!==entry)return;
    if(result?.ok!==true||sectorDay(result.day)!==day||!Array.isArray(result.rows))throw Error('板块资金回执的交易日或结构不一致');
    entry.data=result;entry.error='';
   }).catch(error=>{
    if(active()&&cache.get(day)===entry)entry.error=error?.name==='AbortError'?'板块资金读取已取消':'完整板块资金回执暂不可用';
   }).finally(()=>{
    if(!active()||cache.get(day)!==entry)return;
    entry.pending=false;
    // A late response may be cached for its own day, but cannot repaint another decision.
    if(sectorDay(ctx.decisionSelection?.day)===day)notify();
   });
 }
 const reader={read(){load();const entry=cache.get(sectorDay(ctx.decisionSelection?.day));
   return projectDecisionSectors(ctx.decisionSelection,ctx.state,entry?.data,{loading:!!entry?.pending,error:entry?.error});},
  subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);}};
 const update=()=>{load();notify();};
 ctx.onDecisionSelection?.(update);ctx.onState?.(update);
 ctx.signal?.addEventListener('abort',()=>{cache.clear();listeners.clear();},{once:true});
 readers.set(ctx,reader);return reader;
}
