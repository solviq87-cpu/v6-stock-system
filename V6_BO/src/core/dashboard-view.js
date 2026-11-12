'use strict';
// Display-only projection of existing observed state. No orders, ranking changes or invented scores.
const number=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const text=v=>typeof v==='string'?v.slice(0,200):'';
const isCode=v=>typeof v==='string'&&/^\d{6}$/.test(v);
const {quoteObservationView}=require('./quote-observation-view');
const {linkIssuerEvents}=require('../strategy/issuer-event-linkage');
const {evaluatePlaybooks}=require('../strategy/research-playbook-engine');
const factorPack=require('../../strategies/extended-factor-pack.json');

const FACTOR_CATALOG=(Array.isArray(factorPack?.factors)?factorPack.factors:[])
 .filter(Boolean)
 .map(x=>({id:text(x.id),field:text(x.field),label:text(x.label||x.field),weight:number(x.weight)}))
 .filter(x=>x.field);
const FACTOR_FIELDS=FACTOR_CATALOG.map(x=>x.field);
const PUSH_SENT_RE=/^(?:✅)|送达结果未知/;
const PUSH_FAILED_RE=/^(?:❌|🚫|⚠️|🔒|夜间静默|副本拦截|↩️)|未送达|拒收|未配置|闸门|拦截/;

function factorValuesOf(row){
 const out={};
 for(const field of FACTOR_FIELDS){
  const v=number(row?.[field]);
  if(v!==null)out[field]=v;
 }
 return out;
}

function signalScopeOfCode(code){
 if(!isCode(code))return 'all';
 if(code.startsWith('68'))return 'kc50';
 if(code.startsWith('30'))return 'cyb';
 if(code.startsWith('60'))return 'sh';
 return 'sz';
}

function stageMeta(stage){
 const map={
  candidate:{label:'候选股票',order:5},
  triggered:{label:'信号已触发',order:1},
  pending:{label:'待发送',order:0},
  sent:{label:'发送成功',order:2},
  failed:{label:'发送失败',order:3},
  expired:{label:'已失效',order:4}
 };
 return map[stage]||{label:'待核验',order:6};
}

function normalizePushLogRecord(record){
 const ts=number(record?.ts);
 const status=text(record?.status);
 return {
  ts,
  status,
  title:text(record?.title),
  note:text(record?.note),
  channel:text(record?.channel),
  sent:PUSH_SENT_RE.test(status)&&status.indexOf('未发送')<0,
  failed:PUSH_FAILED_RE.test(status)&&status.indexOf('送达结果未知')<0
 };
}

function pushLogIndex(pushLog){
 const latestByCode=new Map();
 const historyByCode=new Map();
 const list=Array.isArray(pushLog)?pushLog:[];
 for(const item of list){
  const normalized=normalizePushLogRecord(item);
  const codes=Array.isArray(item?.extra?.codes)?item.extra.codes.filter(isCode):[];
  if(!codes.length||normalized.ts===null)continue;
  const historyEntry={
   ts:normalized.ts,
   status:normalized.status,
   title:normalized.title,
   note:normalized.note,
   channel:normalized.channel,
   sent:normalized.sent,
   failed:normalized.failed
  };
  for(const code of codes){
   const previous=latestByCode.get(code);
   if(!previous||normalized.ts>previous.ts)latestByCode.set(code,historyEntry);
   const history=historyByCode.get(code)||[];
   history.push(historyEntry);
   historyByCode.set(code,history);
  }
 }
 for(const [code,history] of historyByCode){
  history.sort((a,b)=>(b.ts||0)-(a.ts||0));
  const dedup=[],seen=new Set();
  for(const entry of history){
   const key=[entry.ts,entry.status,entry.title,entry.channel].join('|');
   if(seen.has(key))continue;
   seen.add(key);
   dedup.push(entry);
   if(dedup.length>=20)break;
  }
  historyByCode.set(code,dedup);
  if(!latestByCode.get(code)&&dedup.length)latestByCode.set(code,dedup[0]);
 }
 return {latestByCode,historyByCode};
}

