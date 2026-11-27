'use strict';
/**
 * Offline, read-only evidence reconciliation across the registered routes.
 * A route listing is not a feed connection. The input is a previously saved
 * ONE-SHOT probe, not a network request or an authority to switch sources.
 * No quote prices, secrets, URLs or raw upstream bytes are copied into output.
 */
const {validateRegistry,registeredSourceRows}=require('./data-source-lineage');
const {session}=require('./quote-dual-source-diagnostic');
const PROVIDERS=new Set(['tencent','eastmoney','sina']);

// Static review, never a runtime or authorization receipt.
const WIRING=Object.freeze({
 "eastmoney":["mainline-quote","V6_BO/em.js","V6_BO/holdings.js"],
 "tencent":["mainline-quote","V6_BO/em.js","V6_BO/holdings.js"],
 "sina":["mainline-quote","V6_BO/em.js"],
 "baostock":["manual-research-comparison","V6_BO/scripts/optional-research-sources.py","V6_BO/scripts/research-cross-source-history.js"],
 "mootdx":["optional-report-only","V6_BO/scripts/optional-research-sources.py","V6_BO/src/core/optional-research-view.js"],
 "ashare":["optional-report-only","V6_BO/scripts/optional-research-sources.py","V6_BO/src/core/optional-research-view.js"],
 "efinance":["optional-report-only","V6_BO/scripts/optional-research-sources.py","V6_BO/scripts/six-photo-sources.py","V6_BO/src/core/optional-research-view.js"],
 "cninfo":["conditional-announcement-research","V6_BO/scripts/optional-research-sources.py","V6_BO/src/strategy/universe-scanner.js","V6_BO/src/strategy/research-v2-universe-scanner.js"],
 "akshare-em-daily":["optional-bank-only","V6_BO/scripts/six-photo-sources.py","V6_BO/src/core/six-photo-backups.js","V6_BO/src/core/dashboard-view.js"],
 "akshare-em-minute":["optional-bank-only","V6_BO/scripts/six-photo-sources.py","V6_BO/src/core/six-photo-backups.js","V6_BO/src/core/dashboard-view.js"],
 "akshare-sina-minute":["optional-bank-only","V6_BO/scripts/six-photo-sources.py","V6_BO/src/core/six-photo-backups.js","V6_BO/src/core/dashboard-view.js"],
 "easyquotation-sina":["conditional-readonly-quote-fallback","V6_BO/scripts/six-photo-sources.py","V6_BO/src/core/six-photo-backups.js","V6_BO/em.js"],
 "efinance-fund":["optional-bank-only","V6_BO/scripts/six-photo-sources.py","V6_BO/src/core/six-photo-backups.js","V6_BO/src/core/dashboard-view.js"],
 "eastmoney-public-history":["manual-research-comparison","V6_BO/src/core/eastmoney-historical-feed.js","V6_BO/scripts/eastmoney-historical-import.js","V6_BO/scripts/research-cross-source-history.js"],
 "ifind":["generic-gateway-contract","V6_BO/src/core/parallel-market.js","V6_BO/scripts/parallel-market.js"],
 "choice":["generic-gateway-contract","V6_BO/src/core/parallel-market.js","V6_BO/scripts/parallel-market.js"],
 "sec-edgar":["manual-background-archive","V6_BO/src/core/sec-companyfacts.js","V6_BO/scripts/collect-sec-companyfact.js","V6_BO/src/core/market-data-evidence.js"],
 "worldbank":["manual-background-archive","V6_BO/src/core/worldbank-indicators.js","V6_BO/scripts/collect-worldbank-indicator.js","V6_BO/src/core/market-data-evidence.js"],
 "ecb":["manual-background-archive","V6_BO/src/core/ecb-fx-daily.js","V6_BO/scripts/collect-ecb-fx.js","V6_BO/src/core/market-data-evidence.js","V6_BO/src/core/ecb-cross-reference.js"],
 "us-eia":["manual-background-archive","V6_BO/src/core/eia-spot-daily.js","V6_BO/scripts/collect-eia-spot.js","V6_BO/src/core/market-data-evidence.js"],
 "itick":["conditional-diagnostic-only","V6_BO/src/core/itick-stock-quote.js","V6_BO/src/core/multi-source-price-consensus.js","V6_BO/scripts/multi-source-quote.js"]
});
function integrationStage(source){
 const reviewed=Object.hasOwn(WIRING,source.id)?WIRING[source.id]:null;
 const adapterStage=source.adapter==='candidate'?'candidate-registration-only':source.adapter==='operator-import'?'manual-import-contract':
  source.adapter==='authorized-gateway'?'generic-gateway-contract':reviewed?'named-adapter-code-reviewed':'named-adapter-not-reviewed';
 const scope=reviewed?.[0]??(adapterStage==='manual-import-contract'?'manual-import-contract':'not-reviewed');
 return {declaredAdapter:source.adapter,adapterStage,staticWiringScope:scope,sourcePaths:reviewed?reviewed.slice(1):[],
  businessAnalysisPathReviewed:['mainline-quote','conditional-announcement-research'].includes(scope),
  businessAnalysisExecutionVerified:null,productionEnabled:null};
}
const STATUSES=new Set(['fresh-source-unverified','dated-snapshot','redirect-refused',
 'access-denied','rate-limited','http-error','response-too-large','invalid-response',
 'invalid-quote','invalid-quote-time','timeout','transport-error','not-requested']);
