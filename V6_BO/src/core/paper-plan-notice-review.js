'use strict';

const {aShareCalendarDate}=require('./a-share-calendar');
const {accountEpochOf}=require('./account-equity-evidence');
const {observePaperPlans,planVersion,alertsForRecord,sessions,MAX_GAP_MS,MAX_RECORDS,validateObservation}=require('./paper-plan-observer');

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

// F23.2: only use the immutable archive prefix visible at the original
// trigger. A sampled quote is NOT the official open, daily high or low.
function frozenSampledPath(records,trigger){
  const base={status:'unknown',sampleCount:0,first:null,peak:null,trough:null,last:null,
    originalOpen:null,originalPreviousClose:null,openingGapPct:null,
    peakToTriggerPct:null,firstToTriggerPct:null,observedPattern:null,
    maximumSampleGapMs:null,completeIntradayPath:false,canTrade:false,canTrain:false};
  const unknown=reason=>({...base,reason});
  try{
    if(!Array.isArray(records)||records.length>MAX_RECORDS)return unknown('原采样档案超限或缺失');
    validateObservation(trigger,{now:trigger.observedAt,day:trigger.day});
    const window=sessions(trigger.day).find(([a,b])=>trigger.quoteAt>=a&&trigger.observedAt<b);
    if(!window)return unknown('原触发不在同一连续竞价窗');
    const point=r=>({price:r.price,quoteAt:r.quoteAt,observedAt:r.observedAt,observationId:r.fingerprint,source:r.source});
    const rows=[];
    for(const row of records){
      if(!row||row.planId!==trigger.planId||row.planVersion!==trigger.planVersion||
        row.decisionId!==trigger.decisionId||row.code!==trigger.code||row.day!==trigger.day||
        row.entryEventId!==trigger.entryEventId||row.source!==trigger.source||row.mode!==trigger.mode)continue;
      if(row.observedAt>trigger.observedAt||row.quoteAt>trigger.quoteAt||row.quoteAt<window[0])continue;
      validateObservation(row,{now:trigger.observedAt,day:trigger.day});
      if(row.frozenAt!==trigger.frozenAt||row.intendedDate!==trigger.intendedDate||
        ['entryMin','entryMax','stop','target'].some(k=>row[k]!==trigger[k]))return unknown('原计划价格保护不一致');
      rows.push(row);
    }
    if(!rows.some(r=>r.fingerprint===trigger.fingerprint))return unknown('缺少原触发采样引用');
    rows.sort((a,b)=>a.quoteAt-b.quoteAt||a.observedAt-b.observedAt||a.fingerprint.localeCompare(b.fingerprint));
    let first=null,peak=null,trough=null,last=null,maximumSampleGapMs=0,sampleCount=0;
    for(const row of rows){
      if(last&&row.quoteAt===last.quoteAt){
        if(row.price!==last.price)return unknown('同源同原始时点报价矛盾');
        continue;
      }
      if(last)maximumSampleGapMs=Math.max(maximumSampleGapMs,row.quoteAt-last.quoteAt);
      last=point(row);sampleCount++;
      first??=last;
      if(!peak||last.price>peak.price)peak=last;
      if(!trough||last.price<trough.price)trough=last;
    }
    // The trigger is the last original timestamp. Do not count repeated
    // observations of the same source quote as another price movement.
    if(!last||last.quoteAt!==trigger.quoteAt||last.price!==trigger.price)return unknown('原触发路径终点未核对');
    const end=point(trigger),pct=(x,y)=>Number(((x/y-1)*100).toFixed(6));
    const observedPattern=peak.quoteAt<end.quoteAt&&peak.price>trigger.entryMax&&end.price<peak.price?
      end.price<trigger.entryMin?'sampled-rise-then-below-entry-range':
      end.price<=trigger.entryMax?'sampled-rise-then-entry-range':'sampled-retreat-above-entry-range':null;
    return {...base,status:'descriptive-only',sampleCount,first,peak,trough,last:end,
      maximumSampleGapMs:sampleCount>1?maximumSampleGapMs:null,
      peakToTriggerPct:pct(end.price,peak.price),firstToTriggerPct:pct(end.price,first.price),observedPattern,
      basis:'same-plan-version/source/mode/lot and continuous session; archive prefix at original trigger',
      reason:'仅原触发前已保存的离散采样；首笔不是开盘价，未证实高低开、回踩支撑、逐笔路径或成交'};
  }catch{return unknown('原采样完整性或时点无法核验');}
}

