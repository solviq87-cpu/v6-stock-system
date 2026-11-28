'use strict';
const runtimeTrace=require('../core/runtime-trace');
const {planIdOf}=require('../core/paper-decision-plan');

// A past plan is relevant only while its original purchase lot is still held.
// Retain the archive in full; avoid rescanning every old plan on each quote tick.
function selectActivePlans(plans,book,day){
  const lots=new Set(),heldPlans=new Set();
  for(const [symbol,position] of Object.entries(book?.account?.positions||{})){
    if(!(position?.quantity>0))continue;
    for(const lot of position.lots||[])if(lot?.quantity>0&&typeof lot.sourceEventId==='string')
      lots.add(symbol+'/'+lot.sourceEventId);
  }
  for(const event of book?.account?.events||[]){
    if(event?.side!=='buy'||!lots.has(event.symbol+'/'+event.eventId))continue;
    const id=planIdOf(event.reason);if(id)heldPlans.add(event.symbol+'/'+id);
  }
  return plans.filter(plan=>plan?.decisionAuthority==='fayo-decision-center'&&
    (plan.intendedDate===day||plan.intendedDate<day&&heldPlans.has(plan.code+'/'+plan.id)));
}
// The scheduler observes frozen research plans. It has no order mutation API.
function createDecisionEvidenceRuntime({clock=Date.now,isPrimary,canReadArchive=isPrimary,session,readArchive,readContext,
  observe,store,privateReady,sendPrivate,historyDay,historySymbols,collectHistory,trace=runtimeTrace}) {
  let plans=[],loadedAt=0,epoch=0,observing=false,collecting=false,historyKey='',attempts=0,nextHistoryAt=0;
  const state={status:'waiting',lastObservedAt:null,lastAttemptAt:null,lastSuccessAt:null,lastCompletedAt:null,attemptSequence:0,completedSequence:null,planCount:0,activePlanCount:0,lastError:null,
    history:{status:typeof collectHistory==='function'?'waiting':'delegated',owner:typeof collectHistory==='function'?'legacy-optional':'decision-center-background',day:null,attempts:0}};
  const status=()=>({...state,running:observing,history:{...state.history},privateChannel:privateReady()?'configured':'unconfigured',
    observationOnly:true,accountMutated:false});
  function invalidate(){loadedAt=0;epoch++;state.completedSequence=null;}
  async function tick(){
    if(observing||!isPrimary())return status();
    const initial=session(clock());
    if(!initial.continuous)return status();
    observing=true;state.lastAttemptAt=clock();const tickEpoch=epoch,attempt=++state.attemptSequence;
    await trace.async('task.decision-evidence',async root=>{
    try{
      if(!loadedAt||clock()<loadedAt||clock()-loadedAt>=60000){
        const version=epoch,archive=await readArchive();
        if(!isPrimary()||version!==epoch){root.mark('blocked','BUSINESS_REJECTED');return status();}
        if(!archive?.ok||!Array.isArray(archive.state?.plans))throw Error('冻结计划档案尚未读取');
        plans=archive.state.plans.filter(p=>p.decisionAuthority==='fayo-decision-center');
        loadedAt=clock();state.planCount=plans.length;
      }
      if(!plans.length){root.mark('skipped','NO_CANDIDATE');state.status='no-plans';state.activePlanCount=0;state.lastError=null;return status();}
      const context=await trace.async('risk.plan-context',()=>readContext(plans)),now=clock(),current=session(now);
      if(tickEpoch!==epoch||!isPrimary()||!current.continuous||current.day!==initial.day){root.mark('blocked','BUSINESS_REJECTED');return status();}
      const observedAt=context.now??now;
      if(!Number.isSafeInteger(observedAt)||observedAt>now||now-observedAt>15000)throw Error('原报价观察上下文已过期');
      const activePlans=selectActivePlans(plans,context.book,current.day);
      state.activePlanCount=activePlans.length;
      if(!activePlans.length){root.mark('skipped','NO_CANDIDATE');state.status='no-active-plans';state.lastError=null;return status();}
      const result=trace.sync('risk.plan-observation',span=>{
        const value=observe({...context,plans:activePlans,day:current.day,now:observedAt,continuous:current.continuous});
        if(!value.records.length)span.mark('unknown','SOURCE_UNAVAILABLE');
        return value;
      });
      const beforePersist=session(clock());
      if(tickEpoch!==epoch||!isPrimary()||!beforePersist.continuous||beforePersist.day!==initial.day){root.mark('blocked','BUSINESS_REJECTED');return status();}
      const committed=await trace.async('risk.plan-persist',()=>store.append({records:result.records,alerts:result.alerts,now:observedAt}));
      // A returned callback alone is not proof that the original archive
      // accepted every observation. Count newly persisted and exact duplicates.
      const validReceipt=Number.isSafeInteger(committed?.added)&&committed.added>=0&&
        Number.isSafeInteger(committed?.duplicate)&&committed.duplicate>=0&&
        committed.added+committed.duplicate===result.records.length&&Array.isArray(committed.alerts);
      if(!validReceipt){root.mark('unknown','SOURCE_UNAVAILABLE');state.status='observation-receipt-unverified';return status();}
      const completedAt=clock(),completedSession=session(completedAt);
      if(tickEpoch!==epoch||!isPrimary()||!completedSession.continuous||completedSession.day!==initial.day||
         !Number.isSafeInteger(completedAt)||completedAt<state.lastAttemptAt||completedAt<observedAt){
        root.mark('blocked','BUSINESS_REJECTED');state.status='observation-receipt-unverified';return status();
      }
      if(!result.records.length)root.mark('unknown','SOURCE_UNAVAILABLE');
      state.status=result.records.length?'observing':'missing-current-evidence';
      state.lastObservedAt=observedAt;state.lastError=null;
      if(result.records.length){state.lastSuccessAt=observedAt;state.lastCompletedAt=completedAt;state.completedSequence=attempt;}
      for(const alert of committed.alerts||[]){
        // Dedupe is committed before dispatch. Never replay an old condition
        // after restart, a missing webhook, a role change or an uncertain send.
        const dispatchAt=clock(),dispatchSession=session(dispatchAt);
        if(tickEpoch!==epoch||!isPrimary()||!privateReady()||!Number.isSafeInteger(alert?.quoteAt)||
           alert.quoteAt<=0||alert.quoteAt>dispatchAt||dispatchAt-alert.quoteAt>15000)continue;
        if(dispatchSession.day!==initial.day||dispatchSession.day!==alert.day||!dispatchSession.continuous)continue;
        try{await trace.async('notification.dispatch',async span=>{
          const accepted=await sendPrivate(alert);
          // Callback completion is not a gateway receipt or actual delivery.
          if(accepted===false)span.mark('blocked','NOTIFICATION_BLOCKED');
          else if(accepted!==true)span.mark('unknown','DELIVERY_UNKNOWN');
        });}catch{/* The existing private channel owns delivery receipts. */}
      }
    }catch(error){root.fail(error);state.status='evidence-unavailable';state.lastError=String(error?.message||'观察证据暂不可用').slice(0,180);}
    finally{observing=false;}
    return status();
    });
    return status();
  }
  async function tickHistory(){
    if(collecting||!isPrimary()||typeof collectHistory!=='function'||typeof historyDay!=='function'||typeof historySymbols!=='function')return status();
    const day=historyDay();
    if(!day)return status();
    if(historyKey!==day){historyKey=day;attempts=0;nextHistoryAt=0;}
    if(attempts>=3||clock()<nextHistoryAt)return status();
    const candidates=[...new Set(historySymbols().filter(code=>typeof code==='string'&&/^\d{6}$/.test(code)))];
    // Both registered daily-history adapters currently cover Shanghai/Shenzhen.
    const supported=code=>/^(?:60|68|00|30)\d{4}$/.test(code);
    const symbols=candidates.filter(supported).slice(0,3),excludedSymbols=candidates.filter(code=>!supported(code));
    const coverage={markets:['沪市','深市'],maxSymbolsPerDay:3,excludedSymbols};
    if(!symbols.length){state.history={status:'no-supported-symbols',day,attempts,coverage,
      missing:['当前历史来源仅覆盖沪深股票，尚无可采集标的']};return status();}
    collecting=true;attempts++;nextHistoryAt=clock()+15*60000;
    try{
      const result=await collectHistory({symbols,start:day,end:day});
      state.history={status:result?.status||'unavailable',day,attempts,coverage,missing:result?.missing||[],
        summary:result?.summary||null};
      // A completed response with missing source evidence is not retried into
      // fabricated completeness. Only an actual source failure gets a retry.
      if(['collected','already-collected-today','daily-attempt-limit','network-not-enabled','read-only-instance'].includes(result?.status))attempts=3;
    }catch{state.history={status:'collection-failed',day,attempts,coverage,missing:['来源采集失败，保留原回执']};}
    finally{collecting=false;}
    return status();
  }
  let reviewing=false;
  async function reviewNotice(ref,authorized) {
    if(reviewing)return {status:'busy',reason:'已有计划复核进行中，请稍后再读',original:null,current:null,
      checkedAt:clock(),canTrade:false,accountMutated:false};
    reviewing=true;
    const version=epoch;
    try {
      return await require('../core/paper-plan-notice-review').reviewPlanNotice(ref,{clock,session,store,readArchive,readContext,
        canRead:()=>canReadArchive() && authorized(),
        available:()=>epoch===version && isPrimary() && authorized()});
    } finally { reviewing=false; }
  }
  return {tick,tickHistory,status,invalidate,reviewNotice};
}
module.exports={createDecisionEvidenceRuntime,selectActivePlans};
