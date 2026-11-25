'use strict';
// Read-only research projections of the existing private evidence stores.
// Templates are the only writes, in a separate private research-settings
// journal using the original append/CAS implementation. No account writer,
// quote acquisition, strategy mutation or notification dependency.
const path=require('node:path');
const S=require('./research-workspace-store');
const {normalizeMarketLinkageEvidence}=require('./market-sector-stock-linkage');
const {scorecards}=require('./research-workspace-analytics');
const {createSingleModelInterface}=require('./single-model-interface');
const Journal=require('./news-evidence-journal');
const Signal=require('./production-signal-journal');
const {createPaperExecutionReportStore}=require('./paper-execution-report-store');
const {validatePlan}=require('./paper-decision-plan');
const flags=Object.freeze({researchOnly:true,canTrade:false,canNotify:false,accountMutated:false,productionWeightsChanged:false});
const list=v=>Array.isArray(v)?v:[];
const time=(v,max)=>Number.isSafeInteger(v)&&v>0&&v<=max;
const instant=v=>Number.isSafeInteger(v)?v:typeof v==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(v)?Date.parse(v):NaN;
const code=v=>typeof v==='string'&&/^\d{6}$/.test(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=(v,max=300)=>typeof v==='string'?v.slice(0,max):'';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const cleanDay=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const day=v=>new Date(v+28800000).toISOString().slice(0,10);
const close=d=>Date.parse(d+'T15:00:00+08:00');
const official=new Set(['cninfo.com.cn','www.cninfo.com.cn','sse.com.cn','www.sse.com.cn','szse.cn','www.szse.cn','bse.cn','www.bse.cn']);
function only(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw Error('研究参数无效');}
function settingsRoot(root){return path.join(path.dirname(root),path.basename(root)+'-interactions');}
function readTemplates(root,{now=Date.now()}={}){
 const events=S.readEvents(settingsRoot(root),{asOf:now}),latest=new Map();
 for(const e of events){
  if(e.kind!=='preset'||e.data.scope!=='command-v1'||!hash(e.data.name)||typeof e.data.raw!=='string'||e.data.raw.length>160||S.digest(e.data.raw)!==e.data.name)
   throw Error('选股模板档案校验失败');
  latest.set(e.data.name,e);
 }
 return {templates:[...latest.values()].reverse().map(e=>({id:e.data.name,raw:e.data.raw,revision:e.revision,recordedAt:e.recordedAt})),...flags};
}
async function saveTemplate(root,input,{authorize=()=>false}={}){
 only(input,['action','raw','requestId','expectedRevision']);
 const {parseSelectionCommand}=await import('../../public/nova/command-selection.mjs');
 if(typeof input.raw!=='string'||!input.raw.trim()||input.raw.length>160||
  /https?:\/\/|api[_ -]?key|password|bearer\s|token\s*[:=]|webhook|sharecode/i.test(input.raw))throw Error('不接受链接或凭据');
 const q=parseSelectionCommand(input.raw);
 if(!q.ok||q.explicitAllMarket)throw Error(q.error||'全市场范围未接通，不能保存成候选池替代模板');
 if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)throw Error('需核对原模板版本');
 const raw=q.raw,id=S.digest(raw),templates=readTemplates(root).templates,prior=templates.find(t=>t.id===id);
 if(!prior&&templates.length>=50)throw Error('模板数量已达50项，请归档后继续');
 if(!authorize())throw Object.assign(Error('设备授权或主实例角色已变化'),{httpStatus:403});
 const e=S.appendEvent(settingsRoot(root),'preset',{scope:'command-v1',name:id,raw},{expectedRevision:input.expectedRevision,requestId:input.requestId});
 return {id,raw,revision:e.revision,recordedAt:e.recordedAt,reused:e.reused,...flags};
}
function readRuns(root,symbol,runId,asOf){
 if(!code(symbol)||runId!==undefined&&!hash(runId)||!time(asOf,Date.now()))throw Error('研究身份或截点无效');
 const events=S.readEvents(root,{asOf}).filter(e=>e.kind==='analysis'&&time(e.data?.asOf,e.recordedAt)&&code(e.data?.symbol));
 const own=events.filter(e=>e.data.symbol===symbol),selected=runId?own.find(e=>e.hash===runId):own.at(-1);
 if(runId&&!selected)throw Error('该封存版本不存在或晚于回放截点');
 return {events,own,selected};
}
function validBar(b,e,asOf){
 return cleanDay(b?.date)&&time(b.knownAt,Math.min(asOf,e.recordedAt,e.data.asOf))&&b.knownAt>=close(b.date)&&finite(b.close)&&b.close>0;
}
function point(v,source,knownAt,ref,kind='daily-price-change'){
 return finite(v)&&text(source)&&time(knownAt,Date.now())?{value:v,source,knownAt,ref,kind}:null;
}
function dailySeries(own,selected,dates,asOf,boardCode){
 const d=selected?.data;
 if(!d||!['eastmoney','tencent','sina'].includes(d.provider)||d.priceBasis!=='unadjusted')return {rows:dates.map(date=>({date,stock:null,sector:null,index:null})),boards:[],selectedBoard:null,missing:['没有已封存的未复权个股历史']};
 const valid=own.filter(e=>e.data.provider===d.provider&&e.data.priceBasis===d.priceBasis);
 const bars=new Map(),byDay=new Map(),boards=new Map();
 for(const e of valid){
  for(const b of list(e.data.bars))if(validBar(b,e,asOf))bars.set(b.date,{b,e});
  if(cleanDay(e.data.tradeDate))byDay.set(e.data.tradeDate,e);
  try{
   const l=normalizeMarketLinkageEvidence(e.data.context?.marketLinkageEvidence,{asOf:e.data.asOf,tradeDate:e.data.tradeDate,provider:d.provider,symbol:d.symbol});
   for(const b of l.boards.filter(b=>b.members.includes(d.symbol)))boards.set(b.code,{code:b.code,name:b.name,category:b.category});
  }catch{}
  for(const b of list(e.data.context?.sectorContext?.current?.boards)){
   if(b.membershipComplete===true&&list(b.members).includes(d.symbol)&&typeof b.code==='string'&&b.code.length<=64&&time(b.membersObservedAt,e.data.asOf))
    boards.set(b.code,{code:b.code,name:b.name,category:b.category});
  }
 }
 const choices=[...boards.values()].slice(0,50),chosen=choices.find(b=>b.code===boardCode)||(!boardCode?choices[0]:null);
 const calendar=list(d.tradeDates).filter(cleanDay);
 const ordered=calendar.length&&calendar.every((x,i)=>!i||x>calendar[i-1])?calendar:[];
 const rows=dates.map(date=>{
  const r={date,stock:null,sector:null,index:null,close:null,comparison:'unknown'};
  const cur=bars.get(date),i=ordered.indexOf(date),prev=i>0?bars.get(ordered[i-1]):null;
  if(cur){r.close=point(cur.b.close,d.provider,Math.max(cur.b.knownAt,cur.e.recordedAt),cur.e.hash,'unadjusted-close');
   if(prev)r.stock=point(100*(cur.b.close/prev.b.close-1),d.provider,Math.max(cur.b.knownAt,prev.b.knownAt,cur.e.recordedAt,prev.e.recordedAt),cur.e.hash,'unadjusted-price-change');}
  const e=byDay.get(date);
  if(!e)return r;
  const cutoff=Math.min(asOf,e.data.asOf,e.recordedAt);
  try{
   const l=normalizeMarketLinkageEvidence(e.data.context?.marketLinkageEvidence,{asOf:cutoff,tradeDate:date,provider:d.provider,symbol:d.symbol});
   if(i>0&&l.window.start===close(ordered[i-1])&&l.window.end===close(date)&&
      ['price','unadjusted','price-return'].includes(l.returnBasis)&&l.methodology.noCorporateActions===true){
    const s=l.stocks.find(s=>s.symbol===d.symbol),b=l.boards.find(b=>b.code===chosen?.code&&b.category===chosen?.category&&b.members.includes(d.symbol));
    r.stock=s&&finite(s.return)?point(s.return*100,l.provider,Math.max(s.knownAt,e.recordedAt),e.hash,'frozen-same-window'):r.stock;
    r.sector=b&&finite(b.return)?point(b.return*100,l.provider,Math.max(b.knownAt,e.recordedAt),e.hash,'frozen-same-window'):null;
    r.index=finite(l.benchmark.return)?point(l.benchmark.return*100,l.benchmark.provider,Math.max(l.benchmark.knownAt,e.recordedAt),e.hash,'frozen-same-window'):null;
    r.comparison=[r.stock,r.sector,r.index].every(x=>x?.kind==='frozen-same-window')?'same-window':'partial';
   }
  }catch{}
  if(!r.sector&&chosen){
   const b=list(e.data.context?.sectorContext?.current?.boards).find(b=>b.code===chosen.code&&b.category===chosen.category&&b.membershipComplete===true&&list(b.members).includes(d.symbol));
   if(b?.quoteDate===date&&time(b.quoteAt,cutoff)&&b.quoteAt>=close(date)&&time(b.membersObservedAt,cutoff)&&finite(b.changePct))
    r.sector=point(b.changePct,text(b.source)||d.provider,Math.max(b.quoteAt,b.membersObservedAt,e.recordedAt),e.hash,'board-source-change');
  }
  if(!r.index){
   const ix=e.data.context?.indices,got=instant(ix?.retrievedAt),b=list(ix?.records).find(x=>x.tradeDate===date);
   if(time(got,cutoff)&&got>=close(date)&&text(ix?.source)&&finite(b?.shanghaiChangePct))
    r.index=point(b.shanghaiChangePct,ix.source,Math.max(got,e.recordedAt),e.hash,'index-source-change');
  }
  return r;
 });
 const missing=[];
 if(!ordered.length)missing.push('交易日历证据不完整，不计算跨缺口涨幅');
 if(!chosen)missing.push('没有已核对的板块归属');
 if(!rows.some(r=>r.sector))missing.push('板块同期数据缺失');
 if(!rows.some(r=>r.index))missing.push('指数同期数据缺失');
 if(rows.some(r=>r.comparison!=='same-window'))missing.push('部分日期仅展示各自来源的价格变动，未认证同口径超额收益');
 return {rows,boards:choices,selectedBoard:chosen||null,missing};
}
function marker(kind,ref,at,knownAt,source,detail,asOf){
 if(!text(ref)||!text(source)||!time(at,asOf)||!time(knownAt,asOf)||at>knownAt)return null;
 return {kind,ref,at,knownAt,source,detail,...flags};
}
function newsMarkers(rows,symbol,asOf){
 const out=[];
 for(const row of rows){
  const e=row.evidence;
  if(!e)continue;
  let host='';try{host=new URL(e.url).hostname;}catch{}
  // Source identity is evidence as supplied, not independent authentication.
  const status=e.kind==='retracted'?'撤稿':e.kind==='revised'?'修订':official.has(host)&&e.bodyScope==='declared-body'?'正式披露来源声明（未独立核实）':'原始记录（未独立核实）';
  const m=marker('news',row.eventHash,row.recordedAt,row.recordedAt,e.source,{
    title:text(e.title,500),bodyExcerpt:text(e.body,1600),status,sourceEventId:e.eventId,sourceRevisionId:e.sourceRevisionId,
    originalPublishedAt:e.publishedAt??null,receivedAt:e.receivedAt,revisedAt:e.revisedAt??null,bodyScope:e.bodyScope,
    url:e.url||null,associated:e.securities.includes(symbol),securities:e.securities,
    subject:e.securities.includes(symbol)?symbol:null,industry:null,effectiveAt:null,
    note:'主体以原证券关联为准；行业、金额语义及生效时间未核实则保持未知；非因果证据'
  },asOf);
  if(m)out.push(m);
 }
 return out;
}
function tradeMarkers(state,symbol,asOf){
 const out=[];
 for(const t of list(state?.trades)){
  if(t.code!==symbol||!hash(t.sourceFingerprint))continue;
  const known=instant(t.createdAt);
  if(!time(known,asOf))continue;
  const p=t.paperSettlement,m=t.manualDecision;
  if(p&&p.symbol===symbol&&t.sourceSet==='模拟成交'&&hash(S.digest(p))&&S.digest(p)===t.sourceFingerprint){
   for(const f of list(p.entryFills)){
    const v=marker('fill',f.eventId,f.time,known,'原模拟成交结算档案',{side:'buy',price:f.price,quantity:f.quantity,account:p.accountId,planId:t.decisionLink&&time(t.decisionLink.knownAt,asOf)?t.decisionLink.planId:null},asOf);if(v)out.push(v);
   }
   const v=marker('fill',p.exitEventId,p.exitTimestamp,known,'原模拟成交结算档案',{side:'sell',price:p.exitPrice,quantity:p.exitQuantity,account:p.accountId},asOf);if(v)out.push(v);
  }else if(m&&t.sourceSet==='本人人工实录'&&S.digest(m)===t.sourceFingerprint){
   for(const f of list(m.fills)){const v=marker('manual-fill',f.id||f.reference,f.executedAt,Math.max(known,f.recordedAt||0),'本人对账记录（非券商认证）',{side:f.side,price:f.priceUnits/10000,quantity:f.quantity,planId:m.planId},asOf);if(v)out.push(v);}
  }
 }
 return out;
}
async function readReplay(roots,query,{now=Date.now(),readShortline}={}){
 only(query,['symbol','runId','asOf','window','board']);
 const {symbol,runId,board}=query,asOf=query.asOf??now,window=query.window??14;
 if(!time(asOf,now)||![7,14,30].includes(window)||board!==undefined&&(!text(board)||board.length>64))throw Error('回放范围无效');
 const {own,selected}=readRuns(roots.root,symbol,runId,asOf);
 const first=day(asOf-(window-1)*86400000),last=day(asOf);
 const dates=Array.from({length:window},(_,i)=>day(asOf-(window-1-i)*86400000));
 const series=dailySeries(own,selected,dates,asOf,board);
 const markers=[],missing=[...series.missing],readFailures=[],holdings=[];
 const add=m=>{if(m&&day(m.at)>=first&&day(m.at)<=last)markers.push(m);};
 for(const e of own)if(day(e.recordedAt)>=first){
  add(marker('research',e.hash,e.recordedAt,e.recordedAt,e.data.provider,{tradeDate:e.data.tradeDate,systems:list(e.data.systems).map(s=>({id:s.id,version:s.version,verdict:s.verdict})),note:'原封存研究判断，非交易指令'},asOf));
 }
 try{const n=Journal.queryAt(roots.newsRoot,{symbol,asOf,now,limit:200});for(const m of newsMarkers(n.rows,symbol,asOf))add(m);
  if(n.nextOffset!==null)missing.push('新闻回放仅显示最近200条版本，完整原文档案可分页查询');
 }catch{readFailures.push('新闻档案未就绪');}
 let archive=null;
 try{const read=readShortline||((r)=>import('../research/shortline/store.mjs').then(m=>m.shortlineJob({root:r,book:'main',replica:true})));
  const result=await read(roots.shortlineRoot);if(!result?.ok||!result.state)throw Error();archive=result.state;
  for(const p of list(archive.plans)){
   if(p.code!==symbol)continue;
   try{validatePlan(p,asOf);}catch{continue;}
   const at=instant(p.frozenAt);
   add(marker('plan',p.id,at,at,'原冻结计划',{day:p.intendedDate,decisionId:p.decisionId,entryMin:p.entryMin,entryMax:p.entryMax,stop:p.stop,target:p.target,maxPosition:p.maxPosition,note:'原后端冻结值，仅历史证据展示'},asOf));
  }
  for(const m of tradeMarkers(archive,symbol,asOf))add(m);
 }catch{readFailures.push('原冻结计划或结算档案未就绪');}
 try{
  const reports=createPaperExecutionReportStore({root:path.join(roots.shortlineRoot,'execution-reports')});
  for(const d of dates){
   const r=reports.read({day:d,asOf});
   if(r.status!=='observed')continue;
   for(const item of list(r.report?.checklist?.items)){
    if(item.code!==symbol)continue;
    if(Number.isSafeInteger(item.remainingQuantity)&&item.remainingQuantity>=0)holdings.push({day:d,quantity:item.remainingQuantity,planId:item.planId,knownAt:r.recordedAt,ref:r.reportHash});
    if(item.entry)add(marker('fill',item.entry.eventId,item.entry.executionAt,r.recordedAt,'原持久执行日报',{side:'buy',planId:item.planId,price:item.entry.price,quantity:item.entry.quantity,reportHash:r.reportHash},asOf));
    for(const risk of list(item.risk))add(marker('risk',risk.observationId,risk.quoteAt,r.recordedAt,risk.source||'原执行日报',{kind:risk.kind,planId:item.planId,reason:risk.reason,availability:risk.availability,observedAt:risk.observedAt,reportHash:r.reportHash},asOf));
   }
  }
 }catch{readFailures.push('原持久执行日报未就绪');}
 try{
  for(const d of dates){
   const r=Signal.readEvidence(roots.signalRoot,{date:d,code:symbol,limit:100});
   if(r.total>r.records.length)missing.push(d+' 信号档案超出本次读取上限');
   for(const v of r.records){const e=v.evidence;
    add(marker('signal',e.signalId,e.triggerAt,v.recordedAt,'原生产信号档案',{type:e.type,version:e.strategyVersion,status:e.status,archiveHash:v.archiveHash,missing:e.missingReasons},asOf));}
  }
 }catch{readFailures.push('原生产信号档案未就绪');}
 try{
  const events=S.readEvents(roots.manualRoot,{asOf}),plans=new Map();
  for(const e of events){
   const d=e.data;if(e.kind!=='manual-loop')continue;
   if(d.type==='freeze'&&d.snapshot?.symbol===symbol){plans.set(e.hash,d.snapshot);add(marker('manual-plan',e.hash,e.recordedAt,e.recordedAt,'原本人冻结建议',{runId:d.snapshot.runId,note:'本人研究建议，非后端下单计划'},asOf));}
   else if(plans.has(d.planId)&&d.type==='fill'){
    add(marker('manual-fill',e.hash,d.fill.executedAt,e.recordedAt,'本人实录（未券商认证）',{planId:d.planId,side:d.fill.side,price:d.fill.priceUnits/10000,quantity:d.fill.quantity},asOf));
   }else if(plans.has(d.planId)&&['void-fill','review','reopen','not-executed'].includes(d.type)){
    add(marker('manual-review',e.hash,e.recordedAt,e.recordedAt,'本人记录原版本',{planId:d.planId,type:d.type,fillId:d.fillId??null,note:text(d.note||d.reason,300)},asOf));
   }
  }
 }catch{readFailures.push('本人执行日志未就绪');}
 // Same immutable fill may appear in several report versions. Keep the
 // earliest admissible receipt; never use a later revision to backdate it.
 const unique=new Map();
 for(const m of markers.sort((a,b)=>a.knownAt-b.knownAt)){
  const key=m.kind+'|'+m.ref;
  if(!unique.has(key))unique.set(key,m);
 }
 const all=[...unique.values()].sort((a,b)=>a.at-b.at||a.knownAt-b.knownAt);
 for(const m of all.filter(m=>m.kind==='news')){
  const prior=own.filter(e=>e.recordedAt<=m.knownAt).at(-1);
  m.detail.subjectName=prior?.data?.name||null;
  m.detail.industry=list(prior?.data?.context?.sectorContext?.current?.boards).filter(b=>b.membershipComplete===true&&list(b.members).includes(symbol)&&time(b.membersObservedAt,m.knownAt)).map(b=>({name:b.name,ref:prior.hash,knownAt:b.membersObservedAt})).slice(0,10);
  m.detail.relatedPlans=all.filter(p=>p.kind==='plan'&&p.knownAt<=m.knownAt&&p.detail.day===day(m.at)).map(p=>({id:p.ref,day:p.detail.day,knownAt:p.knownAt}));
  m.detail.holdingEvidence=holdings.filter(h=>h.knownAt<=m.knownAt&&h.day===day(m.at));
  m.detail.associationScope='仅同证券、当时已封存的同日计划/持仓快照；缺档为未知，不证明新闻造成交易';
 }
 if(all.length>500)missing.push('标记超出500条，仅显示最近500条；原档案保留');
 return {protocol:'fayo-evidence-replay-v1',symbol,asOf,from:first,to:last,window,runId:selected?.hash??null,
   ...series,markers:all.slice(-500),missing:[...new Set([...missing,...readFailures,'成交以持久日报、原结算或实际手工记录可知时点为限；无当时证据不回填'])],
   scope:'historical-readonly',...flags};
}
function ruleSignature(run,system){
 const rows=list(run.conditions).filter(c=>c.system===system.id&&!c.coverageOnly);
 if(!rows.length||rows.some(c=>!text(c.id)||!text(c.version)||!['pass','fail'].includes(c.status)))return null;
 return S.digest(rows.map(c=>[c.id,c.version,c.status]).sort((a,b)=>a[0].localeCompare(b[0])));
}
function similarSamples(root,{symbol,runId,asOf}){
 const {events,selected}=readRuns(root,symbol,runId,asOf);
 if(!selected)return {status:'unknown',groups:[],reason:'没有匹配封存研究',...flags};
 const d=selected.data,index=new Map(events.map(e=>[e.hash,e])),scores=scorecards(events,{asOf}),groups=[];
 for(const sys of list(d.systems).filter(s=>s.verdict==='pass'&&text(s.version))){
  const sig=ruleSignature(d,sys);
  if(!sig||d.regime==='unknown')continue;
  const comparable=new Set(events.filter(e=>{
   const c=e.data,s=list(c.systems).find(s=>s.id===sys.id&&s.version===sys.version&&s.verdict==='pass');
   return e.hash!==selected.hash&&c.tradeDate<d.tradeDate&&c.provider===d.provider&&c.priceBasis===d.priceBasis&&c.regime===d.regime&&s&&ruleSignature(c,s)===sig;
  }).map(e=>e.hash));
  for(const horizon of [1,5,20,60]){
   const rows=scores.observations.filter(o=>o.system===sys.id&&o.horizon===horizon&&comparable.has(o.runId)&&o.exitDate<=d.tradeDate&&
     time(o.entryOutcomeRecordedAt,asOf)&&time(o.exitOutcomeRecordedAt,asOf));
   const realized=rows.filter(o=>o.status==='paper-estimate'&&finite(o.netReturnPct));
   const independentDays=new Set(realized.map(o=>o.signalDate)).size;
   groups.push({system:sys.id,version:sys.version,regime:d.regime,provider:d.provider,horizon,conditionSignature:sig,
    matchedRuns:comparable.size,matured:rows.length,modeled:realized.length,independentDays,
    averageNetReturnPct:realized.length?realized.reduce((n,o)=>n+o.netReturnPct,0)/realized.length:null,
    positiveFractionPct:realized.length?100*realized.filter(o=>o.netReturnPct>0).length/realized.length:null,
    samples:rows.slice(-30).map(o=>({...o,signalRecordedAt:index.get(o.runId)?.recordedAt??null})),
    status:realized.length?'descriptive-only':'unknown'});
  }
 }
 return {status:groups.some(g=>g.matured)?'observed':'unknown',groups,asOf,symbol,runId:selected.hash,
  reason:'同策略版本、条件状态签名、市场分组及来源的早期样本；仅用截点前已取得的后续结果。成本后估计不是权威成交或独立有效性证明。',...flags};
}
const nextRules={'追高':'下一次逐笔核对冻结买入区间，超上限时不以新价格改写原计划',
 '买入区间偏离':'下一次按冻结区间核对原买入回执','违反止损':'下一次核对原止损触及与可成交窗口',
 '按计划买入':'下一次核对原计划及关联买入','按计划止损':'下一次核对可用退出窗口与原批次',
 '计划外交易':'下一次保留事前冻结计划及原买入事件引用','过早离场':'下一次事前记录离场条件和原门禁豁免',
 '重复交易':'下一次核对原成交编号、完整批次与重复执行原因','超仓':'下一次冻结并核对实际权益和组合限制',
 '数量上限':'下一次核对冻结数量与实际累计持股'};
