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
const normalize=value=>typeof value==='string'?value.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):'';
const safe=value=>String(value||'').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,500);
const RESULTS=['insufficient-evidence','awaiting-approval','duplicate-proposal','submitted','validation-rejected','unavailable'];
const VALIDATION=['待人工审批','验证未通过'],CANDIDATE_STATES=[...VALIDATION,'人工驳回','已晋级'];
const candidateIdOk=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(x);
const clockOk=x=>Number.isSafeInteger(x)&&x>0&&x<=Date.now();
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function validResult(r){
  if(!object(r)||!RESULTS.includes(r.status)||r.proposalFingerprint!==null&&!hashOk(r.proposalFingerprint)||
     typeof r.reason!=='string'||r.reason.length>500||r.submissionUnconfirmed!==undefined&&
     (r.submissionUnconfirmed!==true||r.status!=='unavailable'||!hashOk(r.proposalFingerprint)))return false;
  if(r.status==='submitted')return hashOk(r.proposalFingerprint)&&candidateIdOk(r.candidateId)&&VALIDATION.includes(r.validationStatus);
  if(r.status==='awaiting-approval')return candidateIdOk(r.candidateId)&&r.validationStatus===null;
  return r.candidateId===null&&r.validationStatus===null&&
    (!['duplicate-proposal','validation-rejected'].includes(r.status)||hashOk(r.proposalFingerprint));
}
function archiveCandidates(value){
  if(!Array.isArray(value))throw Error('反馈审批档案缺失');
  const seen=new Set();
  for(const row of value){
    if(!object(row)||!candidateIdOk(row.id)||!CANDIDATE_STATES.includes(row.status)||seen.has(row.id))throw Error('反馈审批档案候选证据无效');
    seen.add(row.id);
  }
  return value;
}
const alreadyInspected=(row,fingerprint)=>row.proposalFingerprint===fingerprint&&
  (['submitted','validation-rejected'].includes(row.status)||row.submissionUnconfirmed===true);
const safePermission=fn=>{try{return fn()===true;}catch{return false;}};
function submissionReceipt(value){
  const r=value?.result;
  if(value?.ok===true&&candidateIdOk(r?.candidateId)&&VALIDATION.includes(r.status)&&
     ['automaticApproval','productionWeightsChanged','canTrade','canNotify'].every(k=>r[k]===undefined||r[k]===false))
    return {status:'submitted',candidateId:r.candidateId,validationStatus:r.status,
      reason:'已进入原五项验证；模型版本仍须原人工审批，未自动改权重'};
  if(value?.ok===false&&[409,503,422].includes(value.httpStatus))return {status:value.httpStatus===422?'validation-rejected':'unavailable',
    reason:safe(value.error||'原验证未通过或暂不可用，未批准任何版本')};
  return {status:'unavailable',submissionUnconfirmed:true,reason:'原验证候选回执不完整或矛盾；先核对原档案，不自动重复提交同一提案'};
}

