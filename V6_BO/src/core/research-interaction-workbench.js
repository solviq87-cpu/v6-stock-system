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
const {createPaperExecutionReportStore,MAX_VERSIONS}=require('./paper-execution-report-store');
const {validatePlan}=require('./paper-decision-plan');
const {planVersion}=require('./paper-plan-observer');
const {verifiedSettlement}=require('./intelligence-execution-validation');
// The original paper importer fingerprints JSON bytes in insertion order;
// manual/workspace journals use canonical JSON. These are different contracts.
const paperDigest=value=>require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
 const e=S.appendEvent(settingsRoot(root),'preset',{scope:'command-v1',name:id,raw},{expectedRevision:input.expectedRevision,requestId:input.requestId,beforeCommit:authorize});
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
function point(v,source,knownAt,ref,kind='daily-price-change',identity=null){
 return finite(v)&&text(source)&&time(knownAt,Date.now())&&hash(ref)?{value:v,source,knownAt,ref,kind,
  ...(identity?{identity,seriesIdentity:S.digest(identity)}:{})}:null;
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
  const stockIdentity={type:'stock',code:d.symbol,provider:d.provider,priceBasis:d.priceBasis,frequency:'1d'};
  if(cur){r.close=point(cur.b.close,d.provider,Math.max(cur.b.knownAt,cur.e.recordedAt),cur.e.hash,'unadjusted-close',{...stockIdentity,returnBasis:'close'});
   if(prev)r.stock=point(100*(cur.b.close/prev.b.close-1),d.provider,Math.max(cur.b.knownAt,prev.b.knownAt,cur.e.recordedAt,prev.e.recordedAt),cur.e.hash,'unadjusted-price-change',{...stockIdentity,returnBasis:'unadjusted-price-change'});}
  const e=byDay.get(date);
  if(!e)return r;
  const cutoff=Math.min(asOf,e.data.asOf,e.recordedAt);
  try{
   const l=normalizeMarketLinkageEvidence(e.data.context?.marketLinkageEvidence,{asOf:cutoff,tradeDate:date,provider:d.provider,symbol:d.symbol});
   if(i>0&&l.window.start===close(ordered[i-1])&&l.window.end===close(date)&&
      ['price','unadjusted','price-return'].includes(l.returnBasis)&&l.methodology.noCorporateActions===true){
    const s=l.stocks.find(s=>s.symbol===d.symbol),b=l.boards.find(b=>b.code===chosen?.code&&b.category===chosen?.category&&b.members.includes(d.symbol));
    r.stock=s&&finite(s.return)?point(s.return*100,l.provider,Math.max(s.knownAt,e.recordedAt),e.hash,'frozen-same-window',{...stockIdentity,returnBasis:l.returnBasis}):r.stock;
    r.sector=b&&finite(b.return)?point(b.return*100,l.provider,Math.max(b.knownAt,e.recordedAt),e.hash,'frozen-same-window',
     {type:'sector',code:b.code,category:b.category,provider:l.provider,returnBasis:l.returnBasis,classificationVersion:l.classification.version,frequency:'1d'}):null;
    r.index=finite(l.benchmark.return)?point(l.benchmark.return*100,l.benchmark.provider,Math.max(l.benchmark.knownAt,e.recordedAt),e.hash,'frozen-same-window',
     {type:'index',code:l.benchmark.code,provider:l.benchmark.provider,returnBasis:l.returnBasis,methodologyVersion:l.benchmark.methodologyVersion,frequency:'1d'}):null;
    r.comparison=[r.stock,r.sector,r.index].every(x=>x?.kind==='frozen-same-window')?'same-window':'partial';
   }
  }catch{}
  if(!r.sector&&chosen){
   const context=e.data.context?.sectorContext,b=list(context?.current?.boards).find(b=>b.code===chosen.code&&b.category===chosen.category&&b.membershipComplete===true&&list(b.members).includes(d.symbol));
   const source=text(b?.source)||text(context?.current?.source)||text(context?.provider);
   if(source&&b?.quoteDate===date&&time(b.quoteAt,cutoff)&&b.quoteAt>=close(date)&&time(b.membersObservedAt,cutoff)&&finite(b.changePct))
    r.sector=point(b.changePct,source,Math.max(b.quoteAt,b.membersObservedAt,e.recordedAt),e.hash,'board-source-change',
     {type:'sector',code:b.code,category:b.category??null,provider:source,returnBasis:'provider-reported-change',classificationVersion:context.current.classificationVersion??null,frequency:'1d'});
  }
  if(!r.index){
   const ix=e.data.context?.indices,got=instant(ix?.retrievedAt),b=list(ix?.records).find(x=>x.tradeDate===date);
   if(time(got,cutoff)&&got>=close(date)&&text(ix?.source)&&finite(b?.shanghaiChangePct))
    r.index=point(b.shanghaiChangePct,ix.source,Math.max(got,e.recordedAt),e.hash,'index-source-change',
     {type:'index',code:'000001',provider:ix.source,returnBasis:'provider-reported-change',methodologyVersion:null,frequency:'1d'});
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
  const sourceStatus=e.kind==='retracted'?'撤稿':e.kind==='revised'?'修订':official.has(host)&&e.bodyScope==='declared-body'?'正式披露来源声明（未独立核实）':'原始记录（未独立核实）';
  const associated=e.securities.includes(symbol),status=(row.current===false?'已被后续版本替代 · ':!associated?'证券关联已移除 · ':'')+sourceStatus;
   const sourceAt=e.kind==='original'?e.publishedAt:e.revisedAt;
   const declared=time(sourceAt,e.receivedAt)&&time(e.receivedAt,row.recordedAt);
   const m=marker('news',row.eventHash,declared?sourceAt:row.recordedAt,row.recordedAt,e.source,{
    title:text(e.title,500),bodyExcerpt:text(e.body,1600),status,sourceEventId:e.eventId,sourceRevisionId:e.sourceRevisionId,
     originalPublishedAt:e.publishedAt??null,receivedAt:e.receivedAt,revisedAt:e.revisedAt??null,bodyScope:e.bodyScope,
     timeBasis:declared?'source-declared':'archive-receipt',
    url:e.url||null,associated,securities:e.securities,
    current:row.current===true,supportStatus:text(row.supportStatus)||'unknown',supersedes:e.supersedes||null,
    eligibleForResearchSupport:row.current===true&&associated&&row.eligibleForResearchSupport===true,
    subject:associated?symbol:null,industry:null,effectiveAt:null,
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
  if(p&&p.symbol===symbol&&t.sourceSet==='模拟成交'&&paperDigest(p)===t.sourceFingerprint){
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
  const add=m=>{if(m&&(day(m.at)>=first&&day(m.at)<=last||day(m.knownAt)>=first&&day(m.knownAt)<=last))markers.push(m);};
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
    const versions=reports.snapshots({day:d,asOf,limit:MAX_VERSIONS});
    if(!versions.complete)throw Error('执行日报版本范围不完整');
    for(const r of versions.versions)for(const item of list(r.report?.checklist?.items)){
     if(item.code!==symbol||item.day!==d)continue;
     if(Number.isSafeInteger(item.remainingQuantity)&&item.remainingQuantity>=0)holdings.push({day:d,quantity:item.remainingQuantity,planId:item.planId,knownAt:r.recordedAt,ref:r.reportHash});
     if(item.entry)add(marker('fill',item.entry.eventId,item.entry.executionAt,r.recordedAt,'原持久执行日报',{side:'buy',planId:item.planId,price:item.entry.price,quantity:item.entry.quantity,reportHash:r.reportHash,reportVersion:r.reportVersion},asOf));
     for(const risk of list(item.risk))add(marker('risk',risk.observationId,risk.quoteAt,r.recordedAt,risk.source||'原执行日报',{kind:risk.kind,planId:item.planId,reason:risk.reason,availability:risk.availability,observedAt:risk.observedAt,reportHash:r.reportHash,reportVersion:r.reportVersion},asOf));
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
  // A correction can remove the requested security. Keep its original chain
  // visible, but do not reattach the removed company's private evidence.
  if(!m.detail.associated){
   Object.assign(m.detail,{subjectName:null,industry:[],relatedPlans:[],holdingEvidence:[],
    associationScope:'原证券关联已移除；仅保留修订轨迹，不再关联该证券的公司、行业、计划或持仓'});
   continue;
  }
  const prior=own.filter(e=>e.recordedAt<=m.knownAt).at(-1);
  m.detail.subjectName=prior?.data?.name||null;
  m.detail.industry=list(prior?.data?.context?.sectorContext?.current?.boards).filter(b=>b.membershipComplete===true&&list(b.members).includes(symbol)&&time(b.membersObservedAt,m.knownAt)).map(b=>({name:b.name,ref:prior.hash,knownAt:b.membersObservedAt})).slice(0,10);
  m.detail.relatedPlans=all.filter(p=>p.kind==='plan'&&p.knownAt<=m.knownAt&&p.detail.day===day(m.at)).map(p=>({id:p.ref,day:p.detail.day,knownAt:p.knownAt}));
   const holdingAt=new Map();
   for(const h of holdings.filter(h=>h.knownAt<=m.knownAt&&h.day===day(m.at)))holdingAt.set(h.planId,h);
   m.detail.holdingEvidence=[...holdingAt.values()];
  m.detail.associationScope='仅同证券、当时已封存的同日计划/持仓快照；缺档为未知，不证明新闻造成交易';
 }
 if(all.length>500)missing.push('标记超出500条，仅显示最近500条；原档案保留');
 return {protocol:'fayo-evidence-replay-v1',symbol,asOf,from:first,to:last,window,runId:selected?.hash??null,
   ...series,markers:all.slice(-500),missing:[...new Set([...missing,...readFailures,'成交以持久日报、原结算或实际手工记录可知时点为限；无当时证据不回填'])],
   scope:'historical-readonly',...flags};
}
function ruleSignature(conditions,system){
 const rows=conditions.filter(c=>c.system===system.id&&!c.coverageOnly);
 if(!rows.length||rows.some(c=>!text(c.id)||!text(c.version)||!['pass','fail'].includes(c.status)))return null;
 return S.digest(rows.map(c=>[c.id,c.version,c.field,c.op,c.threshold,c.status]).sort((a,b)=>a[0].localeCompare(b[0])));
}
async function similarSamples(root,{symbol,runId,asOf}){
 const {events,selected}=readRuns(root,symbol,runId,asOf);
 if(!selected)return {status:'unknown',groups:[],reason:'没有匹配封存研究',...flags};
 const {sealedResearchConditions}=await import('../../public/nova/research-review.mjs');
 const d=selected.data,index=new Map(events.map(e=>[e.hash,e])),scores=scorecards(events,{asOf}),groups=[];
 const conditions=new Map(events.map(e=>[e.hash,sealedResearchConditions(e.data)]));
 for(const sys of list(d.systems).filter(s=>s.verdict==='pass'&&text(s.version))){
  const sig=ruleSignature(conditions.get(selected.hash),sys);
  if(!sig||!text(d.regime)||['unknown','未知','资料不足'].includes(d.regime))continue;
  const comparable=new Set(events.filter(e=>{
   const c=e.data,s=list(c.systems).find(s=>s.id===sys.id&&s.version===sys.version&&s.verdict==='pass');
   return e.hash!==selected.hash&&c.tradeDate<d.tradeDate&&c.provider===d.provider&&c.priceBasis===d.priceBasis&&c.regime===d.regime&&s&&ruleSignature(conditions.get(e.hash),s)===sig;
  }).map(e=>e.hash));
  for(const horizon of [1,5,20,60]){
   const rows=scores.observations.filter(o=>o.system===sys.id&&o.horizon===horizon&&comparable.has(o.runId)&&o.exitDate<=d.tradeDate&&
     time(o.entryOutcomeRecordedAt,asOf)&&time(o.exitOutcomeRecordedAt,asOf));
   const realized=rows.filter(o=>o.status==='paper-estimate'&&finite(o.netReturnPct));
   const independentDays=new Set(realized.map(o=>o.signalDate)).size;
   let nonOverlappingWindows=0,end='';
   for(const o of realized.slice().sort((a,b)=>a.exitDate.localeCompare(b.exitDate)))if(o.entryDate>end){nonOverlappingWindows++;end=o.exitDate;}
   groups.push({system:sys.id,version:sys.version,regime:d.regime,provider:d.provider,horizon,conditionSignature:sig,
    matchedRuns:comparable.size,matured:rows.length,modeled:realized.length,independentDays,nonOverlappingWindows,
    distinctSymbols:new Set(realized.map(o=>o.symbol)).size,cohortBasis:'same-version-condition-regime',individualPrediction:false,
    averageNetReturnPct:realized.length?realized.reduce((n,o)=>n+o.netReturnPct,0)/realized.length:null,
    positiveFractionPct:realized.length?100*realized.filter(o=>o.netReturnPct>0).length/realized.length:null,
    samples:rows.slice(-30).map(o=>({...o,signalRecordedAt:index.get(o.runId)?.recordedAt??null})),
    status:realized.length?'descriptive-only':'unknown'});
  }
 }
 return {status:groups.some(g=>g.matured)?'observed':'unknown',groups,asOf,symbol,runId:selected.hash,
  similarCases:{status:'pending-integration',engine:'shortline.similarCases',reason:'原短线研究五维 neighbours / excursions 合同待统一接入；本页没有另建相似度算法。'},
  reason:'原前向评测的同策略版本、条件状态签名、市场分组及来源的早期样本；仅用查看截点前已取得的结果。这是条件分组描述，不是五维相似匹配、个股预测或权威成交收益。',...flags};
}
const nextRules={'追高':'下一次逐笔核对冻结买入区间，超上限时不以新价格改写原计划',
 '买入区间偏离':'下一次按冻结区间核对原买入回执','违反止损':'下一次核对原止损触及与可成交窗口',
 '按计划买入':'下一次核对原计划及关联买入','按计划止损':'下一次核对可用退出窗口与原批次',
 '计划外交易':'下一次保留事前冻结计划及原买入事件引用','过早离场':'下一次事前记录离场条件和原门禁豁免',
 '重复交易':'下一次核对原成交编号、完整批次与重复执行原因','超仓':'下一次冻结并核对实际权益和组合限制',
 '数量上限':'下一次核对冻结数量与实际累计持股'};
function paperBinding(t,state,asOf){
 const p=t?.paperSettlement,recorded=instant(t?.createdAt),fills=list(p?.entryFills);
 if(!p||t.sourceSet!=='模拟成交'||t.sourceFingerprint!==paperDigest(p)||p.symbol!==t.code||!['pool','pre'].includes(p.accountId)||
  !time(recorded,asOf)||!time(p.exitTimestamp,recorded)||!cleanDay(t.exitDate)||day(p.exitTimestamp)!==t.exitDate||
  !text(p.exitEventId)||!fills.length||fills.length>500||new Set(fills.map(f=>f.eventId)).size!==fills.length||
  fills.some(f=>!text(f.eventId)||!text(f.orderId)||!time(f.time,p.exitTimestamp-1)||!finite(f.price)||f.price<=0||
    !Number.isSafeInteger(f.quantity)||f.quantity<=0||f.grossCents!==Math.round(f.price*f.quantity*100)))return null;
 const known=instant(t.decisionLink?.knownAt),matches=list(state?.plans).filter(p=>p?.id===t.planId),plan=matches.length===1?matches[0]:null;
 const unknown={plan:null,planVersion:null,knownAt:recorded,reason:'未取得匹配的原冻结计划、规则版本及结算校验证据'};
 if(!plan||p.accountId!=='pool'||!time(known,asOf)||known<Math.max(...fills.map(f=>f.time))||
   t.decisionLink.planId!==plan.id||t.decisionLink.decisionId!==plan.decisionId||t.decisionLink.planFingerprint!==paperDigest(plan)||
   list(t.decisionLink.entryEventIds).length!==fills.length||new Set(t.decisionLink.entryEventIds).size!==fills.length||
   fills.some(f=>!t.decisionLink.entryEventIds.includes(f.eventId)))return unknown;
 try{validatePlan(plan,asOf);if(!verifiedSettlement(t,plan,asOf).row)return unknown;}catch{return unknown;}
 return {plan,planVersion:planVersion(plan),knownAt:Math.max(recorded,known),reason:null};
}
function manualBinding(t,plans,asOf){
 const m=t?.manualDecision,known=instant(t?.createdAt),fills=list(m?.fills);
 if(!m||t.sourceSet!=='本人人工实录'||t.sourceFingerprint!==S.digest(m)||!time(known,asOf)||!hash(m.planId)||
  !time(m.frozenAt,known)||!time(m.reconciledAt,known)||!fills.length||fills.length>500||
  fills.some(f=>!hash(f.id)||!text(f.reference)||!['buy','sell'].includes(f.side)||!time(f.executedAt,f.recordedAt)||!time(f.recordedAt,m.reconciledAt))||
  !fills.some(f=>f.side==='sell')||!cleanDay(t.exitDate)||day(Math.max(...fills.filter(f=>f.side==='sell').map(f=>f.executedAt)))!==t.exitDate)return null;
 const matches=list(plans).filter(p=>p?.id===m.planId),p=matches.length===1?matches[0]:null,rec=p?.reconciliation;
 const verified=p&&p.symbol===t.code&&p.runId===m.runId&&p.sourceHash===m.sourceHash&&p.sourceAsOf===m.sourceAsOf&&p.frozenAt===m.frozenAt&&
  p.limitPriceUnits===m.limitPriceUnits&&p.shares===m.plannedShares&&rec?.matched===true&&rec.brokerVerified===false&&m.brokerVerified===false&&
  rec.id===m.reconciliationId&&rec.recordedAt===m.reconciledAt&&rec.statementHash===m.statementHash&&rec.fillsHash===m.fillsHash&&
  m.fillsHash===S.digest(p.fills)&&p.totals?.quantity===0&&p.totals.netPnlCents===m.netPnlCents;
 return {plan:verified?p:null,planVersion:verified?p.id:null,knownAt:known,reason:verified?null:'原本人建议或对账版本未匹配，不能借用当前标签归责'};
}
const NEXT_PLAN_ID_LIMIT=20000;
const nextPlanInventory=()=>({items:new Map(),complete:true});
function rememberNextPlan(target,p){
 if(Array.isArray(target)){target.push(p);return;}
 if(!target.complete)return;
 const key=JSON.stringify([p.source,p.accountId,p.code,p.planId,p.planVersion,p.planFrozenAt]),prior=target.items.get(key);
 if(!prior&&target.items.size>=NEXT_PLAN_ID_LIMIT){target.complete=false;target.items.clear();return;}
 const latest=!prior||String(p.date)>String(prior.date)||p.date===prior.date&&p.knownAt>=prior.knownAt?p:prior;
 target.items.set(key,{...latest,ambiguous:!!(prior?.ambiguous||p.ambiguous)});
}
function disciplineRows(state,{symbol=null,asOf=Date.now(),manualPlans=[],nextPlans=[]}={}){
 const rows=[];
 const counts=new Map(),proofs=new Map();for(const t of list(state?.trades)){counts.set(t?.id,(counts.get(t?.id)||0)+1);proofs.set(t?.sourceFingerprint,(proofs.get(t?.sourceFingerprint)||0)+1);}
 for(const t of list(state?.trades)){
  if(!code(t.code)||symbol&&t.code!==symbol||!text(t.id)||counts.get(t.id)!==1||proofs.get(t.sourceFingerprint)!==1||!hash(t.sourceFingerprint)||!time(instant(t.createdAt),asOf))continue;
  const p=t.paperSettlement,m=t.manualDecision,source=p?'模拟成交':m?'本人实录':null,raw=p||m;
  if(!source||p&&m)continue;
  const binding=p?paperBinding(t,state,asOf):manualBinding(t,manualPlans,asOf);if(!binding)continue;
  const planId=binding.plan?.id||null,knownAt=binding.knownAt;
  const date=t.exitDate;
  if(!cleanDay(date)||date>day(asOf))continue;
  const refs=p?[...list(p.entryFills).map(x=>x.eventId),p.exitEventId].filter(x=>text(x)):list(m.fills).map(x=>x.id||x.reference).filter(x=>text(x));
  const identity={code:t.code,source,date,knownAt,ref:t.id,planId,planVersion:binding.planVersion,
   accountId:p?.accountId||null,planFrozenAt:binding.plan?instant(binding.plan.frozenAt):null,
   ruleVersion:p?'original-shortline-paper-v1':'original-manual-settlement-v1',refs};
  // Keep the plan even when its imported rule facts are missing. A later
  // successful plan must not be selected merely because this one is unknown.
  rememberNextPlan(nextPlans,identity);
  const ruleCounts=new Map();for(const f of list(t.disciplineFacts))ruleCounts.set(f?.rule,(ruleCounts.get(f?.rule)||0)+1);
  const facts=list(t.disciplineFacts).filter(f=>ruleCounts.get(f?.rule)===1&&text(f?.rule)&&['符合','触发','不适用','资料不足'].includes(f.status)&&text(f.evidence));
  // Current imported labels may have been linked later than the requested
  // cutoff. Never let that future plan linkage prove an earlier discipline fact.
  for(const f of facts){
   let status=binding.plan?f.status:'资料不足',evidence=binding.reason||f.evidence;
   // Settlement imports have no intraday risk windows or full equity snapshot.
   // Preserve their unknowns even if an unrelated mutable label claims success.
   if(['超仓','违反止损'].includes(f.rule)&&f.status!=='资料不足'||f.rule==='过早离场'&&!['资料不足','不适用'].includes(f.status)){
    status='资料不足';evidence='原结算未封存该分类所需的权益、盘中可成交窗口或完整豁免证据';
   }
   const plan=binding.plan;
   if(p&&plan&&['追高','买入区间偏离'].includes(f.rule)){
    const expected=p.entryFills.every(leg=>leg.price<=plan.entryMax&&(f.rule!=='买入区间偏离'||leg.price>=plan.entryMin))?'符合':'触发';
    if(f.status!==expected){status='资料不足';evidence='原分类标签与冻结区间或原成交值不一致，保留未知';}
   }
   rows.push({...identity,rule:f.rule,status,evidence,evidenceRefs:refs,
    attribution:status==='触发'?'原执行纪律核验触发':status==='不适用'?'原规则不适用，非自动归责':status==='符合'?'原纪律核验符合':'未知'});
  }
 }
 return rows.sort((a,b)=>a.date.localeCompare(b.date)||a.knownAt-b.knownAt||a.ref.localeCompare(b.ref));
}
function nextPlanCheck(original,rows,plans,asOf,complete){
 const result={status:'unknown',label:'后续计划证据不足',scope:'read-archive-window-same-account-source-symbol',
  accountId:original.accountId||null,source:original.source,code:original.code,planId:null,planVersion:null,planFrozenAt:null,
  rule:original.rule,ruleVersion:original.ruleVersion||null,date:null,knownAt:null,ref:null,refs:[],evidence:null,reason:null,
  note:'仅在已读取原档案范围核对后续计划，不认证完整交易覆盖；保留原日事实，不证明用户看过建议或习惯改善。'};
 const unknown=(reason,status='unknown')=>({...result,status,reason});
 const identity=p=>['pool','pre'].includes(p.accountId)&&code(p.code)&&text(p.source)&&text(p.planId)&&hash(p.planVersion)&&
  time(p.planFrozenAt,p.knownAt)&&time(p.knownAt,asOf)&&text(p.ruleVersion)&&text(p.ref)&&!p.ambiguous;
 if(!identity(original))return unknown(original.accountId?
  '原问题缺少可核对的冻结计划版本、冻结时点、规则版本或原记录引用':'该来源未提供原账户身份，后续计划核对未就绪','not-ready');
 if(!complete)return unknown('后续原计划身份超过本次'+NEXT_PLAN_ID_LIMIT+'项核对容量，未选择任何候选；原日事实保持','not-ready');
 const visible=list(plans).filter(p=>p.code===original.code&&p.source===original.source&&p.planId!==original.planId&&time(p.knownAt,asOf));
 // Unknown identity/timing is an ordering gap, not permission to skip ahead.
 if(visible.some(p=>(p.accountId===original.accountId||!p.accountId)&&p.knownAt>original.knownAt&&
   (!time(p.planFrozenAt,p.knownAt)||!p.accountId)))return unknown('后续原计划的账户或冻结时点不完整，不能确定核对顺序');
 const candidates=visible.filter(p=>p.accountId===original.accountId&&p.planFrozenAt>original.knownAt)
  .sort((a,b)=>a.planFrozenAt-b.planFrozenAt||a.knownAt-b.knownAt);
 if(!candidates.length)return unknown('已读取范围内没有在本条原核验记录之后冻结的后续计划；不推断范围外交易');
 const first=candidates[0],same=visible.filter(p=>p.accountId===original.accountId&&p.planId===first.planId);
 Object.assign(result,{planId:first.planId||null,planVersion:first.planVersion||null,planFrozenAt:first.planFrozenAt});
 if(candidates.some(p=>p.planId!==first.planId&&p.planFrozenAt===first.planFrozenAt)||
   same.some(p=>p.planVersion!==first.planVersion||p.planFrozenAt!==first.planFrozenAt))
  return unknown('后续冻结计划的先后或版本身份有歧义，不能选择更晚的成功计划');
 const latest=same.sort((a,b)=>String(a.date).localeCompare(String(b.date))||a.knownAt-b.knownAt).at(-1);
 Object.assign(result,{ruleVersion:latest.ruleVersion||null,date:latest.date||null,knownAt:latest.knownAt,
  ref:latest.ref||null,refs:[...new Set([latest.ref,...list(latest.refs)].filter(v=>text(v)))]});
 if(!identity(latest))return unknown('所选后续计划缺少完整原身份或记录引用');
 if(latest.ruleVersion!==original.ruleVersion)return unknown('所选后续计划的原规则版本已变化，不能据此确认本次改进');
 const matched=rows.filter(r=>r.accountId===original.accountId&&r.code===original.code&&r.source===original.source&&
  r.planId===first.planId&&r.planVersion===first.planVersion&&r.planFrozenAt===first.planFrozenAt&&r.rule===original.rule&&
  r.ref===latest.ref&&r.knownAt===latest.knownAt);
 if(matched.length!==1)return unknown('所选后续计划缺少同一原引用下的唯一规则核验；不跳过该计划');
 const actual=matched[0];
 Object.assign(result,{evidence:actual.evidence||null,refs:[...new Set([actual.ref,...list(actual.refs)].filter(v=>text(v)))]});
 if(actual.ruleVersion!==original.ruleVersion||!list(actual.evidenceRefs).some(v=>text(v))||!['符合','触发'].includes(actual.status))
  return unknown('所选后续计划的原核验为'+actual.status+'或缺少同版本原始事件引用，仍需补证');
 return {...result,status:'observed',label:actual.status==='符合'?'后续计划原核验符合':'后续计划原核验再次触发',reason:null};
}
function followups(rows,{nextPlans=rows,asOf=Date.now(),nextPlanLimit=Infinity}={}){
 const out=[],ordered=rows.slice().sort((a,b)=>a.date.localeCompare(b.date)||a.knownAt-b.knownAt),groups=new Map();
 const inventory=Array.isArray(nextPlans)?nextPlanInventory():nextPlans;
 if(Array.isArray(nextPlans))for(const p of nextPlans)rememberNextPlan(inventory,p);
 const planScopes=new Map(),rowScopes=new Map(),scope=r=>JSON.stringify([r.source,r.code]);
 for(const [values,index] of [[inventory.items.values(),planScopes],[ordered,rowScopes]])for(const r of values){
  const key=scope(r);if(!index.has(key))index.set(key,[]);index.get(key).push(r);
 }
 const key=r=>JSON.stringify([r.code,r.source,r.planId,r.planVersion,r.rule,r.ruleVersion]);
 for(const r of ordered)if(text(r.planId)&&hash(r.planVersion)&&text(r.ruleVersion))groups.set(key(r),r);
 for(const r of ordered){
  if(!['触发','资料不足'].includes(r.status)||!Object.hasOwn(nextRules,r.rule))continue;
  const last=groups.get(key(r)),later=last?.date>r.date?last:null;
  const usable=later&&list(later.evidenceRefs).some(ref=>text(ref))&&['符合','触发'].includes(later.status);
  out.push({accountId:null,planFrozenAt:null,...r,nextCheck:nextRules[r.rule],followupScope:'same-plan-same-rule-version',followup:later?{
   status:usable?(later.status==='符合'?'后续处理已有符合证据':'后续原核验再次触发'):'后续证据不足',date:later.date,planId:later.planId,
   planVersion:later.planVersion,ruleVersion:later.ruleVersion,ref:later.ref,refs:later.refs,evidence:later.evidence,
   note:'仅核对同一计划、同一规则版本的后续处理；保留原日事实，不据此认定行为习惯已改善。'}:null});
 }
 for(const r of out.slice(-nextPlanLimit))r.nextPlanCheck=nextPlanCheck(r,rowScopes.get(scope(r))||[],planScopes.get(scope(r))||[],asOf,inventory.complete);
 return out;
}
function reportDisciplineRows(saved,{symbol=null,asOf=Date.now(),nextPlans=[],identitiesOnly=false}={}){
 const r=saved?.report,rows=[];
 if(saved?.status!=='observed'||!cleanDay(saved.day)||!hash(saved.reportHash)||!Number.isSafeInteger(saved.reportVersion)||saved.reportVersion<1||
  !time(saved.recordedAt,asOf)||saved.recordedAt<close(saved.day)||r?.protocol!=='paper-execution-daily-report-v1'||r.account!=='pool'||
  r.day!==saved.day||r.calculatedAt!==saved.recordedAt||!text(r.ruleVersion)||r.score?.day!==saved.day||r.score.closed!==true||
  r.checklist?.day!==saved.day||!Array.isArray(r.score.rows)||!Array.isArray(r.checklist.items)||r.score.rows.length>1000||r.checklist.items.length>1000)return rows;
 const plans=new Map(),duplicates=new Set(),scores=new Set();
 for(const p of r.checklist.items){if(plans.has(p?.planId))duplicates.add(p.planId);plans.set(p?.planId,p);}
 for(const s of r.score.rows){if(scores.has(s?.planId))duplicates.add(s.planId);scores.add(s?.planId);}
 for(const p of plans.values())if(code(p?.code)&&(!symbol||p.code===symbol)&&p.day===saved.day)
  rememberNextPlan(nextPlans,{code:p.code,source:'原模拟执行日报',accountId:r.account,date:saved.day,knownAt:saved.recordedAt,
   ref:saved.reportHash,refs:[saved.reportHash],planId:p.planId||null,planVersion:p.planVersion||null,
   planFrozenAt:time(instant(p.frozenAt),saved.recordedAt)?instant(p.frozenAt):null,ruleVersion:r.ruleVersion,
   ambiguous:duplicates.has(p.planId)});
 if(identitiesOnly)return rows;
 for(const score of r.score.rows){
  const p=plans.get(score?.planId);
  if(!p||duplicates.has(score.planId)||!text(score.planId)||!code(score.code)||symbol&&score.code!==symbol||p.code!==score.code||
    p.day!==saved.day||score.day!==saved.day||!hash(score.planVersion)||p.planVersion!==score.planVersion)continue;
  const counts=new Map();for(const f of list(score.facts))counts.set(f?.rule,(counts.get(f?.rule)||0)+1);
  for(const f of list(score.facts)){
   if(counts.get(f?.rule)!==1||!Object.hasOwn(nextRules,f?.rule)||!['符合','触发','不适用','资料不足'].includes(f.status)||!text(f.evidence))continue;
   const evidenceRefs=[...new Set([f.eventId,...list(f.eventIds),...list(f.observations).map(x=>x?.id)].filter(x=>text(x)))];
   rows.push({code:score.code,source:'原模拟执行日报',accountId:r.account,date:saved.day,knownAt:saved.recordedAt,ref:saved.reportHash,
    planFrozenAt:time(instant(p.frozenAt),saved.recordedAt)?instant(p.frozenAt):null,
    reportVersion:saved.reportVersion,planId:p.planId,planVersion:p.planVersion,ruleVersion:r.ruleVersion,rule:f.rule,status:f.status,
    evidence:f.evidence,evidenceRefs,refs:[saved.reportHash,...evidenceRefs],attribution:f.status==='不适用'?'原风控或规则不适用，非自动归责':f.status==='触发'?'原执行核验触发':f.status==='符合'?'原执行核验符合':'未知'});
  }
 }
 return rows;
}
async function readDiscipline(roots,{symbol=null,asOf=Date.now()}={},readShortline){
 if(symbol!==null&&!code(symbol)||!time(asOf,Date.now()))throw Error('纪律复盘身份或时点无效');
 const read=readShortline||((r)=>import('../research/shortline/store.mjs').then(m=>m.shortlineJob({root:r,book:'main',replica:true})));
 const coverage=[];let state=null,manual=null;
 // These stores have independent integrity boundaries. A missing or damaged
 // settlement archive must not hide still-valid manual logs and sealed reports.
 try{const r=await read(roots.shortlineRoot);if(!r?.ok||!r.state)throw Error();state=r.state;}
 catch{coverage.push('原短线结算档案未就绪，未使用该来源作出纪律结论');}
 try{manual=require('./manual-decision-loop').view(roots.manualRoot,{asOf});}catch{coverage.push('本人执行日志未就绪');}
 const nextPlans=nextPlanInventory(),rows=disciplineRows(state,{symbol,asOf,manualPlans:manual?.plans,nextPlans}),extra=[];
 // Repeated entries can be valid partial fills. Only display verifiable
 // separate original rounds, never mark repetition a violation by count.
 const rounds=list(state?.trades).filter(t=>code(t.code)&&(!symbol||t.code===symbol)&&paperBinding(t,state,asOf));
 const seen=new Map();
 for(const t of rounds.sort((a,b)=>a.paperSettlement.exitTimestamp-b.paperSettlement.exitTimestamp)){
  const p=t.paperSettlement,key=p.accountId+'|'+t.code,previous=seen.get(key),first=Math.min(...list(p.entryFills).map(f=>f.time));
  if(previous&&time(first,asOf)&&first>previous.paperSettlement.exitTimestamp&&day(first)===previous.exitDate)
   extra.push({code:t.code,source:'模拟成交',date:t.exitDate,knownAt:instant(t.createdAt),planId:time(t.decisionLink?.knownAt,asOf)?t.decisionLink.planId:null,rule:'重复交易',status:'资料不足',ref:t.id,
    refs:[previous.paperSettlement.exitEventId,...list(p.entryFills).map(f=>f.eventId)],evidence:'前次原批次卖出后同日出现新的买入批次；是否计划外重复交易需核对原计划',attribution:'未知'});
  seen.set(key,t);
 }
 try{
  const store=createPaperExecutionReportStore({root:path.join(roots.shortlineRoot,'execution-reports')});
  const days=store.days().filter(d=>d<=day(asOf)&&d>=day(asOf-59*86400000)).slice(-20);
  for(const d of days){
   // The source already retains bounded append-only versions. Retain earlier
   // plan identities so a removed/unknown next plan cannot be skipped, while
   // incident rows continue to display the latest original daily report only.
   const {versions}=store.snapshots({day:d,asOf,limit:MAX_VERSIONS});
   for(let i=0;i<versions.length;i++)rows.push(...reportDisciplineRows(versions[i],{
    symbol,asOf,nextPlans,identitiesOnly:i<versions.length-1}));
  }
 }catch{coverage.push('原执行日报未就绪')}
 if(manual){
  for(const p of list(manual.plans)){
   if(!code(p.symbol)||symbol&&p.symbol!==symbol)continue;
   if(p.notExecuted){const h=list(p.history).filter(x=>x.type==='not-executed').at(-1);if(h)rows.push({code:p.symbol,source:'本人原始日志',date:day(h.recordedAt),knownAt:h.recordedAt,ref:h.id,planId:p.id,rule:'按计划买入',status:'资料不足',evidence:'本人未执行说明：'+text(p.notExecuted.reason),refs:[p.id,h.id],attribution:'本人记录，客观可成交性未核验'});}
   if(p.review&&p.review.id)rows.push({code:p.symbol,source:'本人原始日志',date:day(p.review.recordedAt),knownAt:p.review.recordedAt,ref:p.review.id,planId:p.id,rule:'本人复盘归因',status:'资料不足',evidence:text(p.review.note)||'原本人复盘未填写说明',refs:[p.id,p.review.id],attribution:'本人原始判断，未独立认证策略失误'});
  }
 }
 const combined=[...rows,...extra].sort((a,b)=>a.date.localeCompare(b.date)||(a.knownAt||0)-(b.knownAt||0));
 const relevant=combined.slice(-500),allFollowups=followups(combined,{nextPlans,asOf,nextPlanLimit:300}),items=allFollowups.slice(-300);
 return {asOf,symbol,rows:relevant,followups:items,
  rowTotal:combined.length,followupTotal:allFollowups.length,
  scope:'原短线结算、本人日志及最近60日内最多20个交易日的原执行日报；展示各日最新版本，后续计划核对有界原版本；并非券商实盘',
  missing:[...coverage,'策略失误必须有独立策略复盘，不能仅以亏损归因','无法成交只采用原风控/日历证据；过早离场、重复买卖及完整盘中观察不足时保持未知','同计划后续处理与后续计划核对分别保留；后者限已读取档案范围，不能证明原问题消失或行为习惯改善'],...flags};
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
 const {explainSealedResearch}=await import('../../public/nova/research-review.mjs');
 const projected=explainSealedResearch({selectedRun:{...d,id:selected.hash,recordedAt:selected.recordedAt},asOf:input.asOf},input.question);
 const facts=[],citations=[];
 for(const c of projected.rows){
  if(input.question==='history'||facts.length>=60||c.coverageOnly)continue;
  const refs=c.evidence;
  const id='R'+(facts.length+1),backed=['pass','fail'].includes(c.status)&&refs.length>0;
  const evidenceStatus=refs.length?(backed?'observed':'incomplete'):'missing';
  // An unknown projection can retain its archived numeric display value even
  // when the source arrived after the cutoff. Do not transmit that value to a
  // model through the missing-evidence or invalidation question.
  facts.push({id,system:['fourteen','bazi','gpt','python','research36'].includes(c.system)?c.system:'other',status:c.status,
    value:backed&&finite(c.value)?c.value:null,threshold:backed&&finite(c.threshold)?c.threshold:null,op:backed&&['>','>=','<','<=','=','!='].includes(c.op)?c.op:null,
    currentValidity:'unknown',evidenceStatus});
  citations.push({id,ruleId:text(c.id),rule:text(c.name||c.id),version:text(c.version)||null,
    evidenceStatus,missingReason:backed?null:text(c.missing)||'该封存条件缺少可核对的原始证据',
    refs:refs.map(e=>({id:e.id,source:e.source,knownAt:Math.max(e.availableAt,e.receivedAt),ref:e.evidenceRef}))});
 }
 if(input.question==='history'){
  const similar=await similarSamples(root,{symbol:input.symbol,runId:input.runId,asOf:input.asOf});
  for(const g of similar.groups.filter(g=>g.modeled>0).slice(0,20)){
   const id='H'+(facts.length+1);
   facts.push({id,horizon:g.horizon,modeled:g.modeled,independentDays:g.independentDays,nonOverlappingWindows:g.nonOverlappingWindows,
    distinctSymbols:g.distinctSymbols,averageNetReturnPct:g.averageNetReturnPct,positiveFractionPct:g.positiveFractionPct,descriptiveOnly:true,individualPrediction:false});
   citations.push({id,ruleId:g.conditionSignature,rule:'原前向评测同条件分组（非五维相似匹配）',version:g.version,evidenceStatus:'observed',missingReason:null,
    refs:g.samples.slice(0,6).map(x=>({id:x.runId,source:g.provider,knownAt:x.exitOutcomeRecordedAt,ref:x.exitOutcomeRunId}))});
  }
 }
 if(!facts.length)return {...base,status:'not-ready',modelCalled:false,model:model.status().model,reason:'没有可供模型解释的封存条件'};
 if(!authorize())return {...base,status:'denied',modelCalled:false,reason:'授权已变化'};
 try{
  const r=await model.complete({prompt:'只做研究解释。不得建议或触发交易，不得改变原规则。只用以下结构化条件，不猜测缺失信息。输出JSON {"answer":"中文简述","citations":["R1"]}，引用编号必须存在。不根据缺少权重的反证排序，不输出买卖指令。问题类型 '+input.question+'。条件：'+JSON.stringify(facts)});
  const x=JSON.parse(r.text);
  only(x,['answer','citations']);
  if(typeof x.answer!=='string'||!x.answer.trim()||x.answer.length>1800||!Array.isArray(x.citations)||!x.citations.length||x.citations.length>20||
    new Set(x.citations).size!==x.citations.length||x.citations.some(id=>!citations.some(c=>c.id===id)))throw Error('模型引用无效');
  if(!authorize())return {...base,status:'denied',modelCalled:true,model:r.model,reason:'模型回执后授权已变化，未返回私有内容'};
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
module.exports={run,readTemplates,saveTemplate,readReplay,dailySeries,newsMarkers,tradeMarkers,similarSamples,disciplineRows,reportDisciplineRows,followups,readDiscipline,modelStatus,localAdapter,explain,flags};
