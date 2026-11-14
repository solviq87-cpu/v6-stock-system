'use strict';
const path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto'),{performance}=require('node:perf_hooks');
const store=require('./research-workspace-store'),decision=require('./research-workspace-decision'),analytics=require('./research-workspace-analytics');
const checks=require('./research-workspace-diagnostics');
const modelForecast=require('./model-forward-evaluation');
const array=x=>Array.isArray(x)?x:[];
const rootOf=options=>options.workspaceRoot||path.join(path.dirname(options.observationRoot),'research-workspace');
function codeVersion(){
 const files=['research-workspace.js','research-workspace-store.js','research-workspace-decision.js','research-workspace-analytics.js','research-workspace-diagnostics.js','model-forward-evaluation.js','../strategy/rule-comparison.js'];
 return {fingerprint:store.digest(files.map(f=>({file:f,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,f))).digest('hex')}))),
  commit:/^[a-f0-9]{40}$/.test(process.env.V6_SOURCE_COMMIT||'')?process.env.V6_SOURCE_COMMIT:null};
}
function trace(){
 const stages=[];
 return {stages,async asyncStage(name,fn){const startedAt=Date.now(),start=performance.now();try{const v=await fn();stages.push({stage:name,status:'completed',startedAt,finishedAt:Date.now(),durationMs:+(performance.now()-start).toFixed(2)});return v;}
  catch(e){stages.push({stage:name,status:'failed',startedAt,finishedAt:Date.now(),durationMs:+(performance.now()-start).toFixed(2),errorCode:'STAGE_FAILED'});throw e;}},
 syncStage(name,fn){const startedAt=Date.now(),start=performance.now();try{const v=fn();stages.push({stage:name,status:'completed',startedAt,finishedAt:Date.now(),durationMs:+(performance.now()-start).toFixed(2)});return v;}
  catch(e){stages.push({stage:name,status:'failed',startedAt,finishedAt:Date.now(),durationMs:+(performance.now()-start).toFixed(2),errorCode:'STAGE_FAILED'});throw e;}}};
}
function saveObservation(result,options,{requestId,stages=[]}={}){
 const data=decision.buildWorkspaceDecision(result),root=rootOf(options);
 data.codeVersion=codeVersion();data.diagnostics=[...stages,...data.diagnostics];
 const identity=requestId||'capture_'+store.digest({observation:data.observationHash,bundle:data.bundleHash,asOf:data.asOf});
 const e=store.appendEvent(root,'analysis',data,{requestId:identity});
 return {runId:e.hash,sequence:e.sequence,reused:e.reused,status:'saved',...store.FLAGS};
}
function saveDiagnostic(options,data){
 try{return store.appendEvent(rootOf(options),'diagnostic',{...data,asOf:Date.now()},{requestId:'job_'+crypto.randomBytes(16).toString('hex')}).hash;}catch{return null;}
}
async function reviewStored(input,options,{read}={}){
 const {symbol,provider,requestId,nativeEvidence}=input||{};
 if(!/^\d{6}$/.test(symbol||'')||!['eastmoney','tencent'].includes(provider)||typeof requestId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(requestId))throw Error('需要六位代码、明确档案来源和请求ID');
 if(nativeEvidence!==undefined&&(!nativeEvidence||Array.isArray(nativeEvidence)||Object.keys(nativeEvidence).some(k=>!['pythonEvidence','gptEvidence','fourteenEvidence','benchmarkEvidence'].includes(k))))throw Error('原生策略证据字段无效');
 const root=rootOf(options),fingerprint=store.digest({symbol,provider,nativeEvidence:nativeEvidence||null}),prior=store.readEvents(root).find(e=>e.requestId===requestId);
 if(prior){if(prior.kind!=='analysis'||prior.data.requestFingerprint!==fingerprint)throw Error('请求ID与内容冲突');return {ok:true,runId:prior.hash,reused:true,...store.FLAGS};}
 const t=trace();
 try{
  const result=await t.asyncStage('读取封存行情',async()=>{
   const reply=await (read||require('../server/stock-observation-job').runStockObservationJob)({symbol,provider},{...options,action:'read'});
   if(!reply?.ok||!reply.result?.stock)throw Error('没有可用的已存股票观察');return reply.result;
  });
  const data=t.syncStage('分析原有策略与证据',()=>decision.buildWorkspaceDecision(result,nativeEvidence||{}));
  data.codeVersion=codeVersion();data.requestFingerprint=fingerprint;data.diagnostics=t.stages;
  const event=t.syncStage('封存研究结果',()=>store.appendEvent(root,'analysis',data,{requestId}));
  let diagnosticsSaved=true;
  try{store.appendEvent(root,'diagnostic',{symbol,provider,asOf:Date.now(),runId:event.hash,status:'completed',stages:t.stages},{requestId:'diag_'+requestId});}catch{diagnosticsSaved=false;}
  return {ok:true,runId:event.hash,reused:event.reused,diagnostics:t.stages,diagnosticsSaved,...store.FLAGS};
 }catch{
  let receipt=null;
  try{receipt=store.appendEvent(root,'diagnostic',{symbol,provider,asOf:Date.now(),status:'failed',stages:t.stages,
    retry:'原观察档案保留；重新读取后用新请求ID继续，不执行交易或通知'}, {requestId:'failed_'+requestId}).hash;}catch{}
  return {ok:false,runId:receipt,error:'研究未完成：'+(t.stages.at(-1)?.stage||'读取设置')+'失败；原档案保留',diagnostics:t.stages,...store.FLAGS};
 }
}
function saveScreen(root,result,provenance){
 try{const data=decision.screeningRecord(result,{provenance});data.codeVersion=codeVersion();
  const e=store.appendEvent(root,'screen',data,{requestId:'scan_'+crypto.randomBytes(16).toString('hex')});
  return {status:'saved',runId:e.hash,sequence:e.sequence,...store.FLAGS};
 }catch{return {status:'failed',error:'筛选结果封存未完成，原扫描结果保留',...store.FLAGS};}
}
function saveSettings(root,input){
 const {action,requestId,expectedRevision}=input;
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Error('设置写入需要预期版本');
 if(action==='preferences')return store.appendEvent(root,'preferences',store.preferenceInput(input.value),{requestId,expectedRevision});
 if(action==='restore-preferences'){
  const old=store.readEvents(root).find(e=>e.kind==='preferences'&&e.revision===input.revision);
  if(!old)throw Error('约束恢复版本不存在');
  const {scope,...value}=old.data;return store.appendEvent(root,'preferences',store.preferenceInput(value),{requestId,expectedRevision});
 }
 if(action==='restore-preset'){
  const old=store.readEvents(root).find(e=>e.kind==='preset'&&e.data.name===input.name&&e.revision===input.revision);
  if(!old)throw Error('模板恢复版本不存在');
  return store.appendEvent(root,'preset',old.data,{requestId,expectedRevision});
 }
 if(action==='preset'){
  const v=input.value;if(!v||Object.keys(v).some(k=>!['name','symbol','status','minScore','horizon'].includes(k))||
    typeof v.name!=='string'||!/^[\p{L}\p{N} _-]{1,40}$/u.test(v.name)||v.symbol!==undefined&&!/^\d{6}$/.test(v.symbol)||
    !['all','selected','rejected','unknown'].includes(v.status??'all')||
    v.minScore!==undefined&&(!Number.isFinite(v.minScore)||v.minScore<0||v.minScore>100)||![1,5,20,60].includes(v.horizon??5))throw Error('筛选模板无效');
  return store.appendEvent(root,'preset',{name:v.name,symbol:v.symbol??null,status:v.status??'all',minScore:v.minScore??0,horizon:v.horizon??5},{requestId,expectedRevision});
 }throw Error('未知研究设置操作');
}
function saveModelForecast(root,input){return modelForecast.freezeForecast(root,store.readEvents(root),input);}
function workspaceView(root,query={}, {accounts={},quotes=new Map(),now=Date.now()}={}){
 const asOf=query.asOf??now,events=store.readEvents(root,{asOf});
 if(query.symbol!==undefined&&!/^\d{6}$/.test(query.symbol)||query.offset!==undefined&&(!Number.isSafeInteger(query.offset)||query.offset<0)||
   query.limit!==undefined&&(!Number.isSafeInteger(query.limit)||query.limit<1||query.limit>100)||
   query.runId!==undefined&&!/^[a-f0-9]{64}$/.test(query.runId)||query.compareId!==undefined&&!/^[a-f0-9]{64}$/.test(query.compareId)||query.screenId!==undefined&&!/^[a-f0-9]{64}$/.test(query.screenId)||
   query.status!==undefined&&!['all','selected','rejected','unknown'].includes(query.status)||
   query.minScore!==undefined&&(!Number.isFinite(query.minScore)||query.minScore<0||query.minScore>100))throw Error('研究查询无效');
 const all=analytics.analysisEvents(events,asOf),runs=all.filter(e=>!query.symbol||e.data.symbol===query.symbol),latest=query.runId?runs.find(e=>e.hash===query.runId):runs.at(-1);
 if(query.runId&&!latest)throw Error('研究版本不存在或晚于回放时点');
 const compared=query.compareId?runs.find(e=>e.hash===query.compareId):null;
 if(query.compareId&&!compared)throw Error('对照版本不存在或晚于回放时点');
 const symbol=query.symbol||latest?.data.symbol||null,preferences=events.filter(e=>e.kind==='preferences').at(-1),presetMap=new Map();
 for(const e of events.filter(e=>e.kind==='preset'))presetMap.set(e.data.name,e);
 const screen=query.screenId?events.find(e=>e.kind==='screen'&&e.hash===query.screenId):events.filter(e=>e.kind==='screen').at(-1);
 if(query.screenId&&!screen)throw Error('筛选版本不存在或晚于回放时点');
 let screenRows=screen?.data.rows||[];
 const evaluated=!query.symbol||screenRows.some(r=>r.symbol===query.symbol);
 if(query.symbol)screenRows=screenRows.filter(r=>r.symbol===query.symbol);
 if(query.status&&query.status!=='all')screenRows=screenRows.filter(r=>r.status===query.status);
 if(query.minScore>0)screenRows=screenRows.filter(r=>r.score!==null&&r.score>=query.minScore);
 const offset=query.offset??0,limit=query.limit??20;
 const history=symbol?analytics.timeline(events,symbol,asOf):[];
 const scorecard=analytics.scorecards(events,{asOf}),outcomes=scorecard.observations.filter(o=>!query.symbol||o.symbol===query.symbol);
 const forecastEvaluation=modelForecast.evaluationView(root,events,{asOf,symbol:query.symbol,runId:query.runId,offset,limit});
 try{forecastEvaluation.input=latest?modelForecast.prepareInput(latest):null;}catch{forecastEvaluation.input=null;forecastEvaluation.inputReason='所选研究缺少可核对的闭合价格、证券身份或交易日历';}
 forecastEvaluation.outputTemplate=forecastEvaluation.input?modelForecast.outputTemplate(forecastEvaluation.input):null;
 forecastEvaluation.freezeAllowed=query.asOf===undefined&&forecastEvaluation.status==='available'&&!!forecastEvaluation.input&&now<forecastEvaluation.input.freezeDeadline;
 return {schemaVersion:1,mode:'research-workspace',asOf,...store.FLAGS,
  selectedRun:latest?{id:latest.hash,sequence:latest.sequence,recordedAt:latest.recordedAt,...latest.data}:null,
  runs:{total:runs.length,offset,limit,rows:runs.slice().reverse().slice(offset,offset+limit).map(e=>({id:e.hash,recordedAt:e.recordedAt,symbol:e.data.symbol,name:e.data.name,provider:e.data.provider,tradeDate:e.data.tradeDate,regime:e.data.regime,codeVersion:e.data.codeVersion}))},
  timeline:history.slice().reverse().slice(offset,offset+limit),timelineTotal:history.length,marketPosition:symbol?analytics.marketPosition(events,symbol,latest?.recordedAt||asOf):null,
  screenRuns:events.filter(e=>e.kind==='screen').slice().reverse().slice(0,100).map(e=>({id:e.hash,asOf:e.data.asOf,total:e.data.total,provenance:e.data.provenance})),
  screening:{runId:screen?.hash||null,total:screenRows.length,inputTotal:screen?.data.total??null,offset,limit,rows:screenRows.slice(offset,offset+limit),
    funnel:screen?.data.funnel||null,lookupStatus:!screen?'no-screen-run':!evaluated?'not-evaluated-in-this-run':!screenRows.length?'filtered-out':'available',provenance:screen?.data.provenance||null},
  scorecard:{...scorecard,observations:outcomes.slice(offset,offset+limit),observationTotal:outcomes.length,offset,limit,stress:[{feeBps:16,slippageBps:30,sellTaxBps:5},{feeBps:32,slippageBps:50,sellTaxBps:5}].map(cost=>({assumptions:cost,groups:analytics.scorecards(events,{asOf,...cost}).groups}))},quality:analytics.qualityReport(latest?.data),
  inputAudit:checks.inputAudit(latest?.data),pairedComparison:checks.pairedComparison(latest?.data,compared?.data),drift:checks.driftReport(events,asOf),
  forecastEvaluation,
  publicModelComparison:new Date(asOf+28800000).toISOString().slice(0,10)>='2026-11-14'?require('../../config/public-model-comparison-20261114.json'):{models:[],reason:'对照目录晚于回放时点，不作为当时已知资料'},
  defense:query.asOf===undefined?analytics.holdingDefense(events,accounts,quotes,asOf,preferences?.data):{rows:[],exposures:[],reason:'历史回放不借用当前持仓；原账本没有该时点快照'},
  preferences:{revision:preferences?.revision||0,value:preferences?.data||store.preferenceInput({}),history:events.filter(e=>e.kind==='preferences').map(e=>({revision:e.revision,recordedAt:e.recordedAt,objective:e.data.objective}))},
  presets:[...presetMap.values()].map(e=>({revision:e.revision,...e.data,history:events.filter(p=>p.kind==='preset'&&p.data.name===e.data.name).map(p=>({revision:p.revision,recordedAt:p.recordedAt,...p.data}))})),
  diagnostics:events.filter(e=>e.kind==='diagnostic'&&(!symbol||e.data.symbol===symbol)).slice(-20).map(e=>({id:e.hash,...e.data})),
  limits:{events:2000,maxEventBytes:2*1024*1024,totalBytes:128*1024*1024},
  note:'持久化研究记录与原账本隔离；回放只读取当时已封存版本，不联网、不下单、不推送'};
}
function exportResearch(view){
 return {schemaVersion:1,mode:'research-reproducible-export',...store.FLAGS,asOf:view.asOf,run:view.selectedRun,
  timeline:view.timeline,timelineScope:{offset:view.runs.offset,limit:view.runs.limit,total:view.timelineTotal},marketPosition:view.marketPosition,scorecard:view.scorecard,quality:view.quality,preferences:view.preferences.value,
  inputAudit:view.inputAudit,pairedComparison:view.pairedComparison,drift:view.drift,
  forecastEvaluation:view.forecastEvaluation,
  omitted:['实际账户持仓、成本、令牌、Webhook和私有文件路径'],scope:'selected-private-research-evidence-only'};
}
module.exports={rootOf,codeVersion,trace,saveObservation,saveDiagnostic,reviewStored,saveScreen,saveSettings,saveModelForecast,workspaceView,exportResearch};