function createFeedbackRunStore({root,clock=Date.now,canWrite=()=>false}={}){
  journal.privateRoot(root);
  const guard=()=>{if(canWrite()!==true)throw Error('中心反馈调度仅允许已启用的原主实例');};
  const actual=value=>{
    const now=value,current=clock();
    if(!clockOk(now)||!clockOk(current)||now>current)throw Error('反馈调度实际时点无效');
    return now;
  };
  const publishAllowed=(now,day)=>safePermission(()=>{const current=actual(now);return canWrite()===true&&aShareCalendarDate(clock())===day&&aShareCalendarDate(current)===day;});
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
           !validResult(value))
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
      const event=journal.appendEvent(dir,'diagnostic',data,{now,requestId:'feedback-'+crypto.randomUUID(),beforeCommit:()=>publishAllowed(now,state.runDay)});
      return {reserved:true,runDay:state.runDay,day,attemptHash:event.hash,recordedAt:now};
    });
  }
  function complete(attempt,{status,proposalFingerprint=null,candidateId=null,validationStatus=null,reason='',submissionUnconfirmed,now=clock()}={}){
    now=actual(now);
    const receipt={status,proposalFingerprint,candidateId,validationStatus,reason:safe(reason),...(submissionUnconfirmed===undefined?{}:{submissionUnconfirmed})};
    if(attempt?.reserved!==true||!hashOk(attempt.attemptHash)||!validResult(receipt))throw Error('反馈调度回执无效');
    if(aShareCalendarDate(now)!==attempt.runDay)return {status:'unrecorded-next-day'};
    guard();const base=journal.privateRoot(root,true);
    return withAccountLock(path.join(base,'scheduler'),()=>{
      guard();const state=read({now}),original=state.attempts.find(row=>row.hash===attempt.attemptHash);
      if(!original||original.day!==attempt.day||original.recordedAt!==attempt.recordedAt)throw Error('反馈调度缺少对应持久尝试');
      const old=state.results.find(row=>row.attemptHash===attempt.attemptHash);
      if(old){if(Object.keys(receipt).some(k=>old[k]!==receipt[k])||old.submissionUnconfirmed!==receipt.submissionUnconfirmed)throw Error('反馈调度重复回执内容冲突');return old;}
      const data={protocol:PROTOCOL,action:'result',runDay:state.runDay,day:attempt.day,asOf:now,
        attemptHash:attempt.attemptHash,...receipt};
      guard();const event=journal.appendEvent(location(state.runDay,true),'diagnostic',data,{now,requestId:'feedback-result-'+attempt.attemptHash,beforeCommit:()=>publishAllowed(now,state.runDay)});
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
  let busy=false,nextAt=0,lastClock=0;
  const status=()=>({...state,missing:[...state.missing],lastAttempt:state.lastAttempt&&{...state.lastAttempt},lastResult:state.lastResult&&{...state.lastResult}});
  const permitted=()=>safePermission(()=>isPrimary()===true&&enabled()===true);
  const guard=()=>{if(!permitted())throw Error('原实例角色或中心启用状态已变化');};
  function closedDay(now){
    const today=aShareCalendarDate(now);
    for(let i=0;i<45;i++){
      const day=new Date(Date.parse(today)-i*86400000).toISOString().slice(0,10);
      const open=calendar.isOpen(day);if(open!==true&&open!==false)return null;
      if(open===true&&now>=Date.parse(day+'T16:00:00+08:00'))return day;
    }return null;
  }
  function checkedClock(){
    const now=clock();if(!clockOk(now)||now<lastClock)throw Error('反馈调度时钟无效或回退');lastClock=now;return now;
  }
  function sessionMinute(now){
    const s=session(now),local=new Date(now+28800000),minute=local.getUTCHours()*60+local.getUTCMinutes();
    return normalize(s?.day)===aShareCalendarDate(now)&&s?.minute===minute?minute:null;
  }
  function currentScope(attempt){
    guard();const now=checkedClock(),minute=sessionMinute(now);
    if(aShareCalendarDate(now)!==attempt.runDay||minute===null||minute<960||closedDay(now)!==attempt.day)
      throw Error('反馈调度的交易日或收盘范围已变化');
    return now;
  }
  function activeAttempt(attempt){
    const now=currentScope(attempt),latest=store.read({now});
    if(latest.attempts.at(-1)?.hash!==attempt.attemptHash||latest.results.some(r=>r.attemptHash===attempt.attemptHash))
      throw Error('反馈调度尝试已经完成或被较新尝试取代');
    return {now,latest};
  }
  async function tick(){
    if(!permitted()){state.status='disabled-or-replica';return status();}
    if(busy)return status();
    let now;
    try{
      now=checkedClock();if(now<nextAt)return status();
      const minute=sessionMinute(now);
      if(minute===null){state.status='missing-session';return status();}
      if(minute<960){state.status='waiting-close';return status();}
    }catch(error){state.status='unavailable';state.missing=[safe(error.message)];return status();}
    busy=true;state.running=true;nextAt=now+MIN_GAP;let attempt=null,proposalFingerprint=null,submissionStarted=false;
    try{
      guard();const day=closedDay(now);state.day=day;
      if(!day){state.status='missing-calendar';state.missing=['原日历尚未确认已收盘交易日'];return status();}
      const previous=store.read({now});
      attempt=store.reserve({day,now});
      if(!attempt.reserved){state.status=attempt.status;state.lastResult=previous.results.at(-1)||null;return status();}
      state.lastAttempt={day,recordedAt:attempt.recordedAt,attemptHash:attempt.attemptHash};state.status='reading';
      const reply=await readResearch({day,now});const {latest}=activeAttempt(attempt);
      const report=reply?.result,feedback=report?.feedback,bridge=feedback?.validationBridge;
      if(reply?.ok!==true||report?.authority!=='fayo-intelligence-research'||report.day!==day||!object(feedback))
        throw Error(reply?.error||'未取得完整的服务端中心报告');
      let result={status:'insufficient-evidence',reason:''};
      proposalFingerprint=hashOk(feedback.proposalFingerprint)?feedback.proposalFingerprint:null;
      const pending=archiveCandidates(feedback.archivedCandidates).filter(row=>row.status==='待人工审批');
      if(pending.length){result={status:'awaiting-approval',candidateId:pending.at(-1).id,reason:'原研究档案已有待人工审批候选，保留现有审批顺序'};}
      else if(bridge?.ready!==true||!proposalFingerprint||!Number.isSafeInteger(feedback.archiveRevision)||feedback.archiveRevision<0){
        result.reason=(Array.isArray(bridge?.missing)?bridge.missing:[]).map(safe).join('；')||'缺少可核实提案、档案版本或原验证证据';
      }else if(latest.results.some(row=>alreadyInspected(row,proposalFingerprint))){
        result={status:'duplicate-proposal',reason:'本次原提案已有验证回执；等待新证据，不重复消耗独立窗口'};
      }else{
        const scope=activeAttempt(attempt);
        const authorize=()=>safePermission(()=>{const check=activeAttempt(attempt);return !check.latest.results.some(row=>alreadyInspected(row,proposalFingerprint));});
        if(!authorize())throw Error('反馈调度提交范围已变化');
        submissionStarted=true;
        const value=await submit({day,now:scope.now,revision:feedback.archiveRevision,proposalFingerprint},{authorize});
        currentScope(attempt);result=submissionReceipt(value);
      }
      const completed=store.complete(attempt,{...result,proposalFingerprint,now:currentScope(attempt)});
      if(completed?.status!==result.status||!hashOk(completed.hash))throw Error('反馈调度未取得对应持久回执');
      state.lastResult=completed;state.status=completed.status;state.missing=result.status==='insufficient-evidence'?[result.reason]:[];
      if(result.status==='submitted')state.lastSuccessAt=state.lastResult.recordedAt;
    }catch(error){
      state.status=permitted()?'unavailable':'disabled-or-replica';state.missing=[safe(error.message||'原研究反馈暂不可用')];
      if(attempt?.reserved&&permitted()){
        try{const now=checkedClock();if(aShareCalendarDate(now)===attempt.runDay){const receipt=store.complete(attempt,{status:'unavailable',proposalFingerprint,reason:state.missing[0],now,...(submissionStarted&&proposalFingerprint?{submissionUnconfirmed:true}:{})});if(hashOk(receipt?.hash))state.lastResult=receipt;}}catch{}
      }
    }finally{busy=false;state.running=false;}
    return status();
  }
  return {tick,status};
}

module.exports={createFeedbackRunStore,createDecisionFeedbackRuntime,PROTOCOL,MIN_GAP,MAX_RUNS};
