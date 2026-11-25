'use strict';
// One read model over the existing shortline archive and research event chain.
// It owns no quotes, cash, positions, execution, notifications or model approval.
const crypto=require('node:crypto');
const store=require('./research-workspace-store');
const {causalHistory}=require('../research/automatic-research');
const rows=x=>Array.isArray(x)?x:[];
const flags={researchOnly:true,canTrade:false,canNotify:false,productionWeightsChanged:false,autoPromotion:false};
const fingerprint=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const chinaDay=at=>new Date(at+28800000).toISOString().slice(0,10);
function instant(value){
 if(Number.isSafeInteger(value)&&value>0)return value;
 if(typeof value!=='string')return null;
 const raw=/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d)?$/.test(value)?value.replace(' ','T')+(value.length===16?':00':'')+'+08:00':value;
 const at=Date.parse(raw);return Number.isSafeInteger(at)&&at>0?at:null;
}
function known(row,asOf){
 const times=['knownAt','receivedAt','recordedAt','createdAt','observedAtMs','observedAt','frozenAt'].filter(k=>row?.[k]!=null).map(k=>instant(row[k]));
 return times.length>0&&times.every(at=>at!==null&&at<=asOf);
}
function causalArchive(archive,asOf){
 const out={...archive};
 for(const key of ['checks','plans','trades','explanations','candidates','versions','notes','checkins','market','marketHistory','bars','corrections','executionReports','feedbackRuns','manualLoopLinks'])
  out[key]=rows(archive[key]).filter(row=>known(row,asOf));
 if(!known(archive.v6Observation,asOf))delete out.v6Observation;
 if(!known(archive.executionReport,asOf))delete out.executionReport;
 return out;
}
function evidenceBars(archive,events,asOf){
 const byIdentity=new Map(),quarantined=new Set(),diagnostics={sourceRows:0,duplicates:0,lateEnrichmentsOmitted:0,workspaceReceiptFloorApplied:0,rejected:0,quarantinedRows:0,conflicts:[]};
 const {isTestSample}=require('../../public/nova/shortline/sample-quality.mjs');
 const at=value=>{
  if(typeof value==='string'&&/^\d{4}-\d\d-\d\d$/.test(value)){
   const date=Date.parse(value);return Number.isFinite(date)&&new Date(date).toISOString().slice(0,10)===value?Date.parse(value+'T15:00:00+08:00'):null;
  }
  const parsed=instant(value);return parsed!==null&&parsed<8e15?parsed:null;
 };
 const test=bar=>isTestSample(bar)||bar?.simulated===true||['source','sampleSource','provider'].some(k=>/synthetic|fixture|mock|demo|simulated|教学|测试/i.test(String(bar?.[k]||'')))||/^合成验证股票/.test(bar?.name||'');
 const normalizePeriod=value=>({daily:'日K','1d':'日K',D:'日K','日线':'日K',weekly:'周K',W:'周K','周线':'周K',monthly:'月K',M:'月K','月线':'月K'})[value]||value;
 const values=['open','high','low','close','volume','amount','turnover','limitUp','limitDown','sessionOpen','sessionClose'];
 const add=input=>{
  diagnostics.sourceRows++;
  if(!input||!known(input,asOf)){diagnostics.rejected++;return;}
  const received=['knownAt','receivedAt','recordedAt'].filter(k=>input[k]!=null).map(k=>at(input[k])),ended=at(input.date),available=at(input.availableAt||input.date);
  if(!received.length||received.some(v=>!Number.isSafeInteger(v))||!Number.isSafeInteger(ended)||!Number.isSafeInteger(available)||Math.max(...received)>asOf||ended>asOf||available>asOf||available<ended||Math.max(...received)<ended){diagnostics.rejected++;return;}
  const bar={...input,role:input.role||'stock',period:normalizePeriod(input.period||(String(input.date).length>10?'分时':'日K')),knownAt:Math.max(...received),sampleSet:test(input)?'test':input.sampleSet||'real'};
  const identity=[bar.sampleSet,bar.role,bar.code,bar.period,bar.date].join('/');
  if(quarantined.has(identity)){diagnostics.quarantinedRows++;return;}
  const previous=byIdentity.get(identity);
  if(!previous){byIdentity.set(identity,bar);return;}
  const conflict=values.some(k=>previous[k]!=null&&bar[k]!=null&&previous[k]!==bar[k])||previous.priceBasis&&bar.priceBasis&&previous.priceBasis!==bar.priceBasis;
  if(conflict){
   byIdentity.delete(identity);quarantined.add(identity);diagnostics.quarantinedRows+=2;
   diagnostics.conflicts.push({identity,reason:'同一时点来源或修订值冲突，已隔离研究计算',receipts:[previous.knownAt,bar.knownAt]});
   return;
  }
  diagnostics.duplicates++;
  // Keep the whole earliest available observation. Copying later optional
  // fields onto its old receipt would silently backdate that enrichment.
  const previousVisible=Math.max(previous.knownAt,at(previous.availableAt||previous.date)),currentVisible=Math.max(bar.knownAt,available);
  if(values.some(k=>(previous[k]==null)!==(bar[k]==null)))diagnostics.lateEnrichmentsOmitted++;
  if(currentVisible<previousVisible)byIdentity.set(identity,bar);
 };
 for(const row of rows(archive.bars))add(test(archive)?{...row,sampleSet:'test'}:row);
 for(const event of rows(events)){
  if(event?.kind!=='analysis'||!Number.isSafeInteger(event.recordedAt)||event.recordedAt<=0||event.recordedAt>asOf||!Number.isSafeInteger(event.data?.asOf)||event.data.asOf<=0||event.data.asOf>event.recordedAt)continue;
  const d=event.data;
  const append=(b,identity,ancestor)=>{
   const received=['knownAt','receivedAt','recordedAt'].filter(k=>b?.[k]!=null).map(k=>at(b[k]));
   if(!received.length||received.some(t=>t===null)||Math.max(...received)>d.asOf||b.code&&b.code!==identity.code){diagnostics.sourceRows++;diagnostics.rejected++;return;}
   const originalKnownAt=Math.max(...received),knownAt=Math.max(originalKnownAt,event.recordedAt);
   if(knownAt>originalKnownAt)diagnostics.workspaceReceiptFloorApplied++;
   // The workspace chain proves receipt of this snapshot, not the earlier
   // client/provider timestamp. An already archived identical bar can retain
   // its own proven earlier receipt through the identity deduplication above.
   add({...b,...identity,knownAt,originalKnownAt,workspaceRecordedAt:event.recordedAt,
    workspaceEventHash:/^[a-f0-9]{64}$/.test(event.hash||'')?event.hash:null,receiptPolicy:'first-workspace-server-receipt',
    sampleSet:test(event)||test(d)||test(ancestor)||test(b)?'test':b.sampleSet||d.sampleSet||'real'});
  };
  for(const b of rows(d.bars))append(b,{code:d.symbol,name:d.name,role:'stock',period:'日K',source:b.source||b.provider||d.provider,provider:b.provider||d.provider,priceBasis:b.priceBasis||d.priceBasis},d);
  const benchmark=d.benchmarkSeries;
  for(const b of rows(benchmark?.bars))append(b,{role:'index',code:benchmark.symbol||benchmark.code||'unknown-index',period:'日K',source:b.source||b.provider||benchmark.provider,provider:b.provider||benchmark.provider,priceBasis:b.priceBasis||benchmark.priceBasis},benchmark);
 }
 const result=[...byIdentity.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.code).localeCompare(String(b.code))||String(a.period).localeCompare(String(b.period)));
 diagnostics.admittedRows=result.length;diagnostics.testRows=result.filter(test).length;diagnostics.realRows=result.length-diagnostics.testRows;
 Object.defineProperty(result,'evidenceDiagnostics',{value:diagnostics,enumerable:false});
 return result;
}
function historyFrom(events,code,asOf,calendar={}){
 const {isTestSample}=require('../../public/nova/shortline/sample-quality.mjs');
 const test=row=>isTestSample(row)||row?.simulated===true||['source','sampleSource','provider'].some(k=>/synthetic|fixture|mock|demo|simulated|教学|测试/i.test(String(row?.[k]||'')))||/^合成验证股票/.test(row?.name||'');
 const realStock=bar=>bar.role==='stock'&&bar.code===code&&bar.priceBasis==='unadjusted'&&!test(bar);
 const eligible=rows(events).filter(e=>e?.kind==='analysis'&&Number.isSafeInteger(e.recordedAt)&&e.recordedAt>0&&e.recordedAt<=asOf&&
  Number.isSafeInteger(e.data?.asOf)&&e.data.asOf>0&&e.data.asOf<=e.recordedAt&&e.data.symbol===code&&e.data.priceBasis==='unadjusted'&&
  typeof e.data.provider==='string'&&e.data.provider.trim()&&!test(e)&&!test(e.data))
  .sort((a,b)=>b.data.asOf-a.data.asOf||b.recordedAt-a.recordedAt||(b.sequence||0)-(a.sequence||0));
 // A later import of an older observation must not change the effective
 // provider. Pick the latest analysis with at least one admissible real bar.
 const latest=eligible.find(e=>evidenceBars({bars:[]},[e],asOf).some(realStock));
 if(!latest)return null;
 const bars=evidenceBars({bars:[]},eligible.filter(e=>e.data.provider===latest.data.provider),asOf).filter(realStock)
  .map(b=>({...b,priceKnownAt:b.knownAt}));
 const tradeDates=Array.isArray(calendar?.tradeDates)?calendar.tradeDates:rows(latest.data.tradeDates);
 return causalHistory({...latest.data,bars},tradeDates);
}
async function buildEvolutionReport({archive={},events=[],code,asOf=Date.now(),calendar={},financials=null,financialMissing=null,ledger={},preferences=null,history=null,trialInputs=null,options={}}={}){
 if(!Number.isSafeInteger(asOf)||asOf<=0||asOf>Date.now())throw Error('研究时点无效');
 if(code!==undefined&&code!==''&&!/^\d{6}$/.test(code))throw Error('研究证券无效');
 calendar=calendar||{};
 if(preferences&&preferences.revision!==0&&(!Number.isSafeInteger(preferences.recordedAt)||preferences.recordedAt>asOf))preferences=null;
 const visibleEvents=events.filter(e=>Number.isSafeInteger(e.recordedAt)&&e.recordedAt<=asOf&&
  (e.kind==='analysis'?Number.isSafeInteger(e.data?.asOf)&&e.data.asOf<=asOf:!Number.isSafeInteger(e.data?.asOf)||e.data.asOf<=asOf));
 const visible=causalArchive(archive,asOf);
 visible.bars=evidenceBars(visible,visibleEvents,asOf);
 visible.tradeDates=calendar?.tradeDates||[];
 visible.calendar=calendar||{};
 code=code||preferences?.value?.selectedCode||visible.v6Observation?.code||visible.checks.at(-1)?.code||visibleEvents.findLast(e=>e.kind==='analysis')?.data.symbol||visible.bars.find(b=>!b.role||b.role==='stock')?.code||'';
 const symbols=new Map();
 for(const row of [...visible.bars,...visible.checks,...visible.plans])if(/^\d{6}$/.test(row.code)&&(!row.role||row.role==='stock'))symbols.set(row.code,row.name||row.code);
 for(const e of visibleEvents)if(e.kind==='analysis')symbols.set(e.data.symbol,e.data.name||e.data.symbol);
 const market=require('./evolution-market-evidence').buildEvolutionMarketEvidence({archive:visible,code,asOf,financials,
  signal:visible.plans.filter(p=>p.code===code).at(-1)||visible.checks.filter(c=>c.code===code).at(-1),
  latestEvidence:visible.checks.filter(c=>c.code===code).at(-1),calendar});
 if(financialMissing&&!financials)market.financialHealth={...market.financialHealth,sourceReason:financialMissing};
 const originalHistory=history||historyFrom(visibleEvents,code,asOf,calendar),historyFingerprint=fingerprint(originalHistory);
 const nativeInputsFingerprint=fingerprint(require('./evolution-research-statistics').diagnosticInputsFromEvents(visibleEvents,originalHistory,{asOf}));
 const implementationFingerprint=require('./evolution-diagnostic-version').diagnosticImplementationFingerprint();
 const diagnostic=visibleEvents.findLast(e=>e.kind==='diagnostic'&&e.data.protocol==='evolution-diagnostics-v1'&&e.data.code===code&&
  e.data.historyFingerprint===historyFingerprint&&e.data.nativeInputsFingerprint===nativeInputsFingerprint&&
  e.data.implementationFingerprint===implementationFingerprint&&e.data.horizon===(options.horizon||5));
 const statistics=await require('./evolution-research-statistics').buildEvolutionStatistics({archive:visible,events:visibleEvents,
  asOf,history:originalHistory,trialInputs,options:{...options,...(diagnostic?{diagnostics:diagnostic.data.result}:{})}});
 if(trialInputs)statistics.overfitting.archive={status:trialInputs.status,source:trialInputs.source||null,reason:trialInputs.reason||null,
  archiveCount:trialInputs.archiveCount??0,limitations:trialInputs.limitations||[]};
 const workflow=await require('./evolution-workflow').buildEvolutionWorkflow({archive:visible,events:visibleEvents,asOf,code,ledger,calendar});
 if(preferences)workflow.preferences=preferences;
 const {observations,similarCases}=await import('../../public/nova/shortline/backtest.mjs');
 const point=new Date(asOf+28800000).toISOString().slice(0,16).replace('T',' ');
 const observed=observations(visible,point,{all:true,causal:true});
 const selected=observed.filter(r=>r.code===code).sort((a,b)=>String(b.decisionAt||b.date).localeCompare(String(a.decisionAt||a.date)))[0];
 const similar=selected?similarCases(visible,selected,point):{status:'not-evaluated',reason:'尚无当时已取得证据的历史观察',neighbours:[],success:[],failure:[],neutral:[],missing:[]};
 const sources={archiveRevision:archive.revision??0,visibleBars:visible.bars.length,visibleChecks:visible.checks.length,visibleEvents:visibleEvents.length,
  observedThrough:visible.bars.reduce((d,b)=>b.date>d?b.date:d,''),selectedCode:code,day:chinaDay(asOf),barEvidence:visible.bars.evidenceDiagnostics,
  implementationFingerprint,diagnosticRecord:diagnostic?.hash||null};
 const result={schemaVersion:1,mode:'fayo-intelligence-evolution',asOf,code,symbols:[...symbols].map(([code,name])=>({code,name})),
  sources,market,similar,statistics,workflow,...flags};
 result.fingerprint=fingerprint(result);
 result.visibleEvidenceFingerprint=fingerprint({asOf,code,market,similar,statistics,workflow,
  historyFingerprint,nativeInputsFingerprint,implementationFingerprint});
 return result;
}
async function readEvolutionReport({root,workspaceRoot,paths={},query={},calendar,replica=false,now=Date.now()}={}){
 const {shortlineJob}=await import('../research/shortline/store.mjs');
 const archive=await shortlineJob({root,book:'main',replica});
 if(!archive.ok)return archive;
 const asOf=query.asOf??now,events=store.readEvents(workspaceRoot,{asOf});
 const workflow=require('./evolution-workflow');
 const preferences=workflow.readEvolutionPreferences(workspaceRoot,{asOf});
 const visible=causalArchive(archive.state,asOf);
 const code=query.code||preferences.value?.selectedCode||visible.v6Observation?.code||visible.checks.at(-1)?.code||events.findLast(e=>e.kind==='analysis')?.data.symbol||'';
 let financials=null,financialMissing='尚无原始财报回执';
 if(code&&paths.evidenceRoot&&paths.observationRoot){
  const read=require('./decision-evidence').createDecisionFinancialReader({...paths,ttlMs:0}).read([code],{now:asOf});
  financials=read.byCode[code]||null;financialMissing=read.missingByCode[code]||null;
 }
 let trialInputs;
 try{const statistics=require('./evolution-research-statistics');trialInputs=statistics.readEvolutionTrialInputs({asOf,configFile:paths.factorConfigFile,
  modelDir:paths.factorModelDir,captureDir:paths.factorCaptureDir,signalDays:statistics.researchSignalDays(events,{asOf})});}
 catch{trialInputs={status:'not-evaluated',reason:'原试验档案完整性校验未通过，不能计算过拟合验证',trialReports:[],signalDays:[]};}
 const result=await buildEvolutionReport({archive:archive.state,events,code,asOf,calendar,financials,financialMissing,preferences,
  trialInputs,ledger:paths.manualLedgerRoot?require('./manual-decision-loop').view(paths.manualLedgerRoot,{asOf,workspaceRoot}):{},options:{horizon:query.horizon||5}});
 return {ok:true,result};
}
async function runStoredEvolutionDiagnostics({root,workspaceRoot,query={},input={},calendar,replica=false,now=Date.now()}={}, {beforeCommit}={}){
 if(replica)throw Error('副本不能保存研究诊断');
 const command={symbol:input.symbol??null,asOf:input.asOf??null,horizon:input.horizon??'5'},commandFingerprint=fingerprint(command);
 const previous=store.readEvents(workspaceRoot).find(e=>e.requestId===input.requestId);
 if(previous){
  if(previous.kind!=='diagnostic'||previous.data.protocol!=='evolution-diagnostics-v1'||previous.data.commandFingerprint!==commandFingerprint)throw Error('同请求ID内容冲突');
  if(beforeCommit&&beforeCommit()!==true){const e=Error('编辑授权已撤销');e.code='WORKSPACE_AUTH_REVOKED';throw e;}
  return {ok:true,result:previous.data.result,recordedAt:previous.recordedAt,recordId:previous.hash,reused:true,...flags};
 }
 const asOf=query.asOf??now,events=store.readEvents(workspaceRoot,{asOf});
 const prefs=require('./evolution-workflow').readEvolutionPreferences(workspaceRoot,{asOf});
 const code=query.code||prefs.value.selectedCode||events.findLast(e=>e.kind==='analysis')?.data.symbol||'';
 const history=historyFrom(events,code,asOf,calendar),historyFingerprint=fingerprint(history),horizon=query.horizon||5;
 const implementationFingerprint=require('./evolution-diagnostic-version').diagnosticImplementationFingerprint();
 const statistics=require('./evolution-research-statistics');
 const nativeInputs=statistics.diagnosticInputsFromEvents(events,history,{asOf});
 const nativeInputsFingerprint=fingerprint(nativeInputs);
 const result=await statistics.runEvolutionDiagnostics({history:history?{...history,holdDays:horizon}:null,asOf,...nativeInputs});
 const event=store.appendEvent(workspaceRoot,'diagnostic',{protocol:'evolution-diagnostics-v1',code,asOf,horizon,commandFingerprint,historyFingerprint,nativeInputsFingerprint,implementationFingerprint,result},
  {requestId:input.requestId,now:Date.now(),beforeCommit});
 return {ok:true,result,recordedAt:event.recordedAt,recordId:event.hash,reused:event.reused,...flags};
}
module.exports={buildEvolutionReport,readEvolutionReport,runStoredEvolutionDiagnostics,causalArchive,evidenceBars,historyFrom};
