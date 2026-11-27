'use strict';
/**
 * Fail-closed GLOBAL experiment budget across accepted shadow model versions.
 * One inspect of forward holdout outcomes costs one trial even if rejected.
 * Date window is the latest 90 DISTINCT, explicit research signal days.
 */
const crypto=require('node:crypto');
const MAX_TRIALS=6,WINDOW_DAYS=90;
const INSPECTED=new Set(['shadow-updated','shadow-retained','paused-market-shock']);
const MONITOR_ONLY=new Set(['paused-shadow-decay','paused-shadow-cooldown','shadow-recovered']);
const validFingerprint=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const finiteDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const safeFlags=x=>['canTrade','productionWeightsChanged','productionStrategyChanged','autoPromotion','verifiedLive'].every(k=>!Object.hasOwn(x,k)||x[k]===false);
function verifyArchive(report){
 if(!safeFlags(report)||Object.hasOwn(report,'shadowOnly')&&report.shadowOnly!==true)
  throw Error('全局试验档案权限无效');
 // Legacy reduced budget summaries do not carry the complete sealed payload.
 // Count them conservatively, but never label them native verified archives.
 const native=Object.hasOwn(report,'schemaVersion')||Object.hasOwn(report,'shadowOnly')||Object.hasOwn(report,'observedFingerprints');
 if(native){
  const {fingerprint,...payload}=report;
  if(report.schemaVersion!==1||report.canTrade!==false||report.productionWeightsChanged!==false||hash(payload)!==fingerprint)
   throw Error('全局试验档案完整性或版本无效');
 }
 return native;
}
function verifyTrialLineage(counted,archives){
 const groups=new Map();
 for(const row of counted){
  if(row.explicitLineage){
   const parent=row.parentFingerprint;
   if(parent!==null){
    const found=archives.get(parent);
    if(!validFingerprint(parent)||!found||found.status!=='shadow-updated'||found.lastObservationDay>=row.firstDay)
     throw Error('全局试验已接受父版本血缘无效');
   }
  }
  const rows=groups.get(row.parentFingerprint)||[];rows.push(row);groups.set(row.parentFingerprint,rows);
 }
 // Trial numbers restart under each newly accepted model, not globally.
 // For lineages with explicit predecessor evidence, require the complete chain.
 for(const rows of groups.values()){
  if(!rows.some(r=>r.explicitLineage))continue;
  for(let i=0;i<rows.length;i++){
   const row=rows[i],prior=rows[i-1];
   if(row.legacy&&!prior)continue;
   if(!row.explicitLineage||row.trialNumber!==(prior?(prior.legacy?1:prior.trialNumber)+1:1)||
      row.previousTrialFingerprint!==(prior?.fingerprint||null))
    throw Error('全局试验归档血缘断裂或编号冲突');
  }
 }
}
function assessGlobalTrialBudget(reports,signalDays,packFingerprint){
 if(!Array.isArray(reports)||reports.length>500||
    !Array.isArray(signalDays)||signalDays.length<36||signalDays.length>400||
    !validFingerprint(packFingerprint))
  throw Error('全局研究试验预算协议无效');
 const days=[...new Set(signalDays)];
 if(days.length!==signalDays.length||days.some(x=>!finiteDate(x)))
  throw Error('试验预算的研究交易日缺失、重复或无效');
 days.sort();
 const windowStart=days[Math.max(0,days.length-WINDOW_DAYS)];
 const asOfDay=days.at(-1);
 const counted=[],fingerprints=new Set(),archives=new Map();let nativeArchives=0;
 const knownDays=new Set(days),firstKnownDay=days[0];
 // Only dates inside the supplied manifest span can be reconciled locally.
 // Older archived trials still count in all-time history.
 const absentFromManifest=date=>date>=firstKnownDay&&date<=asOfDay&&!knownDays.has(date);
 for(const report of reports){
  if(!record(report)||report.mode!=='v6-factor-shadow-evolution-v1')
   throw Error('全局试验历史档案模式无效，不能跳过');
  // Budget is GLOBAL, not per pack revision. Replacing factor definitions
  // must not reset prior candidate inspections or hide malformed archives.
  if(!validFingerprint(report.packFingerprint))
   throw Error('全局试验历史因子包指纹无效');
  if(!validFingerprint(report.fingerprint)||fingerprints.has(report.fingerprint))
   throw Error('全局研究报告指纹缺失、无效或重复');
  fingerprints.add(report.fingerprint);archives.set(report.fingerprint,report);
  const native=verifyArchive(report);if(native)nativeArchives++;
  // Never silently discard an inspected candidate because an audit status
  // is unknown, missing on a new report, or mislabeled as monitor-only.
  const inspected=INSPECTED.has(report.status),monitorOnly=MONITOR_ONLY.has(report.status);
  if(!inspected&&!monitorOnly)
   throw Error('全局试验历史报告状态无效，拒绝跳过');
  const hasAudit=Object.hasOwn(report,'trialAudit'),audit=report.trialAudit;
  if(hasAudit&&(!audit||typeof audit!=='object'||Array.isArray(audit)||
     audit.schemaVersion!==1||
     audit.status!==(inspected?'consumed':'not-evaluated')))
   throw Error('全局试验审计状态与报告状态不一致，拒绝少计试验');
  if(hasAudit&&(!safeFlags(audit)||Object.hasOwn(audit,'trialNumber')&&
     (!Number.isSafeInteger(audit.trialNumber)||audit.trialNumber<(inspected?1:0))))
   throw Error('全局试验权限或编号无效');
  if(Object.hasOwn(report,'globalTrialBudget')){
   const claim=report.globalTrialBudget;
   if(!record(claim)||!safeFlags(claim)||Object.hasOwn(claim,'consumedThisRun')&&claim.consumedThisRun!==inspected)
    throw Error('全局试验预算声明与报告状态不一致');
  }
  const explicitLineage=hasAudit&&(Object.hasOwn(audit,'previousTrialFingerprint')||Object.hasOwn(audit,'previousAcceptedFingerprint'));
  if(native&&hasAudit&&!explicitLineage)throw Error('全局试验原生档案缺少候选血缘');
  if(explicitLineage&&(!Object.hasOwn(audit,'previousTrialFingerprint')||!Object.hasOwn(audit,'previousAcceptedFingerprint')||
     !Object.hasOwn(audit,'trialNumber')||!Object.hasOwn(report,'previousFingerprint')||
     !(report.previousFingerprint===null||validFingerprint(report.previousFingerprint))||
     !(audit.previousTrialFingerprint===null||validFingerprint(audit.previousTrialFingerprint))||
     audit.previousAcceptedFingerprint!==report.previousFingerprint))
   throw Error('全局试验候选血缘无效');
  // Older immutable reports predate trialAudit; retain their conservative
  // inspected-holdout treatment rather than rewriting those archives.
  const legacy=!hasAudit&&inspected;
  if(!inspected){
   if(hasAudit&&(audit.firstHoldoutDay!=null||audit.lastHoldoutDay!=null||
      (Object.hasOwn(audit,'holdoutDays')&&audit.holdoutDays!==0)))
    throw Error('全局监控档案含已查看保留集证据，拒绝少计试验');
   // Monitoring-only reports do not spend trial slots, but they ARE sealed
   // research history. Reject a future cooldown/recovery before budget skip.
   if(!finiteDate(report.lastObservationDay))
    throw Error('全局研究档案最后观察日期无效');
   if(report.lastObservationDay>asOfDay)
    throw Error('全局监控档案晚于当前研究清单，历史交易日倒退');
   if(absentFromManifest(report.lastObservationDay))
    throw Error('全局监控档案日期不在当前研究清单');
   continue;
  }
  const end=legacy?report.lastObservationDay:audit.lastHoldoutDay,
   start=legacy?report.holdout?.firstFreshDay:audit.firstHoldoutDay;
  if(!finiteDate(end)||!finiteDate(start)||start>end||
     !finiteDate(report.lastObservationDay)||end>report.lastObservationDay||
     (!legacy&&(audit.schemaVersion!==1||
      !Number.isSafeInteger(audit.holdoutDays)||audit.holdoutDays<5||
      !validFingerprint(audit.candidateFingerprint))))
   throw Error('试验预算归档时间或候选血缘无效');
  // A later sealed inspection cannot belong to an earlier restored manifest.
  // Reject BEFORE returning budget-exhausted: a harmless skip would hide a
  // research-calendar rollback and let operators miss the broken lineage.
  if(end>asOfDay||report.lastObservationDay>asOfDay)
   throw Error('全局试验档案晚于当前研究清单，历史交易日倒退');
  if([start,end,report.lastObservationDay].some(absentFromManifest))
   throw Error('全局试验档案日期不在当前研究清单');
  if(!legacy){
   // Sparse trading manifests can contain fewer days than calendar dates.
   // A declared count may not exceed either verified bound. Do not require
   // equality: eligible cross-sections legitimately skip some signal days.
   const calendarBound=1+(Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000;
   if(audit.holdoutDays>calendarBound||
      (start>=firstKnownDay&&audit.holdoutDays>days.filter(d=>d>=start&&d<=end).length))
    throw Error('全局试验保留集天数与原日期范围不一致');
  }
  counted.push({firstDay:start,lastDay:end,fingerprint:report.fingerprint,
   parentFingerprint:report.previousFingerprint||null,legacy,explicitLineage,
   trialNumber:audit?.trialNumber,previousTrialFingerprint:audit?.previousTrialFingerprint});
 }
 counted.sort((a,b)=>a.firstDay.localeCompare(b.firstDay)||
  a.lastDay.localeCompare(b.lastDay));
 for(let i=1;i<counted.length;i++){
  if(counted[i].firstDay<=counted[i-1].lastDay)
   throw Error('全局研究试验跨模型版本复用了同一批保留日');
 }
 verifyTrialLineage(counted,archives);
 // A restored partial manifest cannot prove that earlier trials have aged
 // out of a ninety-session window. Do not release slots until it covers 90.
 const fullWindow=days.length>=WINDOW_DAYS;
 const recent=fullWindow?counted.filter(x=>x.lastDay>=windowStart):counted;
 return {status:recent.length>=MAX_TRIALS?'budget-exhausted':'budget-available',
  windowTradingDays:WINDOW_DAYS,maxTrials:MAX_TRIALS,
  windowStartDay:windowStart,asOfDay,manifestDayCount:days.length,
  expiryEvidence:fullWindow?'full-observation-window':'insufficient-window-retain-all',
  archiveEvidence:!reports.length?'empty-input':nativeArchives===reports.length?'sealed-native-verified':'legacy-summary-present',
  allTimeTrialCount:counted.length,usedTrials:recent.length,
  remainingTrials:Math.max(0,MAX_TRIALS-recent.length),
  lastTrialFingerprint:recent.at(-1)?.fingerprint||null,
  holdoutAlreadyInspected:recent.length>0,
  canTrade:false,productionWeightsChanged:false};
}
module.exports={assessGlobalTrialBudget,MAX_TRIALS,WINDOW_DAYS};
