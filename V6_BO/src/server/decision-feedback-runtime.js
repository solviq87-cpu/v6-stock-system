'use strict';

// Automatic submission stops at the existing five validation gates. This
// scheduler has no model-approval, account, order or notification capability.
const path=require('node:path'),crypto=require('node:crypto');
const journal=require('../core/research-workspace-store');
const {withAccountLock}=require('../core/account-process-lock');
const {aShareCalendarDate}=require('../core/a-share-calendar');
const PROTOCOL='fayo-feedback-scheduler-v1',MIN_GAP=30*60000,MAX_RUNS=8;
const dayOk=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
  Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const hashOk=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const normalize=value=>String(value||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
const safe=value=>String(value||'').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,500);
const RESULTS=['insufficient-evidence','awaiting-approval','duplicate-proposal','submitted','validation-rejected','unavailable'];

function createFeedbackRunStore({root,clock=Date.now,canWrite=()=>false}={}){
  journal.privateRoot(root);
  const guard=()=>{if(canWrite()!==true)throw Error('中心反馈调度仅允许已启用的原主实例');};
  const actual=value=>{
    const now=value??clock();
    if(!Number.isSafeInteger(now)||now<=0||now>clock()||now>Date.now())throw Error('反馈调度实际时点无效');
    return now;
  };
  const location=(day,create=false)=>{
    if(!dayOk(day))throw Error('反馈调度日期无效');
    return journal.privateRoot(path.join(journal.privateRoot(root,create),'runs',day),create);
  };
  function read({now=clock()}={}){
    now=actual(now);const day=aShareCalendarDate(now),events=journal.readEvents(location(day),{asOf:now}),attempts=[],results=[];
    for(const event of events){
      const value=event.data;
      if(event.kind!=='diagnostic'||value?.protocol!==PROTOCOL||value.runDay!==day||
         value.asOf!==event.recordedAt||aShareCalendarDate(event.recordedAt)!==day||!dayOk(value.day)||value.day>day)
        throw Error('反馈调度历史校验失败');
      if(value.action==='attempt'){
        if(attempts.length>=MAX_RUNS||attempts.length&&event.recordedAt-attempts.at(-1).recordedAt<MIN_GAP)
          throw Error('反馈调度额度记录不一致');
        attempts.push({hash:event.hash,day:value.day,recordedAt:event.recordedAt});
      }else if(value.action==='result'){
        const attempt=attempts.find(row=>row.hash===value.attemptHash);
        if(!attempt||attempt.day!==value.day||results.some(row=>row.attemptHash===value.attemptHash)||
           !RESULTS.includes(value.status)||value.proposalFingerprint!==null&&!hashOk(value.proposalFingerprint))
          throw Error('反馈调度结果缺少对应的持久尝试');
        results.push({...value,recordedAt:event.recordedAt,hash:event.hash});
      }else throw Error('反馈调度记录类型无效');
    }
    return {runDay:day,attempts,results,limits:{minGapMs:MIN_GAP,maxRunsPerDay:MAX_RUNS}};
  }
  function reserve({day,now=clock()}={}){
    now=actual(now);if(!dayOk(day)||day>aShareCalendarDate(now))throw Error('反馈目标日期无效');
    guard();const base=journal.privateRoot(root,true);
    return withAccountLock(path.join(base,'scheduler'),()=>{
      guard();const state=read({now}),last=state.attempts.at(-1);
      if(state.attempts.length>=MAX_RUNS)return {reserved:false,status:'daily-limit'};
      if(last&&now-last.recordedAt<MIN_GAP)return {reserved:false,status:'backoff'};
      const data={protocol:PROTOCOL,action:'attempt',runDay:state.runDay,day,asOf:now};
      guard();const dir=location(state.runDay,true);guard();
      const event=journal.appendEvent(dir,'diagnostic',data,{now,requestId:'feedback-'+crypto.randomUUID()});
      return {reserved:true,runDay:state.runDay,day,attemptHash:event.hash,recordedAt:now};
    });
  }
  function complete(attempt,{status,proposalFingerprint=null,candidateId=null,validationStatus=null,reason='',now=clock()}={}){
    now=actual(now);
    if(!attempt?.reserved||!RESULTS.includes(status)||proposalFingerprint!==null&&!hashOk(proposalFingerprint))
      throw Error('反馈调度回执无效');
    if(aShareCalendarDate(now)!==attempt.runDay)return {status:'unrecorded-next-day'};
    guard();const base=journal.privateRoot(root,true);
    return withAccountLock(path.join(base,'scheduler'),()=>{
      guard();const state=read({now}),original=state.attempts.find(row=>row.hash===attempt.attemptHash);
      if(!original||original.day!==attempt.day)throw Error('反馈调度缺少持久尝试');
      const old=state.results.find(row=>row.attemptHash===attempt.attemptHash);if(old)return old;
      const data={protocol:PROTOCOL,action:'result',runDay:state.runDay,day:attempt.day,asOf:now,
        attemptHash:attempt.attemptHash,status,proposalFingerprint,candidateId:candidateId?safe(candidateId):null,
        validationStatus:validationStatus?safe(validationStatus):null,reason:safe(reason)};
      guard();const event=journal.appendEvent(location(state.runDay,true),'diagnostic',data,{now,requestId:'feedback-result-'+attempt.attemptHash});
      return {...data,recordedAt:event.recordedAt,hash:event.hash};
    });
  }
  return {read,reserve,complete};
}

