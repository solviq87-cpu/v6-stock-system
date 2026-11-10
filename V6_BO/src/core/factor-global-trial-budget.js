'use strict';
/**
 * Fail-closed GLOBAL experiment budget across accepted shadow model versions.
 * One inspect of forward holdout outcomes costs one trial even if rejected.
 * Date window is the latest 90 DISTINCT, explicit research signal days.
 */
const MAX_TRIALS=6,WINDOW_DAYS=90;
const finiteDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
function assessGlobalTrialBudget(reports,signalDays,packFingerprint){
 if(!Array.isArray(reports)||reports.length>500||
    !Array.isArray(signalDays)||signalDays.length<36||signalDays.length>400||
    !/^[0-9a-f]{64}$/.test(packFingerprint||''))
  throw Error('全局研究试验预算协议无效');
 const days=[...new Set(signalDays)];
 if(days.length!==signalDays.length||days.some(x=>!finiteDate(x)))
  throw Error('试验预算的研究交易日缺失、重复或无效');
 days.sort();
 const windowStart=days[Math.max(0,days.length-WINDOW_DAYS)];
 const asOfDay=days.at(-1);
 const counted=[];
 for(const report of reports){
  if(!report||report.mode!=='v6-factor-shadow-evolution-v1')continue;
  // Budget is GLOBAL, not per pack revision. Replacing factor definitions
  // must not reset prior candidate inspections or hide malformed archives.
  if(!/^[0-9a-f]{64}$/.test(report.packFingerprint||''))
   throw Error('全局试验历史因子包指纹无效');
  const audit=report.trialAudit;
  const legacy=!audit&&['shadow-updated','shadow-retained','paused-market-shock']
   .includes(report.status);
  if(!legacy&&audit?.status!=='consumed')continue;
  const end=legacy?report.lastObservationDay:audit.lastHoldoutDay,
   start=legacy?report.holdout?.firstFreshDay:audit.firstHoldoutDay;
  if(!finiteDate(end)||!finiteDate(start)||start>end||
     !finiteDate(report.lastObservationDay)||end>report.lastObservationDay||
     (!legacy&&(audit.schemaVersion!==1||
      !Number.isSafeInteger(audit.holdoutDays)||audit.holdoutDays<5||
      !/^[a-f0-9]{64}$/.test(audit.candidateFingerprint||''))))
   throw Error('试验预算归档时间或候选血缘无效');
  // A later sealed inspection cannot belong to an earlier restored manifest.
  // Reject BEFORE returning budget-exhausted: a harmless skip would hide a
  // research-calendar rollback and let operators miss the broken lineage.
  if(end>asOfDay||report.lastObservationDay>asOfDay)
   throw Error('全局试验档案晚于当前研究清单，历史交易日倒退');
  counted.push({firstDay:start,lastDay:end,fingerprint:report.fingerprint,
   parentFingerprint:report.previousFingerprint||null,legacy});
 }
 counted.sort((a,b)=>a.firstDay.localeCompare(b.firstDay)||
  a.lastDay.localeCompare(b.lastDay));
 for(let i=1;i<counted.length;i++){
  if(counted[i].firstDay<=counted[i-1].lastDay)
   throw Error('全局研究试验跨模型版本复用了同一批保留日');
 }
 const recent=counted.filter(x=>x.lastDay>=windowStart);
 return {status:recent.length>=MAX_TRIALS?'budget-exhausted':'budget-available',
  windowTradingDays:WINDOW_DAYS,maxTrials:MAX_TRIALS,
  windowStartDay:windowStart,asOfDay,
  allTimeTrialCount:counted.length,usedTrials:recent.length,
  remainingTrials:Math.max(0,MAX_TRIALS-recent.length),
  lastTrialFingerprint:recent.at(-1)?.fingerprint||null,
  holdoutAlreadyInspected:recent.length>0,
  canTrade:false,productionWeightsChanged:false};
}
module.exports={assessGlobalTrialBudget,MAX_TRIALS,WINDOW_DAYS};