function conditionLine(id,label,value,threshold,operator,source,updatedAt,fallbackReason='缺失值'){
 const actual=number(value);
 const gate=number(threshold);
 let satisfied=null;
 if(actual!==null&&gate!==null){
  if(operator==='>=')satisfied=actual>=gate;
  else if(operator==='<=')satisfied=actual<=gate;
  else if(operator==='>')satisfied=actual>gate;
  else if(operator==='<')satisfied=actual<gate;
 }
 const reason=satisfied===null?fallbackReason:(satisfied?'满足':'未满足');
 return {id:text(id),label:text(label),value:actual,threshold:gate,operator:text(operator),satisfied,reason:text(reason),source:text(source),updatedAt:number(updatedAt)};
}

function stageOfSignal(signalRow,pushRecord,candidateRow,pushLast,now){
 const ts=number(signalRow?.ts)||0;
 const age=ts>0?Math.max(0,now-ts):Infinity;
 if(pushRecord?.sent)return {state:'sent',reason:'已存在可核验的发送记录'};
 if(pushRecord?.failed)return {state:'failed',reason:pushRecord.note||pushRecord.status||'发送未完成'};
 if(pushLast&&pushLast.sent===null&&number(pushLast.t)!==null&&number(pushLast.t)>=ts&&age<=5*60*1000){
  return {state:'pending',reason:text(pushLast.why)||'等待通道回执'};
 }
 if(age>6*60*60*1000&&(!candidateRow||candidateRow.price==null)){
  return {state:'expired',reason:'信号窗口已过且当前候选池无对应行情'};
 }
 return {state:'triggered',reason:age<=10*60*1000?'信号刚触发，等待发送状态':'信号已触发，仍需核验推送回执'};
}

