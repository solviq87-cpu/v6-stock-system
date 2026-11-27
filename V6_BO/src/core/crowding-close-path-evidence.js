'use strict';
// Descriptive closed-daily path only, after the ORIGINAL forward observer
// has validated its frozen cohort, market, calendar and matching baseline.
// Never infer intraday event order, exchange depth, fills or notification time.
const VERSION='fayo-close-path-evidence-v1';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const ms=x=>Number.isSafeInteger(x)&&x>0&&x<8e15;
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const round=x=>finite(x)?Number(x.toFixed(8)):null;
const fields=['knownAt','firstKnownAt','receivedAt','availableAt','recordedAt'];
const flags=['sourceConflict','conflict','retracted','withdrawn'];
function closeReceipt(bar,symbol,market){
 if(!bar||!date(bar.date)||!date(market?.asOf)||bar.date>market.asOf||!ms(market.observedAt)||
  market.observedAt<Date.parse(bar.date+'T16:00:00+08:00')||
  !finite(bar.close)||bar.close<=0||!Number.isSafeInteger(bar.volume)||bar.volume<=0||bar.suspended!==false||
  bar.final===false||market.final===false||bar.symbol!=null&&bar.symbol!==symbol||
  bar.code!=null&&bar.code!==symbol||bar.priceBasis!=null&&bar.priceBasis!=='unadjusted'||
  flags.some(k=>bar[k]===true)||['conflict','stale','unknown'].includes(bar.evidenceStatus)||
  market.feed?.source!=='fixture'&&['simulated','fixture','mock','synthetic','testSample'].some(k=>bar[k]===true))
  return {status:'invalid-or-missing',knownAt:null};
 const present=fields.filter(k=>Object.hasOwn(bar,k));
 if(!present.length)return {status:'snapshot-only-unverified',knownAt:null};
 const closeAt=Date.parse(bar.date+'T15:00:00+08:00');
 if(present.some(k=>!ms(bar[k])||bar[k]<closeAt||bar[k]>market.observedAt))
  return {status:'invalid-or-missing',knownAt:null};
 // firstKnownAt cannot be later than any declared later availability.
 // Availability and recording cannot precede receipt or known time.
 if(present.some(k=>k!=='firstKnownAt'&&ms(bar.firstKnownAt)&&bar[k]<bar.firstKnownAt)||
  ['availableAt','recordedAt'].some(k=>ms(bar[k])&&['receivedAt','knownAt'].some(p=>ms(bar[p])&&bar[k]<bar[p])))
  return {status:'invalid-or-missing',knownAt:null};
 return {status:'explicit-daily-receipt-unverified',knownAt:Math.max(...present.map(k=>bar[k]))};
}
function indexStocks(market){
 const map=new Map();
 for(const stock of Array.isArray(market?.stocks)?market.stocks:[]){
  if(!stock||typeof stock.symbol!=='string')continue;
  if(map.has(stock.symbol)){map.set(stock.symbol,null);continue;}
  const bars=new Map();
  for(const bar of Array.isArray(stock.bars)?stock.bars:[]){
   if(!bar||!date(bar.date))continue;
   bars.set(bar.date,bars.has(bar.date)?null:bar);
  }
  map.set(stock.symbol,{bars,actions:new Set(Array.isArray(stock.corporateActions)?stock.corporateActions:[])});
 }
 return map;
}
function buildCloseRiskPath({signal,market,stock,calendarIndex,horizon,lossPct,validated,purged=false}={}){
 const out={version:VERSION,status:purged?'purged-overlapping-fold':'unknown',expectedSessions:horizon??null,
  explicitObservedSessions:0,snapshotOnlySessions:0,missingOrInvalidSessions:0,pendingSessions:0,corporateActionSessions:0,
  pathComplete:false,eventObserved:null,firstEventDate:null,firstObservedAdverseDate:null,firstObservedAdverseAvailableAt:null,
  firstEventTimingKnown:false,firstEventPrefixAvailableAt:null,earliestAvailableAdverseCloseDate:null,earliestAvailableAdverseAt:null,
  firstGapDate:null,completeCloseAdverseExcursionPct:null,observedCloseAdverseExcursionPct:null,
  terminalCloseEvent:null,actualIntradayMaximumAdverseExcursion:null,actualNotificationLeadTime:null,
  actualExitEvidence:null,trainingEligible:false,canTrade:false,canNotify:false};
 if(purged||validated!==true||!signal||!stock||!date(signal.signalDate)||!finite(signal.baselineClose)||signal.baselineClose<=0||
  !Number.isSafeInteger(horizon)||horizon<1||horizon>60||!finite(lossPct)||lossPct<=0||lossPct>=100||
  !Number.isSafeInteger(calendarIndex)||calendarIndex<0||market?.calendar?.[calendarIndex]!==signal.signalDate||
  !date(market.calendar[calendarIndex+horizon]))return out;
 let worst=0,blockedByAction=false,priorGap=false,firstAdverse=null,earliestAvailable=null,prefixAvailableAt=0;
 for(let i=1;i<=horizon;i++){
  const d=market.calendar[calendarIndex+i],bar=stock.bars.get(d);
  let reason=null;
  if(d>market.asOf||market.observedAt<Date.parse(d+'T16:00:00+08:00')){out.pendingSessions++;reason='pending';}
  else{
   if(stock.actions.has(d))blockedByAction=true;
   if(blockedByAction){out.corporateActionSessions++;reason='corporate-action-unresolved';}
   else{
    const receipt=closeReceipt(bar,signal.symbol,market);
    if(receipt.status==='snapshot-only-unverified'){out.snapshotOnlySessions++;reason='snapshot-only';}
    else if(receipt.status!=='explicit-daily-receipt-unverified'){out.missingOrInvalidSessions++;reason='missing-or-invalid';}
    else{
     const ret=(bar.close/signal.baselineClose-1)*100;
     if(!finite(ret)||ret<-100){out.missingOrInvalidSessions++;reason='invalid-return';}
     else{
      out.explicitObservedSessions++;worst=Math.max(worst,-ret);
      const adverse=ret<=-lossPct+1e-9;
      if(i===horizon)out.terminalCloseEvent=adverse;
      prefixAvailableAt=Math.max(prefixAvailableAt,receipt.knownAt);
      if(adverse){
       if(!firstAdverse)firstAdverse={date:d,availableAt:receipt.knownAt,first:!priorGap,prefixAvailableAt:priorGap?null:prefixAvailableAt};
       if(!earliestAvailable||receipt.knownAt<earliestAvailable.availableAt)earliestAvailable={date:d,availableAt:receipt.knownAt};
      }
     }
    }
   }
  }
  if(reason){priorGap=true;out.firstGapDate??=d;}
 }
 out.pathComplete=out.explicitObservedSessions===horizon;
 out.eventObserved=firstAdverse?true:out.pathComplete?false:null;
 if(firstAdverse){
  out.firstObservedAdverseDate=firstAdverse.date;out.firstObservedAdverseAvailableAt=firstAdverse.availableAt;
  out.firstEventTimingKnown=firstAdverse.first;
  out.firstEventDate=firstAdverse.first?firstAdverse.date:null;
  out.firstEventPrefixAvailableAt=firstAdverse.prefixAvailableAt;
  out.earliestAvailableAdverseCloseDate=earliestAvailable.date;
  out.earliestAvailableAdverseAt=earliestAvailable.availableAt;
 }
 out.observedCloseAdverseExcursionPct=out.explicitObservedSessions?round(worst):null;
 out.completeCloseAdverseExcursionPct=out.pathComplete?round(worst):null;
 out.status=out.pathComplete?'complete-declared-daily-path':firstAdverse?'adverse-observed-incomplete-path':
  out.pendingSessions===horizon-out.explicitObservedSessions?'pending':'incomplete-path';
 return out;
}
function summarizeClosePaths(rows,expectedDays,receivedDays){
 const byDay=new Map();
 for(const r of rows){
  const same=byDay.get(r.day)||[];same.push(r.closePath);byDay.set(r.day,same);
 }
 const complete=[...byDay.values()].filter(rs=>rs.every(p=>p?.pathComplete===true));
 return {registeredDays:expectedDays,receivedDays,missingRegisteredDays:expectedDays-receivedDays,
  eligibleReceivedSignals:rows.length,completePaths:rows.filter(r=>r.closePath?.pathComplete===true).length,
  observedAdversePaths:rows.filter(r=>r.closePath?.eventObserved===true).length,
  completeNoAdversePaths:rows.filter(r=>r.closePath?.eventObserved===false).length,
  unknownEventPaths:rows.filter(r=>r.closePath?.eventObserved==null).length,
  exactFirstEventPaths:rows.filter(r=>r.closePath?.firstEventTimingKnown===true).length,
  completeReceivedDays:complete.length,completeDaysWithAdverse:complete.filter(rs=>rs.some(p=>p.eventObserved===true)).length,
  completeDaysWithMultipleAdverse:complete.filter(rs=>rs.filter(p=>p.eventObserved===true).length>=2).length,
  fullRegisteredPopulationCertified:false,independenceCertified:false,actualAvoidableLoss:null,
  note:'同日多证券只计为同一事件日描述；预登记样本池名单及真实首次落盘未认证，缺档不计无风险。'};
}
function labelSensitivity(paired,lossPct){
 const valid=Array.isArray(paired)&&paired.length>0&&paired.every(r=>finite(r.priceReturnPct)&&typeof r.event==='boolean');
 const rows=[.9,1,1.1].map(factor=>{
  const threshold=lossPct*factor;
  if(!valid||!finite(threshold)||threshold<=0||threshold>=100)return {factor,lossPct:threshold,pairedCount:valid?paired.length:0,eventCount:null,changedLabels:null};
  const values=paired.map(r=>r.priceReturnPct<=-threshold+1e-9);
  return {factor,lossPct:threshold,pairedCount:paired.length,eventCount:values.filter(Boolean).length,
   changedLabels:values.filter((v,i)=>v!==paired[i].event).length};
 });
 return {version:VERSION,status:'exploratory-label-only',rows,decisionThresholdSensitivity:null,
  calibration:null,selectedThreshold:null,productionThresholdChanged:false,canTrade:false,
  note:'固定0.9/1/1.1倍仅比较同一已配对收盘损失标签的敏感性，非模型门槛优化、事前登记的新标签或晋级证据。'};
}
module.exports={VERSION,closeReceipt,indexStocks,buildCloseRiskPath,summarizeClosePaths,labelSensitivity};
