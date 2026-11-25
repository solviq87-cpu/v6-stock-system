'use strict';
const path=require('node:path');
const crypto=require('node:crypto');
const {buildRiskWorkbench,filterRiskWorkbench,riskForPlanAlert}=require('../core/risk-workbench');
const {buildEffectiveRiskEvidence,freshMark}=require('../core/effective-risk-evidence');
const {buildRiskActionEvidence}=require('../core/risk-action-evidence');
const {createRiskAlertLifecycle,normalizeRiskReceipt,normalizeRisk}=require('../core/risk-alert-lifecycle');
const {digest}=require('../core/research-workspace-store');
const planObserver=require('../core/paper-plan-observer');
const {aShareCalendarDate}=require('../core/a-share-calendar');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const list=value=>Array.isArray(value)?value:[];

// Read adapters have no order-mutation capability. Only tick/notification state
// writes derived files, under the same primary-instance condition as the host.
function createRiskWorkbenchRuntime({root,clock=Date.now,isPrimary,readBook,readQuotes,readResearch,readPlans,
  readObservations,readAutomaticPolicy,readOriginalExitChecks,readMarket=()=>({}),readSystem=()=>({}),
  readStrategy=()=>null,session,calendar,privateReady=()=>false,sendPrivate=()=>false,planEnabled=()=>false}={}) {
  const {buildAccountEquityEvidence,createAccountEquityEvidenceStore}=require('../core/account-equity-evidence');
  const {buildPortfolioStressEvidence}=require('../core/portfolio-stress-evidence');
  const equityStore=createAccountEquityEvidenceStore({root:path.join(root,'equity'),clock,canWrite:isPrimary});
  const notifications=createRiskAlertLifecycle({root:path.join(root,'notifications'),clock,canWrite:isPrimary});
  let plans=[],plansAt=0,plansError='冻结计划尚未读取',planLoad=null,observedDay='',observationAt=0;
  let observations=[],planAlerts=[],observationError=null,busy=false;
  const status={lastObservedAt:null,lastError:null,accountErrors:{pool:null,pre:null},
    accountChecks:{pool:null,pre:null},privateChannel:'unconfigured',readOnly:true};
  const samples=new Map();

  async function refreshEvidence() {
    const now=clock(),day=aShareCalendarDate(now);
    if(planLoad)return planLoad;
    if(plansAt&&now>=plansAt&&now-plansAt<60000&&observedDay===day)return;
    planLoad=(async()=>{
      try{
        const archive=await readPlans();
        if(!archive?.ok||!Array.isArray(archive.state?.plans))throw Error('原冻结计划档案不可用');
        plans=archive.state.plans.filter(p=>p?.decisionAuthority==='fayo-decision-center');
        plansAt=clock();plansError=null;
      }catch{plansError='原冻结计划档案不可读；计划观察与执行覆盖未知';}
      try{
        const value=await readObservations({day,now:clock()});
        if(observedDay!==day||observationAt<=(value.records?.at(-1)?.observedAt||0)){
          const latest=new Map();for(const row of list(value.records))if(!latest.has(row.planId)||latest.get(row.planId).observedAt<row.observedAt)latest.set(row.planId,row);
          observations=[...latest.values()];planAlerts=list(value.alerts);observationAt=clock();observedDay=day;
        }
        observationError=null;
      }catch{observationError='原计划观察档不可读，不能确认缺档期间是否触发条件';}
    })().finally(()=>{planLoad=null;});
    return planLoad;
  }

  function classifications(market,equity) {
    const source=market?.classificationSnapshot;
    if(!source||!source.day||!Number.isSafeInteger(source.knownAt))return [];
    const day=String(source.day).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
    return list(equity?.positions).flatMap(position=>{
      const fact=source.facts?.[position.symbol],themes=list(fact?.themes).filter(x=>typeof x==='string'&&x.trim());
      if(!themes.length)return [];
      return [{symbol:position.symbol,themes,source:'dabanke',sourceRecordId:day+'/'+position.symbol,
        version:hash([day,source.knownAt,position.symbol,themes]),day,knownAt:source.knownAt}];
    });
  }

  async function read({accountId='pool',code=null,actor=null}={}) {
    if(!['pool','pre'].includes(accountId))throw Error('未知原账户');
    await refreshEvidence();
    const now=clock(),current=session(now),missing=[],authorityChecks=[];
    let book=null,quotes={},equity=null,history=null,rules=null,actions=null,stress=null,research=null,market={},bookRead=false;
    try{if(!isPrimary())throw Error('副本');book=readBook(accountId);bookRead=true;
    }catch{missing.push('未取得该实例的原权威账户；副本估值不冒充主账本');
      if(isPrimary())authorityChecks.push({kind:'authority-unavailable',source:'original-paper-account-service',checkedAt:clock(),success:false});}
    let quotesRead=false;
    try{quotes=readQuotes();quotesRead=true;}catch{missing.push('原逐票报价不可用');
      authorityChecks.push({kind:'quote-reader-failed',source:'original-quote-reader',checkedAt:clock(),success:false});}
    try{equity=buildAccountEquityEvidence({book,accountId,quotes,now});}catch{missing.push('权威账户权益证据无法核验');}
    if(bookRead)authorityChecks.push({kind:'authority-unavailable',source:'original-paper-account-service',checkedAt:clock(),success:true,
      recoveryConfirmed:Boolean(equity?.accountEpoch)&&equity?.cashMovements?.status==='reconciled'});
    if(quotesRead)authorityChecks.push({kind:'quote-reader-failed',source:'original-quote-reader',checkedAt:clock(),success:true,
      dataAt:Math.max(0,...Object.values(quotes||{}).map(row=>Number.isSafeInteger(row?.quoteAt)?row.quoteAt:0))||null,
      recoveryConfirmed:equity?.status==='complete'&&Object.entries(quotes||{}).some(([symbol,row])=>
        freshMark(row,symbol,now).usable)});
    if(equity?.accountEpoch)try{history=equityStore.read({accountId,accountEpoch:equity.accountEpoch,now,limit:500});}
    catch{missing.push('权益观察档缺失或损坏；禁止静默修复或从已结算曲线补造回撤');}
    try{rules=buildEffectiveRiskEvidence({book,quotes,now,calendar,accountId,automaticPolicy:readAutomaticPolicy(accountId)});}
    catch{missing.push('实际生效规则或风险占用证据不可核验');}
    try{
      const accountPlans=accountId==='pool'?plans:[];
      actions=buildRiskActionEvidence({book,plans:accountPlans,observations:accountId==='pool'?observations:[],quotes,now,calendar,
        continuous:current.continuous,originalExitChecks:readOriginalExitChecks(accountId,accountPlans,book,quotes,now),accountId});
    }catch{missing.push('原风险动作和执行限制证据不可核验');}
    try{research=readResearch(now);}catch{missing.push('原研究风险证据不可用');}
    try{market=readMarket(now);}catch{missing.push('原市场及分类回执不可用');}
    const classification=classifications(market,equity);
    try{stress=buildPortfolioStressEvidence({equity,classifications:classification,now});}
    catch{missing.push('组合压力测试缺少可核验的权益或分类输入');}
    let alertView=null;
    if(equity?.accountEpoch)try{alertView=notifications.read({accountId,accountEpoch:equity.accountEpoch,actor});}
    catch{missing.push('原风险提醒记录不可核验，保留去重且不自动重发');}
    if(plansError&&accountId==='pool')missing.push(plansError);
    if(observationError&&accountId==='pool')missing.push(observationError);
    let system={},strategy=null;
    try{system=readSystem()||{};}catch{missing.push('原系统状态不可读取');}
    try{strategy=readStrategy();}catch{missing.push('上游策略风险结论不可读取，尚未取得校准或衰减证据');}
    if(status.lastError&&!Object.values(status.accountErrors).some(Boolean))missing.push(status.lastError);
    const report=buildRiskWorkbench({accountId,now:clock(),equity,equityHistory:history,rules,actions,stress,research,market,
      classifications:classification,strategy,alerts:alertView,
      planAlerts:accountId==='pool'?planAlerts:[],system:{...system,replica:!isPrimary(),authorityChecks,missing:[...list(system.missing),...missing],
        observationHealth:['pool','pre'].filter(id=>status.accountChecks[id]!==null).map(id=>({accountId:id,
          error:status.accountErrors[id],checkedAt:status.accountChecks[id],summary:status.lastError}))}});
    report.runtime={...status,accountErrors:{...status.accountErrors},accountChecks:{...status.accountChecks},
      plansObservedAt:plansAt||null,observationsReadAt:observationAt||null,
      privateChannel:privateReady()?'configured':'unconfigured',notificationSource:'original-private-push-queue'};
    return filterRiskWorkbench(report,code);
  }

  function observePlans(result) {
    const records=list(result?.records);if(!records.length)return;
    const day=records[0].day;
    const latest=new Map(observedDay===day?observations.map(x=>[x.planId,x]):[]);
    for(const row of records)if(!latest.has(row.planId)||latest.get(row.planId).observedAt<row.observedAt)latest.set(row.planId,row);
    observations=[...latest.values()];planAlerts=list(result.alerts);observedDay=day;observationAt=clock();observationError=null;
  }
  function receipt(key,deliveryId,result) {
    try{notifications.recordReceipt({...key,deliveryId,...normalizeRiskReceipt(result)});}
    catch{status.lastError='投递回执尚未持久确认，原预留保留且不自动重发';}
  }
  function dispatch(report,risk,{planAlert=false}={}) {
    if(!report.accountEpoch||!isPrimary()||!privateReady())return false;
    const isPlanRisk=Boolean(risk.references?.planId)||risk.rootCauseId.startsWith('plan/');
    if(isPlanRisk&&(planEnabled()!==true||plansError||observationError))return false;
    // The original plan observer remains the single owner of active condition
    // alerts. Its callback runs only after its trigger ID has been committed.
    if(isPlanRisk&&risk.status!=='resolved'&&!planAlert)return false;
    const now=clock();
    // These notifications report facts; unknown/stale data never generates a
    // fresh stop/exit signal. The old transport applies all its own gates too.
    if(!['available','conflict'].includes(risk.evidenceStatus)||risk.status==='unknown')return false;
    if(risk.priceDependent&&(!risk.sourceAt||now<risk.sourceAt||now-risk.sourceAt>15000||!session(now).continuous))return false;
    if(!planAlert&&risk.status!=='resolved'&&!['warning','critical'].includes(risk.severity))return false;
    const key={accountId:report.account.id,accountEpoch:report.accountEpoch};
    const group=notifications.read(key).groups.find(row=>row.rootCauseId===risk.rootCauseId);
    if(!group||group.observationGap||group.status!==risk.status||
      !group.risks.some(row=>digest(row)===digest(normalizeRisk(risk,now))))return false;
    const reservation=notifications.reserveDelivery({...key,rootCauseId:risk.rootCauseId,eventId:group.notificationEventId,
      expectedRiskFingerprint:digest(group.risks)});
    if(!reservation.reserved)return false;
    const beforeSend=()=>{
      const at=clock();if(!isPrimary()||!privateReady())return {ok:false,why:'原主实例或私密通道条件已变化'};
      if(isPlanRisk&&(planEnabled()!==true||plansError||observationError))return {ok:false,why:'原计划观察已停用或档案证据不可读'};
      try{
        const view=notifications.read(key),latest=view.groups.find(row=>row.rootCauseId===risk.rootCauseId);
        if(!latest||latest.muted||latest.observationGap||latest.status!==risk.status||latest.notificationEventId!==reservation.eventId)
          return {ok:false,why:'风险已更新、静音或观察缺档，原排队消息不再外发'};
        const book=readBook(key.accountId);let quotes={},quoteReadFailed=false;
        try{quotes=readQuotes();}catch{quoteReadFailed=true;}
        const current=buildAccountEquityEvidence({book,accountId:key.accountId,quotes,now:at});
        if(current.accountEpoch!==key.accountEpoch)return {ok:false,why:'原账户期间已变化'};
        // An actual reader exception can be reported without consuming its
        // nonexistent price. Recheck that same exception and the original
        // account period; this grants no trading or holding-risk exemption.
        if(risk.authorityEvidence?.kind==='quote-reader-failed'){
          if(risk.status==='active'&&!quoteReadFailed)return {ok:false,why:'原报价读取故障已变化，旧故障通知暂停'};
          if(risk.status==='resolved'&&(quoteReadFailed||current.status!=='complete'||
            !Object.entries(quotes||{}).some(([symbol,row])=>freshMark(row,symbol,at).usable)))
            return {ok:false,why:'原报价链尚无完整有效恢复证据'};
        }else if(quoteReadFailed)return {ok:false,why:'原报价读取失败，不能复核旧价格通知'};
        if(isPlanRisk&&risk.priceDependent){
          const plan=plans.find(row=>row.id===risk.references?.planId),kind=risk.references?.kind;
          if(!plan||!['entry','stop','target'].includes(kind))return {ok:false,why:'原冻结计划或条件引用缺失'};
          const day=aShareCalendarDate(at),quote=quotes[plan.code];
          if(quote?.sourceConflict===true||quote?.conflict===true)return {ok:false,why:'原计划报价来源已出现冲突，暂停依赖该价格的通知'};
          planObserver.quoteEvidence(quote,plan.code,day,at);
          const context=planObserver.planLedgerContext(book,plan,at);
          if(context.ambiguous||!context.current||quote.quoteAt<Date.parse(plan.frozenAt))return {ok:false,why:'原计划持仓批次或报价尚未核对'};
          const stillTriggered=kind==='entry'?context.entry===null&&day===plan.intendedDate&&quote.price>=plan.entryMin&&quote.price<=plan.entryMax:
            context.entry!==null&&context.remaining>0&&(kind==='stop'?quote.price<=plan.stop:quote.price>=plan.target);
          if(risk.status==='active'&&!stillTriggered||risk.status==='resolved'&&stillTriggered)
            return {ok:false,why:'原计划已有更新报价或持仓，旧触发或解除条件不再成立'};
        }else if(risk.priceDependent){
          if(risk.evidenceStatus==='conflict'){
            // A conflict warning reports the conflict itself. Recheck that
            // diagnostic instead of requiring its unusable price to pass.
            const conflict=list(readMarket(at)?.conflicts).find(row=>row?.code===risk.object.id&&/conflict|ambiguous/.test(row.status||''));
            const checkedAt=typeof conflict?.checkedAt==='number'?conflict.checkedAt:Date.parse(conflict?.checkedAt||'');
            if(!Number.isSafeInteger(checkedAt)||checkedAt>at||at-checkedAt>15000||checkedAt<risk.sourceAt)
              return {ok:false,why:'原来源冲突回执已更新、缺失或过期，旧通知暂停'};
          }else if(risk.object.type==='account'){
            if(current.status!=='complete')return {ok:false,why:'当前账户估值重新出现覆盖缺口，不能发送旧解除提示'};
          }else if(risk.object.type==='security'){
            const quote=quotes[risk.object.id];
            if(quote?.sourceConflict===true||quote?.conflict===true)return {ok:false,why:'当前报价来源冲突，旧价格通知暂停'};
            planObserver.quoteEvidence(quote,risk.object.id,aShareCalendarDate(at),at);
          }else return {ok:false,why:'该价格风险缺少可复核的原报价对象'};
        }
      }catch{return {ok:false,why:'原账户证据无法核验'};}
      if(risk.priceDependent&&(!session(at).continuous||at<risk.sourceAt||at-risk.sourceAt>15000))return {ok:false,why:'风险观察原始报价或时段已失效'};
      return {ok:true};
    };
    // Keep the original plan observer's quota classification and trigger IDs.
    // Only a verified active plan alert with its original buy event qualifies
    // as holding risk; a generic risk card must not acquire that exemption.
    const originalPlanAlert=planAlert&&risk.status==='active'&&risk.references?.alertId&&
      ['entry','stop','target'].includes(risk.references?.kind);
    const holdingRisk=originalPlanAlert&&risk.references.kind!=='entry'&&Boolean(risk.references.entryEventId);
    const title=originalPlanAlert?(holdingRisk?'持仓风控·计划条件观察':'计划条件观察'):
      `风险工作台 · ${risk.status==='resolved'?'解除观察':risk.severity==='critical'?'关键风险':'风险观察'}`;
    const message=`═══ ${title} ═══\n`+
      `${report.account.label} · ${risk.object.label||risk.object.id}\n${risk.facts.join('\n')}\n`+
      `影响：${risk.impact}\n当前限制：${risk.restrictions.join('；')||'未附加新限制，沿用原门禁'}\n`+
      `检查：${risk.checks.join('；')}\n解除条件：${risk.releaseConditions.join('；')}\n`+
      `来源：${risk.source} · ${risk.sourceAt?new Date(risk.sourceAt).toISOString():'时点未知'}\n条件观察、订单提交及实际成交分别核对，成交以原账本为准。`;
    try{
      const accepted=sendPrivate(message,{private:true,sseEdit:true,beforeSend,
        onReceipt:result=>receipt(key,reservation.deliveryId,result),
        signalRefs:typeof risk.object.id==='string'&&/^\d{6}$/.test(risk.object.id)?[{code:risk.object.id,
          type:originalPlanAlert?'plan-'+risk.references.kind:'risk-'+risk.category,ts:risk.sourceAt,
          signalId:originalPlanAlert?risk.references.alertId:hash([key,risk.rootCauseId,reservation.eventId])}]:[]});
      if(accepted===false)receipt(key,reservation.deliveryId,{blocked:true});
      else if(accepted!==true)receipt(key,reservation.deliveryId,{status:'unknown'});
      return accepted===true;
    }catch{receipt(key,reservation.deliveryId,{status:'unknown'});return false;}
  }

  async function sendPlanAlert(alert) {
    if(!isPrimary()||planEnabled()!==true)return false;
    try{
      const report=await read({accountId:'pool'}),now=clock();
      if(!report.accountEpoch||!isPrimary()||planEnabled()!==true||plansError||observationError||!alert||alert.day!==aShareCalendarDate(now)||
          !Number.isSafeInteger(alert.quoteAt)||alert.quoteAt>now||now-alert.quoteAt>15000)return false;
      const plan=plans.find(row=>row.id===alert.planId),record=observations.find(row=>row.fingerprint===alert.observationId);
      if(!plan||!record)return false;
      planObserver.validateObservation(record,{now,plan,day:alert.day});
      if(!planObserver.alertsForRecord(record).some(row=>digest(row)===digest(alert)))return false;
      const derived=riskForPlanAlert(alert),risk=report.risks.find(r=>r.rootCauseId===derived.rootCauseId)||derived;
      if(risk.status!=='active')return false;
      notifications.observe({accountId:'pool',accountEpoch:report.accountEpoch,risks:[risk],observedAt:now,complete:false});
      return dispatch(report,risk,{planAlert:true});
    }catch{status.lastError='计划风险提醒证据无法核验，原观察保留且不补发未知条件';return false;}
  }
  async function tick() {
    if(busy||!isPrimary())return {...status};busy=true;
    status.privateChannel=privateReady()?'configured':'unconfigured';
    try{
      for(const accountId of ['pool','pre']){
        if(!isPrimary())break;
        try{
        const report=await read({accountId});
        if(!report.accountEpoch)throw Error('原账户期间无法核验');
        // Sampling retains an explicit cadence; reads and page refreshes never
        // create observations or earn continuity that was not observed.
        const last=samples.get(accountId);
        if(!last||clock()-last.at>=15000||last.revision!==report.accountRevision||last.epoch!==report.accountEpoch){
          equityStore.append({evidence:report.equity});samples.set(accountId,{at:clock(),revision:report.accountRevision,epoch:report.accountEpoch});
        }
        const view=notifications.observe({accountId,accountEpoch:report.accountEpoch,risks:report.risks,observedAt:clock(),complete:true});
        const candidates=new Set(list(view.notificationCandidates).map(g=>g.rootCauseId));
        for(const risk of report.risks)if(candidates.has(risk.rootCauseId))dispatch(report,risk);
        status.accountErrors[accountId]=null;
        }catch{status.accountErrors[accountId]=accountId+' 派生风险观察未完成；保留原账户、原门禁和已预留通知记录';}
        status.accountChecks[accountId]=clock();
      }
      status.lastError=Object.values(status.accountErrors).filter(Boolean).join('；')||null;
      if(!status.lastError&&isPrimary())status.lastObservedAt=clock();
    }
    finally{busy=false;}
    return {...status,accountErrors:{...status.accountErrors},accountChecks:{...status.accountChecks}};
  }
  async function update(input,{actor,authorized=()=>false}={}) {
    const permitted=()=>{if(typeof authorized!=='function'||authorized()!==true)throw Error('当前编辑授权已失效，提醒状态未修改');};
    permitted();
    if(!isPrimary())throw Error('副本只读，提醒状态须由原主实例更新');
    if(!input||!['view','mute'].includes(input.action)||!['pool','pre'].includes(input.accountId))throw Error('提醒操作无效');
    const report=await read({accountId:input.accountId,actor});
    permitted();
    if(!report.accountEpoch||input.accountEpoch!==report.accountEpoch)throw Error('账户期间已变化，请重新读取');
    const common={accountId:input.accountId,accountEpoch:report.accountEpoch,actor,expectedRevision:input.expectedRevision};
    permitted();
    if(input.action==='view')return notifications.markViewed({...common,rootCauseId:input.rootCauseId});
    return notifications.setMuted({...common,rootCauseId:input.rootCauseId,classification:input.classification,mutedUntil:input.mutedUntil});
  }
  return {read,tick,update,observePlans,sendPlanAlert,invalidate:()=>{plansAt=0;},status:()=>({...status})};
}
module.exports={createRiskWorkbenchRuntime};
