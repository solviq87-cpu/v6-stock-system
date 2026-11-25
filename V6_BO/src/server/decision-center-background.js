'use strict';

// One bounded research task per minute. Page reads never launch collectors and
// neither collector can create executable quotes or modify the paper account.
function createDecisionCenterBackground({enabled, isPrimary, session, candidates,
  collectHistory, collectFinancials, historyCandidates = async () => [], clock = Date.now}) {
  let pending = false, nextAt = 0, day = '';
  let historyCache = {day:'',at:0,codes:[],cursor:0};
  const attempts = new Map();
  const state = {running:false,lastAttempt:null,lastResult:null};
  const normalizeDay = value => String(value || '').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
  function due(kind, code, now) {
    const row = attempts.get(kind + '/' + code);
    if (!row) return true;
    if (row.success) return kind === 'financials' && now - row.at >= 6*3600000;
    return row.count < 3 && now - row.at >= 15*60000;
  }
  function successful(kind, result, task, now) {
    if (!result || result.ok === false) return false;
    if (kind === 'history') return ['admitted','already-collected'].includes(result.result?.status || result.status);
    const financials = result.result?.marketContext?.financials || result.marketContext?.financials;
    if(!financials)return false;
    const evidence=require('../core/decision-evidence').fundamentalEvidence(financials,{code:task.code,
      day:new Date(now+28800000).toISOString().slice(0,10),now});
    return typeof evidence.score==='number'&&Number.isFinite(evidence.score)&&evidence.missing.length===0;
  }
  async function tick() {
    const now = clock(), current = session();
    if (pending || now < nextAt || !enabled() || !isPrimary() || !current?.openDay) return null;
    const currentDay = normalizeDay(current.day);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(currentDay)) return null;
    if (day !== currentDay) { day=currentDay;attempts.clear();historyCache={day:'',at:0,codes:[],cursor:historyCache.cursor}; }
    const codesOf = (rows,limit=30) => [...new Set((Array.isArray(rows)?rows:[]).map(row => typeof row === 'string' ? row : row?.code)
      .filter(code => typeof code === 'string' && /^\d{6}$/.test(code)))].slice(0,limit);
    const codes=codesOf(candidates() || []), afterClose=current.minute>=960;
    if (!afterClose&&!current.trading) return null;
    // Hold the busy guard across the asynchronous archive read too. A previous
    // signal still needs its outcome after it leaves today's candidate pool.
    nextAt=now+60000;pending=true;state.running=true;
    try {
      if(afterClose&&(historyCache.day!==day||now<historyCache.at||now-historyCache.at>=5*60000)){
        try{
          const result=await historyCandidates({day,now,cursor:historyCache.cursor});
          if(Array.isArray(result)||result?.ok===true&&Array.isArray(result.codes)){
            const nextCursor=result?.coverage?.nextCursor;
            const retained=[...historyCache.codes,...(Array.isArray(result)?result:result.codes)].filter(code=>{
              const attempt=attempts.get('history/'+code);
              return !attempt?.success&&(attempt?.count||0)<3;
            });
            historyCache={day,at:now,codes:codesOf(retained,120),
              cursor:Number.isSafeInteger(nextCursor)&&nextCursor>=0?nextCursor:0};
          }
        }catch{ /* Retain prior pending codes; collector evidence remains unchanged. */ }
      }
      const historyCodes=afterClose?codesOf([...historyCache.codes,...codes].filter(code=>due('history',code,now))):[];
      const tasks=[...historyCodes.map(code=>({kind:'history',code})),...codes.map(code=>({kind:'financials',code}))]
        .filter(task=>due(task.kind,task.code,now));
      if(!tasks.length)return null;
      const task=tasks[0],key=task.kind+'/'+task.code,prior=attempts.get(key);
      const row={at:now,count:(prior?.success?0:prior?.count||0)+1,success:false};
      attempts.set(key,row);state.lastAttempt={kind:task.kind,code:task.code,day,at:now};
      // Recheck immediately before dispatch. The worker independently validates
      // inputs; a later role change never turns research results into quotes.
      if (!enabled() || !isPrimary()) return null;
      const result = await (task.kind === 'history' ? collectHistory : collectFinancials)({code:task.code,day,now});
      row.success=successful(task.kind,result,task,clock());
      if(task.kind==='history'&&row.success)historyCache.codes=historyCache.codes.filter(code=>code!==task.code);
      state.lastResult={...state.lastAttempt,completedAt:clock(),status:row.success?'collected':'incomplete',
        reason:row.success?null:task.kind==='history'?'后复权独立来源或原时点证据未齐，保留原回执并退避重试':'财报原始回执未齐，保留缺项并退避重试'};
      return state.lastResult;
    } catch {
      state.lastResult={...state.lastAttempt,completedAt:clock(),status:'unavailable',reason:'研究采集暂不可用；原档案保留，15分钟后有限重试'};
      return state.lastResult;
    } finally { pending=false;state.running=false; }
  }
  return {tick,status:()=>({...state,lastAttempt:state.lastAttempt&&{...state.lastAttempt},lastResult:state.lastResult&&{...state.lastResult}})};
}

module.exports={createDecisionCenterBackground};