const validMs=v=>Number.isSafeInteger(v)&&v>946684800000&&v<4102444800000;
const withQuoteStatus=status=>status==='fresh-source-unverified'||status==='dated-snapshot';
function consistentHttp(status,code){
 if(withQuoteStatus(status))return code===200;
 if(status==='redirect-refused')return code===null||code>=300&&code<400;
 if(status==='access-denied')return code===401||code===403;
 if(status==='rate-limited')return code===429;
 if(status==='http-error')return code>=400&&code<=599&&![401,403,429].includes(code);
 if(status==='invalid-response')return code>=200&&code<300;
 if(['response-too-large','invalid-quote','invalid-quote-time'].includes(status))return code===200;
 if(['timeout','transport-error','not-requested'].includes(status))return code===null;
 return false;
}
function assertIdentity(row,snapshot,routeById){
 const source=routeById.get(row.provider);
 if(!source||source.adapter!=='public-quote-probe'||
  ['id','source','quoteSource'].some(k=>row[k]!==undefined&&row[k]!==row.provider)||
  row.upstreamGroup!==undefined&&row.upstreamGroup!==source.upstreamGroup||
  ['code','symbol'].some(k=>row[k]!==undefined&&row[k]!==snapshot.code)||
  ['canTrade','canNotify','verifiedLive','providerLicensed','exchangeVerified'].some(k=>row[k]!==undefined&&row[k]!==false)||
  ['synthetic','mock','fixture','testSample'].some(k=>row[k]===true))
  throw Error('健康快照来源身份、证券或权限相互矛盾');
}
function iso(v){
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v))
  throw Error('行情健康快照时间格式无效');
 const n=Date.parse(v);
 if(!validMs(n)||new Date(n).toISOString()!==v)throw Error('行情健康快照时间无效');
 return n;
}
function inspectProbe(snapshot,now,routeById){
 const observations=new Map();
 if(snapshot===undefined||snapshot===null)return {observations,report:null};
 if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||
    snapshot.schemaVersion!==1||snapshot.mode!=='one-shot-public-quote-endpoint-health'||
    snapshot.providerLicensed!==false||snapshot.verifiedLive!==false||
    snapshot.exchangeCalendarVerified!==false||
    snapshot.canTrade!==false||snapshot.canNotify!==false||
    ['synthetic','mock','fixture','testSample'].some(k=>snapshot[k]===true)||
    typeof snapshot.code!=='string'||!/^(?:60|68|00|30)\d{4}$/.test(snapshot.code)||
    !Array.isArray(snapshot.providers)||snapshot.providers.length<1||snapshot.providers.length>3||
    !['completed-unverified','outside-weekday-session-window','clock-regressed'].includes(snapshot.status))
  throw Error('健康快照类型、来源身份或研究权限无效');
 const pattern=snapshot.observationPattern;
 const modern=pattern!==undefined||snapshot.commonCauseVerified!==undefined;
 if(modern&&(snapshot.commonCauseVerified!==false||
    !['untrusted-clock','all-fresh-unverified','partial-fresh','all-denied-or-limited','no-fresh-observation'].includes(pattern)||
    (pattern==='untrusted-clock')!==(snapshot.status==='clock-regressed')||
    snapshot.status==='outside-weekday-session-window'))
  throw Error('健康快照共同故障或时钟声明无效');
 const started=iso(snapshot.startedAt);
 const ended=snapshot.status==='outside-weekday-session-window'?started:iso(snapshot.finishedAt);
 if(started>now||ended>now||snapshot.status==='completed-unverified'&&ended<started||
    snapshot.status==='clock-regressed'&&ended>=started&&!modern||
    snapshot.status==='outside-weekday-session-window'&&(session(started)||snapshot.finishedAt!==undefined&&iso(snapshot.finishedAt)!==started)||
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
  assertIdentity(row,snapshot,routeById);
  const quote=typeof row.quoteAt==='number'&&validMs(row.quoteAt)?row.quoteAt:null;
  if(row.quoteAt!==null&&quote===null)throw Error('健康快照供应商原始时点无效');
  const withQuote=withQuoteStatus(row.status);
  if(row.status!=='not-requested'&&!consistentHttp(row.status,row.httpStatus))
   throw Error('健康快照HTTP码与观测结论冲突');
  if(withQuote){
   if(modern&&pattern==='untrusted-clock')throw Error('不可信时钟报告不能保留有效报价');
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
    attempted,successfulQuoteObservation:withQuote&&snapshot.status==='completed-unverified',
    state:!attempted?'not-requested':current?'recent-original-quote-unverified':
      snapshot.status==='clock-regressed'?'clock-regressed':
      age>15000?'historical-probe-only':
      row.status==='fresh-source-unverified'?'quote-expired-at-audit':row.status,
    recentAtAudit:current,
    freshAtReport:snapshot.status==='completed-unverified'&&row.status==='fresh-source-unverified',
    reportedElapsedMs:attempted?row.elapsedMs:null
  });
 }
 const rows=[...observations.values()],fresh=rows.filter(r=>r.freshAtReport).length,
  denied=rows.filter(r=>['access-denied','rate-limited'].includes(r.lastProbeStatus)).length;
 const expectedPattern=snapshot.status==='clock-regressed'?'untrusted-clock':
  snapshot.status==='outside-weekday-session-window'?'not-requested':
  fresh===rows.length?'all-fresh-unverified':fresh>0?'partial-fresh':
  denied===rows.length&&rows.length>1?'all-denied-or-limited':'no-fresh-observation';
 if(modern&&pattern!==expectedPattern)throw Error('健康快照观测分级与实际记录不一致');
 return {observations,report:{code:snapshot.code,reportAt:new Date(ended).toISOString(),
  status:snapshot.status,ageMs:now-ended,providerCount:observations.size,
  attemptedProviderCount:rows.filter(x=>x.attempted).length,
  observationPattern:expectedPattern,commonCauseVerified:false}};
}
// Count catalogue declarations, not authenticated publishers. Multi-source
// frameworks and ambiguous wrappers have no resolved publisher vote.
function catalogueLineage(rows){
 const byGroup=new Map(),unresolvedRouteIds=[];
 for(const row of rows){
  if(row.upstreamGroup.startsWith('multi:')){unresolvedRouteIds.push(row.id);continue;}
  if(!byGroup.has(row.upstreamGroup))byGroup.set(row.upstreamGroup,[]);
  byGroup.get(row.upstreamGroup).push(row);
 }
 const groups=[...byGroup.keys()].sort().map(upstreamGroup=>{
  const members=byGroup.get(upstreamGroup);
  return {upstreamGroup,routeCount:members.length,routeIds:members.map(r=>r.id).sort(),
   markets:[...new Set(members.map(r=>r.market))].sort(),
   dataClasses:[...new Set(members.map(r=>r.dataClass))].sort(),
   publisherIdentityVerified:false};
 });
 const shared=groups.filter(g=>g.routeCount>1);
 return {mode:'catalogue-declared-upstream-relationships',groups,
  unresolvedRouteIds:unresolvedRouteIds.sort(),
  resolvedRouteCount:rows.length-unresolvedRouteIds.length,
  cataloguedPublisherGroups:groups.length,
  sharedPublisherGroups:shared.length,
  sharedPublisherRoutes:shared.reduce((n,g)=>n+g.routeCount,0),
  singleRoutePublisherGroups:groups.length-shared.length,
  independentlyAuthenticatedPublishers:0,commonFailureRiskMeasured:false,
  providerIndependenceVerified:false,canTrade:false};
}
function auditRegisteredSourceReadiness({asOf=Date.now(),snapshot}={}){
 if(!validMs(asOf))throw Error('数据源审核时钟无效');
 const catalog=validateRegistry();
 const registered=registeredSourceRows();
 const routeById=new Map(registered.map(r=>[r.id,r]));
 const lineage=catalogueLineage(registered);
 const groupSizes=new Map(lineage.groups.map(g=>[g.upstreamGroup,g.routeCount]));
 const {observations,report}=inspectProbe(snapshot,asOf,routeById);
 const byAccess={},byEvidenceState={},byMarket={},byDeclaredIntegrationKind={};
 const routes=registered.map(source=>{
  const declaredIntegrationKind=source.adapter==='candidate'?'candidate':source.adapter==='operator-import'?'operator-import':
   source.adapter==='authorized-gateway'?'authorized-gateway':'named-adapter';
  byDeclaredIntegrationKind[declaredIntegrationKind]=(byDeclaredIntegrationKind[declaredIntegrationKind]||0)+1;
  const probe=observations.get(source.id);
  const attempted=probe?.attempted===true;
  const successfulQuote=attempted?probe.successfulQuoteObservation:null;
  const state=probe?.state??'not-probed',integration=integrationStage(source);
  byAccess[source.access]=(byAccess[source.access]||0)+1;
  byEvidenceState[state]=(byEvidenceState[state]||0)+1;
  byMarket[source.market]=(byMarket[source.market]||0)+1;
  return {id:source.id,market:source.market,dataClass:source.dataClass,
   access:source.access,upstreamGroup:source.upstreamGroup,integration,
   declaredAdapter:source.adapter,declaredIntegrationKind,
   runtimeUsage:{status:'not-checked',sampledDays:null,latestObservedAt:null,
    adapterInvocationVerified:false,downstreamUse:'unknown'},
   // Legacy upstreamUnique means resolved, NOT unique among routes.
   upstreamUnique:groupSizes.has(source.upstreamGroup),
   upstreamResolved:groupSizes.has(source.upstreamGroup),
   upstreamGroupRouteCount:groupSizes.get(source.upstreamGroup)??null,
   sharesCataloguedUpstream:groupSizes.has(source.upstreamGroup)?groupSizes.get(source.upstreamGroup)>1:null,
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
   endpointHealth:{scope:'single-reported-check-only',
    status:!probe?'unknown':!attempted?'not-requested':report.status==='clock-regressed'?'untrusted-clock':
      probe.recentAtAudit?'recent-quote-unverified':probe.successfulQuoteObservation?'dated-quote-unverified':probe.lastProbeStatus,
    reportedElapsedMs:probe?.reportedElapsedMs??null,
    freshAtReport:attempted&&report.status==='completed-unverified'?probe.freshAtReport:null,
    sustainedAvailabilityPct:null,providerLatencyP95Ms:null,rankingEligible:false,latencyIsExchangeDelay:false},
   phases:{registration:'registered',adapter:integration.adapterStage,report:probe?'reported':'not-reported',
    attempt:attempted?'attempted':probe?'not-requested':'unknown',
    singleQuote:successfulQuote===true?'observed-unverified':attempted?'no-usable-quote':'unknown',
    actualCall:attempted?'attempt-reported':probe?'not-requested':'unknown',
    dataReturn:successfulQuote===true?'quote-returned-unverified':attempted?'no-usable-quote':'unknown',
    runtimeSample:'unknown',businessAnalysis:'unknown',sustainedAvailability:'unknown',authorization:'unknown',productionActivation:'unknown'},
   sustainedAvailabilityVerified:null,observationWindow:null,effectiveObservationDays:null,
   licensedForLive:null,productionEnabled:null,exchangeVerified:false,canTrade:false,
   activeByThisAudit:false};
 });
 const reported=routes.filter(x=>x.reportedOnThisExactRoute);
 const probed=routes.filter(x=>x.observedOnThisExactRoute);
 const observedUpstreams=[...new Set(probed.map(x=>x.upstreamGroup))].sort();
 const eligible=routes.filter(x=>PROVIDERS.has(x.id)&&x.declaredAdapter==='public-quote-probe');
 const successful=probed.filter(x=>x.successfulQuoteObservation===true).length,
  freshAtReport=probed.filter(x=>x.endpointHealth.freshAtReport===true).length,
  recent=probed.filter(x=>x.recentQuoteAtAudit===true).length;
 const trustedReport=report?.status==='completed-unverified';
 const ratio=(count,total)=>total>0?Number((100*count/total).toFixed(3)):null;
 const probeCoverage={scope:'single-symbol-one-shot-public-endpoint-observation',
  eligibleExactRoutes:eligible.length,reportedRoutes:reported.length,attemptedRoutes:probed.length,
  notAttemptedRoutes:eligible.length-probed.length,attemptCoveragePct:ratio(probed.length,eligible.length),
  successfulQuotes:successful,freshAtReport,recentAtAudit:recent,
  returnedQuoteRateAmongAttemptsPct:trustedReport?ratio(successful,probed.length):null,
  freshRateAmongAttemptsPct:trustedReport?ratio(freshAtReport,probed.length):null,
  missingOrFailedAttempts:trustedReport?probed.length-successful:null,
  clockRejectedAttempts:report?.status==='clock-regressed'?probed.length:0,
  elapsedObservationCount:probed.filter(r=>r.endpointHealth.reportedElapsedMs!==null).length,
  longitudinalAvailabilityPct:null,providerRankingVerified:false,fullMarketCoverageVerified:false};
 return {schemaVersion:2,mode:'read-only-registered-source-readiness-evidence',
  auditedAt:new Date(asOf).toISOString(),
  status:probed.length?'observational-evidence-unverified':report?'report-only-no-attempt':'registry-only-no-probe',
  summary:{registeredRoutes:catalog.routeCount,
   cataloguedPublisherGroups:lineage.cataloguedPublisherGroups,
   unresolvedUpstreamRoutes:lineage.unresolvedRouteIds.length,
   sharedPublisherGroups:lineage.sharedPublisherGroups,
   sharedPublisherRoutes:lineage.sharedPublisherRoutes,
   singleRoutePublisherGroups:lineage.singleRoutePublisherGroups,
   candidateRegistrationOnlyRoutes:routes.filter(x=>x.integration.adapterStage==='candidate-registration-only').length,
   namedAdapterCodeReviewedRoutes:routes.filter(x=>x.integration.adapterStage==='named-adapter-code-reviewed').length,
   genericGatewayContractRoutes:routes.filter(x=>x.integration.adapterStage==='generic-gateway-contract').length,
   manualImportContractRoutes:routes.filter(x=>x.integration.adapterStage==='manual-import-contract').length,
   namedAdapterNotReviewedRoutes:routes.filter(x=>x.integration.adapterStage==='named-adapter-not-reviewed').length,
   staticBusinessAnalysisPathRoutes:routes.filter(x=>x.integration.businessAnalysisPathReviewed).length,
   businessAnalysisExecutionRoutesVerified:0,
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
  probe:report,probeCoverage,routes,lineage,runtimeUsage:{status:'not-checked',scope:'last-qualified-runtime-quote-sample-per-day',
   reviewedDays:null,matchedSourceLabels:null,allRouteUsageVerified:false},canTrade:false,canNotify:false,canTrain:false,
  verifiedLive:false,providerIndependenceVerified:false,autoEnableNewProviders:false,
  qualityProvesPriceAccuracy:false,
  note:'有报告行、实际尝试、取得一次可校验但未认证的报价、审核时仍在15秒内分别统计。observedExactRoutes仅为attemptedExactRoutes兼容别名，失败尝试不等于成功；not-requested不计尝试。只按确切来源ID核对，不把同上游SDK算成已探测或独立来源。持续稳定、授权与生产启用保持unknown/null；各Verified计数和licensedLiveSources=0仅表示本证据没有证明，不断言实际系统全部未授权或未启用。静态适配器及业务接线仅为源码审查，不是实际调用、取数、分析使用或生产启用；一次探测仅证明该确切路线的报告证据。时钟倒退不计成功取数。上游分组仅为目录声明，multi路线未解析；upstreamUnique为旧版已解析标记，并非路线独占上游；共享关系以upstreamGroupRouteCount为准。本报告不联网、不启用来源或交易，不证明真实开市与长期可用率。'};
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
 let reviewedDays=0,skippedDays=0,partialDays=0,unregisteredSampleRows=0,contradictorySampleDays=0,eligibleSampleRows=0;
 for(const day of report.days){
  const market=day.latestLive?.market,evidence=market?.quoteEvidence,at=evidence?.observedAt;
  if(!day.liveSamples)continue;
  if(day.sourceShas.length!==1||evidence?.schemaVersion!==1||evidence.conflictPolicy!=='explicit-and-duplicate-v1'||
   evidence.truncated!==false||!validMs(at)||at>asOf||at<day.firstObservedAt||at>day.lastObservedAt||
   new Date(at+28800000).toISOString().slice(0,10)!==day.day||!Array.isArray(evidence.samples)||
   evidence.samples.length<1||evidence.samples.length>10){skippedDays++;continue;}
  // Validate projected sample identity and denominator before counting labels.
  const sample=evidence.samples,seen=new Set();
  let contradiction=evidence.sampled!==true||evidence.sampleLimit!==10||
   typeof evidence.sampleTruncated!=='boolean'||
   !Number.isSafeInteger(market.observedSymbols)||market.observedSymbols<sample.length||
   sample.length!==Math.min(10,market.observedSymbols)||
   evidence.sampleTruncated!==(market.observedSymbols>sample.length)||
   !Number.isSafeInteger(market.freshQuotes)||market.freshQuotes<1||market.freshQuotes>market.observedSymbols;
  let freshRows=0;const labels=new Set();let unknownLabels=0;
  for(const q of sample){
   if(!q||typeof q.code!=='string'||!/^\d{6}$/.test(q.code)||seen.has(q.code)||q.sampled!==true||
      typeof q.eligibleFresh!=='boolean'){contradiction=true;continue;}
   seen.add(q.code);
   if(!q.eligibleFresh)continue;
   freshRows++;
   if(q.sourceAllowed!==true||q.sourceConflict!==false||q.quoteStatus!=='recent-unverified'||
    q.reason!=='fresh-original-quote'||typeof q.price!=='number'||!Number.isFinite(q.price)||q.price<=0||
    !validMs(q.quoteAt)||!validMs(q.receivedAt)||q.quoteAt>q.receivedAt||q.receivedAt>at||at-q.quoteAt>15000||
    new Date(q.quoteAt+28800000).toISOString().slice(0,10)!==day.day||
    typeof q.source!=='string'||!q.source.trim()){contradiction=true;continue;}
   if(!known.has(q.source)){unknownLabels++;continue;}
   labels.add(q.source);
  }
  if(freshRows>market.freshQuotes||!evidence.sampleTruncated&&freshRows!==market.freshQuotes)contradiction=true;
  if(contradiction){skippedDays++;contradictorySampleDays++;continue;}
  reviewedDays++;if(evidence.sampleTruncated)partialDays++;
  eligibleSampleRows+=freshRows;unregisteredSampleRows+=unknownLabels;
  for(const label of labels){const x=observed.get(label)||{sampledDays:0,latestObservedAt:null};
   x.sampledDays++;x.latestObservedAt=Math.max(x.latestObservedAt||0,at);observed.set(label,x);}
 }
 for(const route of result.routes){const receipt=observed.get(route.id);
  route.runtimeUsage={status:receipt?'exact-source-label-observed':'not-established-by-bounded-sample',
   sampledDays:receipt?.sampledDays??null,latestObservedAt:receipt?new Date(receipt.latestObservedAt).toISOString():null,
   adapterInvocationVerified:false,downstreamUse:'unknown'};
  // A sampled label is separate from the explicit probe and actual API
  // invocation/analysis/production evidence, which remain unchanged.
  route.phases.runtimeSample=receipt?'exact-source-label-observed':'not-established-by-bounded-sample';
 }
 result.runtimeUsage={status:reviewedDays?'bounded-original-samples-reviewed':'no-qualified-sample-reviewed',
  scope:'last-qualified-runtime-quote-sample-per-day',reviewedDays,skippedDays,partialDays,matchedSourceLabels:observed.size,
  unregisteredSampleRows,eligibleSampleRows,contradictorySampleDays,allRouteUsageVerified:false,verifiedExternal:false,downstreamUseVerified:false,
  note:'原私有日志哈希链与原运行报告读取器；仅统计每日末次合格报价样本中实际出现的确切来源标签。缺席不是未使用，标签不是适配器调用证明，不证明策略、账户、通知或授权。'};
 return result;
}
module.exports={auditRegisteredSourceReadiness,auditRuntimeSourceUsage};