function pushProjection(state,rows,poolByCode,pushMeta,now){
 const signals=Array.isArray(state?.signals)?state.signals:[];
 const pushLast=pushMeta&&typeof pushMeta==='object'?pushMeta.pushLast:null;
 const pushGov=pushMeta&&typeof pushMeta==='object'?pushMeta.pushGov:null;
 const {latestByCode:pushByCode,historyByCode}=pushLogIndex(pushMeta&&typeof pushMeta==='object'?pushMeta.pushLog:[]);
 const items=[];
 const seenSignalCode=new Set();
 const signalsByCode=new Map();
 for(const sig of signals){
  const code=text(sig?.code);
  if(!isCode(code))continue;
  const grouped=signalsByCode.get(code)||[];
  grouped.push(sig);
  signalsByCode.set(code,grouped);
 }
 for(const [code,grouped] of signalsByCode){
  grouped.sort((a,b)=>(number(b?.ts)||0)-(number(a?.ts)||0));
  const sig=grouped[0]||null;
  if(!sig)continue;
  seenSignalCode.add(code);
  const row=poolByCode.get(code)||null;
  const pushRecord=pushByCode.get(code)||null;
  const stage=stageOfSignal(sig,pushRecord,row,pushLast,now);
  const signalProb=number(sig?.riseProb)??number(sig?.prob);
  const probThreshold=number(pushGov?.minProb);
  const conditions=[
   conditionLine('probability','信号概率评分',signalProb,probThreshold,'>=',probThreshold===null?'阈值缺失':'pushGov.minProb',sig?.ts,probThreshold===null?'当前无概率阈值配置':'缺失概率值'),
   conditionLine('main_pct','主力净占比',sig?.mainPct,0,'>=','state.signals.mainPct',sig?.ts,'缺少主力占比'),
   conditionLine('candidate_score','候选评分',row?.score,0,'>=','candidate.score',row?.quoteAt||state?.stocksAt,'候选池暂未收录该票')
  ];
  const met=conditions.filter(x=>x.satisfied===true).length;
  const validN=conditions.filter(x=>x.satisfied!==null).length;
  const stageInfo=stageMeta(stage.state);
  const signalHistory=grouped.slice(0,12).map(entry=>({
   triggerAt:number(entry?.ts),
   triggerStrategy:text(entry?.type||'未标注策略'),
   probability:number(entry?.riseProb)??number(entry?.prob),
   price:number(entry?.price),
   pct:number(entry?.pct),
   mainPct:number(entry?.mainPct),
   rawMessage:text(entry?.msg||'')
  }));
  items.push({
   id:text((sig?.type||'signal')+'-'+code+'-'+(sig?.ts||'')),
   scope:signalScopeOfCode(code),
   source:'state.signals',
   stage:stage.state,
   stageLabel:stageInfo.label,
   stageReason:stage.reason,
   stageOrder:stageInfo.order,
   code,
   name:text(sig?.name||row?.name||code),
   sector:text(sig?.sector||row?.sector||row?.industry||''),
   price:number(sig?.price)??number(row?.price),
   pct:number(sig?.pct)??number(row?.pct),
   quoteAt:number(row?.quoteAt)||number(state?.stocksAt)||number(sig?.ts),
   quoteSource:text(row?.quoteSource||'候选快照'),
   triggerStrategy:text(sig?.type||'未标注策略'),
   triggerAt:number(sig?.ts),
   pushAt:pushRecord&&pushRecord.ts!==null?pushRecord.ts:null,
   pushStatus:text(pushRecord?.status||''),
   pushChannel:text(pushRecord?.channel||''),
   pushNote:text(pushRecord?.note||''),
   rawMessage:text(sig?.msg||''),
    volume:number(sig?.volume)??number(row?.volume),
    amount:number(sig?.amount)??number(row?.amount),
    turnover:number(sig?.turnover)??number(row?.turnover),
    mainInflow:number(sig?.mainInflow)??number(row?.mainInflow),
    mainPct:number(sig?.mainPct)??number(row?.mainPct),
    dataSource:text(sig?.source||row?.quoteSource||'state.signals'),
    strategyVersion:text(pushMeta?.strategyVersion||state?.strategyVersion||''),
    riskLevel:row?.bad===true?'high':'unknown',
    stopLossRule:text(sig?.stopLoss||'待验证'),
    invalidationRule:text(sig?.invalidWhen||'待验证'),
    signalValidity:stage.state==='expired'||stage.state==='failed'?'invalid':'active',
    signalHistory,
    duplicateSignalCount:Math.max(0,grouped.length-1),
    pushHistory:historyByCode.get(code)||[],
   conditions,
   conditionsSummary:{met,total:validN,label:`条件满足 ${met}/${validN}`},
   factorValues:row?.factorValues&&typeof row.factorValues==='object'?row.factorValues:{},
   factorEvidence:row?.factorEvidence&&typeof row.factorEvidence==='object'?row.factorEvidence:{},
   playbookAnalysis:row?.playbookAnalysis&&typeof row.playbookAnalysis==='object'?row.playbookAnalysis:null,
   focused:row?.focused===true
  });
 }

 for(const row of rows){
  if(!isCode(row.code)||seenSignalCode.has(row.code))continue;
  const values=row.factorValues&&typeof row.factorValues==='object'?row.factorValues:{};
  const firstField=Object.keys(values)[0]||'';
  const threshold=firstField?70:null;
  const candidateConditions=[
   conditionLine('candidate_score','候选评分',row.score,0,'>=','candidate.score',row?.quoteAt||state?.stocksAt,'候选评分缺失'),
   conditionLine(firstField||'factor_preview',firstField?`${firstField} 研究阈值`:'研究阈值',firstField?values[firstField]:null,threshold,'>=',firstField?'candidate.factorValues':'无可用因子',row?.quoteAt||state?.stocksAt,firstField?'因子值缺失':'暂无可量化因子')
  ];
  const met=candidateConditions.filter(x=>x.satisfied===true).length;
  const validN=candidateConditions.filter(x=>x.satisfied!==null).length;
  const stageInfo=stageMeta('candidate');
  items.push({
   id:'candidate-'+row.code,
   scope:signalScopeOfCode(row.code),
   source:'candidate_pool',
   stage:'candidate',
   stageLabel:stageInfo.label,
   stageReason:'仅进入候选池，尚未触发推送信号',
   stageOrder:stageInfo.order,
   code:text(row.code),
   name:text(row.name||row.code),
   sector:text(row.sector||''),
   price:number(row.price),
   pct:number(row.pct),
   quoteAt:number(row.quoteAt)||number(state?.stocksAt)||null,
   quoteSource:text(row.quoteSource||'候选快照'),
   triggerStrategy:'候选观察',
   triggerAt:null,
   pushAt:null,
   pushStatus:'',
   pushChannel:'',
   pushNote:'',
   rawMessage:'',
   volume:number(row?.volume),
   amount:number(row?.amount),
   turnover:number(row?.turnover),
   mainInflow:number(row?.mainInflow),
   mainPct:number(row?.mainPct),
   dataSource:text(row?.quoteSource||'candidate_pool'),
   strategyVersion:text(pushMeta?.strategyVersion||state?.strategyVersion||''),
   riskLevel:row?.bad===true?'high':'unknown',
   stopLossRule:'待验证',
   invalidationRule:'待验证',
   signalValidity:'unknown',
   signalHistory:[],
   duplicateSignalCount:0,
   pushHistory:historyByCode.get(row.code)||[],
   conditions:candidateConditions,
   conditionsSummary:{met,total:validN,label:`条件满足 ${met}/${validN}`},
   factorValues:values,
   factorEvidence:row.factorEvidence&&typeof row.factorEvidence==='object'?row.factorEvidence:{},
   playbookAnalysis:row.playbookAnalysis&&typeof row.playbookAnalysis==='object'?row.playbookAnalysis:null,
   focused:row.focused===true
  });
 }

 items.sort((a,b)=>(a.stageOrder-b.stageOrder)||((b.triggerAt||0)-(a.triggerAt||0))||((b.quoteAt||0)-(a.quoteAt||0))||String(a.code).localeCompare(String(b.code)));
 const counts={candidate:0,triggered:0,pending:0,sent:0,failed:0,expired:0,total:items.length};
 for(const x of items){
  if(Object.prototype.hasOwnProperty.call(counts,x.stage))counts[x.stage]++;
 }
 const emptyReason=!items.length?'当前未收录候选/触发信号，无法生成系统推送股票卡片':'';
 return {
  asOf:now,
  source:'state.signals + pushlog',
  channels:{
   stageNote:'候选池、信号触发、站内展示与外发送达状态分开记录',
   lastDispatch:pushLast&&typeof pushLast==='object'?{ret:pushLast.ret===true,sent:pushLast.sent===true,t:number(pushLast.t),why:text(pushLast.why)}:null
  },
  throttle:pushGov&&typeof pushGov==='object'?{
   quota:number(pushGov.quota),used:number(pushGov.used),left:number(pushGov.left),
   dropped:number(pushGov.dropped),lowProb:number(pushGov.lowProb),throttled:number(pushGov.throttled)
  }:null,
  counts,
  emptyReason,
   strategyVersion:text(pushMeta?.strategyVersion||state?.strategyVersion||''),
   items
 };
}

