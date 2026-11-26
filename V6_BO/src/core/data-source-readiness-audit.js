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
const routeById=new Map(registry.sources.map(r=>[r.id,r]));
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
 "ecb":["manual-background-archive","V6_BO/src/core/ecb-fx-daily.js","V6_BO/scripts/collect-ecb-fx.js","V6_BO/src/core/market-data-evidence.js"],
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
 if(['response-too-large','invalid-response','invalid-quote','invalid-quote-time'].includes(status))return code>=200&&code<300;
 if(['timeout','transport-error','not-requested'].includes(status))return code===null;
 return false;
}
function assertIdentity(row,snapshot){
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
  assertIdentity(row,snapshot);
  const quote=typeof row.quoteAt==='number'&&validMs(row.quoteAt)?row.quoteAt:null;
  if(row.quoteAt!==null&&quote===null)throw Error('健康快照供应商原始时点无效');
  const withQuote=withQuoteStatus(row.status);
  if(row.status!=='not-requested'&&!consistentHttp(row.status,row.httpStatus))
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
    attempted,successfulQuoteObservation:withQuote&&snapshot.status==='completed-unverified',
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
 const byAccess={},byEvidenceState={},byMarket={};
 const routes=registry.sources.map(source=>{
  const probe=observations.get(source.id);
  const attempted=probe?.attempted===true;
  const successfulQuote=attempted?probe.successfulQuoteObservation:null;
  const state=probe?.state??'not-probed',integration=integrationStage(source);
  byAccess[source.access]=(byAccess[source.access]||0)+1;
  byEvidenceState[state]=(byEvidenceState[state]||0)+1;
  byMarket[source.market]=(byMarket[source.market]||0)+1;
  return {id:source.id,market:source.market,dataClass:source.dataClass,
   access:source.access,upstreamGroup:source.upstreamGroup,integration,
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
   phases:{registration:'registered',adapter:integration.adapterStage,report:probe?'reported':'not-reported',
    attempt:attempted?'attempted':probe?'not-requested':'unknown',
    singleQuote:successfulQuote===true?'observed-unverified':attempted?'no-usable-quote':'unknown',
    actualCall:attempted?'attempt-reported':probe?'not-requested':'unknown',
    dataReturn:successfulQuote===true?'quote-returned-unverified':attempted?'no-usable-quote':'unknown',
    businessAnalysis:'unknown',sustainedAvailability:'unknown',authorization:'unknown',productionActivation:'unknown'},
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
   byAccess,byMarket,byEvidenceState},
  probe:report,routes,canTrade:false,canNotify:false,canTrain:false,
  verifiedLive:false,providerIndependenceVerified:false,autoEnableNewProviders:false,
  qualityProvesPriceAccuracy:false,
  note:'有报告行、实际尝试、取得一次可校验但未认证的报价、审核时仍在15秒内分别统计。observedExactRoutes仅为attemptedExactRoutes兼容别名，失败尝试不等于成功；not-requested不计尝试。只按确切来源ID核对，不把同上游SDK算成已探测或独立来源。持续稳定、授权与生产启用保持unknown/null；各Verified计数和licensedLiveSources=0仅表示本证据没有证明，不断言实际系统全部未授权或未启用。静态适配器及业务接线仅为源码审查，不是实际调用、取数、分析使用或生产启用；一次探测仅证明该确切路线的报告证据。时钟倒退不计成功取数。本报告不联网、不启用来源或交易，不证明真实开市与长期可用率。'};
}
module.exports={auditRegisteredSourceReadiness};
