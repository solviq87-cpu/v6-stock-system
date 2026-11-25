import {h,button,section,field,empty,note,format,money,table,updateReadout} from './ui.js';
import {isTestSample} from './shortline/sample-quality.mjs';

// Read-only views over dated public pools and the existing private research book.
// A search result, a prefilling action and a realised profit are never execution evidence.
const list=value=>Array.isArray(value)?value:[];
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const stock=value=>typeof value==='string'&&/^\d{6}$/.test(value)?value:'';
const stamp=value=>Number.isSafeInteger(value)?value:typeof value==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value)?Date.parse(value):NaN;
const wallDay=value=>Number.isSafeInteger(value)&&value>0&&value<=8e15?new Date(value+28800000).toISOString().slice(0,10):'';
function day(value){
 const s=typeof value==='string'?value.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):'';
 return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s?s:'';
}
export function workflowDay(state={}){
 if(state.marketClock?.trading===true)return day(state.marketClock.day);
 return day(state.closeSession?.day)||day(state.marketClock?.day)||day(state.snapshotFieldDays?.candidatePool)||
  day(state.snapshotFieldDays?.pool)||day(state.dashboard?.snapshotDay)||day(state.snapshotDay);
}
function rows(value){
 if(Array.isArray(value))return value.filter(row=>row&&stock(String(row.code||row.symbol||'')));
 for(const key of ['items','rows','stocks','pool','list','top'])if(Array.isArray(value?.[key]))return rows(value[key]);
 return [];
}
const support='支持“近5日主力净流入前5的芯片股”“今日主力净流入前5”“精选评分前3的芯片股”；范围为当前同日候选池。';
export function parseStockCommand(input){
 if(typeof input!=='string'||input.length>120)return {ok:false,reason:'请输入不超过120字的选股条件。',support};
 const text=input.trim().replace(/[，,。.!！?？\s]/g,'').replace(/^(?:请)?(?:帮我)?(?:找出|查找|筛选|看看)/,'');
 if(/且|并且|大于|小于|不低于|不高于|涨停概率/.test(text))return {ok:false,reason:'暂不支持组合条件，请一次使用一个已支持的排序指标。',support};
 let match=/^(?:近(1|3|5|10)(?:个交易日|交易日|日)|今日|今天|当日)主力净流入前(\d{1,2})(?:的([\p{L}\p{N}·-]{1,24})股)?$/u.exec(text);
 if(match){
  const count=Number(match[2]);
  if(count<1||count>10)return {ok:false,reason:'一次最多展示10只，请使用“前1”至“前10”。',support};
  return {ok:true,kind:'flow',window:Number(match[1]||1),count,theme:(match[3]||'').replace(/股$/,''),text:input.trim()};
 }
 match=/^(?:精选)?评分前(\d{1,2})(?:的([\p{L}\p{N}·-]{1,24})股)?$/u.exec(text);
 if(match){
  const count=Number(match[1]);
  if(count>=1&&count<=10)return {ok:true,kind:'score',window:1,count,theme:(match[2]||'').replace(/股$/,''),text:input.trim()};
 }
 return {ok:false,reason:'暂未识别这组条件，请按支持的时间、指标和题材查询。',support};
}
function themesOf(row){
 return [...new Set([row.sector,row.industry,row.sectorStrength?.theme,...list(row.themes),...list(row.concepts)]
  .filter(value=>typeof value==='string'&&value.trim()).map(value=>value.trim()))];
}
function matchesTheme(row,theme){
 if(!theme||theme==='全部'||theme==='所有')return true;
 const aliases=theme==='芯片'?['芯片','半导体','集成电路']:[theme];
 return themesOf(row).some(label=>aliases.some(word=>label.includes(word)));
}
export function commandCandidates(state={},role='view',now=Date.now()){
 const target=workflowDay(state),byCode=new Map();
 if(!target||target>wallDay(now))return {day:target,rows:[],reason:'候选池交易日待核验'};
 const sources=[
  [state.pool,state.snapshotFieldDays?.candidatePool||state.snapshotFieldDays?.pool],
  [state.dashboard?.rows,state.snapshotFieldDays?.dashboard||state.dashboard?.snapshotDay],
  [state.trendPool,state.snapshotFieldDays?.trendPool],
  [state.ztPre,state.snapshotFieldDays?.ztPre]
 ];
 if(role==='edit')sources.push([state.yierList,state.yierAsOf]);
 for(const [value,parentDay] of sources)for(const original of rows(value)){
  const dates=[original.poolDay,original.tradeDate,original.sourceTradeDate,original.quoteDate].filter(v=>v!=null&&v!=='');
  if(dates.some(value=>day(value)!==target))continue;
  const own=dates.length?day(dates[0]):day(parentDay);
  const at=original.vendorQuoteAt??original.quoteAt??original.quoteTimestamp;
  if(own!==target||at!=null&&(!Number.isSafeInteger(at)||at<=0||at>now||wallDay(at)!==target)||isTestSample(original))continue;
  const code=String(original.code||original.symbol);
  // Keep a complete row from one pool; do not graft a fresher timestamp onto old funds.
  if(!byCode.has(code))byCode.set(code,{...original,code,poolDay:target});
 }
 return {day:target,rows:[...byCode.values()],reason:byCode.size?'':'尚无同日候选池记录'};
}

