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
const roundedPct = (a,b) => Math.round(a*1000/b)/10;
const blocked = reason => ({schemaVersion:1,mode:'quote-source-window-quality-research',status:'blocked',reason,
 canTrade:false,canTrain:false,canNotify:false,verifiedLive:false,canAutoSelectProvider:false,
 providerIndependenceVerified:false,qualityProvesPriceAccuracy:false});
function auditQuoteSourceWindow({registeredAt,asOf,expectedSlots,observations,maxReportLagMs=30000,maxPairSkewMs=3000}={}) {
 if (!validTime(registeredAt)||!validTime(asOf)||registeredAt>=asOf||
     !Number.isSafeInteger(maxReportLagMs)||maxReportLagMs<0||maxReportLagMs>60000||
     !Number.isSafeInteger(maxPairSkewMs)||maxPairSkewMs<0||maxPairSkewMs>15000||
     !Array.isArray(expectedSlots)||expectedSlots.length<3||expectedSlots.length>250||
     !expectedSlots.every((t,i)=>validTime(t)&&t<=asOf&&(i===0||t-expectedSlots[i-1]>=30000))||
     registeredAt>=expectedSlots[0]||
     !Array.isArray(observations)||observations.length>expectedSlots.length)
  return blocked('invalid-preregistered-window-or-clock');
 const expected=new Set(expectedSlots),seen=new Map();
 let code=null;
 for (const item of observations) {
  if (!item||!expected.has(item.slotAt)||seen.has(item.slotAt))
   return blocked('duplicate-or-unexpected-observation-slot');
  const r=item.report;
  if (!r||r.schemaVersion!==1||r.mode!=='two-source-public-quote-diagnostic'||
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
  if (!Array.isArray(r.sourceStatuses)||r.sourceStatuses.length!==(outside?0:2)||
      (!outside&&!session(reportAt)))
   return blocked('invalid-session-or-provider-coverage');
  const rows=new Map();
  for (const s of r.sourceStatuses) {
   if (!s||!PROVIDERS.includes(s.provider)||rows.has(s.provider)||!STATUS.has(s.status))
    return blocked('invalid-provider-status-or-duplicate');
   if (s.status==='unavailable') {
    if (s.quoteAt!==null) return blocked('unavailable-source-has-quote-time');
   } else if (!validTime(s.quoteAt)||s.quoteAt>reportAt||
             (s.status==='fresh-unverified'&&reportAt-s.quoteAt>15000))
    return blocked('missing-future-or-stale-original-quote-time');
   rows.set(s.provider,s);
  }
  if (!outside&&rows.size!==2) return blocked('provider-pair-incomplete');
  const fresh=PROVIDERS.every(provider=>rows.get(provider)?.status==='fresh-unverified');
  if (outside) {
   if (session(reportAt)||r.discrepancyBps!==null||r.quoteAt!==null)
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
       (r.status==='source-conflict'&&r.discrepancyBps<=50&&skew<=15000))
    return blocked('pair-numerics-or-verdict-inconsistent');
  } else if (r.status!=='insufficient-fresh-sources'||r.discrepancyBps!==null||r.quoteAt!==null)
   return blocked('incomplete-pair-verdict-inconsistent');
  seen.set(item.slotAt,{report:r,rows});
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
 const missingSlots=expectedSlots.length-seen.size;
 const status=missingSlots?'coverage-watch':misalignedPairs?'time-misalignment-watch':
  disagreements?'price-disagreement-watch':
  alignedPairs===0?'insufficient-comparable-evidence':'limited-alignment-unverified';
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify({registeredAt,asOf,expectedSlots,observations,maxReportLagMs,maxPairSkewMs})).digest('hex');
 return {schemaVersion:1,mode:'quote-source-window-quality-research',status,
  registeredAt,asOf,code,expectedSlotCount:expectedSlots.length,receivedSlotCount:seen.size,
  missingSlotCount:missingSlots,maxReportLagMs,maxPairSkewMs,sourceCoverage:perSource,
  pair:{freshPairs,timeAlignedPairs:alignedPairs,timeMisalignedPairs:misalignedPairs,
   alignedPriceAgreements:agreements,alignedPriceDisagreements:disagreements},
  evidenceFingerprint:fingerprint,canTrade:false,canTrain:false,canNotify:false,
  verifiedLive:false,canAutoSelectProvider:false,providerIndependenceVerified:false,
  qualityProvesPriceAccuracy:false,
  note:'仅诊断事前预定时段的双源报价新鲜覆盖、原始时点偏移和对齐后的分歧；缺档计入分母。无法证明真实交易日历、源授权/独立性、哪家价格正确或可成交。禁止据此切换报价源、修改策略及触发交易。'};
}
module.exports={auditQuoteSourceWindow};
