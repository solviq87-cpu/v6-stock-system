'use strict';
/**
 * One offline, read-only evidence graph for the eight user-confirmed V6
 * workflows. It consumes existing outputs, does not rerun or edit the
 * original strategy, execution or account engines.
 */
const crypto=require('node:crypto');
const {auditMarketData}=require('./market-data-quality');
const {updateLifecycle}=require('../strategy/signal-pool-lifecycle');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const isoDay=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
 new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
const safeString=(x,n=120)=>typeof x==='string'?x.slice(0,n):'';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const keys=Object.freeze([
 ['market','大盘'],['sector','板块'],['stock','个股联动'],['explanation','入选解释'],
 ['risk','风控'],['learning','学习规则'],['publicRules','公开策略分层'],['testing','自动测试']
]);
const note='仅为统一的历史研究证据摘要。数据来源自报、行情许可、真实提醒与实际部署均未验收；不产生下单或自动调权指令。';
function buildEightPointEvidence({history,selectionEvidence,publicRuleForwardAudit,
 reconciliation,strategies,calendar,previousWatchStates=[]}={}){
 if(!history||!Array.isArray(history.stocks)||!selectionEvidence||
   !reconciliation||!strategies||!calendar)throw Error('八项联动缺少已有完整研究输出');
 const quality=auditMarketData(history);
 const date=selectionEvidence.asOf||quality.lastDate||null;
 const imported=history.source==='imported';
 const sameDate=isoDay(date)&&date===quality.lastDate;
 const candidates=Array.isArray(selectionEvidence.candidates)?selectionEvidence.candidates:[];
 const marketRows=[],sectorRows=[],explanations=[],watchItems=[];
 for(const candidate of candidates){
  const symbol=String(candidate?.symbol||''),r=candidate?.rationale||{};
  if(!/^\d{6}$/.test(symbol))continue;
  const selection=r.selection||{},price=r.price||{},market=r.market||{},sector=r.sector||{};
  const resilience=r.marketSectorResilience||{},rules=Array.isArray(selection.rules)?selection.rules:[];
  const datedPrice=imported&&sameDate&&price.status==='imported-unverified'&&price.date===date;
  const safeRules=rules.filter(x=>typeof x?.id==='string'&&x.id&&x.status==='matched')
   .map(x=>({id:safeString(x.id,90),family:safeString(x.family,70),
    name:safeString(x.name,90),kind:safeString(x.type,50),
    evidence:Array.isArray(x.evidence)?x.evidence.slice(0,4).map(y=>safeString(y,180)):[]}));
  const risks=Array.isArray(r.risks)?r.risks.slice(0,24).map(x=>safeString(x,180)):[];
  const sourceOk=datedPrice&&r.market?.status==='imported-unverified'&&
   resilience?.status==='market-sector-observed-unverified'&&
   resilience.tradeDate===date&&resilience.marketSource===market.source;
  if(sourceOk)marketRows.push({symbol,
   regime:safeString(resilience.marketRegime,60),
   domesticIndices:resilience.marketIndexChanges||{},
   breadthPct:finite(market.breadthScore)?market.breadthScore:null,
   source:safeString(resilience.marketSource,100)});
  const sectorOk=sourceOk&&sector.status==='imported-unverified'&&
   resilience.sectorName===sector.name&&resilience.sectorSource===sector.source;
  if(sectorOk)sectorRows.push({symbol,name:safeString(sector.name,80),
   source:safeString(sector.source,100),
   changePct:finite(resilience.sectorChangePct)?resilience.sectorChangePct:null,
   relativePct:finite(resilience.relativeToCorePct)?resilience.relativeToCorePct:null,
   regime:safeString(resilience.sectorRegime,80),
   researchDeprioritized:r.weakMarketPreference?.researchDeprioritized===true,
   cohortRps:r.sectorCohortRps?.status==='imported-unverified'&&
    finite(r.sectorCohortRps.rpsPct)?r.sectorCohortRps.rpsPct:null});
  const watchEligible=datedPrice&&selection.watchEligible===true&&safeRules.length>0;
  const danger=risks.some(x=>/停牌|ST|安全|看跌|拦截|风险公告|风险标题|冲突|弱于|未知/.test(x));
  watchItems.push({symbol,name:safeString(candidate.name,80),patternDate:price.date||date,
   quality:{usable:candidate.quality?.usable===true,fresh:datedPrice,
    simulated:!imported},blockedBySafety:danger,
   patterns:{matched:watchEligible?safeRules.map(rule=>({id:rule.id,status:'matched',
    side:'bullish'})):[]},
   issuerEvidence:{riskClues:risks.filter(x=>/公告风险/.test(x)).map(x=>({title:x}))},
   linkageResearch:{riskConflict:danger}});
  explanations.push({symbol,name:safeString(candidate.name,80),
   sourceDate:isoDay(price.date)?price.date:null,priceStatus:safeString(price.status,60),
   watchEligible,ruleCount:safeRules.length,rules:safeRules,
   upObserved:r.whyUp?.observedRise===true&&datedPrice,
   confirmedUpsideCauses:[],
   possibleContributors:Array.isArray(r.whyUp?.possibleContributors)&&datedPrice?
    r.whyUp.possibleContributors.slice(0,6).map(x=>safeString(x,180)):[],
   whySelected:safeString(selection.explanation,250),
   whyUp:safeString(r.whyUp?.conclusion,250),risks,
   weakMarketDeprioritized:r.weakMarketPreference?.researchDeprioritized===true,
   score:candidate.score??null});
 }
 // Same-day historical snapshots are a single observation, not continuing
 // multi-day watch-state persistence. Missing or simulated quotes never focus.
 // An offline report cannot depend on wall-clock time: missing dates never become fresh.
 const clock=isoDay(quality.lastDate)?Date.parse(quality.lastDate+'T15:00:00+08:00'):
  Date.parse('2000-01-01T15:00:00+08:00');
 // Retain previously observed symbols missing from the latest imported sample.
 // They remain unavailable, never silently archived or considered fresh.
 const seenSymbols=new Set(watchItems.map(x=>x.symbol));
 for(const p of previousWatchStates){
  if(p&&/^\d{6}$/.test(p.symbol)&&!seenSymbols.has(p.symbol)){
   watchItems.push({symbol:p.symbol,name:p.name||p.symbol,patternDate:date,
    quality:{usable:false,fresh:false,simulated:true},patterns:{matched:[]}});
   seenSymbols.add(p.symbol);
  }
 }
 const watch=updateLifecycle({items:watchItems,previous:previousWatchStates,now:clock});
 const officialWatch=new Set((selectionEvidence.researchWatchlist||[]).map(x=>x.symbol));
 const researchWatch=watch.states.filter(x=>officialWatch.has(x.symbol)&&
  x.dataStatus==='observed-research-only'&&['observe','focus','risk-review'].includes(x.stage));
 const bySector=new Map();
 for(const row of sectorRows){
  const k=row.name+'|'+row.source+'|'+date,old=bySector.get(k);
  if(old)old.stockCount++;
  else bySector.set(k,{name:row.name,source:row.source,stockCount:1,
   changePct:row.changePct,relativePct:row.relativePct,
   regime:row.regime,cohortRps:row.cohortRps});
 }
 const forward=publicRuleForwardAudit;
 const review=forward?.weightReviewDiagnostics;
 const perRule=review?.byRule&&typeof review.byRule==='object'?Object.entries(review.byRule).map(([id,v])=>
  ({id,review:v.review,blockers:v.blockers||[],modeledEvents:v.modeledEvents||0,
   weightChanged:false})):[];
 const sources=(history.provider&&history.datasetId)?'declared-unverified':'incomplete';
 const safetyBalanced=reconciliation.paper?.balanced===true&&reconciliation.backtest?.balanced===true;
 const dimensions={
  market:{status:marketRows.length?'imported-observed-unverified':'unavailable',
   date:date||null,observations:marketRows.length,
   indices:marketRows[0]?.domesticIndices||{},breadthPct:marketRows[0]?.breadthPct??null,
   regime:marketRows[0]?.regime||'unknown',verifiedExternal:false,
   missing:marketRows.length?['指数和市场广度仍需供应商独立对账']:['缺少同日完整指数/上涨家数与有效来源']},
  sector:{status:sectorRows.length?'imported-observed-unverified':'unavailable',
   sectors:[...bySector.values()],stockSectorLinks:sectorRows.length,
   weakMarketDeprioritizedCount:sectorRows.filter(x=>x.researchDeprioritized).length,
   missing:sectorRows.length?['板块成分、覆盖率和实际资金流未经独立对账']:['缺少同日有效板块涨跌及行业映射']},
  stock:{status:selectionEvidence.status==='evaluated'?'historical-research-only':'unavailable',
   candidates:candidates.length,watch:researchWatch,
   watchPools:watch.pools,watchStates:watch.states,
   previousStateCount:previousWatchStates.length,
   retainedUnavailableCount:watch.states.filter(x=>x.dataStatus==='unavailable').length,
   notPersistedAcrossDates:true,
   missing:['连续跨交易日观察池状态尚未由本次一键研究持久化；未验证券商行情和企业行为']},
  explanation:{status:explanations.length?'historical-research-only':'unavailable',
   stocks:explanations,causalAttributionVerified:false,
   missing:['个股公告原文、原因等级与电脑/手机真机点击尚需对账']},
  risk:{status:safetyBalanced?'existing-guards-reconciled':'reconciliation-unavailable',
   paperLedgerBalanced:reconciliation.paper?.balanced===true,
   backtestBalanced:reconciliation.backtest?.balanced===true,
   marketDataReview:quality.summary,
   qualityIssues:quality.issues,
   flaggedStocks:explanations.filter(x=>x.risks.length).map(x=>x.symbol),
   manualHoldingWatch:{status:'separate-private-local-endpoint',
    path:'/api/paper/holding-risks',canNotify:false,
    note:'私有手动持仓仅由独立本机鉴权接口读取，不会进入研究报告或GitHub'},
   missing:['真实行情逐票时间、推送送达、风险拒单与实机验收尚未独立完成']},
  learning:{status:perRule.length?'manual-review-only':'needs-opt-in-forward-audit',
   horizonDays:5,perRule,weightsChanged:false,
   autoPromotion:false,forwardAuditStatus:forward?.status||'not-requested',
   missing:['独立样本外显著性、来源许可、实盘成本与正式因子参数晋级均未验收']},
  publicRules:{status:selectionEvidence.status==='evaluated'?'research-layer-attached':'unavailable',
   originalStrategyKeys:Object.keys(strategies.coverage||{}).sort(),
   researchCatalogCount:(selectionEvidence.openSourceCatalog?.length||0)+
    (selectionEvidence.linkedResearchCatalog?.length||0)+
    (selectionEvidence.qualityResearchCatalog?.length||0),
   officialPromotion:false,stockRuleHits:explanations.reduce((s,x)=>s+x.ruleCount,0),
   missing:['公开策略版权/许可、交易数据适用权与正式晋级证据仍需人工核查']},
  testing:{status:'local-evidence-constructed-ci-not-self-attested',
   datasetFingerprint:sha(history),inputSourceStatus:sources,
   dataQualityChecked:true,marketDataReviewReady:quality.reviewReady===true,
   accountReconciled:safetyBalanced,
   calendarStatus:calendar.valid===true?'explicit-calendar-checked':'not-externally-verified',
   ciVerifiedByThisReport:false,
   missing:['本次提交对应的完整CI、浏览器真机、真实网络和上线部署必须分别验收']}
 };
 const workstreams=keys.map(([id,label])=>({id,label,status:dimensions[id].status,
  unresolved:dimensions[id].missing.slice(),externallyAccepted:false}));
 return {schemaVersion:1,mode:'v6-eight-point-integrated-historical-research',
  asOf:sameDate?date:null,
  sourceStatus:sources,canTrade:false,canNotify:false,verifiedLive:false,
  weightsChanged:false,productionReleaseReady:false,
  accountModified:false,strategyParametersModified:false,
  workstreams,dimensions,
  coverage:{totalWorkstreams:8,codeConnected:8,
   externalAccepted:0,verifiedDeployment:false},
  externalBlockers:[
   '合规供应商授权、盘中逐票报价及指数/板块一致性未验收',
   '本机私有持仓风险与真实推送渠道未完成到达率及误报核对',
   '观察池跨日可靠持久化、公告原文和回测样本外统计仍未验收',
   '国内服务器HTTPS、持久化/恢复、手机电脑视觉及操作验收未完成'
  ],note};
}
module.exports={buildEightPointEvidence,keys};