export function archivedFlowWindow(observation,code,target,window,now=Date.now()){
 const fail=reason=>({ok:false,reason});
 if(!stock(code)||!day(target)||![1,3,5,10].includes(window)||target>wallDay(now))return fail('资金查询窗口无效');
 const result=observation?.result||observation,flow=result?.marketContext?.funds?.stock;
 if(!result||result.stock?.symbol!==code||flow?.symbol!==code)return fail('尚无该股票的已归档资金证据');
 if(flow.source!=='eastmoney'||flow.fundsMethod!=='vendor-order-size-estimate'||flow.unit!=='CNY')return fail('资金来源、口径或人民币单位未核实');
 if(!Number.isSafeInteger(result.asOf)||result.asOf<=0||result.asOf>now||
    !Number.isSafeInteger(flow.retrievedAt)||flow.retrievedAt<=0||flow.retrievedAt>result.asOf||
    flow.sourceTimestamp!=null&&(!Number.isSafeInteger(flow.sourceTimestamp)||flow.sourceTimestamp<=0||flow.sourceTimestamp>flow.retrievedAt))return fail('资金证据时间待核验');
 if(result.marketContext.tradeDate!==target)return fail('资金档案交易日与本次查询不一致');
 let dates=[target];
 if(window>1){
  const calendar=list(result.analysis?.tradeDates);
  if(result.calendar?.status!=='available'||!calendar.length||calendar.some(value=>!day(value))||
     new Set(calendar).size!==calendar.length||calendar.some((value,index)=>index&&value<=calendar[index-1]))return fail('缺少可核对的交易日历，不能把零散日期当作近'+window+'日');
  const index=calendar.indexOf(target);
  if(index<window-1)return fail('交易日历未覆盖所需窗口');
  dates=calendar.slice(index-window+1,index+1);
 }
 const records=list(flow.records),byDay=new Map();
 for(const record of records){
  if(!day(record?.tradeDate)||record.tradeDate>target)return fail('资金记录含无效或未来日期');
  if(!dates.includes(record.tradeDate))continue;
  if(byDay.has(record.tradeDate))return fail('同日资金记录重复或冲突');
  byDay.set(record.tradeDate,record);
 }
 if(dates.some(date=>!finite(byDay.get(date)?.mainNetInflow)))return fail('缺少完整'+window+'个交易日主力净额，不以零补齐');
 const value=dates.reduce((sum,date)=>sum+byDay.get(date).mainNetInflow,0);
 if(!Number.isFinite(value))return fail('资金合计超出有效范围');
 return {ok:true,value,dates,source:flow.source,unit:'CNY',retrievedAt:flow.retrievedAt,
  reason:(window===1?'当日':'近'+window+'个交易日')+'主力净流入 '+money(value)+' 元 · '+dates[0]+(window>1?' 至 '+dates.at(-1):'')+' · 东财订单规模估算'};
}
function currentFlow(row,target,now){
 const at=row.fundsSourceTimestamp,received=row.fundsRetrievedAt,dateValue=row.fundsTradeDate||row.fundsDay,own=day(dateValue);
 if(!finite(row.mainInflow)||row.fundsUnit!=='CNY'||row.fundsSource!=='eastmoney'||
    row.fundsMethod!=='vendor-order-size-estimate'||(!own&&!Number.isSafeInteger(at))||
    dateValue&&!own||own&&own!==target||received!=null&&(!Number.isSafeInteger(received)||received<=0||received>now)||
    at!=null&&(!Number.isSafeInteger(at)||at<=0||at>now||wallDay(at)!==target||received!=null&&at>received))return null;
 return {ok:true,value:row.mainInflow,dates:[target],source:row.fundsSource,unit:'CNY',
  reason:'当日主力净流入 '+money(row.mainInflow)+' 元 · '+target+' · 东财订单规模估算'};
}
export function evaluateStockCommand(command,{state={},observations={},role='view',now=Date.now()}={}){
 const parsed=typeof command==='string'?parseStockCommand(command):command;
 if(!parsed?.ok)return {...parsed,items:[],missing:[],status:'unsupported'};
 const pool=commandCandidates(state,role,now),candidates=pool.rows.filter(row=>matchesTheme(row,parsed.theme)),accepted=[],missing=[];
 for(const row of candidates){
  if(parsed.kind==='score'){
   if(finite(row.score))accepted.push({...row,commandValue:row.score,commandReason:'原精选评分 '+format(row.score,1)+' · 题材 '+(themesOf(row).join(' / ')||'未标注')});
   else missing.push({code:row.code,name:row.name,reason:'原精选评分未返回'});
  }else{
   const observation=observations instanceof Map?observations.get(row.code):observations[row.code];
   const result=parsed.window===1&&currentFlow(row,pool.day,now)||archivedFlowWindow(observation,row.code,pool.day,parsed.window,now);
   if(!result.ok)missing.push({code:row.code,name:row.name,reason:result.reason});
   else if(result.value>0)accepted.push({...row,commandValue:result.value,commandReason:result.reason,commandEvidence:result});
  }
 }
 accepted.sort((a,b)=>b.commandValue-a.commandValue||a.code.localeCompare(b.code));
 return {ok:true,status:missing.length?'partial':accepted.length?'ready':'empty',day:pool.day,command:parsed,
  items:accepted.slice(0,parsed.count),missing,matched:candidates.length,known:candidates.length-missing.length,
  scope:'当前同日候选池',reason:!pool.rows.length?pool.reason:!candidates.length?'当前候选池没有已标注该题材的股票':
   missing.length?'按已核实样本排序；缺证股票未参与，不能据此认定整个候选池前'+parsed.count+'名':accepted.length?'':'有完整证据的股票未满足净流入为正的条件'};
}

