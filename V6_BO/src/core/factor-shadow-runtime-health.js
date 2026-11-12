'use strict';
/**
 * Read-only status semantics for shadow research evidence and WATCH pulses.
 * This is NOT a service liveness proof, trading-calendar certification or
 * a calculation of real investment return.
 */
const {aShareCalendarAgeDays}=require('./a-share-calendar');
const MIN_INTERVAL=30000,MAX_INTERVAL=3600000;
const validMs=x=>Number.isSafeInteger(x)&&x>0&&Number.isFinite(new Date(x).getTime());
const validDay=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
 new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
function assessShadowRuntimeHealth({now=Date.now(),signalDays=[],
 reportFilesPresent=[],pulse=null,budget=null,accepted=null,trial=null,
 registration=null,cooldown=null}={}){
 if(!validMs(now)||!Array.isArray(signalDays)||signalDays.length<36||
    signalDays.length>400||!Array.isArray(reportFilesPresent)||
    reportFilesPresent.length!==signalDays.length||
    reportFilesPresent.some(x=>typeof x!=='boolean')||
    signalDays.some((day,i)=>!validDay(day)||(i&&signalDays[i-1]>=day)))
  throw Error('影子学习健康诊断日历或证据参数无效');
 const lastManifestSignalDay=signalDays.at(-1);
 const calendarAgeDays=aShareCalendarAgeDays(lastManifestSignalDay,now);
 if(calendarAgeDays<0)throw Error('研究冻结日位于诊断时钟未来');
 const missingReportCount=reportFilesPresent.filter(x=>!x).length;
 const sealedReportFileCount=signalDays.length-missingReportCount;
 let heartbeat={status:'not-observed',ageMs:null,lastStatus:null,
  watchPeriodMs:null,readOnly:true};
 if(pulse!==null){
  if(pulse?.schemaVersion!==1||
     pulse.mode!=='v6-shadow-watch-heartbeat-v1'||
     !validMs(pulse.observedAt)||pulse.observedAt>now||
     !Number.isSafeInteger(pulse.intervalMs)||
     pulse.intervalMs<MIN_INTERVAL||pulse.intervalMs>MAX_INTERVAL||
     !['tick-success','tick-error'].includes(pulse.outcome)||
     typeof pulse.lastStatus!=='string'||pulse.lastStatus.length>90)
   throw Error('研究心跳无效，不能推断后台健康');
  const age=now-pulse.observedAt;
  heartbeat={status:age>Math.max(120000,3*pulse.intervalMs)?
   'heartbeat-stale':pulse.outcome==='tick-error'?'recent-tick-failure':
   'recent-heartbeat-observed',
   ageMs:age,lastStatus:pulse.lastStatus,watchPeriodMs:pulse.intervalMs,
   readOnly:true};
 }
 const budgetState=budget?.status==='budget-exhausted'?'trial-budget-exhausted':
  budget?.status==='budget-available'?'trial-budget-available':'budget-unverified';
 const researchState=cooldown&&
   ['paused-shadow-decay','paused-shadow-cooldown'].includes(cooldown.status)?
   'research-decay-cooldown':
  budgetState==='trial-budget-exhausted'?'research-budget-paused':
  !accepted&&!trial?'no-sealed-research-version':
  registration?'candidate-registration-present':'research-history-present';
 const issues=[];
 if(heartbeat.status==='not-observed')issues.push('no-observed-watch-heartbeat');
 if(heartbeat.status==='heartbeat-stale')issues.push('watch-heartbeat-stale');
 if(heartbeat.status==='recent-tick-failure')issues.push('watch-tick-error');
 if(missingReportCount)issues.push('missing-research-H5-files');
 if(calendarAgeDays>=7)issues.push('latest-manifest-calendar-age-needs-review');
 if(budgetState==='trial-budget-exhausted')issues.push('trial-budget-exhausted');
 if(researchState==='research-decay-cooldown')issues.push('research-decay-cooldown');
 if(!accepted&&!trial)issues.push('no-sealed-research-version');
 if(registration&&registration.latestFrozenSignalDay===lastManifestSignalDay)
  issues.push('candidate-awaits-post-registration-signals');
 const status=missingReportCount?'missing-research-evidence':
  budgetState==='trial-budget-exhausted'?'research-budget-paused':
  researchState==='research-decay-cooldown'?'research-decay-paused':
  heartbeat.status==='heartbeat-stale'?'watch-heartbeat-stale':
  heartbeat.status==='recent-tick-failure'?'watch-tick-failed':
  heartbeat.status==='not-observed'?'watch-not-confirmed':
  calendarAgeDays>=7?'research-calendar-age-needs-review':
  'recent-heartbeat-only-not-live-certified';
 return {schemaVersion:1,mode:'v6-factor-shadow-runtime-health-v1',
  status,checkedAt:now,marketCalendar:'Asia/Shanghai-calendar-days-not-trading-session-certified',
  totalManifestSignalDays:signalDays.length,lastManifestSignalDay,
  lastManifestCalendarAgeDays:calendarAgeDays,
  sealedReportFileCount,missingReportCount,
  reportPresenceNotMaturityProof:true,
  acceptedVersion:accepted?.version??null,
  lastAcceptedObservationDay:accepted?.lastObservationDay??null,
  latestTrialHoldoutDay:trial?.trialAudit?.lastHoldoutDay??
   trial?.lastObservationDay??null,
  registrationStatus:registration?'sealed-candidate-present':'none',
  researchState,budgetState,remainingTrialBudget:budget?.remainingTrials??null,
  heartbeat,issues,readOnly:true,verifiedLive:false,
  trainingProgressCertified:false,canTrain:false,canTrade:false,
  productionWeightsChanged:false};
}
module.exports={assessShadowRuntimeHealth};
