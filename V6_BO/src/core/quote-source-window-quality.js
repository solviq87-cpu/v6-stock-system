'use strict';
/**
 * Offline review of predeclared public-quote diagnostic slots.
 * A fresh timestamp or consistent pair is not proof of authentic market data.
 * NEVER drives source switching, strategy weights, alerts or paper execution.
 */
const crypto = require('node:crypto');
const {session} = require('./quote-dual-source-diagnostic');
const PROVIDERS = Object.freeze(['tencent','eastmoney']);
const STATUS = new Set(['fresh-unverified','dated-snapshot','unavailable']);
const PAIRS = new Set(['sources-agree-unverified','source-conflict','insufficient-fresh-sources','outside-weekday-session-window']);
const validTime = x => Number.isSafeInteger(x) && x > 946684800000 && x < 4102444800000;
// Optional assertions must not contradict the explicitly read-only evidence contract.
const unsafe = x => ['synthetic','simulated','fixture','mock','testSample','canTrade','canNotify','canTrain',
 'verifiedLive','certifiedLive','exchangeVerified','providerLicensed','calendarVerified','canAutoSelectProvider',
 'releaseReady','autoPromotion','canExecute'].some(k=>x[k]!==undefined&&x[k]!==false);
const roundedPct = (a,b) => b?Math.round(a*1000/b)/10:null;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const dense=x=>Array.isArray(x)&&Array.from(x,(_,i)=>Object.hasOwn(x,i)).every(Boolean);
const token=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x);
const symbol=x=>typeof x==='string'&&/^(?:60|68|00|30)\d{4}$/.test(x);
const blocked = reason => ({schemaVersion:1,mode:'quote-source-window-quality-research',status:'blocked',reason,
 canTrade:false,canTrain:false,canNotify:false,verifiedLive:false,canAutoSelectProvider:false,
 providerIndependenceVerified:false,qualityProvesPriceAccuracy:false});