const observationCache=new WeakMap();
export function renderStockCommand(ctx){
 const input=h('input',{class:'fy-input',type:'search',name:'stock-command',maxlength:120,placeholder:'近5日主力净流入前5的芯片股','aria-label':'一句话选股条件'});
 const output=h('div',{'data-stock-command-results':'',class:'fy-stack','aria-live':'polite'}),status=note('查询当前候选池，保留交易日和缺失证据。');
 const submit=h('button',{class:'fy-button primary',type:'submit'},'选股');
 const form=h('form',{class:'fy-command-form'},field('一句话选股',input),submit);
 const host=section('一句话选股','',form,status,output,h('details',{class:'fy-details'},h('summary',{},'支持的查询'),h('p',{},support)));
 host.setAttribute('data-stock-command','');
 let generation=0,controller=null,activeDay=workflowDay(ctx.state);
 const cacheKey=ctx.signal||ctx;
 if(!observationCache.has(cacheKey))observationCache.set(cacheKey,new Map());
 const cache=observationCache.get(cacheKey);
 function cancel(){generation++;controller?.abort();submit.disabled=false;}
 function show(result){
  status.textContent=[result.day||'交易日待核验',result.scope||'',result.matched!=null?'已核实 '+result.known+' / '+result.matched+' 只':'',result.reason].filter(Boolean).join(' · ');
  output.replaceChildren(...[result.items?.length?table([
   {label:'股票',value:row=>button((row.name||row.code)+' '+row.code,()=>ctx.selectStock?.(row.code,row),'quiet')},
   {label:'筛选依据',value:row=>row.commandReason}
  ],result.items):empty('本次没有可核实的筛选结果'),
  result.missing?.length?h('details',{class:'fy-details'},h('summary',{},'缺失证据 · '+result.missing.length+' 只'),
   h('ul',{class:'fy-evidence-list'},result.missing.map(row=>h('li',{},(row.name||row.code)+' '+row.code+'：'+row.reason)))):null].filter(Boolean));
 }
 form.addEventListener('submit',async event=>{
  event.preventDefault();cancel();const turn=generation,parsed=parseStockCommand(input.value);
  if(!parsed.ok){status.textContent=parsed.reason+' '+parsed.support;output.replaceChildren();return;}
  const sourceState=ctx.state||{},pool=commandCandidates(sourceState,ctx.role),target=pool.day;
  activeDay=target;controller=new AbortController();const signal=controller.signal,observations=new Map();
  const active=()=>!signal.aborted&&!ctx.signal?.aborted&&turn===generation&&workflowDay(ctx.state)===target;
  const candidates=pool.rows.filter(row=>matchesTheme(row,parsed.theme));
  if(parsed.kind==='flow'&&ctx.role==='edit'&&candidates.length>20){status.textContent='本次题材包含 '+candidates.length+' 只候选，请缩小题材后核对资金档案（一次最多20只）。';output.replaceChildren();return;}
  submit.disabled=true;
  try{
   if(parsed.kind==='flow'&&ctx.role==='edit')for(const [index,row] of candidates.entries()){
    if(!active())return;
    if(parsed.window===1&&currentFlow(row,target,Date.now()))continue;
    status.textContent='正在核对已归档资金 '+(index+1)+' / '+candidates.length+' · '+target;
    const key=target+'/'+row.code,prior=cache.get(key);
    if(prior&&Date.now()-prior.at<60000){observations.set(row.code,prior.value);continue;}
    // The existing archive reader has one interactive worker slot. Read serially.
    for(const provider of ['eastmoney','tencent']){
     if(!active())return;
     try{
      const response=await ctx.api('/api/research/stock-observations?'+new URLSearchParams({symbol:row.code,provider}),{signal,timeoutMs:55000});
      if(!active())return;
      if(archivedFlowWindow(response,row.code,target,parsed.window).ok){observations.set(row.code,response);cache.set(key,{at:Date.now(),value:response});break;}
      if(!observations.has(row.code))observations.set(row.code,response);
     }catch(error){if(signal.aborted||ctx.signal?.aborted)return;}
    }
   }
   if(!active())return;
   const result=evaluateStockCommand(parsed,{state:sourceState,observations,role:ctx.role});
   if(parsed.kind==='flow'&&ctx.role!=='edit'&&result.missing.length)result.reason='当前身份不能读取私人资金档案；只显示现有公开候选中证据齐备的记录。';
   show(result);
  }finally{if(turn===generation)submit.disabled=false;}
 });
 ctx.signal?.addEventListener('abort',cancel,{once:true});
 ctx.onState?.(()=>{
  const next=workflowDay(ctx.state);if(next!==activeDay){cancel();activeDay=next;output.replaceChildren();status.textContent='交易日已切换至 '+(next||'待核验')+'，请重新查询。';}
 });
 return host;
}