function createDecisionFeedbackRuntime({clock=Date.now,isPrimary,enabled,session,calendar,readResearch,submit,store}={}){
  if([clock,isPrimary,enabled,session,readResearch,submit].some(fn=>typeof fn!=='function')||
     typeof calendar?.isOpen!=='function'||['read','reserve','complete'].some(key=>typeof store?.[key]!=='function'))
    throw Error('反馈调度缺少原研究验证接口');
  const state={status:'waiting-close',running:false,day:null,lastAttempt:null,lastResult:null,lastSuccessAt:null,missing:[],
    automaticSubmission:true,automaticApproval:false,productionWeightsChanged:false,canTrade:false,canNotify:false};
  let busy=false,nextAt=0;
  const status=()=>({...state,missing:[...state.missing],lastAttempt:state.lastAttempt&&{...state.lastAttempt},lastResult:state.lastResult&&{...state.lastResult}});
  const permitted=()=>isPrimary()===true&&enabled()===true;
  const guard=()=>{if(!permitted())throw Error('原实例角色或中心启用状态已变化');};
  function closedDay(now){
    const today=aShareCalendarDate(now);
    for(let i=0;i<45;i++){
      const day=new Date(Date.parse(today)-i*86400000).toISOString().slice(0,10);
      if(calendar.isOpen(day)===true&&now>=Date.parse(day+'T16:00:00+08:00'))return day;
    }return null;
  }
  async function tick(){
    const now=clock();
    if(!permitted()){state.status='disabled-or-replica';return status();}
    if(busy||now<nextAt)return status();
    const s=session(now),minute=new Date(now+28800000).getUTCHours()*60+new Date(now+28800000).getUTCMinutes();
    if(normalize(s?.day)!==aShareCalendarDate(now)||s?.minute!==minute){state.status='missing-session';return status();}
    if(minute<960){state.status='waiting-close';return status();}
    busy=true;state.running=true;nextAt=now+MIN_GAP;let attempt=null,proposalFingerprint=null;
    try{
      guard();const day=closedDay(now);state.day=day;
      if(!day){state.status='missing-calendar';state.missing=['原日历尚未确认已收盘交易日'];return status();}
      const previous=store.read({now});
      attempt=store.reserve({day,now});
      if(!attempt.reserved){state.status=attempt.status;state.lastResult=previous.results.at(-1)||null;return status();}
      state.lastAttempt={day,recordedAt:attempt.recordedAt,attemptHash:attempt.attemptHash};state.status='reading';
      const reply=await readResearch({day,now});guard();
      const report=reply?.result,feedback=report?.feedback,bridge=feedback?.validationBridge;
      if(reply?.ok!==true||report?.authority!=='fayo-intelligence-research'||report.day!==day||!feedback)
        throw Error(reply?.error||'未取得完整的服务端中心报告');
      let result={status:'insufficient-evidence',reason:''};
      proposalFingerprint=hashOk(feedback.proposalFingerprint)?feedback.proposalFingerprint:null;
      const pending=(feedback.archivedCandidates||[]).filter(row=>row.status==='待人工审批');
      if(pending.length){result={status:'awaiting-approval',candidateId:pending.at(-1).id,reason:'原研究档案已有待人工审批候选，保留现有审批顺序'};}
      else if(bridge?.ready!==true||!proposalFingerprint||!Number.isSafeInteger(feedback.archiveRevision)||feedback.archiveRevision<0){
        result.reason=(Array.isArray(bridge?.missing)?bridge.missing:[]).map(safe).join('；')||'缺少可核实提案、档案版本或原验证证据';
      }else if(previous.results.some(row=>row.proposalFingerprint===proposalFingerprint&&['submitted','validation-rejected'].includes(row.status))){
        result={status:'duplicate-proposal',reason:'本次原提案已有验证回执；等待新证据，不重复消耗独立窗口'};
      }else{
        guard();const value=await submit({day,now:clock(),revision:feedback.archiveRevision,proposalFingerprint},{authorize:permitted});guard();
        result=value?.ok===true&&value.result?.candidateId?
          {status:'submitted',candidateId:value.result.candidateId,validationStatus:value.result.status,
            reason:'已进入原五项验证；模型版本仍须原人工审批，未自动改权重'}:
          {status:[409,503].includes(value?.httpStatus)?'unavailable':'validation-rejected',
            reason:safe(value?.error||'原验证未返回有效候选回执，未批准任何版本')};
      }
      guard();state.lastResult=store.complete(attempt,{...result,proposalFingerprint,now:clock()});
      state.status=result.status;state.missing=result.status==='insufficient-evidence'?[result.reason]:[];
      if(result.status==='submitted')state.lastSuccessAt=state.lastResult.recordedAt;
    }catch(error){
      state.status=permitted()?'unavailable':'disabled-or-replica';state.missing=[safe(error.message||'原研究反馈暂不可用')];
      if(attempt?.reserved&&permitted()){
        try{state.lastResult=store.complete(attempt,{status:'unavailable',proposalFingerprint,reason:state.missing[0],now:clock()});}catch{}
      }
    }finally{busy=false;state.running=false;}
    return status();
  }
  return {tick,status};
}

module.exports={createFeedbackRunStore,createDecisionFeedbackRuntime,PROTOCOL,MIN_GAP,MAX_RUNS};
