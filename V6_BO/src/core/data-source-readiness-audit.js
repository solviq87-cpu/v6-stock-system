'use strict';
/**
 * Offline, read-only evidence reconciliation across the registered routes.
 * A route listing is not a feed connection. The input is a previously saved
 * ONE-SHOT probe, not a network request or an authority to switch sources.
 * No quote prices, secrets, URLs or raw upstream bytes are copied into output.
 */
const registry=require('../../config/data-source-registry-2026.json');
const {validateRegistry}=require('./data-source-lineage');
const {session}=require('./quote-dual-source-diagnostic');
const PROVIDERS=new Set(['tencent','eastmoney','sina']);
const STATUSES=new Set(['fresh-source-unverified','dated-snapshot','redirect-refused',
 'access-denied','rate-limited','http-error','response-too-large','invalid-response',
 'invalid-quote','invalid-quote-time','timeout','transport-error','not-requested']);
const validMs=v=>Number.isSafeInteger(v)&&v>946684800000&&v<4102444800000;
function iso(v){
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v))
  throw Error('行情健康快照时间格式无效');
 const n=Date.parse(v);
 if(!validMs(n)||new Date(n).toISOString()!==v)throw Error('行情健康快照时间无效');
 return n;
}
function inspectProbe(snapshot,now){
 const observations=new Map();
 if(snapshot===undefined||snapshot===null)return {observations,report:null};
 if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||
    snapshot.schemaVersion!==1||snapshot.mode!=='one-shot-public-quote-endpoint-health'||
    snapshot.providerLicensed!==false||snapshot.verifiedLive!==false||
    snapshot.exchangeCalendarVerified!==false||
    snapshot.canTrade!==false||snapshot.canNotify!==false||
    typeof snapshot.code!=='string'||!/^(?:60|68|00|30)\d{4}$/.test(snapshot.code)||
    !Array.isArray(snapshot.providers)||snapshot.providers.length<1||snapshot.providers.length>3||
    !['completed-unverified','outside-weekday-session-window','clock-regressed'].includes(snapshot.status))
  throw Error('健康快照类型、来源身份或研究权限无效');
 const started=iso(snapshot.startedAt);
 const ended=snapshot.status==='outside-weekday-session-window'?started:iso(snapshot.finishedAt);
 if(started>now||ended>now||snapshot.status==='completed-unverified'&&ended<started||
    snapshot.status==='clock-regressed'&&ended>=started||
    snapshot.status==='outside-weekday-session-window'&&session(started)||
    snapshot.status!=='outside-weekday-session-window'&&!session(started))
  throw Error('健康快照观察时钟超出审核时点或因果矛盾');
 // A future end or old timestamp must never refresh an original quote time.
 for(const row of snapshot.providers){
  if(!row||typeof row!=='object'||Array.isArray(row)||
     !PROVIDERS.has(row.provider)||observations.has(row.provider)||
     !STATUSES.has(row.status)||
     !Number.isSafeInteger(row.elapsedMs)||row.elapsedMs<0||row.elapsedMs>120000||
     !(row.httpStatus===null||Number.isSafeInteger(row.httpStatus)&&row.httpStatus>=100&&row.httpStatus<=599))
   throw Error('健康快照来源、响应状态或重复记录无效');
  const quote=typeof row.quoteAt==='number'&&validMs(row.quoteAt)?row.quoteAt:null;
  if(row.quoteAt!==null&&quote===null)throw Error('健康快照供应商原始时点无效');
  const withQuote=['fresh-source-unverified','dated-snapshot'].includes(row.status);
  if(withQuote&&row.httpStatus!==200||
     row.status==='access-denied'&&![401,403].includes(row.httpStatus)||
     row.status==='rate-limited'&&row.httpStatus!==429||
     row.status==='http-error'&&!(row.httpStatus>=400))
   throw Error('健康快照HTTP码与观测结论冲突');
  if(withQuote){
   if(quote===null||quote>ended||quote>now||row.quoteAgeMs!==ended-quote||
      typeof row.price!=='number'||!Number.isFinite(row.price)||row.price<=0||
      typeof row.previousClose!=='number'||!Number.isFinite(row.previousClose)||row.previousClose<=0)
    throw Error('健康快照价格、供应商时点或年龄相互矛盾');
   if(row.status==='fresh-source-unverified'&&(
      ended<started||ended-quote>15000||!session(ended)))
    throw Error('过时或休市报价不能伪报单次检查新鲜');
  }else if(quote!==null||row.price!==null||row.previousClose!==null||row.quoteAgeMs!==null)
   throw Error('失败或未请求记录不能携带可用行情');
  if(snapshot.status==='outside-weekday-session-window'&&
      (row.status!=='not-requested'||row.elapsedMs!==0||row.httpStatus!==null)||
     snapshot.status!=='outside-weekday-session-window'&&row.status==='not-requested')
   throw Error('健康快照休市和请求状态冲突');
  const age=now-ended;
  const attempted=row.status!=='not-requested';
  const current= snapshot.status==='completed-unverified'&&
     row.status==='fresh-source-unverified'&&age<=15000&&
     now-quote<=15000&&session(now);
  observations.set(row.provider,{
    lastProbeStatus:row.status,reportAt:new Date(ended).toISOString(),
    probeAgeMs:age,originalQuoteAgeMs:quote===null?null:now-quote,
    attempted,successfulQuoteObservation:withQuote,
    state:!attempted?'not-requested':current?'recent-original-quote-unverified':
      snapshot.status==='clock-regressed'?'clock-regressed':
      age>15000?'historical-probe-only':
      row.status==='fresh-source-unverified'?'quote-expired-at-audit':row.status,
    recentAtAudit:current
  });
 }
 return {observations,report:{code:snapshot.code,reportAt:new Date(ended).toISOString(),
  status:snapshot.status,ageMs:now-ended,providerCount:observations.size,
  attemptedProviderCount:[...observations.values()].filter(x=>x.attempted).length}};
}
function auditRegisteredSourceReadiness({asOf=Date.now(),snapshot}={}){
 if(!validMs(asOf))throw Error('数据源审核时钟无效');
 const catalog=validateRegistry();
 const {observations,report}=inspectProbe(snapshot,asOf);
 const byAccess={},byEvidenceState={},byMarket={},byDeclaredIntegrationKind={};
 const routes=registry.sources.map(source=>{
  const declaredIntegrationKind=source.adapter==='candidate'?'candidate':source.adapter==='operator-import'?'operator-import':
   source.adapter==='authorized-gateway'?'authorized-gateway':'named-adapter';
  byDeclaredIntegrationKind[declaredIntegrationKind]=(byDeclaredIntegrationKind[declaredIntegrationKind]||0)+1;
  const probe=observations.get(source.id);
  const attempted=probe?.attempted===true;
  const successfulQuote=attempted?probe.successfulQuoteObservation:null;
  const state=probe?.state??'not-probed';
  byAccess[source.access]=(byAccess[source.access]||0)+1;
  byEvidenceState[state]=(byEvidenceState[state]||0)+1;
  byMarket[source.market]=(byMarket[source.market]||0)+1;
  return {id:source.id,market:source.market,dataClass:source.dataClass,
   access:source.access,upstreamGroup:source.upstreamGroup,
   declaredAdapter:source.adapter,declaredIntegrationKind,
   runtimeUsage:{status:'not-checked',sampledDays:null,latestObservedAt:null,
    adapterInvocationVerified:false,downstreamUse:'unknown'},
   upstreamUnique:!source.upstreamGroup.startsWith('multi:'),
   reportedOnThisExactRoute:!!probe,attemptedOnThisExactRoute:attempted,
   // Compatibility name: an observation means an actual attempt, including a
   // failed response. A no-fetch report row is not an endpoint observation.
   observedOnThisExactRoute:attempted,observationState:state,
   successfulQuoteObservation:successfulQuote,
   recentQuoteAtAudit:attempted?probe.recentAtAudit:null,
   lastProbeStatus:probe?.lastProbeStatus??null,
   lastReportedAt:probe?.reportAt??null,
   lastObservedAt:attempted?probe.reportAt:null,
   originalQuoteAgeMs:probe?.originalQuoteAgeMs??null,
   phases:{registration:'registered',report:probe?'reported':'not-reported',
    attempt:attempted?'attempted':probe?'not-requested':'unknown',
    singleQuote:successfulQuote===true?'observed-unverified':attempted?'no-usable-quote':'unknown',
    sustainedAvailability:'unknown',authorization:'unknown',productionActivation:'unknown'},
   sustainedAvailabilityVerified:null,observationWindow:null,effectiveObservationDays:null,
   licensedForLive:null,productionEnabled:null,exchangeVerified:false,canTrade:false,
   activeByThisAudit:false};
 });
 const reported=routes.filter(x=>x.reportedOnThisExactRoute);
 const probed=routes.filter(x=>x.observedOnThisExactRoute);
 const observedUpstreams=[...new Set(probed.map(x=>x.upstreamGroup))].sort();
 return {schemaVersion:2,mode:'read-only-registered-source-readiness-evidence',
  auditedAt:new Date(asOf).toISOString(),
  status:probed.length?'observational-evidence-unverified':report?'report-only-no-attempt':'registry-only-no-probe',
  summary:{registeredRoutes:catalog.routeCount,
   reportedExactRoutes:reported.length,
   attemptedExactRoutes:probed.length,
   observedExactRoutes:probed.length,
   successfulQuoteObservations:routes.filter(x=>x.successfulQuoteObservation===true).length,
   recentQuotesAtAudit:routes.filter(x=>x.recentQuoteAtAudit===true).length,
   unreportedRoutes:routes.length-reported.length,
   unattemptedRoutes:routes.length-probed.length,
   unobservedRoutes:routes.length-probed.length,
   observedUpstreamLabels:observedUpstreams.length,
   independentlyAuthenticatedPublishers:0,
   licensedLiveSources:0,licensedLiveSourcesVerified:0,
   sustainedAvailabilitySourcesVerified:0,productionActiveSourcesVerified:0,
   guardedResearchRoutes:byAccess['guarded-research']||0,
   byAccess,byMarket,byEvidenceState,byDeclaredIntegrationKind},
  probe:report,routes,runtimeUsage:{status:'not-checked',scope:'last-qualified-runtime-quote-sample-per-day',
   reviewedDays:null,matchedSourceLabels:null,allRouteUsageVerified:false},canTrade:false,canNotify:false,canTrain:false,
  verifiedLive:false,providerIndependenceVerified:false,autoEnableNewProviders:false,
  qualityProvesPriceAccuracy:false,
  note:'有报告行、实际尝试、取得一次可校验但未认证的报价、审核时仍在15秒内分别统计。observedExactRoutes仅为attemptedExactRoutes兼容别名，失败尝试不等于成功；not-requested不计尝试。只按确切来源ID核对，不把同上游SDK算成已探测或独立来源。持续稳定、授权与生产启用保持unknown/null；各Verified计数和licensedLiveSources=0仅表示本证据没有证明，不断言实际系统全部未授权或未启用。本报告不联网、不启用来源或交易，不证明真实开市与长期可用率。'};
}
// Read the original private runtime journal, never a caller-declared result.
// The last eligible sample per day is bounded to 10 symbols. An exact source
// label proves only that the server observed such a quote in this local sample,
// not which wrapper invoked the API, all calls, model consumption or licensing.
async function auditRuntimeSourceUsage({asOf=Date.now(),snapshot,runtimeRoot}={}){
 const result=auditRegisteredSourceReadiness({asOf,snapshot});
 if(typeof runtimeRoot!=='string'||!require('node:path').isAbsolute(runtimeRoot))throw Error('运行证据须为绝对私有目录');
 const original=require('./runtime-acceptance').createRuntimeAcceptance({root:runtimeRoot,clock:()=>asOf,
  canWrite:()=>false,calendar:()=>null});
 const report=await original.report();
 const known=new Set(result.routes.map(r=>r.id)),observed=new Map();
 let reviewedDays=0,skippedDays=0,partialDays=0,unregisteredSampleRows=0;
 for(const day of report.days){
  const evidence=day.latestLive?.market?.quoteEvidence,at=evidence?.observedAt;
  if(!day.liveSamples)continue;
  if(day.sourceShas.length!==1||evidence?.schemaVersion!==1||evidence.conflictPolicy!=='explicit-and-duplicate-v1'||
   evidence.truncated!==false||!validMs(at)||at>asOf||at<day.firstObservedAt||at>day.lastObservedAt||
   new Date(at+28800000).toISOString().slice(0,10)!==day.day||!Array.isArray(evidence.samples)||
   evidence.samples.length<1||evidence.samples.length>10){skippedDays++;continue;}
  reviewedDays++;if(evidence.sampleTruncated!==false)partialDays++;
  const labels=new Set();
  for(const q of evidence.samples){
   if(q?.eligibleFresh!==true||q.sourceAllowed!==true||q.sourceConflict!==false||q.quoteStatus!=='recent-unverified'||
    !validMs(q.quoteAt)||!validMs(q.receivedAt)||q.quoteAt>q.receivedAt||q.receivedAt>at||at-q.quoteAt>15000||
    typeof q.source!=='string')continue;
   if(!known.has(q.source)){unregisteredSampleRows++;continue;}
   labels.add(q.source);
  }
  for(const label of labels){const x=observed.get(label)||{sampledDays:0,latestObservedAt:null};
   x.sampledDays++;x.latestObservedAt=Math.max(x.latestObservedAt||0,at);observed.set(label,x);}
 }
 for(const route of result.routes){const receipt=observed.get(route.id);
  route.runtimeUsage={status:receipt?'exact-source-label-observed':'not-established-by-bounded-sample',
   sampledDays:receipt?.sampledDays??null,latestObservedAt:receipt?new Date(receipt.latestObservedAt).toISOString():null,
   adapterInvocationVerified:false,downstreamUse:'unknown'};
 }
 result.runtimeUsage={status:reviewedDays?'bounded-original-samples-reviewed':'no-qualified-sample-reviewed',
  scope:'last-qualified-runtime-quote-sample-per-day',reviewedDays,skippedDays,partialDays,matchedSourceLabels:observed.size,
  unregisteredSampleRows,allRouteUsageVerified:false,verifiedExternal:false,downstreamUseVerified:false,
  note:'原私有日志哈希链与原运行报告读取器；仅统计每日末次合格报价样本中实际出现的确切来源标签。缺席不是未使用，标签不是适配器调用证明，不证明策略、账户、通知或授权。'};
 return result;
}
module.exports={auditRegisteredSourceReadiness,auditRuntimeSourceUsage};
