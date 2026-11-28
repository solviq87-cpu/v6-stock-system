'use strict';

const {aShareCalendarDate}=require('./a-share-calendar');
const {accountEpochOf}=require('./account-equity-evidence');
const {observePaperPlans,planVersion,alertsForRecord}=require('./paper-plan-observer');

const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const stamp=value=>Number.isSafeInteger(value)&&value>0&&value<8e15;

function noticeRef(value,signals) {
  if(!value || ![value.deliveryId,value.observationId,value.alertId,value.accountEpoch].every(hash) ||
     typeof value.code!=='string' || !/^\d{6}$/.test(value.code) || !['entry','stop','target'].includes(value.kind) || !stamp(value.quoteAt) ||
     !Array.isArray(signals) || !signals.some(row=>row?.code===value.code && row.type==='plan-'+value.kind &&
       row.ts===value.quoteAt && row.signalId===value.alertId)) return null;
  const {deliveryId,observationId,alertId,accountEpoch,code,kind,quoteAt}=value;
  return {deliveryId,observationId,alertId,accountEpoch,code,kind,quoteAt};
}

// Explicit user read. Neither the scheduler's projection callback nor its
// append/notification hooks run here. The observation and execution precheck
// are the same as those used by the original frozen-plan observer.
async function reviewPlanNotice(ref,{clock,canRead,available,session,store,readArchive,readContext}) {
  let original=null;
  function finish(status, reason, current = null) {
    const receipt = {checkedAt: clock(), canTrade: false, accountMutated: false};
    if (!canRead()) {
      return {...receipt, status: 'unavailable', reason: '当前无权读取原私密计划档案', original: null, current: null};
    }
    return {...receipt, status, reason, original, current};
  }
  try {
    if(!canRead())return finish('unavailable','当前无权读取原私密计划档案');
    const now=clock(),day=aShareCalendarDate(ref.quoteAt);
    if(ref.quoteAt>now)return finish('unknown','原报价时点无法核验');
    const archived=await store.read({day,now});
    if(!canRead())return finish('unavailable','当前无权读取原私密计划档案');
    const alert=archived.alerts.find(a=>a.id===ref.alertId && a.observationId===ref.observationId &&
      a.code===ref.code && a.quoteAt===ref.quoteAt && a.kind===ref.kind);
    const record=alert&&archived.records.find(r=>r.fingerprint===ref.observationId && r.planId===alert.planId &&
      r.planVersion===alert.planVersion && r.code===alert.code && r.day===day);
    if(!record)return finish('unknown','原通知缺少可核对的已归档触发与报价');
    original={code:record.code,kind:alert.kind,decisionId:record.decisionId,planId:record.planId,
      planVersion:record.planVersion,observationId:record.fingerprint,alertId:alert.id,
      inputProvenanceFingerprint:record.inputProvenanceFingerprint,intendedDate:record.intendedDate,frozenAt:record.frozenAt,
      observedAt:record.observedAt,quoteAt:record.quoteAt,receivedAt:record.receivedAt,
      originalQuoteValidUntil:record.quoteAt+15000,entryEventId:record.entryEventId,remainingQuantity:record.remainingQuantity,
      actionWindow:alert.kind==='entry'?'original-entry-trading-day-only':'original-held-lot-only',
      price:record.price,source:record.source,gate:alert.availability,reason:alert.reason,
      entryMin:record.entryMin,entryMax:record.entryMax,stop:record.stop,target:record.target};
    if(!available())return finish('historical','当前计划观察已暂停或版本已变化');
    const atOpen=session(clock());
    if(!atOpen.continuous || (ref.kind==='entry'&&atOpen.day!==record.intendedDate))
      return finish('historical','当前时段或交易日已超出原条件的核验范围');
    const archive=await readArchive();
    if(!available())return finish('unavailable','读取期间权限或计划版本已变化');
    if(!archive?.ok || !Array.isArray(archive.state?.plans))return finish('unknown','冻结计划档案不可读');
    const matches=archive.state.plans.filter(row=>row?.id===record.planId);
    if(matches.length!==1 || matches[0].decisionAuthority!=='fayo-decision-center' ||
       matches[0].decisionId!==record.decisionId || planVersion(matches[0])!==record.planVersion)
      return finish('historical','原计划已变化或当前档案无法唯一匹配');
    const context=await readContext(matches,{publishReceipts:false});
    if(!available())return finish('unavailable','读取期间权限或计划版本已变化');
    const at=clock(),active=session(at);
    if(!active.continuous || active.day!==atOpen.day)return finish('historical','读取期间交易时段已变化');
    if(accountEpochOf(context.book,'pool')!==ref.accountEpoch)return finish('historical','原模拟账户期次已变化');
    if(!stamp(context.now)||context.now>at||at-context.now>15000)return finish('unknown','原模拟预检时点无法核验');
    const observed=observePaperPlans({...context,now:context.now,plans:matches,day:active.day,continuous:true});
    const point=observed.records[0];
    if(!point || at-point.quoteAt>15000 || point.quoteAt<record.quoteAt ||
       (point.quoteAt===record.quoteAt && point.price!==record.price))
      return finish('unknown','缺少可核对的当前同股报价，或与原时点报价矛盾');
    const gate=ref.kind==='entry'?point.entry:point.exit;
    const sameOriginalContext=point.entryEventId===alert.entryEventId;
    const current={price:point.price,quoteAt:point.quoteAt,receivedAt:point.receivedAt,source:point.source,validUntil:point.quoteAt+15000,
      observedAt:point.observedAt,observationId:point.fingerprint,sameOriginalContext,
      remainingQuantity:sameOriginalContext?point.remainingQuantity:null,
      conditionObserved:sameOriginalContext&&alertsForRecord(point).some(a=>a.kind===ref.kind && a.entryEventId===alert.entryEventId),
      // A new lot in the same stock cannot supply the original notification's gate.
      gate:sameOriginalContext?gate.allowed:null,reason:sameOriginalContext?gate.reason:'当前原持仓批次或入场状态已变化，不能沿用其他批次的预检'};
    if(!current.conditionObserved)return finish('waiting','当前报价或原持仓批次已不满足原触发条件',current);
    if(current.gate!==true)return finish(current.gate===false?'blocked':'unknown',gate.reason,current);
    return finish('observed','本次只读复核观察到原计划条件',current);
  } catch {
    return finish('unknown','原始档案、当前报价或权威账户预检无法核验');
  }
}
module.exports={noticeRef,reviewPlanNotice};
