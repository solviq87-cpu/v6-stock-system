'use strict';
// Only project already-observed runtime receipts. Never authorize an order,
// start a supplier request, persist a journal, or expose private error strings.
const {quoteObservationView,quoteSourceAllowsUse}=require('./quote-observation-view');
const PROTOCOL='fayo-system-readiness-v1';
const TASKS={ztpre:'涨停前形态扫描',trendScan:'全市场趋势扫描',steadyUp:'连续收涨',bigmoney:'大单流入',similar:'相似走势跟随',pre:'启动前埋伏',learnall:'学习库入库',ztpreIngest:'涨停前入库',kbf:'K线回填'};
const cap=10000;
const ts=(value,now)=>Number.isSafeInteger(value)&&value>0&&value<=now?value:null;
const maxTime=(values,now)=>{const times=values.map(v=>ts(v,now)).filter(v=>v!==null);return times.length?Math.max(...times):null;};
const day=at=>new Date(at+28800000).toISOString().slice(0,10);
const STATUS={
 normal:['OBSERVED','已取得本项原回执；仍须按原门禁核对交易与完整覆盖','继续沿原流程观察'],
 'missing-data':['DATA_GAP','原始证据或覆盖仍有缺项','查看原来源与缺失原因'],
 unconfigured:['NOT_CONFIGURED','当前能力未配置或此实例不负责写入','核对原配置和实例角色'],
 failed:['RUN_FAILED','最近原任务报告失败；不复制内部错误或私有路径','查看原授权诊断和重试状态'],
 'historical-snapshot':['HISTORICAL_ONLY','仅有带原日期的历史观察，不作为实时信号','开市后等待原行情链更新'],
 unverified:['NO_VERIFIED_RECEIPT','尚无本项真实运行回执','等待原任务实际执行并核对证据']
};
function component(id,label,status,affects,now,{attempt=null,success=null,reason,missing,nextAction,extra={}}={}){
 const def=STATUS[status]||STATUS.unverified;
 return {id,label,status,reasonCodes:[reason||def[0]],missing:missing??(status==='normal'?[]:[def[1]]),
  affects,lastAttemptAt:ts(attempt,now),lastSuccessAt:ts(success,now),nextAction:nextAction||def[2],...extra};
}
function quotes(rows,session,now){
 const list=Array.isArray(rows)?rows:[],observed=Math.min(cap,list.length);
 const stats={receivedRows:list.length,inspectedRows:observed,recentOriginal:0,observationOnly:0,datedHistorical:0,invalidOrUnknown:0,scope:'original-in-memory-stock-rows',universeCoverage:null};
 let latestQuoteAt=null,latestReceiptAt=null;
 for(let i=0;i<observed;i++){
  const row=list[i];let view;
  try{view=quoteObservationView(row,now);}catch{stats.invalidOrUnknown++;continue;}
  const valid=view.quoteAt!==null&&view.receivedAt!==null&&view.quoteSource&&view.quoteAt<=view.receivedAt&&view.receivedAt<=now&&
   ['recent-unverified','stale'].includes(view.quoteStatus);
  if(!valid){stats.invalidOrUnknown++;continue;}
  // Read-only observations can be dated evidence but must never count as a fresh
  // execution-ready source. Source permissions and cross-feed independence are separate.
  if(!quoteSourceAllowsUse(row)){stats.observationOnly++;continue;}
  latestQuoteAt=maxTime([latestQuoteAt,view.quoteAt],now);latestReceiptAt=maxTime([latestReceiptAt,view.receivedAt],now);
  if(view.quoteStatus==='recent-unverified'&&view.tradeDate===day(now))stats.recentOriginal++;
  else stats.datedHistorical++;
 }
 const all=observed>0&&observed===list.length&&stats.recentOriginal===observed;
 const status=session?.trading===true?(all?'normal':observed?'missing-data':'unverified'):
  session?.trading===false&&(stats.recentOriginal+stats.datedHistorical)>0?'historical-snapshot':observed?'missing-data':'unverified';
 return component('quotes','原始行情时点',status,['盘面','策略输入','风控报价'],now,{success:latestReceiptAt,
  reason:status==='normal'?'ORIGINAL_TIME_OBSERVED':status==='historical-snapshot'?'ORIGINAL_DATED_SNAPSHOT':'QUOTE_COVERAGE_OR_TIME_GAP',
  extra:{coverage:stats,latestOriginalQuoteAt:latestQuoteAt,lastSuccessAtKind:'observed-receipt',tradePermissionCertified:false}});
}
function buildSystemReadiness({now=Date.now(),version=null,replica=false,session=null,quoteRows,taskRows,
 risk=null,plans=null,background=null,feedback=null,model=null,worker=null,notificationConfigured=null}={}){
 if(!Number.isSafeInteger(now)||now<=0||now>8e15)throw Error('运行就绪度查询时钟无效');
 const components=[quotes(quoteRows,session,now)];
 for(const [id,label] of Object.entries(TASKS)){
  const row=taskRows?.[id],attempt=ts(row?.lastAttemptAt,now);
  const status=!attempt?'unverified':row.ok===false?'failed':row.ok===true&&row.done==='yield'&&ts(row.lastSuccessAt,now)?'normal':row.ok===true&&row.done==='empty'?'missing-data':'unverified';
  components.push(component('task/'+id,label,status,['原周期任务','相关策略或研究'],now,{attempt,success:row?.lastSuccessAt,
   reason:status==='missing-data'?'NO_OUTPUT_OR_COVERAGE_UNKNOWN':undefined}));
 }
 const riskError=Boolean(risk?.lastError||risk?.status==='unavailable'||Object.values(risk?.accountErrors||{}).some(Boolean));
 const riskStatus=replica?'unconfigured':riskError?'failed':ts(risk?.lastObservedAt,now)?'normal':'unverified';
 components.push(component('risk-observation','原风险观察流程',riskStatus,['账户风险显示','风险提醒'],now,{
  attempt:maxTime(Object.values(risk?.accountChecks||{}),now),success:risk?.lastObservedAt,
  extra:{riskSafetyCertified:false}}));
 const pstatus=replica?'unconfigured':plans?.status==='evidence-unavailable'||plans?.lastError?'failed':
  plans?.status==='observing'&&ts(plans.lastSuccessAt,now)?'normal':plans?.status==='missing-current-evidence'?'missing-data':'unverified';
 components.push(component('plan-observer','冻结计划原观察',pstatus,['计划','风险动作','观察通知'],now,{
  attempt:plans?.lastAttemptAt,success:plans?.lastSuccessAt}));
 const last=background?.lastResult;
 const bstatus=replica?'unconfigured':last?.status==='unavailable'||background?.status==='unavailable'?'failed':
  last?.status==='incomplete'?'missing-data':last?.status==='collected'&&ts(background?.lastSuccessAt,now)&&background?.running!==true?'normal':'unverified';
 components.push(component('history-financial','原历史与财报后台采集',bstatus,['研究证据','历史回验'],now,{
  attempt:background?.lastAttempt?.at,success:background?.lastSuccessAt}));
 const fstatus=replica||feedback?.status==='disabled-or-replica'?'unconfigured':feedback?.status==='unavailable'?'failed':
  feedback?.status==='submitted'&&ts(feedback?.lastSuccessAt,now)?'normal':
  ['insufficient-evidence','missing-calendar','missing-session','validation-rejected'].includes(feedback?.status)?'missing-data':'unverified';
 components.push(component('feedback','原反馈送验',fstatus,['模型研究','人工审批'],now,{
  attempt:feedback?.lastAttempt?.recordedAt,success:feedback?.lastSuccessAt,extra:{approvalCertified:false}}));
 components.push(component('model-evidence','获批模型证据',model?.lastError?'failed':model?.loadedAt?'missing-data':'unverified',['策略研究'],now,{
  reason:'MODEL_APPROVAL_AND_COVERAGE_SEPARATE',missing:['缓存读取不证明独立成熟样本、效果或实际审批'],extra:{lastProjectionAt:ts(model?.loadedAt,now)}}));
 components.push(component('notification','原私密通知',notificationConfigured===false?'unconfigured':'unverified',['风险提醒','用户实际接收'],now,{
  reason:notificationConfigured===true?'CHANNEL_CONFIGURED_DELIVERY_UNVERIFIED':'DELIVERY_NOT_VERIFIED',
  missing:[notificationConfigured===true?'原私密通道已配置，尚无本摘要可认证的真实接收回执':'配置或真实接收回执未核验'],extra:{configured:typeof notificationConfigured==='boolean'?notificationConfigured:null,deliveryCertified:false}}));
 const lanes={};
 for(const [name,maxWorkers,maxOldGenerationSizeMb] of [['background',2,768],['risk',1,128]]){
  const v=worker?.[name],ok=v?.maxWorkers===maxWorkers&&v?.maxOldGenerationSizeMb===maxOldGenerationSizeMb&&
   Number.isSafeInteger(v.active)&&v.active>=0&&v.active<=maxWorkers&&Number.isSafeInteger(v.declaredOldGenerationSizeMb)&&v.declaredOldGenerationSizeMb>=0&&v.declaredOldGenerationSizeMb<=maxOldGenerationSizeMb;
  lanes[name]={maxWorkers,maxOldGenerationSizeMb,active:ok?v.active:null,declaredOldGenerationSizeMb:ok?v.declaredOldGenerationSizeMb:null};
 }
 const workerOk=worker?.available===true&&Object.values(lanes).every(x=>x.active!==null);
 components.push(component('worker-budget','共享研究线程声明预算',workerOk?'normal':'unverified',['后台研究','独立账户风险查询'],now,{
  extra:{scope:'declared-worker-v8-old-generation-only',lanes,processRssCertified:false,productionLoadCertified:false}}));
 const dependencies=[
  {id:'authorized-live-data-and-full-coverage',ready:false,missing:['尚需实际线路、独立上游、用途授权及全市场覆盖回执']},
  {id:'original-account-external-reconciliation',ready:false,missing:['原账户内部证据不能代替外部权威账本与真实对账']},
  {id:'mature-model-validation',ready:false,missing:['实际成熟独立样本、费用、五关及人工批准须另核']},
  {id:'actual-notification-delivery',ready:false,missing:['配置或网关受理不等于接收端送达']},
  {id:'production-and-runtime-acceptance',ready:false,missing:['目标部署和5/20/60真实交易日证据尚须独立核验']}
 ];
 return {schemaVersion:1,protocol:PROTOCOL,asOf:now,version:typeof version==='string'?version.slice(0,80):null,
  instanceRole:replica?'replica':'primary',components,dependencies,readOnly:true,canTrade:false,canNotify:false,writesAccount:false};
}
module.exports={buildSystemReadiness,PROTOCOL};