function dashboardView(state,mood=null,now=Date.now(),meta={}){
 const riskEvidence=require('./risk-evidence-view').riskEvidenceView(state,now);
 const pool=Array.isArray(state.candidatePool)?state.candidatePool.filter(Boolean):[];
 const observed=Number.isFinite(state.stocksAt)&&state.stocksAt>0;
 const fourteenCodes=new Set((state.myrules?.items||[]).filter(Boolean).map(x=>x.code));
 const sectorCounts=new Map(Object.entries(state.ztBySector||{}).map(([name,list])=>[name,Array.isArray(list)?list.length:0]));
 const rows=pool.map(c=>({...quoteObservationView(c,now),code:text(c.code),name:text(c.name),price:number(c.price),pct:number(c.pct),score:number(c.score),
   volume:number(c.volume),amount:number(c.amount),turnover:number(c.turnover),mainInflow:number(c.mainInflow),mainPct:number(c.mainPct),
   sector:text(c.sector||c.industry||''),
   fourteen:fourteenCodes.has(c.code),focused:c.focused===true||c.focused===1,signals:Array.isArray(c.paths)?c.paths.filter(x=>typeof x==='string').slice(0,5):[],
   explanation:Array.isArray(c.pathWhy)?c.pathWhy.filter(x=>typeof x==='string').slice(0,5):typeof c.pathWhy==='string'?[c.pathWhy]:[],
   news:riskEvidence.news.filter(n=>n.codes.includes(c.code)).slice(0,6),
   issuerEvidence:linkIssuerEvents({symbol:c.code,now,announcements:riskEvidence.news.filter(n=>n.codes.includes(c.code))}),
   probabilityLabel:riskEvidence.probabilityLabel,bad:!!state.news?.badCodes?.has?.(c.code),bazi:c.bazi?{score:number(c.bazi.total),verdict:text(c.bazi.verdict),line:text(c.bazi.line)}:null,
   factorValues:factorValuesOf(c),factorEvidence:c.factorEvidence&&typeof c.factorEvidence==='object'?c.factorEvidence:{},
   playbookAnalysis:c.playbookAnalysis&&Array.isArray(c.playbookAnalysis.playbooks)?c.playbookAnalysis:evaluatePlaybooks(c)}));
 const poolByCode=new Map(rows.filter(x=>isCode(x.code)).map(x=>[x.code,x]));
 const pushes=pushProjection(state,rows,poolByCode,meta,now);
 const up=number(mood?.upN),down=number(mood?.downN),flat=number(mood?.flatN);
 const total=up!==null&&down!==null?up+down+(flat??0):0;
 const rules=state.myrules;
 return {sixPhotoBackups:require('./six-photo-backups').readSixPhotoBank(process.env.V6_SIX_PHOTO_FILE),publicQuoteProbe:require('./public-quote-probe').readPublicQuoteProbe(process.env.V6_PUBLIC_QUOTE_PROBE_FILE),parallelMarket:require('./parallel-market').readParallelMarket(process.env.V6_PARALLEL_MARKET_FILE),riskEvidence,schemaVersion:1,observedAt:observed?state.stocksAt:null,indexObservedAt:number(state.idxRt?.at),
   source:'现有行情快照 · 未完成供应商认证',verifiedLive:false,
   indices:(state.idxRt?.items||[]).filter(Boolean).slice(0,4).map(x=>({code:text(x.code),name:text(x.name),price:number(x.price),pct:number(x.pct)})),
   mood:{label:text(mood?.mood),advice:text(mood?.advice),note:text(mood?.why||mood?.note),upN:up,downN:down,flatN:flat,ztN:number(mood?.ztN),dtN:number(mood?.dtN),upRatio:observed&&total?Math.round(up/total*100):null,
    scope:{market:'全A',sample:total||null,snapAt:number(mood?.snapAt)||number(state.stocksAt),method:'外围30% + 涨跌比40% + 资金30%',dtSource:text(mood?.dtSrc||''),idxAt:number(mood?.idxAt)||number(state?.idxRt?.at)}},
   sectors:(Array.isArray(state.sectors)?state.sectors:[]).slice(0,40).map(s=>({name:text(s?.name),pct:number(s?.pct),mainInflow:number(s?.mainInflow),ztCount:sectorCounts.get(s?.name)||0})),
   counts:{candidates:observed?pool.length:null,focused:observed?rows.filter(x=>x.focused).length:null,signals:observed&&Array.isArray(state.signals)?state.signals.length:null,risk:observed?rows.filter(x=>x.bad).length:null},
   strategies:[{id:'fourteen',label:'十四条选股',count:rules?.date?number(rules.count):null,note:rules?.date?text(rules.date):'尚无独立证据'},
    {id:'bazi',label:'八字口诀',count:observed?rows.filter(x=>x.bazi).length:null,note:'候选池已评估数'},
    {id:'gpt',label:'GPT 五策略',count:null,note:'请在研究台独立验证'},
    {id:'python',label:'Python 三轮',count:null,note:'需原生执行证据'}],
   factorCatalog:FACTOR_CATALOG,
   pushes,
   rows};
}
module.exports={dashboardView};