function disciplineRows(state,{symbol=null,asOf=Date.now()}={}){
 const rows=[];
 for(const t of list(state?.trades)){
  if(!code(t.code)||symbol&&t.code!==symbol||!hash(t.sourceFingerprint)||!time(instant(t.createdAt),asOf))continue;
  const p=t.paperSettlement,m=t.manualDecision,source=p?'模拟成交':m?'本人实录':null,raw=p||m;
  if(!source||S.digest(raw)!==t.sourceFingerprint||p&&p.symbol!==t.code||m&&!hash(m.planId))continue;
  const planId=p?(time(t.decisionLink?.knownAt,asOf)?t.decisionLink.planId:null):m.planId;
  const knownAt=Math.max(instant(t.createdAt),p&&planId?t.decisionLink.knownAt:0);
  const date=t.exitDate;
  if(!cleanDay(date)||date>day(asOf))continue;
  const refs=p?[...list(p.entryFills).map(x=>x.eventId),p.exitEventId].filter(x=>text(x)):list(m.fills).map(x=>x.id||x.reference).filter(x=>text(x));
  const facts=list(t.disciplineFacts).filter(f=>text(f?.rule)&&['符合','触发','不适用','资料不足'].includes(f.status)&&text(f.evidence));
  // Current imported labels may have been linked later than the requested
  // cutoff. Never let that future plan linkage prove an earlier discipline fact.
  if(p&&!planId)for(const f of facts)rows.push({code:t.code,source,date,knownAt,ref:t.id,planId:null,rule:f.rule,status:'资料不足',evidence:'当时未取得原冻结计划关联',refs,attribution:'未知'});
  else for(const f of facts)rows.push({code:t.code,source,date,knownAt,ref:t.id,planId,rule:f.rule,status:f.status,evidence:f.evidence,refs,
    attribution:f.status==='触发'?'原执行纪律核验触发':f.status==='不适用'?'原规则不适用，非自动归责':f.status==='符合'?'原纪律核验符合':'未知'});
 }
 return rows.sort((a,b)=>a.date.localeCompare(b.date)||a.knownAt-b.knownAt||a.ref.localeCompare(b.ref));
}
function followups(rows){
 const out=[];
 for(let i=0;i<rows.length;i++){
  const r=rows[i];if(!['触发','资料不足'].includes(r.status)||!Object.hasOwn(nextRules,r.rule))continue;
  const later=rows.slice(i+1).find(n=>n.code===r.code&&n.source===r.source&&n.rule===r.rule&&n.date>r.date&&n.planId&&n.planId!==r.planId);
  out.push({...r,nextCheck:nextRules[r.rule],followup:later?{status:later.status==='符合'?'后续原核验符合':later.status==='触发'?'后续原核验再次触发':'后续证据不足',date:later.date,planId:later.planId,ref:later.ref,refs:later.refs,evidence:later.evidence}:null});
 }
 return out;
}
async function readDiscipline(roots,{symbol=null,asOf=Date.now()}={},readShortline){
 if(symbol!==null&&!code(symbol)||!time(asOf,Date.now()))throw Error('纪律复盘身份或时点无效');
 const read=readShortline||((r)=>import('../research/shortline/store.mjs').then(m=>m.shortlineJob({root:r,book:'main',replica:true})));
 const r=await read(roots.shortlineRoot);
 if(!r?.ok||!r.state)throw Error('原交易结算档案不可用');
 const rows=disciplineRows(r.state,{symbol,asOf}),extra=[];
 // Repeated entries can be valid partial fills. Only display verifiable
 // separate original rounds, never mark repetition a violation by count.
 const rounds=list(r.state.trades).filter(t=>code(t.code)&&(!symbol||t.code===symbol)&&t.paperSettlement&&
   hash(t.sourceFingerprint)&&S.digest(t.paperSettlement)===t.sourceFingerprint&&time(instant(t.createdAt),asOf)&&cleanDay(t.exitDate));
 const seen=new Map();
 for(const t of rounds.sort((a,b)=>a.paperSettlement.exitTimestamp-b.paperSettlement.exitTimestamp)){
  const p=t.paperSettlement,key=p.accountId+'|'+t.code,previous=seen.get(key),first=Math.min(...list(p.entryFills).map(f=>f.time));
  if(previous&&time(first,asOf)&&first>previous.paperSettlement.exitTimestamp&&day(first)===previous.exitDate)
   extra.push({code:t.code,source:'模拟成交',date:t.exitDate,knownAt:instant(t.createdAt),planId:time(t.decisionLink?.knownAt,asOf)?t.decisionLink.planId:null,rule:'重复交易',status:'资料不足',ref:t.id,
    refs:[previous.paperSettlement.exitEventId,...list(p.entryFills).map(f=>f.eventId)],evidence:'前次原批次卖出后同日出现新的买入批次；是否计划外重复交易需核对原计划',attribution:'未知'});
  seen.set(key,t);
 }
 const coverage=[];
 try{
  const store=createPaperExecutionReportStore({root:path.join(roots.shortlineRoot,'execution-reports')});
  for(let i=59;i>=0;i--){const d=day(asOf-i*86400000),report=store.read({day:d,asOf});if(report.status!=='observed')continue;
   const check=list(report.report.checklist?.items);
   for(const score of list(report.report.score?.rows)){
    if(!code(score.code)||symbol&&score.code!==symbol)continue;
    const p=check.find(x=>x.planId===score.planId&&x.code===score.code&&x.planVersion===score.planVersion);
    if(!p)continue;
    for(const f of list(score.facts))if(['符合','触发','不适用','资料不足'].includes(f.status)&&text(f.rule)&&text(f.evidence))rows.push({code:score.code,source:'原模拟执行日报',date:d,knownAt:report.recordedAt,ref:report.reportHash,planId:p.planId,rule:f.rule,status:f.status,evidence:f.evidence,refs:[report.reportHash,...list(f.eventIds),...list(f.observations).map(x=>x.observationId)].filter(x=>text(x)),attribution:f.status==='不适用'?'原风控或规则不适用，非自动归责':f.status==='触发'?'原执行核验触发':f.status==='符合'?'原执行核验符合':'未知'});
   }
  }
 }catch{coverage.push('原执行日报未就绪')}
 try{
  const manual=require('./manual-decision-loop').view(roots.manualRoot,{asOf});
  for(const p of list(manual.plans)){
   if(!code(p.symbol)||symbol&&p.symbol!==symbol)continue;
   if(p.notExecuted){const h=list(p.history).filter(x=>x.type==='not-executed').at(-1);if(h)rows.push({code:p.symbol,source:'本人原始日志',date:day(h.recordedAt),knownAt:h.recordedAt,ref:h.id,planId:p.id,rule:'按计划买入',status:'资料不足',evidence:'本人未执行说明：'+text(p.notExecuted.reason),refs:[p.id,h.id],attribution:'本人记录，客观可成交性未核验'});}
   if(p.review&&p.review.id)rows.push({code:p.symbol,source:'本人原始日志',date:day(p.review.recordedAt),knownAt:p.review.recordedAt,ref:p.review.id,planId:p.id,rule:'本人复盘归因',status:'资料不足',evidence:text(p.review.note)||'原本人复盘未填写说明',refs:[p.id,p.review.id],attribution:'本人原始判断，未独立认证策略失误'});
  }
 }catch{coverage.push('本人执行日志未就绪')}
 const combined=[...rows,...extra].sort((a,b)=>a.date.localeCompare(b.date)||(a.knownAt||0)-(b.knownAt||0));
 const relevant=combined.slice(-500),items=followups(combined).slice(-300);
 return {asOf,symbol,rows:relevant,followups:items,
  scope:'原短线结算、本人日志及最近60日原执行日报；并非券商实盘',
  missing:[...coverage,'策略失误必须有独立策略复盘，不能仅以亏损归因','无法成交只采用原风控/日历证据；过早离场、重复买卖及完整盘中观察不足时保持未知','后续核验来自另一份原始成交记录，不是对用户行为的保证'],...flags};
}
const modelName=()=>process.env.V6_RESEARCH_EXPLAIN_ENABLE_LOCAL==='1'&&/^[a-zA-Z0-9._:/-]{1,100}$/.test(process.env.V6_RESEARCH_EXPLAIN_MODEL||'')?process.env.V6_RESEARCH_EXPLAIN_MODEL:null;
function modelStatus(){const id=modelName();return {configured:!!id,model:id,transport:id?'explicit-loopback-ollama':null,reason:id?'本地适配器已配置，实际调用仍须核对回执':'未明确启用本地语言模型或模型名称未配置',...flags};}
function localAdapter({fetchImpl=global.fetch,id=modelName()}={}){
 if(!id)return null;
 return {id,async complete({prompt}){
   const response=await fetchImpl('http://127.0.0.1:11434/api/generate',{method:'POST',redirect:'error',
    headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),
    body:JSON.stringify({model:id,prompt,stream:false,format:'json',options:{num_predict:400,temperature:0}})});
   if(!response.ok)throw Error('模型 HTTP 请求失败');
   const parts=[];let bytes=0;
   for await(const chunk of response.body){bytes+=chunk.length;if(bytes>65536)throw Error('模型响应超限');parts.push(Buffer.from(chunk));}
   const result=JSON.parse(Buffer.concat(parts).toString('utf8'));
   if(result.model!==id||typeof result.response!=='string'||result.done!==true)throw Error('实际模型回执不一致');
   return {text:result.response};
 }};
}
const allowedQuestions=new Set(['support','opposition','missing','invalidation','history']);
async function explain(root,input,{authorize=()=>false,adapter=localAdapter()}={}){
 only(input,['action','symbol','runId','asOf','question']);
 if(!allowedQuestions.has(input.question)||!hash(input.runId))throw Error('未知问题或研究版本');
 const {selected}=readRuns(root,input.symbol,input.runId,input.asOf);
 if(!selected)throw Error('封存研究不可用');
 const d=selected.data,model=createSingleModelInterface({adapter}),base={symbol:d.symbol,runId:selected.hash,asOf:input.asOf,question:input.question,kind:'model-generated',...flags};
 if(!model.status().configured)return {...base,status:'unconfigured',modelCalled:false,model:null,reason:'未配置语言模型，保留原规则解释'};
 // No source article, user free text, account data, instructions or raw
 // provider content is transmitted. The model receives only typed facts and
 // ordinal citations; IDs are resolved back to the original archive server-side.
 const ev=new Map(list(d.evidence).map(e=>[e.id,e])),facts=[],citations=[];
 for(const c of list(d.conditions)){
  if(input.question==='history'||facts.length>=60||c.coverageOnly||!['pass','fail','unknown'].includes(c.status)||input.question==='support'&&c.status!=='pass'||input.question==='opposition'&&c.status!=='fail'||input.question==='missing'&&c.status!=='unknown')continue;
  const refs=list(c.evidenceIds).map(id=>ev.get(id)).filter(e=>e?.symbol===d.symbol&&time(e.availableAt,d.asOf)&&time(e.receivedAt,d.asOf)&&text(e.source)&&text(e.evidenceRef)&&e.status!=='unknown');
  if(c.status!=='unknown'&&(!refs.length||refs.length!==list(c.evidenceIds).length))continue;
  const id='R'+(facts.length+1);
  facts.push({id,system:['fourteen','bazi','gpt','python','research36'].includes(c.system)?c.system:'other',status:c.status,
    value:finite(c.value)?c.value:null,threshold:finite(c.threshold)?c.threshold:null,op:['>','>=','<','<=','=','!='].includes(c.op)?c.op:null});
  citations.push({id,rule:text(c.name||c.id),version:text(c.version),refs:refs.map(e=>({id:e.id,source:e.source,knownAt:Math.max(e.availableAt,e.receivedAt),ref:e.evidenceRef}))});
 }
 if(input.question==='history'){
  const similar=similarSamples(root,{symbol:input.symbol,runId:input.runId,asOf:input.asOf});
  for(const g of similar.groups.filter(g=>g.modeled>0).slice(0,20)){
   const id='H'+(facts.length+1);
   facts.push({id,horizon:g.horizon,modeled:g.modeled,independentDays:g.independentDays,averageNetReturnPct:g.averageNetReturnPct,positiveFractionPct:g.positiveFractionPct,descriptiveOnly:true});
   citations.push({id,rule:'同条件历史样本',version:g.version,refs:g.samples.slice(0,6).map(x=>({id:x.runId,source:g.provider,knownAt:x.exitOutcomeRecordedAt,ref:x.exitOutcomeRunId}))});
  }
 }
 if(!facts.length)return {...base,status:'not-ready',modelCalled:false,model:model.status().model,reason:'没有可供模型解释的封存条件'};
 if(!authorize())return {...base,status:'denied',modelCalled:false,reason:'授权已变化'};
 try{
  const r=await model.complete({prompt:'只做研究解释。不得建议或触发交易，不得改变原规则。只用以下结构化条件，不猜测缺失信息。输出JSON {"answer":"中文简述","citations":["R1"]}，引用编号必须存在。不根据缺少权重的反证排序，不输出买卖指令。问题类型 '+input.question+'。条件：'+JSON.stringify(facts)});
  const x=JSON.parse(r.text);
  only(x,['answer','citations']);
  if(typeof x.answer!=='string'||!x.answer.trim()||x.answer.length>1800||!Array.isArray(x.citations)||!x.citations.length||x.citations.length>20||
    x.citations.some(id=>!citations.some(c=>c.id===id)))throw Error('模型引用无效');
  return {...base,status:'completed',modelCalled:true,model:r.model,answer:x.answer,citations:citations.filter(c=>x.citations.includes(c.id)),reason:'模型生成内容未独立核实；原规则解释保留，不能用于执行'};
 }catch{return {...base,status:'failed',modelCalled:true,model:model.status().model,reason:'模型调用或引用核验失败，保留原规则解释'};}
}
async function run(roots,query,input,{authorize=()=>false}={}){
 if(input){if(input.action==='save-template')return saveTemplate(roots.root,input,{authorize});if(input.action==='explain')return explain(roots.root,input,{authorize});throw Error('未知研究操作');}
 if(query.mode==='templates'){only(query,['mode']);return readTemplates(roots.root);}
 if(query.mode==='model-status'){only(query,['mode']);return modelStatus();}
 const {mode,...q}=query;
 if(mode==='replay')return readReplay(roots,q);
 if(mode==='similar'){only(q,['symbol','runId','asOf']);return similarSamples(roots.root,q);}
 if(mode==='discipline'){only(q,['symbol','asOf']);return readDiscipline(roots,q);}
 throw Error('未知证据工作台读取');
}
module.exports={run,readTemplates,saveTemplate,readReplay,dailySeries,newsMarkers,tradeMarkers,similarSamples,disciplineRows,followups,readDiscipline,modelStatus,localAdapter,explain,flags};