function auditQuoteSourceWindow(input={}) {
 if(!object(input)||unsafe(input))return blocked('invalid-or-unsafe-window');
 const {registeredAt,asOf,expectedSlots,observations,maxReportLagMs=30000,maxPairSkewMs=3000}=input;
 if (!validTime(registeredAt)||!validTime(asOf)||registeredAt>=asOf||
     !Number.isSafeInteger(maxReportLagMs)||maxReportLagMs<0||maxReportLagMs>60000||
     !Number.isSafeInteger(maxPairSkewMs)||maxPairSkewMs<0||maxPairSkewMs>15000||
     !dense(expectedSlots)||expectedSlots.length<3||expectedSlots.length>250||
     !Array.from(expectedSlots).every((t,i)=>validTime(t)&&t<=asOf&&(i===0||t-expectedSlots[i-1]>=30000))||
     registeredAt>=expectedSlots[0]||
     !dense(observations)||observations.length>expectedSlots.length)
  return blocked('invalid-preregistered-window-or-clock');
 const expected=new Set(expectedSlots),seen=new Map();
 let code=null;
 for (const item of observations) {
  if (!object(item)||unsafe(item)||!expected.has(item.slotAt)||seen.has(item.slotAt))
   return blocked('duplicate-or-unexpected-observation-slot');
  const r=item.report;
  if (!object(r)||unsafe(r)||r.schemaVersion!==1||r.mode!=='two-source-public-quote-diagnostic'||
      r.canTrade!==false||r.canNotify!==false||r.certifiedLive!==false||
      r.exchangeVerified!==false||r.providerLicensed!==false||r.calendarVerified!==false||
      r.source1!=='tencent'||r.source2!=='eastmoney'||
      typeof r.code!=='string'||!/^(?:60|68|00|30)\d{4}$/.test(r.code)||
      !PAIRS.has(r.status)||typeof r.asOf!=='string')
   return blocked('invalid-or-unsafe-diagnostic-report');
  if (code!==null&&code!==r.code) return blocked('mixed-security-code-in-one-window');
  code=r.code;
  const reportAt=Date.parse(r.asOf);
  if (!validTime(reportAt)||new Date(reportAt).toISOString()!==r.asOf||
      reportAt<item.slotAt||reportAt-item.slotAt>maxReportLagMs||reportAt>asOf)
   return blocked('report-outside-predeclared-slot');
  const outside=r.status==='outside-weekday-session-window';
  if (!dense(r.sourceStatuses)||r.sourceStatuses.length!==(outside?0:2)||
      (!outside&&!session(reportAt)))
   return blocked('invalid-session-or-provider-coverage');
  const rows=new Map();
  for (const s of r.sourceStatuses) {
   if (!object(s)||unsafe(s)||!PROVIDERS.includes(s.provider)||rows.has(s.provider)||!STATUS.has(s.status)||
       ['id','source','quoteSource','quoteProvider'].some(k=>s[k]!==undefined&&s[k]!==s.provider)||
       ['code','symbol'].some(k=>s[k]!==undefined&&s[k]!==r.code))
    return blocked('invalid-provider-status-or-duplicate');
   if (s.status==='unavailable') {
    if (s.quoteAt!==null) return blocked('unavailable-source-has-quote-time');
   } else if (!validTime(s.quoteAt)||s.quoteAt>reportAt||
             (s.status==='fresh-unverified'&&reportAt-s.quoteAt>15000))
    return blocked('missing-future-or-stale-original-quote-time');
   // Missing legacy receipts are unknown. Explicit receipt/clock/mode
   // assertions cannot contradict the original observation.
   if(s.receivedAt!=null&&(!validTime(s.receivedAt)||s.receivedAt>reportAt||
       s.quoteAt!=null&&s.receivedAt<s.quoteAt)||
      s.quoteAgeMs!==undefined&&s.quoteAgeMs!==(s.quoteAt===null?null:reportAt-s.quoteAt)||
      s.vendorQuoteAt!==undefined&&s.vendorQuoteAt!==s.quoteAt||
      [s.quoteMode,s.mode].some(m=>m!=null&&(typeof m!=='string'||/simulat|fixture|mock|synthetic|test.sample|imported/i.test(m))))
    return blocked('contradictory-provider-receipt-or-mode');
   rows.set(s.provider,s);
  }
  if (!outside&&rows.size!==2) return blocked('provider-pair-incomplete');
  const fresh=PROVIDERS.every(provider=>rows.get(provider)?.status==='fresh-unverified');
  if (outside) {
   if (session(reportAt)||r.discrepancyBps!==null||r.quoteAt!==null||r.quoteTimeGapMs!=null)
    return blocked('outside-session-report-inconsistent');
  } else if (fresh) {
   const a=rows.get('tencent').quoteAt,b=rows.get('eastmoney').quoteAt;
   const skew=Math.abs(a-b);
   if (r.status!=='sources-agree-unverified'&&r.status!=='source-conflict')
    return blocked('fresh-pair-status-inconsistent');
   if (r.quoteTimeGapMs!==skew||r.quoteAt!==Math.min(a,b)||
       typeof r.discrepancyBps!=='number'||!Number.isFinite(r.discrepancyBps)||
       r.discrepancyBps<0||r.discrepancyBps>10000||
       (r.status==='sources-agree-unverified'&&(r.discrepancyBps>50||skew>15000))||
       // The diagnostic rounds reported bps to two decimals after deciding
       // conflict: an actual 50.004 bps disagreement is reported as 50.
       (r.status==='source-conflict'&&r.discrepancyBps<50&&skew<=15000))
    return blocked('pair-numerics-or-verdict-inconsistent');
  } else if (r.status!=='insufficient-fresh-sources'||r.discrepancyBps!==null||r.quoteAt!==null||r.quoteTimeGapMs!=null)
   return blocked('incomplete-pair-verdict-inconsistent');
  seen.set(item.slotAt,{report:r,rows,reportAt});
 }
 // Overlapping lag windows must not turn reused or regressing reports
 // into separate successful samples. Enforce the registered slot order.
 let previousReportAt=null;
 for(const slot of expectedSlots){
  const reportAt=seen.get(slot)?.reportAt;
  if(reportAt===undefined)continue;
  if(previousReportAt!==null&&reportAt<=previousReportAt)return blocked('duplicate-or-regressing-report-time');
  previousReportAt=reportAt;
 }
 const perSource=PROVIDERS.map(provider=>{
  let fresh=0,dated=0,unavailable=0,missing=0;
  for (const slot of expectedSlots) {
   const s=seen.get(slot)?.rows.get(provider);
   if (!s) missing++;
   else if(s.status==='fresh-unverified')fresh++;
   else if(s.status==='dated-snapshot')dated++;
   else unavailable++;
  }
  return {provider,expectedSlots:expectedSlots.length,freshSlots:fresh,datedSlots:dated,
   unavailableSlots:unavailable,missingEvidenceSlots:missing,
   freshCoveragePct:roundedPct(fresh,expectedSlots.length),
   operationalFreshnessScore:roundedPct(fresh,expectedSlots.length),
   scoreMeaning:'仅为事前采样时段内原时点新鲜覆盖率，并非价格准确率、授权、独立性或供应商优劣'};
 });
 let freshPairs=0,alignedPairs=0,misalignedPairs=0,agreements=0,disagreements=0;
 for (const {report:r,rows} of seen.values()) {
  if (!PROVIDERS.every(p=>rows.get(p)?.status==='fresh-unverified')) continue;
  freshPairs++;
  if (Math.abs(rows.get('tencent').quoteAt-rows.get('eastmoney').quoteAt)>maxPairSkewMs) {
   misalignedPairs++;continue;
  }
  alignedPairs++;
  if (r.status==='source-conflict') disagreements++;
  else agreements++;
 }
 // Missing reports and outside-session reports are not observed co-failures.
 const joint={bothFreshSlots:0,oneFreshSlots:0,neitherFreshSlots:0,bothUnavailableSlots:0,
  bothDatedSlots:0,mixedNonFreshSlots:0,outsideSessionReportSlots:0,
  missingReportSlots:expectedSlots.length-seen.size};
 for(const {rows} of seen.values()){
  if(rows.size===0){joint.outsideSessionReportSlots++;continue;}
  const statuses=PROVIDERS.map(p=>rows.get(p).status),fresh=statuses.filter(s=>s==='fresh-unverified').length;
  if(fresh===2)joint.bothFreshSlots++;
  else if(fresh===1)joint.oneFreshSlots++;
  else{
   joint.neitherFreshSlots++;
   if(statuses.every(s=>s==='unavailable'))joint.bothUnavailableSlots++;
   else if(statuses.every(s=>s==='dated-snapshot'))joint.bothDatedSlots++;
   else joint.mixedNonFreshSlots++;
  }
 }
 joint.pairedObservedSlots=joint.bothFreshSlots+joint.oneFreshSlots+joint.neitherFreshSlots;
 joint.neitherFreshRatePct=roundedPct(joint.neitherFreshSlots,joint.pairedObservedSlots);
 joint.commonCauseVerified=false;
 const missingSlots=expectedSlots.length-seen.size;
 const status=missingSlots?'coverage-watch':misalignedPairs?'time-misalignment-watch':
  disagreements?'price-disagreement-watch':
  alignedPairs===0?'insufficient-comparable-evidence':'limited-alignment-unverified';
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify({registeredAt,asOf,expectedSlots,observations,maxReportLagMs,maxPairSkewMs})).digest('hex');
 return {schemaVersion:1,mode:'quote-source-window-quality-research',status,
  registeredAt,asOf,code,expectedSlotCount:expectedSlots.length,receivedSlotCount:seen.size,
  missingSlotCount:missingSlots,maxReportLagMs,maxPairSkewMs,sourceCoverage:perSource,jointCoverage:joint,
  pair:{freshPairs,timeAlignedPairs:alignedPairs,timeMisalignedPairs:misalignedPairs,
   alignedPriceAgreements:agreements,alignedPriceDisagreements:disagreements},
  evidenceFingerprint:fingerprint,canTrade:false,canTrain:false,canNotify:false,
  verifiedLive:false,canAutoSelectProvider:false,providerIndependenceVerified:false,
  qualityProvesPriceAccuracy:false,
  note:'仅诊断事前预定时段的双源报价新鲜覆盖、原始时点偏移和对齐后的分歧；缺档计入分母。无法证明真实交易日历、源授权/独立性、哪家价格正确或可成交。禁止据此切换报价源、修改策略及触发交易。'};
}

