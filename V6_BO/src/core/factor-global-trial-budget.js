'use strict';
/**
 * Fail-closed GLOBAL experiment budget across accepted shadow model versions.
 * One inspect of forward holdout outcomes costs one trial even if rejected.
 * Date window is the latest 90 DISTINCT, explicit research signal days.
 */
const MAX_TRIALS=6,WINDOW_DAYS=90;
const INSPECTED=new Set(['shadow-updated','shadow-retained','paused-market-shock']);
const MONITOR_ONLY=new Set(['paused-shadow-decay','paused-shadow-cooldown','shadow-recovered']);
const validFingerprint=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const own=(o,k)=>Object.hasOwn(o,k);
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const readOnly=x=>['canTrade','productionWeightsChanged'].every(k=>!own(x,k)||x[k]===false);
const finiteDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
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
 const counted=[],fingerprints=new Set();
 const knownDays=new Set(days),firstKnownDay=days[0];
 // Only dates inside the supplied manifest span can be reconciled locally.
 // Older archived trials still count in all-time history.
 const absentFromManifest=date=>date>=firstKnownDay&&date<=asOfDay&&!knownDays.has(date);
 for(const report of reports){
  if(!report||report.mode!=='v6-factor-shadow-evolution-v1')
   throw Error('全局试验历史档案模式无效，不能跳过');
  // Budget is GLOBAL, not per pack revision. Replacing factor definitions
  // must not reset prior candidate inspections or hide malformed archives.
  if(!validFingerprint(report.packFingerprint))
   throw Error('全局试验历史因子包指纹无效');
  if(!validFingerprint(report.fingerprint)||fingerprints.has(report.fingerprint))
   throw Error('全局研究报告指纹缺失、无效或重复');
  fingerprints.add(report.fingerprint);
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
  // Reconcile explicit consumption and research authority across the producer's
  // existing summaries. Older archives may omit these optional summaries.
  const receipt=report.globalTrialBudget;
  if(!readOnly(report)||hasAudit&&!readOnly(audit)||
     own(report,'globalTrialBudget')&&(!record(receipt)||!readOnly(receipt)||
      own(receipt,'consumedThisRun')&&receipt.consumedThisRun!==inspected))
   throw Error('全局试验消费或权限声明与研究档案不一致');
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
  const prefix=report.holdout?.firstFreshDay;
  if(own(report,'trainingEnd')&&(!finiteDate(report.trainingEnd)||report.trainingEnd>=start)||
     own(report,'holdout')&&(!record(report.holdout)||!finiteDate(prefix)||prefix>start||absentFromManifest(prefix))||
     own(report,'trainingEnd')&&prefix&&report.trainingEnd>=prefix||
     !legacy&&own(report,'testDays')&&(!Number.isSafeInteger(report.testDays)||report.testDays<audit.holdoutDays))
   throw Error('全局试验保留集摘要与已检验日期或天数不一致');
  if(!legacy){
   // Bound even a straddling interval: before the retained manifest use only
   // a calendar-day upper bound, inside it count explicit research days.
   const earlierDays=start<firstKnownDay?Math.max(0,(Date.parse(firstKnownDay)-Date.parse(start))/86400000):0;
   const calendarBound=1+(Date.parse(end)-Date.parse(start))/86400000;
   const retainedBound=earlierDays+days.filter(d=>d>=start&&d<=end).length;
   if(audit.holdoutDays>Math.min(calendarBound,retainedBound))
    throw Error('全局试验保留集天数与原日期范围不一致');
  }
  counted.push({firstDay:start,lastDay:end,inspectionDay:report.lastObservationDay,fingerprint:report.fingerprint,
   parentFingerprint:report.previousFingerprint||null,legacy});
 }
 counted.sort((a,b)=>a.firstDay.localeCompare(b.firstDay)||
  a.lastDay.localeCompare(b.lastDay));
 for(let i=1;i<counted.length;i++){
  if(counted[i].firstDay<=counted[i-1].lastDay)
   throw Error('全局研究试验跨模型版本复用了同一批保留日');
 }
 // Charge at the archive's last observation day, not the potentially much
 // older tested holdout end. A short manifest cannot establish expiration.
 const windowHistoryComplete=days.length>=WINDOW_DAYS;
 const recent=counted.filter(x=>!windowHistoryComplete||x.inspectionDay>=windowStart)
  .sort((a,b)=>a.inspectionDay.localeCompare(b.inspectionDay)||a.lastDay.localeCompare(b.lastDay));
 return {status:recent.length>=MAX_TRIALS?'budget-exhausted':'budget-available',
  windowTradingDays:WINDOW_DAYS,maxTrials:MAX_TRIALS,
  windowStartDay:windowStart,asOfDay,windowHistoryComplete,
  carriedBeforeManifestTrials:recent.filter(x=>x.inspectionDay<firstKnownDay).length,
  allTimeTrialCount:counted.length,usedTrials:recent.length,
  remainingTrials:Math.max(0,MAX_TRIALS-recent.length),
  lastTrialFingerprint:recent.at(-1)?.fingerprint||null,
  holdoutAlreadyInspected:recent.length>0,
  canTrade:false,productionWeightsChanged:false};
}
module.exports={assessGlobalTrialBudget,MAX_TRIALS,WINDOW_DAYS};