// Explicit user read. Neither the scheduler's projection callback nor its
// append/notification hooks run here. The observation and execution precheck
// are the same as those used by the original frozen-plan observer.
async function reviewPlanNotice(ref,{clock,canRead,available,session,store,readArchive,readContext}) {
  let original=null,reviewWindow=null,reviewDay=null,reviewedAt=null;
  const windowAt=(at,day)=>stamp(at)&&sessions(day).find(([start,end])=>at>=start&&at<end);
  function finish(status, reason, current = null) {
    const checkedAt=clock();
    const receipt = {checkedAt: stamp(checkedAt)?checkedAt:null, canTrade: false, accountMutated: false};
    if (!canRead()) {
      return {...receipt, status: 'unavailable', reason: '当前无权读取原私密计划档案', original: null, current: null};
    }
    // An asynchronous read or synchronous observation can finish after its
    // admitted quote/session has expired. Publish no live conclusion in that
    // case; never refresh a quote timestamp or request another collection.
    if(current){
      try {
        if(!available())return {...receipt,status:'unavailable',reason:'返回前权限或计划版本已变化',original,current:null};
        if(!stamp(checkedAt)||!stamp(reviewedAt)||checkedAt<reviewedAt||
           !stamp(current.quoteAt)||current.quoteAt>checkedAt||
           current.validUntil!==current.quoteAt+MAX_GAP_MS)
          return {...receipt,status:'unknown',reason:'返回时钟或原报价时点无法核验',original,current:null};
        const active=session(checkedAt),window=windowAt(checkedAt,reviewDay);
        if(!active?.continuous||active.day!==reviewDay||!window||window[0]!==reviewWindow?.[0]||
           checkedAt-current.quoteAt>MAX_GAP_MS)
          return {...receipt,status:'historical',reason:'返回前报价或原连续竞价有效窗已失效，须重新核对',original,current:null};
      }catch{
        return {...receipt,status:'unknown',reason:'返回前无法核对原报价有效窗',original,current:null};
      }
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
      planVersion:record.planVersion,observedAt:record.observedAt,quoteAt:record.quoteAt,
      price:record.price,source:record.source,gate:alert.availability,reason:alert.reason,
      entryMin:record.entryMin,entryMax:record.entryMax,stop:record.stop,target:record.target,
      sampledPath:frozenSampledPath(archived.records,record)};
    if(!available())return finish('historical','当前计划观察已暂停或版本已变化');
    const openedAt=clock(),atOpen=session(openedAt);
    reviewDay=atOpen.day;
    reviewWindow=windowAt(openedAt,reviewDay);
    if(!atOpen.continuous || !reviewWindow || (ref.kind==='entry'&&atOpen.day!==record.intendedDate))
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
    const at=clock(),active=session(at),window=windowAt(at,reviewDay);
    if(!stamp(at)||at<openedAt)return finish('unknown','读取期间时钟倒退或无法核验');
    if(!active.continuous || active.day!==atOpen.day || !window || window[0]!==reviewWindow[0])
      return finish('historical','读取期间交易时段已变化，须重新核对');
    reviewedAt=at;
    if(accountEpochOf(context.book,'pool')!==ref.accountEpoch)return finish('historical','原模拟账户期次已变化');
    if(!stamp(context.now)||context.now>at||context.now<reviewWindow[0]||at-context.now>MAX_GAP_MS)
      return finish('unknown','原模拟预检时点或连续竞价窗无法核验');
    const observed=observePaperPlans({...context,now:context.now,plans:matches,day:active.day,continuous:true});
    const point=observed.records[0];
    if(!point || point.quoteAt<reviewWindow[0] || at-point.quoteAt>MAX_GAP_MS || point.quoteAt<record.quoteAt ||
       (point.quoteAt===record.quoteAt && point.price!==record.price))
      return finish('unknown','缺少可核对的当前同股报价，或与原时点报价矛盾');
    const gate=ref.kind==='entry'?point.entry:point.exit;
    const current={price:point.price,quoteAt:point.quoteAt,source:point.source,validUntil:point.quoteAt+MAX_GAP_MS,
      conditionObserved:alertsForRecord(point).some(a=>a.kind===ref.kind && a.entryEventId===alert.entryEventId),
      gate:gate.allowed,reason:gate.reason};
    if(!current.conditionObserved)return finish('waiting','当前报价或原持仓批次已不满足原触发条件',current);
    if(current.gate!==true)return finish(current.gate===false?'blocked':'unknown',gate.reason,current);
    return finish('observed','本次只读复核观察到原计划条件',current);
  } catch {
    return finish('unknown','原始档案、当前报价或权威账户预检无法核验');
  }
}
module.exports={noticeRef,reviewPlanNotice,frozenSampledPath};
