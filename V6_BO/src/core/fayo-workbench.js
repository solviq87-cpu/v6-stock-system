'use strict';
// Read-only views of original private archives; the only write is an explicitly
// requested template in the existing research workspace journal.
const S=require('./research-workspace-store'),J=require('./news-evidence-journal');
const flags={researchOnly:true,canTrade:false,canNotify:false,accountMutated:false,productionWeightsChanged:false};
const list=v=>Array.isArray(v)?v:[];
const str=v=>typeof v==='string'&&v.trim()?v:null;
const code=v=>typeof v==='string'&&/^\d{6}$/.test(v);
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const time=(v,cut)=>Number.isSafeInteger(v)&&v>0&&v<=cut;
const dayOK=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const day=v=>new Date(v+28800000).toISOString().slice(0,10);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const close=d=>Date.parse(d+'T15:00:00+08:00');
const numeric=v=>typeof v==='string'&&/^\d+$/.test(v)?Number(v):v;
const unknown=(reason,extra={})=>({status:'unknown',reason,...extra,...flags});
function queryInput(raw={},now=Date.now()){
 const modes={templates:[],news:['symbol','asOf','limit'],replay:['symbol','runId','asOf'],history:['symbol','runId','asOf'],discipline:['date','asOf']};
 if(!raw||!Object.hasOwn(modes,raw.panel)||Object.keys(raw).some(k=>k!=='panel'&&!modes[raw.panel].includes(k)))throw Error('INVALID_FAYO_PANEL_QUERY');
 const q={...raw,asOf:raw.asOf===undefined?now:numeric(raw.asOf),historical:raw.asOf!==undefined};
 if(!time(q.asOf,now)||q.symbol!==undefined&&!code(q.symbol)||q.runId!==undefined&&!hash(q.runId)||
    q.date!==undefined&&(!dayOK(q.date)||q.date>day(q.asOf))||q.limit!==undefined&&(!Number.isSafeInteger(numeric(q.limit))||numeric(q.limit)<1||numeric(q.limit)>100)||
    ['replay','history'].includes(q.panel)&&!code(q.symbol)||q.panel==='history'&&!hash(q.runId))throw Error('INVALID_FAYO_PANEL_IDENTITY');
 q.limit=q.limit===undefined?50:numeric(q.limit);return q;
}
const analysis=(events,cut)=>events.filter(e=>e.kind==='analysis'&&hash(e.hash)&&time(e.recordedAt,cut)&&time(e.data?.asOf,e.recordedAt)&&code(e.data.symbol)&&dayOK(e.data.tradeDate)&&e.data.tradeDate<=day(e.data.asOf)).sort((a,b)=>a.recordedAt-b.recordedAt||a.sequence-b.sequence);
function selectRun(events,q){
 const rows=analysis(events,q.asOf).filter(e=>e.data.symbol===q.symbol);
 return q.runId?rows.find(e=>e.hash===q.runId):rows.at(-1);
}
function templates(events){
 const by=new Map();for(const e of events)if(e.kind==='preset'&&e.data?.scope==='selection-command-only'&&str(e.data.command))by.set(e.data.name,e);
 return {status:'observed',templates:[...by.values()].reverse().slice(0,30).map(e=>({id:e.hash,command:e.data.command,revision:e.revision,recordedAt:e.recordedAt})),total:by.size,...flags};
}
async function saveTemplate(root,input,authorize){
 if(!input||Object.keys(input).some(k=>!['action','value','requestId'].includes(k))||typeof input.value!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId||''))throw Error('INVALID_TEMPLATE');
 const {parseSelectionCommand}=await import('../../public/nova/command-selection.mjs');
 const q=parseSelectionCommand(input.value);
 if(!q.ok||q.explicitAllMarket||/https?:\/\/|webhook|sharecode|api[_ -]?key|password|bearer\s|token\s*[:=]/i.test(q.raw))throw Error('UNSUPPORTED_COMMAND');
 const name='command-'+S.digest(q.raw).slice(0,32),events=S.readEvents(root),prior=events.filter(e=>e.kind==='preset'&&e.data.name===name).at(-1);
 if(prior){if(prior.data.scope!=='selection-command-only'||prior.data.command!==q.raw)throw Error('TEMPLATE_IDENTITY_CONFLICT');if(!authorize())throw Error('REVOKED');return {status:'observed',reused:true,id:prior.hash,...flags};}
 if(templates(events).total>=30)throw Error('TEMPLATE_CAPACITY');
 if(!authorize())throw Error('REVOKED');
 const e=S.appendEvent(root,'preset',{name,command:q.raw,scope:'selection-command-only',symbol:null,status:'all',minScore:0,horizon:5},{requestId:input.requestId,expectedRevision:0});
 return {status:'observed',reused:e.reused,id:e.hash,...flags};
}
function newsContext(rows,events,q,report,holdings,plans){
 const codes=[...new Set(rows.flatMap(r=>list(r.evidence?.securities)))].slice(0,100);
 const own=new Map();for(const r of analysis(events,q.asOf))if(codes.includes(r.data.symbol))own.set(r.data.symbol,r);
 const context={};
 for(const symbol of codes){
  const r=own.get(symbol),d=r?.data,items=list(report?.report?.checklist?.items).filter(x=>x.code===symbol&&x.day===report.day);
  const industries=r?list(d.context?.sectorContext?.current?.boards).filter(b=>b?.membershipComplete===true&&list(b.members).includes(symbol)&&b.quoteDate===d.tradeDate&&time(b.quoteAt,d.asOf)&&time(b.membersObservedAt,d.asOf)&&str(b.name)).map(b=>({name:b.name,category:b.category,code:b.code??null,knownAt:Math.max(b.quoteAt,b.membersObservedAt),source:d.provider,runId:r.hash,tradeDate:d.tradeDate})):[];
  context[symbol]={symbol,name:d?.name||null,companySource:r?{runId:r.hash,recordedAt:r.recordedAt,provider:d.provider}:null,industries,
   report:report?.status==='observed'?{day:report.day,recordedAt:report.recordedAt,reportHash:report.reportHash}:null,
   frozenPlans:items.filter(x=>x.planId&&str(x.planVersion)).map(x=>({planId:x.planId,version:x.planVersion,state:x.state,remainingQuantity:x.remainingQuantity??null,entryEventId:x.entry?.eventId??null})),
   currentHoldings:!q.historical&&holdings?.status==='observed'&&time(holdings.asOf,q.asOf)?{asOf:holdings.asOf,accounts:holdings.accounts.filter(x=>list(x.codes).includes(symbol)).map(x=>({account:x.account,revision:x.revision})),source:'original-paper-ledger'}:null,
   currentPlans:!q.historical&&Array.isArray(plans)?plans.filter(x=>x.code===symbol):null,
   note:'公司、行业来自封存观察；日报为当时的回执，并非当前持仓。历史不借用当前账户与计划。'};
 }
 return context;
}
function replaySeries(events,selected,cut){
 if(!selected)return unknown('尚无该标的在截点前封存的研究记录',{days:[],series:[]});
 const d=selected.data,dates=list(d.tradeDates).filter(dayOK).filter(x=>x<=d.tradeDate);
 const calendarOK=dates.length>1&&new Set(dates).size===dates.length&&dates.every((v,i)=>!i||v>dates[i-1])&&dates.at(-1)===d.tradeDate;
 const days=(calendarOK?dates:[...new Set(list(d.bars).map(b=>b.date).filter(dayOK).filter(x=>x<=d.tradeDate))].sort()).slice(-40);
 const bars=new Map(list(d.bars).filter(b=>dayOK(b.date)&&time(b.knownAt,Math.min(d.asOf,cut))&&b.knownAt>=close(b.date)&&finite(b.close)&&b.close>0).map(b=>[b.date,b]));
 const same=analysis(events,cut).filter(e=>e.data.symbol===d.symbol&&e.data.provider===d.provider&&e.data.priceBasis===d.priceBasis);
 const byDate=new Map();for(const r of same)byDate.set(r.data.tradeDate,r);byDate.set(d.tradeDate,selected);
 const normalize=require('./market-sector-stock-linkage').normalizeMarketLinkageEvidence;
 const read=r=>{try{return normalize(r.data.context?.marketLinkageEvidence,{asOf:r.data.asOf,tradeDate:r.data.tradeDate,provider:r.data.provider,symbol:r.data.symbol});}catch{return null;}};
 const basis=read(selected),boards=list(basis?.boards).filter(b=>b.members.includes(d.symbol)).slice(0,5);
 const definitions=[{id:'stock',label:d.name||d.symbol,source:d.provider},{id:'index',label:basis?.benchmark?.name||'同期指数',source:basis?.provider??null},...boards.map(b=>({id:'board:'+b.category+':'+b.code,label:b.name,source:basis.provider}))];
 if(!boards.length)definitions.push({id:'board:unknown',label:'所属板块（待核验）',source:null});
 const point=(date,value,source,ref,knownAt)=>({date,value:finite(value)?value:null,source:source??null,ref:ref??null,knownAt:knownAt??null});
 const series=definitions.map(def=>({...def,points:[]}));
 for(const date of days){
  const prior=calendarOK?dates[dates.indexOf(date)-1]:null,b=bars.get(date),p=bars.get(prior);
  const eligible=b&&p&&b.corporateAction===false&&time(b.corporateActionKnownAt,Math.min(d.asOf,cut))&&d.priceBasis==='unadjusted';
  series[0].points.push(point(date,eligible?100*(b.close/p.close-1):null,eligible?d.provider:null,eligible?selected.hash:null,eligible?Math.max(b.knownAt,p.knownAt,b.corporateActionKnownAt):null));
  const r=byDate.get(date),e=r?read(r):null;
  const matched=e&&basis&&prior&&e.window.start===close(prior)&&e.window.end===close(date)&&e.returnBasis===basis.returnBasis&&['price','unadjusted','price-return'].includes(e.returnBasis)&&
   e.methodology.noCorporateActions===true&&e.classification.version===basis.classification.version&&e.benchmark.code===basis.benchmark.code&&e.benchmark.methodologyVersion&&e.benchmark.methodologyVersion===basis.benchmark.methodologyVersion;
  series[1].points.push(point(date,matched&&finite(e.benchmark.return)?100*e.benchmark.return:null,matched?e.provider:null,matched?r.hash:null,matched?e.benchmark.knownAt:null));
  for(let i=2;i<series.length;i++){
   const orig=boards[i-2],board=matched&&orig?e.boards.find(b=>b.code===orig.code&&b.category===orig.category&&b.members.includes(d.symbol)&&JSON.stringify([...b.members].sort())===JSON.stringify([...orig.members].sort())):null;
   series[i].points.push(point(date,board&&finite(board.return)?100*board.return:null,board?e.provider:null,board?r.hash:null,board?board.knownAt:null));
  }
 }
 return {status:days.length?'observed':'unknown',symbol:d.symbol,runId:selected.hash,asOf:cut,tradeDate:d.tradeDate,days,series,calendarOK,scope:'封存日涨跌幅，同交易日轴；缺口断线，不插值，不作为当前行情',...flags};
}
function replayMarkers({days,symbol,cut,events,news,reports,signals}){
 const markers=[],inDays=new Set(days);
 const add=(date,at,knownAt,kind,ref,label,details={})=>{
  if(!inDays.has(date)||!time(at,cut)||!time(knownAt,cut)||at>knownAt||day(at)!==date||!str(ref))return;
  markers.push({date,at,knownAt,kind,ref,label,details,...flags});
 };
 for(const e of analysis(events,cut))if(e.data.symbol===symbol)add(day(e.recordedAt),e.recordedAt,e.recordedAt,'research',e.hash,'封存策略研究',{provider:e.data.provider,tradeDate:e.data.tradeDate});
 for(const r of list(news?.rows)){const e=r.evidence;if(!list(e?.securities).includes(symbol)&&r.supportStatus!=='security-removed')continue;
  add(day(r.recordedAt),r.recordedAt,r.recordedAt,'news',r.eventHash,e.title,{source:e.source,publishedAt:e.publishedAt,kind:e.kind,bodyHash:e.bodyHash});}
 for(const s of list(signals))if(s.evidence?.code===symbol&&time(s.evidence.triggerAt,cut))add(day(s.evidence.triggerAt),s.evidence.triggerAt,s.recordedAt,'signal',s.archiveHash,'原始策略信号',{signalId:s.evidence.signalId});
 for(const r of list(reports)){if(r.status!=='observed'||!time(r.recordedAt,cut)||!hash(r.reportHash))continue;
  for(const item of list(r.report?.checklist?.items))if(item.code===symbol&&item.day===r.day&&item.planId&&str(item.planVersion)){
   const frozen=Date.parse(item.frozenAt);if(time(frozen,cut))add(day(frozen),frozen,r.recordedAt,'plan',item.planId,'冻结计划（日报引用）',{version:item.planVersion,reportHash:r.reportHash});
   for(const fill of [item.entry,...list(item.exits)].filter(Boolean))if(fill.source==='original-paper-ledger'&&time(fill.executionAt,cut)&&fill.tradeDate===day(fill.executionAt))add(fill.tradeDate,fill.executionAt,r.recordedAt,'fill',fill.eventId,fill===item.entry?'原账本买入':'原账本卖出',{reportHash:r.reportHash,quantity:fill.quantity,price:fill.price,planId:item.planId});
   for(const risk of list(item.risk))if(time(risk.quoteAt,cut)&&time(risk.observedAt,r.recordedAt))add(day(risk.quoteAt),risk.quoteAt,r.recordedAt,'risk',risk.observationId,'原计划风险观察',{source:risk.source,reason:risk.reason,reportHash:r.reportHash});
  }
 }
 const unique=new Map();for(const m of markers.sort((a,b)=>a.knownAt-b.knownAt))if(!unique.has(m.kind+'|'+m.ref))unique.set(m.kind+'|'+m.ref,m);
 return [...unique.values()].sort((a,b)=>a.at-b.at).slice(-500);
}
function sameHistory(events,selected,cut,scorecard){
 if(!selected)return unknown('无所选封存研究',{groups:[],samples:[]});
 const d=selected.data;if(!str(d.regime)||d.regime==='unknown')return unknown('所选市场环境未知，不能判定同类样本',{groups:[],samples:[]});
 const sig=(data,system)=>{const rows=list(data.conditions).filter(c=>c.system===system&&!c.coverageOnly);
  return rows.length&&rows.every(c=>str(c.id)&&str(c.version)&&['pass','fail'].includes(c.status))?JSON.stringify(rows.map(c=>[c.id,c.version,c.status]).sort((a,b)=>a[0].localeCompare(b[0]))):null;};
 const candidates=new Map(analysis(events,cut).filter(e=>e.hash!==selected.hash&&e.data.tradeDate<d.tradeDate&&e.data.provider===d.provider&&e.data.priceBasis===d.priceBasis&&e.data.regime===d.regime).map(e=>[e.hash,e]));
 const samples=[];
 for(const o of list(scorecard?.observations)){
  const r=candidates.get(o.runId),s=list(d.systems).find(s=>s.id===o.system&&s.verdict==='pass'&&!s.coverageOnly),p=list(r?.data.systems).find(x=>x.id===o.system&&x.verdict==='pass'&&!x.coverageOnly);
  const signature=s?sig(d,s.id):null;
  if(!r||o.symbol!==r.data.symbol||!s||!p||!str(s.version)||s.version!==p.version||!signature||signature!==sig(r.data,s.id)||!dayOK(o.exitDate)||o.exitDate>=d.tradeDate||!time(o.entryOutcomeRecordedAt,cut)||!time(o.exitOutcomeRecordedAt,cut)||!hash(o.entryOutcomeRunId)||!hash(o.exitOutcomeRunId))continue;
  samples.push({runId:o.runId,symbol:o.symbol,system:o.system,version:s.version,signalDate:o.signalDate,entryDate:o.entryDate,exitDate:o.exitDate,horizon:o.horizon,status:o.status,priceReturnPct:finite(o.priceReturnPct)?o.priceReturnPct:null,netReturnPct:o.status==='paper-estimate'&&finite(o.netReturnPct)?o.netReturnPct:null,entryOutcomeRunId:o.entryOutcomeRunId,exitOutcomeRunId:o.exitOutcomeRunId,knownAt:Math.max(o.entryOutcomeRecordedAt,o.exitOutcomeRecordedAt)});
 }
 const bins=new Map();for(const x of samples){const k=x.system+'|'+x.version+'|'+x.horizon;if(!bins.has(k))bins.set(k,[]);bins.get(k).push(x);}
 const groups=[...bins.values()].map(rows=>{const net=rows.filter(x=>x.netReturnPct!==null);return {system:rows[0].system,version:rows[0].version,horizon:rows[0].horizon,count:rows.length,independentSignalDays:new Set(rows.map(x=>x.signalDate)).size,estimatedCount:net.length,meanNetReturnPct:net.length?net.reduce((a,b)=>a+b.netReturnPct,0)/net.length:null,status:'descriptive-only'};});
 return {status:samples.length?'observed':'unknown',groups,samples:samples.slice(-100),total:samples.length,reason:'同策略版本、规则状态向量、市场环境、来源及复权口径；只纳入所选信号日前已结束且截点内有回执的样本。成本化估计不是实际成交，重复信号非独立。',...flags};
}
async function dispatch(p,{authorize=()=>false}={}){
 const now=Date.now();
 try{
  if(p.input){
   if(p.replica)return {ok:false,httpStatus:409,error:'副本只读'};
   if(p.input.action==='fayo-save-command')return {ok:true,result:await saveTemplate(p.root,p.input,authorize)};
   if(p.input.action==='fayo-explain')return await require('./fayo-explanation-model').answer(p,{authorize});
   throw Error('UNKNOWN_FAYO_ACTION');
  }
  const q=queryInput(p.query,now),events=S.readEvents(p.root,{asOf:q.asOf});
  if(q.panel==='templates')return {ok:true,result:templates(events)};
  if(q.panel==='history'){
   const selected=selectRun(events,q),score=require('./research-workspace-analytics').scorecards(events,{asOf:q.asOf});
   return {ok:true,result:{...sameHistory(events,selected,q.asOf,score),symbol:q.symbol,runId:q.runId,asOf:q.asOf}};
  }
  if(q.panel==='discipline')return {ok:true,result:await require('./fayo-discipline-view').review(p,q)};
  const reportStore=require('./paper-execution-report-store').createPaperExecutionReportStore({root:p.reportRoot});
  if(q.panel==='news'){
   const result=J.query(p.newsRoot,{symbol:q.symbol??null,limit:q.limit,now,asOf:q.asOf,includeAssociated:true});
   let report=null,plans=null;
   try{for(const date of reportStore.days().filter(d=>d<=day(q.asOf)).slice(-5).reverse()){const r=reportStore.read({day:date,asOf:q.asOf});if(r.status==='observed'){report=r;break;}}}catch{}
   if(!q.historical)try{
    const r=await (await import('../research/shortline/store.mjs')).shortlineJob({root:p.shortlineRoot,book:'main',replica:p.replica});
    const {validatePlan}=require('./paper-decision-plan'),{planVersion}=require('./paper-plan-observer');
    if(r.ok)plans=list(r.state?.plans).flatMap(x=>{try{validatePlan(x,q.asOf);return [{id:x.id,code:x.code,day:x.intendedDate,frozenAt:x.frozenAt,version:planVersion(x)}];}catch{return [];}});
   }catch{}
   return {ok:true,result:{...result,asOf:q.asOf,context:newsContext(result.rows,events,q,report,p.holdings,plans),...flags}};
  }
  const selected=selectRun(events,q),base=replaySeries(events,selected,q.asOf);
  if(!base.days.length)return {ok:true,result:{...base,symbol:q.symbol,runId:q.runId??null,asOf:q.asOf,markers:[],missing:['缺少封存研究序列']}};
  const reports=[],signals=[],missing=[];
  let news=null;try{news=J.query(p.newsRoot,{symbol:q.symbol,limit:100,now,asOf:q.asOf,includeAssociated:true});if(news.total>news.rows.length)missing.push('新闻事件超出本次窗口');}catch{missing.push('新闻证据链不可用');}
  for(const date of base.days){
   try{const r=reportStore.read({day:date,asOf:q.asOf});if(r.status==='observed')reports.push(r);}catch{missing.push(date+' 日报不可用');}
   try{const s=require('./production-signal-journal').readEvidence(p.signalRoot,{date,code:q.symbol,limit:100});signals.push(...s.records.filter(x=>time(x.recordedAt,q.asOf)));if(s.total>s.records.length)missing.push(date+' 信号窗口截断');}catch{missing.push(date+' 信号证据不可用');}
  }
  if(!reports.length)missing.push('截点内无持久执行日报；计划/风险/成交标记不补造');
  if(reports.some(r=>list(r.report?.checklist?.items).some(x=>x.code===q.symbol&&!Array.isArray(x.exits))))missing.push('旧版日报缺卖出明细引用');
  if(!base.calendarOK)missing.push('连续交易日历缺失，个股涨跌幅不补造');
  return {ok:true,result:{...base,markers:replayMarkers({days:base.days,symbol:q.symbol,cut:q.asOf,events,news,reports,signals}),missing:[...new Set(missing)],...flags}};
 }catch(error){return {ok:false,httpStatus:p.input?.action==='fayo-save-command'?409:422,error:'研究证据查询或保存未完成，原档案和交易状态保持',...flags};}
}
module.exports={dispatch,queryInput,selectRun,templates,saveTemplate,newsContext,replaySeries,replayMarkers,sameHistory};