const cents=value=>finite(value)?Math.round(value*100):NaN;
function settledTrade(trade,accountKey,target,now){
 const p=trade?.paperSettlement,created=stamp(trade?.createdAt);
 if(trade?.source!=='V6 模拟成交'||isTestSample(trade)||!p||p.accountId!==accountKey||p.symbol!==trade.code||
    !stock(trade.code)||p.tradeDate!==target||day(trade.exitDate)!==target||
    !Number.isSafeInteger(p.exitTimestamp)||p.exitTimestamp<=0||p.exitTimestamp>now||wallDay(p.exitTimestamp)!==target||
    !Number.isFinite(created)||created<p.exitTimestamp||created>now||
    typeof p.exitEventId!=='string'||!p.exitEventId||!Number.isSafeInteger(p.exitQuantity)||p.exitQuantity<=0||p.exitQuantity!==trade.shares||
    !finite(p.exitPrice)||p.exitPrice<=0||p.exitPrice!==trade.exitPrice||
    !/^[a-f0-9]{64}$/.test(trade.sourceFingerprint||'')||
    !Number.isSafeInteger(p.costBasisCents)||p.costBasisCents<=0||p.costBasisCents!==cents(trade.costBasis)||
    !Number.isSafeInteger(p.realizedCents)||p.realizedCents!==cents(trade.pnlAmount))return false;
 const fills=list(p.entryFills);
 return fills.length>0&&new Set(fills.map(f=>f.eventId)).size===fills.length&&fills.every(f=>
  typeof f.eventId==='string'&&f.eventId&&typeof f.orderId==='string'&&f.orderId&&
  Number.isSafeInteger(f.time)&&f.time>0&&f.time<p.exitTimestamp&&wallDay(f.time)<target&&
  finite(f.price)&&f.price>0&&Number.isSafeInteger(f.quantity)&&f.quantity>0)&&
  fills.reduce((n,f)=>n+f.quantity,0)===trade.shares;
}
function matchingPlan(archive,trade){
 const fills=trade.paperSettlement.entryFills,first=Math.min(...fills.map(f=>f.time)),entryDay=wallDay(first);
 const plans=list(archive.plans).filter(p=>!isTestSample(p)&&p.code===trade.code&&finite(p.entryMax)&&p.entryMax>0&&
  finite(p.stop)&&p.stop>0&&p.stop<p.entryMax&&finite(p.maxPosition)&&p.maxPosition>0&&p.maxPosition<=100&&
  Number.isFinite(stamp(p.frozenAt))&&stamp(p.frozenAt)>0&&stamp(p.frozenAt)<=first&&
  (day(p.intendedDate)||wallDay(stamp(p.frozenAt)))===entryDay&&
  fills.every(f=>wallDay(f.time)===entryDay));
 if(trade.planId)return plans.find(p=>p.id===trade.planId)||null;
 const aligned=plans.filter(p=>typeof p.strategy==='string'&&list(trade.strategies).includes(p.strategy));
 return aligned.length===1?aligned[0]:null;
}
function observedBuy(trade,target,now){
 const f=trade?.fillEvidence;
 if(!trade||trade.side!=='买入'||trade.timeQuality!=='known'||!stock(trade.code)||trade.tradeDate!==target||
  !Number.isSafeInteger(trade.t)||trade.t<=0||trade.t>now||wallDay(trade.t)!==target||
  typeof trade.eventId!=='string'||!trade.eventId||typeof trade.orderId!=='string'||!trade.orderId||
  !Number.isSafeInteger(trade.shares)||trade.shares<=0||!finite(trade.price)||trade.price<=0||
  !finite(trade.fee)||trade.fee<0||!finite(trade.amount)||trade.amount<=0||cents(trade.amount)!==cents(trade.price*trade.shares)||
  !f||f.schemaVersion!==1||f.executionKind!=='automatic-paper'||f.mode!=='public-live-unverified'||
  typeof f.provider!=='string'||!f.provider.trim()||['simulated','imported'].includes(f.source)||
  !/^[a-f0-9]{64}$/.test(f.fingerprint||'')||f.canTrade!==false||f.verifiedLive!==false||
  f.symbol!==trade.code||f.tradeDate!==target||f.executionAt!==trade.t||f.price!==trade.price||
  !Number.isSafeInteger(f.quoteAt)||f.quoteAt<=0||f.quoteAt>trade.t||trade.t-f.quoteAt>180000||wallDay(f.quoteAt)!==target||
  f.receivedAt!==null&&(!Number.isSafeInteger(f.receivedAt)||f.receivedAt<f.quoteAt||f.receivedAt>trade.t)||
  !finite(f.quotePrice)||f.quotePrice<=0||f.volumeUnit!=='shares'||!finite(f.volume)||f.volume<=0||
  f.suspended!==false||f.tradable!==true||!finite(f.upperLimit)||!finite(f.lowerLimit)||f.lowerLimit<=0||
  f.upperLimit<=f.lowerLimit||trade.price<=f.lowerLimit||trade.price>=f.upperLimit)return false;
 return true;
}
function buyPricePlan(archive,trade){
 const plans=list(archive.plans).filter(p=>!isTestSample(p)&&p.code===trade.code&&finite(p.entryMax)&&p.entryMax>0&&
  finite(p.stop)&&p.stop>0&&p.stop<p.entryMax&&finite(p.maxPosition)&&p.maxPosition>0&&p.maxPosition<=100&&
  stamp(p.frozenAt)>0&&stamp(p.frozenAt)<=trade.t&&
  (day(p.intendedDate)||wallDay(stamp(p.frozenAt)))===trade.tradeDate);
 // The current account projection has no plan/strategy binding. A unique
 // pre-trade plan permits only a price comparison, never inferred adherence.
 if(trade.planId)return plans.find(p=>p.id===trade.planId)||null;
 return plans.length===1?plans[0]:null;
}
export function executionScore(archive,{day:target,accountKey='pool',now=Date.now(),account}={}){
 const base={day:day(target),accountKey,score:null,passed:0,failed:0,unknown:0,checks:[],trades:0,settledTrades:0,buyTrades:0,status:'insufficient'};
 if(!base.day||base.day>wallDay(now)||now<Date.parse(base.day+'T15:00:00+08:00'))return {...base,status:'pending',reason:'收盘后核对事前计划与实际执行。'};
 if(!archive||archive.scope!=='live'||archive.book?.id&&archive.book.id!=='main')return {...base,reason:'正式研究档案尚未就绪。'};
 if(account?.audit?.ok===false)return {...base,reason:'模拟账户对账未通过，暂不生成执行评分。'};
 const all=list(archive.trades).filter(t=>t?.source==='V6 模拟成交'&&t.paperSettlement?.accountId===accountKey&&
  (day(t.exitDate)===base.day||t.paperSettlement?.tradeDate===base.day)&&!isTestSample(t));
 const unique=new Map();let invalid=0;
 for(const t of all){
  if(!settledTrade(t,accountKey,base.day,now)){invalid++;continue;}
  const id=t.paperSettlement.exitEventId;
  if(unique.has(id)){if(JSON.stringify(unique.get(id))!==JSON.stringify(t))invalid++;continue;}
  unique.set(id,t);
 }
 for(const t of unique.values()){
  const plan=matchingPlan(archive,t),prefix={code:t.code,name:t.name||t.code,tradeId:t.id,planId:plan?.id||null};
  const add=(rule,status,evidence)=>base.checks.push({...prefix,rule,status,evidence});
  if(!plan){
   for(const rule of ['按计划买入','仓位上限','止损执行'])add(rule,'unknown','缺少可唯一对应的事前冻结计划。');
   continue;
  }
  const max=Math.max(...t.paperSettlement.entryFills.map(f=>f.price)),strategies=list(t.strategies).filter(v=>typeof v==='string'&&v!=='未判定');
  add('按计划买入',max>plan.entryMax||strategies.length&&!strategies.includes(plan.strategy)?'fail':strategies.length?'pass':'unknown',
   '最高成交 '+format(max)+'，计划买价上限 '+format(plan.entryMax)+'；计划战法 '+plan.strategy+'，实际 '+(strategies.join(' / ')||'未记录')+'。');
  if(finite(t.position)&&t.position>0&&t.position<=100&&t.planId===plan.id)
   add('仓位上限',t.position<=plan.maxPosition?'pass':'fail','执行 '+format(t.position)+'%，计划上限 '+format(plan.maxPosition)+'%。');
  else add('仓位上限','unknown','缺少成交当时与该计划关联的完整组合仓位。');
  const stop=t.planId===plan.id?list(t.disciplineFacts).filter(f=>f.rule==='违反止损'):[];
  if(stop.length===1&&['符合','触发'].includes(stop[0].status)&&typeof stop[0].evidence==='string'&&stop[0].evidence.trim())
   add('止损执行',stop[0].status==='符合'?'pass':'fail',stop[0].evidence);
  else add('止损执行','unknown','缺少该计划的止损触发、可成交窗口或执行事实；不按收益猜测。');
 }
 let coverage='',coverageUnknown=0;
 const buys=new Map();
 if(account!==undefined){
  if(account?.audit?.ok!==true||!Array.isArray(account?.trades)||account.accountId&&account.accountId!==accountKey){
   coverage='尚无对账通过的当前账户成交回执。';coverageUnknown=1;
  }else{
   const shown=account.tradesShown,total=account.tradesTotal;
   if(!Number.isSafeInteger(shown)||!Number.isSafeInteger(total)||shown!==account.trades.length||shown<0||total<shown){
    coverage='账户流水覆盖范围待核验，不能认定当日执行已全部核对。';coverageUnknown=1;
   }else if(shown<total){coverage='仅下发最近 '+shown+' / '+total+' 笔流水，当日覆盖尚不完整。';coverageUnknown=1;}
   for(const trade of account.trades){
    if(!trade||trade.side!=='买入'||isTestSample(trade)||
      trade.tradeDate!==base.day&&wallDay(trade.t)!==base.day)continue;
    if(!observedBuy(trade,base.day,now)){invalid++;continue;}
    if(buys.has(trade.eventId)){if(JSON.stringify(buys.get(trade.eventId))!==JSON.stringify(trade))invalid++;continue;}
    buys.set(trade.eventId,trade);
   }
  }
 }
 for(const trade of buys.values()){
  const plan=buyPricePlan(archive,trade),prefix={code:trade.code,name:trade.name||trade.code,tradeId:trade.eventId,planId:plan?.id||null,phase:'buy'};
  const add=(rule,status,evidence)=>base.checks.push({...prefix,rule,status,evidence});
  if(plan)add('买价条件',trade.price<=plan.entryMax?'pass':'fail','当日成交 '+format(trade.price)+' 元、'+trade.shares+' 股；同股同日唯一事前计划上限 '+format(plan.entryMax)+' 元。账户未记录计划或战法关联，本项仅核对买价条件。');
  else add('买价条件','unknown','已核对当日真实模拟买入，缺少可唯一对应的事前冻结计划。');
  add('仓位上限','unknown','账户未记录与该计划关联的成交时组合仓位，当前权益不能替代。');
  add('止损执行','unknown','当日买入的止损执行待证：尚无对应的触发、可成交窗口和执行事实。');
 }
 base.settledTrades=unique.size;base.buyTrades=buys.size;base.trades=unique.size+buys.size;
 base.passed=base.checks.filter(c=>c.status==='pass').length;base.failed=base.checks.filter(c=>c.status==='fail').length;
 base.unknown=base.checks.filter(c=>c.status==='unknown').length+invalid+coverageUnknown;
 const pending=list(archive.plans).filter(p=>!isTestSample(p)&&day(p.intendedDate)===base.day&&Number.isFinite(stamp(p.frozenAt))&&stamp(p.frozenAt)<=now).length;
 if(!base.trades)return {...base,reason:invalid?'当日成交证据存在缺失或冲突，无法评分。':coverage||
  (pending?'已有冻结计划，尚无当日可核对的模拟成交。':'缺少当日可核对的模拟成交及其事前计划，无法评分。')};
 const scope='当日买入 '+base.buyTrades+' 笔，已结算 '+base.settledTrades+' 笔；';
 if(base.unknown)return {...base,status:'partial',reason:scope+'已核 '+(base.passed+base.failed)+' 项，待核 '+base.unknown+' 项；证据未齐不生成总分。'+coverage};
 base.score=Math.round(100*base.passed/base.checks.length);base.status='ready';
 return {...base,reason:'按本日已结算模拟记录核对 '+base.checks.length+' 项纪律。'+(account===undefined?'当前买入回执尚未提供，本分数仅覆盖这些结算记录。':'')};
}

