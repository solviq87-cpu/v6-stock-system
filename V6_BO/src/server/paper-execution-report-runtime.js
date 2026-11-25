'use strict';

const {aShareCalendarDate} = require('../core/a-share-calendar');
const {dayOk, timeOk, closeAt} = require('../core/paper-execution-checklist');
const {ledgerEvents} = require('../core/paper-plan-observer');
const normalizeDay = day => String(day || '').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
const earlier = (day,n=1) => new Date(Date.parse(day)-n*86400000).toISOString().slice(0,10);

// At most one private read/assessment job per five minutes. Attempts are reserved in
// the durable report store before async reads, including failed/crashed jobs.
// The callbacks below expose no buy, sell, account save or notification API.
function createPaperExecutionReportRuntime({clock=Date.now,isPrimary,enabled,session,calendar,
  readArchive,readBook,readObservations,readConditionalOrders,store}={}) {
  if ([clock,isPrimary,enabled,session,readArchive,readBook,readObservations,readConditionalOrders].some(fn=>typeof fn!=='function') ||
      typeof calendar?.isOpen!=='function' || ['read','save','days','schedule','reserve','complete'].some(key=>typeof store?.[key]!=='function'))
    throw Error('执行日报后台缺少原只读证据或主实例门禁');
  let busy=false,nextAt=0,discovered=[];
  const state={status:'waiting-close',running:false,lastAttempt:null,lastResult:null,lastError:null,
    coverage:{candidateDays:0,discoveredDays:0,cursor:null},accountMutated:false,canTrade:false,canNotify:false};
  const status=()=>({...state,coverage:{...state.coverage},lastAttempt:state.lastAttempt&&{...state.lastAttempt},
    lastResult:state.lastResult&&{...state.lastResult}});
  const permitted=()=>isPrimary()===true&&enabled()===true;
  const guard=()=>{if(!permitted())throw Error('原主实例角色或中心启用状态已变化，停止执行日报写入');};
  const eligible=(day,now)=>dayOk(day)&&day<=aShareCalendarDate(now)&&calendar.isOpen(day)===true&&now>=closeAt(day)+15*60000;
  function recentDays(now) {
    const result=[],today=aShareCalendarDate(now);
    for(let n=0;n<40&&result.length<5;n++) { const day=earlier(today,n); if(eligible(day,now))result.push(day); }
    return result;
  }
  async function tick() {
    const started=clock();
    if(!timeOk(started))throw Error('执行日报后台时钟无效');
    if(!permitted()){state.status='disabled-or-replica';return status();}
    if(busy||started<nextAt)return status();
    const current=session(started),minute=new Date(started+28800000).getUTCHours()*60+new Date(started+28800000).getUTCMinutes();
    if(!current||normalizeDay(current.day)!==aShareCalendarDate(started)||!Number.isSafeInteger(current.minute)||current.minute!==minute) {
      state.status='missing-session';state.lastError='原市场时钟与当前北京时间不一致';return status();
    }
    if(minute<915){state.status='waiting-close';return status();}
    busy=true;state.running=true;nextAt=started+5*60000;
    let attempt=null;
    try {
      guard(); const recent=recentDays(started),latest=recent[0];
      if(!latest){state.status='missing-calendar';state.lastError='原交易日历尚未确认最近已收盘交易日';return status();}
      const schedule=store.schedule({now:started});
      const candidates=[...new Set([...recent,...store.days(),...discovered])].filter(day=>eligible(day,started)).sort().reverse();
      if(candidates.length>10000)throw Error('执行日报目标日期超过有界扫描范围，保留档案并停止');
      state.coverage={candidateDays:candidates.length,discoveredDays:discovered.length,cursor:schedule.cursor};
      const last=schedule.attempts.at(-1),limits=schedule.limits;
      if(schedule.attempts.length>=limits.maxRunsPerDay||last&&started-last.at<limits.minRunGapMs){state.status='backoff';return status();}
      const due=day=>{const rows=schedule.attempts.filter(row=>row.day===day);
        return rows.length<limits.maxTargetRunsPerDay&&(!rows.length||started-rows.at(-1).at>=limits.minTargetGapMs);};
      const others=candidates.filter(day=>day!==latest),cursor=schedule.cursor;
      const rotated=cursor?[...others.filter(day=>day<cursor),...others.filter(day=>day>=cursor)]:others;
      const target=due(latest)?latest:rotated.find(due);
      if(!target){state.status='backoff';return status();}
      const nextCursor=target===latest?(cursor||latest):target;
      guard(); attempt=store.reserve({day:target,now:started,cursor:nextCursor});
      if(!attempt.reserved){state.status=attempt.status;return status();}
      state.status='reading';state.lastAttempt={day:target,recordedAt:attempt.recordedAt,attemptHash:attempt.attemptHash};
      const archive=await readArchive();guard();
      if(archive?.ok!==true||!Array.isArray(archive.state?.plans))throw Error('原冻结计划档案尚未通过校验');
      const conditional=await readConditionalOrders();guard();
      if(!Array.isArray(conditional?.orders))throw Error('原条件意图尚未通过校验');
      const observation=await readObservations({day:target,now:clock()});guard();
      if(observation?.day!==target||!Array.isArray(observation.records))throw Error('该交易日计划观察尚未通过校验');
      const book=await readBook();guard();const now=clock();
      if(!timeOk(now)||now<started||!eligible(target,now))throw Error('执行日报期间时钟或原交易日历发生变化');
      // Settlement arrival can change an old day's evidence. Include dates
      // from the real archived plans/fills even when today's candidates differ.
      const found=[...archive.state.plans.filter(p=>p?.decisionAuthority==='fayo-decision-center').map(p=>p.intendedDate),
        ...ledgerEvents(book).map(row=>row.event.tradeDate)].filter(day=>eligible(day,now));
      discovered=[...new Set(found)].sort().reverse();
      if(discovered.length>10000)throw Error('执行日报历史证据日期超过10000日上限');
      guard();
      const result=store.save({day:target,now,book,plans:archive.state.plans,observations:observation.records,
        conditionalOrders:conditional.orders,sources:{archiveRevision:archive.state.revision??null,
          observationRevision:observation.revision??null,conditionalRevision:conditional.revision??null,ledgerReadAt:now}});
      guard();
      store.complete(attempt,{status:result.reused?'unchanged':'saved',reportVersion:result.reportVersion,reportHash:result.reportHash,now:clock()});
      state.status=result.reused?'unchanged':'saved';state.lastError=null;
      state.coverage.discoveredDays=discovered.length;state.coverage.cursor=nextCursor;
      state.lastResult={day:target,recordedAt:result.recordedAt,checkedAt:clock(),reportVersion:result.reportVersion,
        reportHash:result.reportHash,status:state.status,scoreStatus:result.report.score.status,
        unknown:result.report.score.unknown,score:result.report.score.score};
    } catch(error) {
      state.status=permitted()?'evidence-unavailable':'disabled-or-replica';
      state.lastError=String(error?.message||'执行日报证据暂不可用').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,300);
      if(attempt?.reserved&&permitted()) {
        try { store.complete(attempt,{status:'unavailable',reason:state.lastError,now:clock()}); }
        catch { /* Keep the attempt reserved; never replace or repair evidence. */ }
      }
      // Errors before a durable reservation (e.g. damaged journal) back off too.
      nextAt=Math.max(nextAt,clock()+15*60000);
    } finally { busy=false;state.running=false; }
    return status();
  }
  return {tick,status};
}

module.exports={createPaperExecutionReportRuntime};