// Extension of the same offline reviewer. No scheduler, source switching,
// trading, authorization, pricing certification or strategy input.
const HISTORY_MODE='quote-source-history-review';
const historySafe=Object.freeze({canTrade:false,canNotify:false,canTrain:false,verifiedLive:false,
 canAutoSelectProvider:false,qualityProvesPriceAccuracy:false,commonCauseVerified:false,
 providerIndependenceVerified:false,costEvidenceIndependentlyVerified:false,
 supplierAuthorizationVerified:false});
const historyBlock=reason=>({schemaVersion:1,mode:HISTORY_MODE,status:'blocked',reason,...historySafe});
const currencies=new Set(['CNY','USD','HKD','JPY','EUR','GBP']);
const validPolicy=p=>object(p)&&!unsafe(p)&&validTime(p.registeredAt)&&
 Number.isSafeInteger(p.minExpectedSlots)&&p.minExpectedSlots>=3&&p.minExpectedSlots<=250&&
 Number.isSafeInteger(p.healthyMinPct)&&p.healthyMinPct>=1&&p.healthyMinPct<=100&&
 Number.isSafeInteger(p.watchMinPct)&&p.watchMinPct>=0&&p.watchMinPct<p.healthyMinPct;
function grade(fresh,total,policy){
 if(total<policy.minExpectedSlots)return 'insufficient-samples';
 return 100*fresh>=policy.healthyMinPct*total?'healthy-coverage-unverified':
  100*fresh>=policy.watchMinPct*total?'watch-coverage':'low-coverage';
}
function auditQuoteSourceHistory(input={}){
 if(!object(input)||unsafe(input)||input.schemaVersion!==1||input.mode!==HISTORY_MODE||
  !validTime(input.asOf)||!symbol(input.code)||!validPolicy(input.policy)||
  !dense(input.windows)||input.windows.length<1||input.windows.length>90||
  input.costEvidence!==undefined&&(!dense(input.costEvidence)||input.costEvidence.length>180))
  return historyBlock('invalid-history-scope-policy-or-clock');
 const {asOf,code,policy,windows}=input,ids=new Map(),summaries=[];
 let priorEnd=null,priorReview=null,scope=null;
 for(const w of windows){
  if(!object(w)||unsafe(w)||!token(w.windowId)||ids.has(w.windowId)||!object(w.evidence))
   return historyBlock('invalid-or-duplicate-window-identity');
  const x=w.evidence,r=auditQuoteSourceWindow(x);
  if(r.status==='blocked'||(r.code!==null&&r.code!==code)||x.asOf>asOf)
   return historyBlock('unreplayable-window-or-security-conflict');
  const first=x.expectedSlots[0],last=x.expectedSlots.at(-1),lag=r.maxReportLagMs;
  // All scheduled slots must be mature and inside a conventional session,
  // even when their reports are missing. No holiday certification is implied.
  if(policy.registeredAt>x.registeredAt||x.asOf<last+lag||
     priorEnd!==null&&first<=priorEnd||priorReview!==null&&x.asOf<=priorReview||
     !x.expectedSlots.every(at=>session(at)&&session(at+lag)))
   return historyBlock('overlapping-unmatured-or-outside-session-window');
  const current=JSON.stringify([r.maxReportLagMs,r.maxPairSkewMs]);
  if(scope!==null&&scope!==current)return historyBlock('comparison-policy-changed');
  scope=current;priorEnd=last+lag;priorReview=x.asOf;
  const entry={windowId:w.windowId,firstSlotAt:first,lastSlotAt:last,reviewedAt:x.asOf,
   expectedSlotCount:r.expectedSlotCount,receivedSlotCount:r.receivedSlotCount,
   evidenceFingerprint:r.evidenceFingerprint,status:r.status,sourceCoverage:r.sourceCoverage,
   jointCoverage:r.jointCoverage,pair:r.pair};
  summaries.push(entry);ids.set(w.windowId,entry);
 }
 const costs=new Map(),refs=new Set();
 for(const c of input.costEvidence||[]){
  if(!object(c)||unsafe(c)||!ids.has(c.windowId)||!PROVIDERS.includes(c.provider)||
     c.basis!=='actual-allocated-window-cost'||!currencies.has(c.currency)||
     !Number.isSafeInteger(c.costMinor)||c.costMinor<0||c.costMinor>1e12||
     typeof c.evidenceRef!=='string'||!/^[a-f0-9]{64}$/.test(c.evidenceRef)||refs.has(c.evidenceRef)||
     !validTime(c.knownAt)||c.knownAt>asOf||c.knownAt<ids.get(c.windowId).reviewedAt)
   return historyBlock('invalid-cost-scope-clock-or-reused-evidence');
  const key=c.windowId+':'+c.provider;
  if(costs.has(key))return historyBlock('duplicate-cost-record');
  costs.set(key,c);refs.add(c.evidenceRef);
 }
 const totalExpected=summaries.reduce((n,w)=>n+w.expectedSlotCount,0);
 const providerCoverage=PROVIDERS.map(provider=>{
  const totals={freshSlots:0,datedSlots:0,unavailableSlots:0,missingEvidenceSlots:0};
  let cumulativeFresh=0,cumulativeTotal=0;
  const history=summaries.map(w=>{
   const s=w.sourceCoverage.find(s=>s.provider===provider);
   for(const k of Object.keys(totals))totals[k]+=s[k];
   cumulativeFresh+=s.freshSlots;cumulativeTotal+=s.expectedSlots;
   return {windowId:w.windowId,reviewedAt:w.reviewedAt,expectedSlots:s.expectedSlots,
    freshSlots:s.freshSlots,freshCoveragePct:s.freshCoveragePct,grade:grade(s.freshSlots,s.expectedSlots,policy),
    cumulativeFreshCoveragePct:roundedPct(cumulativeFresh,cumulativeTotal),
    cumulativeGrade:grade(cumulativeFresh,cumulativeTotal,policy)};
  });
  const supplied=summaries.map(w=>costs.get(w.windowId+':'+provider)).filter(Boolean);
  const distinct=new Set(supplied.map(c=>c.currency));
  const complete=supplied.length===summaries.length&&distinct.size===1;
  const total=complete?supplied.reduce((n,c)=>n+c.costMinor,0):null;
  const unit=n=>total!==null&&n>0?Number((total/n).toFixed(3)):null;
  const cost={status:complete?'declared-allocated-cost-unverified':distinct.size>1?'mixed-currency':
    supplied.length?'partial-cost-evidence':'unknown-cost',coveredWindows:supplied.length,
    expectedWindows:summaries.length,currency:complete?supplied[0].currency:null,totalCostMinor:total,
    costMinorPerFreshObservation:unit(totals.freshSlots),costMinorPerExpectedSlot:unit(totalExpected),
    independentlyVerified:false};
  return {provider,expectedSlots:totalExpected,...totals,
   freshCoveragePct:roundedPct(totals.freshSlots,totalExpected),
   coverageGrade:grade(totals.freshSlots,totalExpected,policy),history,cost};
 });
 const joint={};
 for(const key of ['bothFreshSlots','oneFreshSlots','neitherFreshSlots','bothUnavailableSlots','bothDatedSlots',
  'mixedNonFreshSlots','outsideSessionReportSlots','missingReportSlots','pairedObservedSlots'])
   joint[key]=summaries.reduce((n,w)=>n+w.jointCoverage[key],0);
 joint.neitherFreshRatePct=roundedPct(joint.neitherFreshSlots,joint.pairedObservedSlots);
 joint.commonCauseVerified=false;
 const pair={};for(const k of ['freshPairs','timeAlignedPairs','timeMisalignedPairs','alignedPriceAgreements','alignedPriceDisagreements'])
  pair[k]=summaries.reduce((n,w)=>n+w.pair[k],0);
 const status=joint.missingReportSlots||joint.outsideSessionReportSlots||joint.neitherFreshSlots||joint.oneFreshSlots||
  pair.timeMisalignedPairs||pair.alignedPriceDisagreements?'historical-quality-watch':
  providerCoverage.some(p=>p.coverageGrade==='insufficient-samples')?'insufficient-samples':'descriptive-history-reviewed-unverified';
 return {schemaVersion:1,mode:HISTORY_MODE,status,asOf,code,policy:{registeredAt:policy.registeredAt,
  minExpectedSlots:policy.minExpectedSlots,healthyMinPct:policy.healthyMinPct,watchMinPct:policy.watchMinPct},
  windowCount:summaries.length,expectedSlotCount:totalExpected,providerCoverage,jointCoverage:joint,pair,
  windows:summaries.map(({windowId,firstSlotAt,lastSlotAt,reviewedAt,expectedSlotCount,receivedSlotCount,evidenceFingerprint,status})=>
   ({windowId,firstSlotAt,lastSlotAt,reviewedAt,expectedSlotCount,receivedSlotCount,evidenceFingerprint,status})),
  evidenceFingerprint:crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex'),...historySafe,
  note:'仅为预登记、成熟窗口的原报价新鲜覆盖成绩单、共同缺失观察及操作者声明的分摊实际成本；不是价格准确率、共同故障根因、供应商授权或生产选源。成本未完整覆盖或币种不同时保持未知。禁止自动切换、训练、通知及交易。'};
}

module.exports={auditQuoteSourceWindow,auditQuoteSourceHistory};