const archiveCache=new WeakMap();
export function renderExecutionScore(ctx,{accountKey='pool',account}={}){
 const host=h('section',{class:'fy-workflow-score','data-execution-score':accountKey,'aria-label':'执行评分'}),body=h('div',{'aria-live':'polite'});
 host.append(h('h3',{},'执行评分'),body);
 if(ctx.role!=='edit'){body.append(note('执行记录需要编辑者权限。'));return host;}
 let generation=0,loaded=null,lastDay='',lastAt=0,mounted=false,disposed=false,unsubscribe=()=>{};
 const scope=ctx.signal||ctx;
 function dispose(){if(disposed)return;disposed=true;generation++;unsubscribe();ctx.signal?.removeEventListener('abort',dispose);}
 function active(initial=false){
  if(disposed||ctx.signal?.aborted){dispose();return false;}
  if(host.isConnected===true)mounted=true;
  // asyncRegion replaces this panel on account refresh, before the route ends.
  // Detached panels must release subscriptions and ignore pending replies.
  if(host.isConnected===false&&(mounted||!initial)){dispose();return false;}
  return true;
 }
 function paint(){
  const target=workflowDay(ctx.state),result=executionScore(loaded,{day:target,accountKey,account});
  updateReadout(body,h('div',{class:'fy-inline'},h('strong',{'data-score-value':''},result.score===null?'暂无法评分':result.score+' / 100'),h('span',{class:'fy-muted'},target||'交易日待核验')),
   note(result.reason),result.checks.length?h('details',{class:'fy-details'},h('summary',{},'执行依据 · 当日买入 '+result.buyTrades+' 笔 / 已结算 '+result.settledTrades+' 笔'),
    table([{label:'股票',value:r=>r.name+' '+r.code},{label:'纪律',value:r=>r.rule},{label:'结果',value:r=>({pass:'符合',fail:'偏离',unknown:'待核验'})[r.status]},{label:'依据',value:r=>r.evidence}],result.checks)):null);
 }
 async function read(force=false,initial=false){
  if(!active(initial))return;
  const target=workflowDay(ctx.state);paint();
  if(!target||Date.now()<Date.parse(target+'T15:00:00+08:00')||ctx.signal?.aborted||ctx.role!=='edit')return;
  if(!force&&target===lastDay&&Date.now()-lastAt<60000)return;
  const turn=++generation;lastDay=target;lastAt=Date.now();
  let requestCache;
  try{
   let cached=archiveCache.get(scope);
   if(force||!cached||Date.now()-cached.at>=60000){
    cached={at:Date.now(),promise:ctx.api('/api/research/shortline',{signal:ctx.signal,headers:{'X-V6-Research-Book':'main'}})};
    archiveCache.set(scope,cached);
   }
   requestCache=cached;const reply=await cached.promise;
   if(turn!==generation||!active()||ctx.role!=='edit'||workflowDay(ctx.state)!==target)return;
   loaded=reply?.state;paint();
  }catch(error){if(turn===generation&&active()){
   loaded=null;if(archiveCache.get(scope)===requestCache)archiveCache.delete(scope);
   body.replaceChildren(note('执行记录未读取成功：'+(error.message||'请重试')));
  }}
 }
 host.append(h('div',{class:'fy-inline'},button('核对执行记录',()=>read(true),'quiet'),button('查看冻结计划',()=>ctx.navigate('lab','shortline-trades'),'quiet')));
 const remove=ctx.onState?.(()=>read());if(typeof remove==='function')unsubscribe=remove;
 ctx.signal?.addEventListener('abort',dispose,{once:true});queueMicrotask(()=>read(false,true));return host;
}

export function privateReminderStatus(state={},role='view'){
 if(role!=='edit')return {label:'需要编辑者权限',ready:false};
 return {label:state.feishuSecReady===true?'已配置':'未配置',ready:state.feishuSecReady===true};
}
export function renderPrivateReminder(ctx){
 const body=h('div',{'aria-live':'polite'}),host=section('飞书提醒','',body);
 function paint(){const result=privateReminderStatus(ctx.state,ctx.role);updateReadout(body,
  h('span',{class:'fy-tag','data-private-reminder':result.ready?'configured':'unconfigured'},'私密通道 · '+result.label),
  ctx.role==='edit'?h('div',{class:'fy-inline'},button('通知设置',()=>ctx.navigate('settings','channels'),'quiet'),button('投递记录',()=>ctx.navigate('inbox','push'),'quiet')):null);}
 paint();ctx.onState?.(paint);return host;
}
