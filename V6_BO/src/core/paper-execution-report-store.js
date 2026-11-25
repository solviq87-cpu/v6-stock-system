'use strict';

// Separate private, append-only research reports and scheduler receipts. The
// existing account files are neither opened nor passed to a write operation.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const journal = require('./research-workspace-store');
const {withAccountLock} = require('./account-process-lock');
const {aShareCalendarDate} = require('./a-share-calendar');
const {buildPaperExecutionReport, reviewedChecklist, PROTOCOL, dayOk, timeOk, closeAt} = require('./paper-execution-checklist');

const RUN_PROTOCOL = 'paper-execution-report-run-v1', MAX_VERSIONS = 128, MAX_DAYS = 10000;
// 15:15 through midnight has fewer than 108 five-minute slots or 36 quarter-hours.
// Keep late settlement checks available all evening; an early successful read
// must not exhaust a four-attempt quota before the final evidence can arrive.
const MAX_RUNS_PER_DAY = 108, MAX_TARGET_RUNS_PER_DAY = 36, MIN_RUN_GAP = 5*60000, MIN_TARGET_GAP = 15*60000;
const hashOk = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const safeReason = value => String(value || '').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,300);

function createPaperExecutionReportStore({root, clock = Date.now, canWrite = () => false, faultInjector} = {}) {
  journal.privateRoot(root);
  if (typeof clock !== 'function' || typeof canWrite !== 'function') throw Error('执行日报存储配置无效');
  const allowed = () => { if (canWrite() !== true) throw Error('执行日报仅允许已启用的原主实例写入'); };
  const nowOf = value => {
    const actual=clock(), now=value??actual;
    if (!timeOk(actual) || !timeOk(now) || now>actual || now>Date.now()) throw Error('执行日报实际记录时点无效');
    return now;
  };
  const location = (kind, day, create=false) => {
    if (!['days','runs'].includes(kind) || !dayOk(day)) throw Error('执行日报私有日期路径无效');
    const base=journal.privateRoot(root,create), area=journal.privateRoot(path.join(base,kind),create);
    return journal.privateRoot(path.join(area,day),create);
  };
  function days(kind='days') {
    const base=journal.privateRoot(root), area=journal.privateRoot(path.join(base,kind));
    if (!fs.existsSync(area)) return [];
    const names=fs.readdirSync(area);
    if (names.length>MAX_DAYS || names.some(name=>!dayOk(name))) throw Error('执行日报日期目录损坏或超出容量');
    for (const name of names) journal.privateRoot(path.join(area,name));
    return names.sort();
  }
  function reports(day, asOf) {
    const events=journal.readEvents(location('days',day),{asOf});
    if (events.length>MAX_VERSIONS) throw Error('执行日报版本超过上限');
    let previous=null;
    for (const event of events) {
      const value=event.data;
      if (event.kind!=='diagnostic' || value?.mode!==PROTOCOL || value.day!==day ||
          value.reportVersion!==event.sequence || value.previousReportHash!==(previous?.hash||null) ||
          value.report?.protocol!==PROTOCOL || value.report.schemaVersion!==1 || value.report.day!==day ||
          value.report.account!=='pool' || value.report.calculatedAt!==event.recordedAt || event.recordedAt<closeAt(day) ||
          !hashOk(value.report.inputFingerprint) || value.report.score?.day!==day || value.report.score.closed!==true ||
          value.report.checklist?.day!==day || !Array.isArray(value.report.checklist.items) ||
          value.report.canTrade!==false || value.report.canNotify!==false || value.report.accountMutated!==false || value.report.researchOnly!==true)
        throw Error('执行日报版本或原始证据链不一致');
      previous=event;
    }
    return events;
  }
  function view(event, day, now) {
    if (!event) return {status:'missing',day,reportVersion:0,recordedAt:null,reportHash:null,report:null,
      checklist:null,missing:['尚未生成该交易日的持久执行日报'],researchOnly:true,canTrade:false,canNotify:false,accountMutated:false};
    const result={status:'observed',day,reportVersion:event.data.reportVersion,recordedAt:event.recordedAt,reportHash:event.hash,
      previousReportHash:event.data.previousReportHash,inputFingerprint:event.data.report.inputFingerprint,report:event.data.report,
      researchOnly:true,canTrade:false,canNotify:false,accountMutated:false};
    result.checklist=reviewedChecklist({...event.data.report.checklist,generatedAt:now},result);
    return result;
  }
  function read({day,asOf=clock()}={}) {
    asOf=nowOf(asOf);
    if (!dayOk(day) || day>aShareCalendarDate(asOf)) throw Error('执行日报读取日期无效');
    return view(reports(day,asOf).at(-1),day,asOf);
  }
  function history({day,asOf=clock(),limit=20}={}) {
    asOf=nowOf(asOf);
    if (!dayOk(day) || !Number.isSafeInteger(limit) || limit<1 || limit>MAX_VERSIONS) throw Error('执行日报历史读取范围无效');
    const events=reports(day,asOf);
    return {day,total:events.length,versions:events.slice(-limit).map(event=>({reportVersion:event.data.reportVersion,
      recordedAt:event.recordedAt,reportHash:event.hash,previousReportHash:event.data.previousReportHash,
      inputFingerprint:event.data.report.inputFingerprint,status:event.data.report.score.status,score:event.data.report.score.score}))};
  }
  function save(input={}) {
    const now=nowOf(input.now),day=input.day;
    if (!dayOk(day) || now<closeAt(day) || clock()-now>60000) throw Error('执行日报只能以本次实际时点保存已收盘日期');
    allowed(); const base=journal.privateRoot(root,true);
    return withAccountLock(path.join(base,'report-'+day),()=>{
      allowed();
      const prior=reports(day,now).at(-1);
      const report=buildPaperExecutionReport({...input,now});
      if (prior?.data.report.inputFingerprint===report.inputFingerprint) return {...view(prior,day,now),reused:true};
      if ((prior?.data.reportVersion||0)>=MAX_VERSIONS) throw Error('执行日报版本达到上限；旧证据保持，请离线归档');
      const value={mode:PROTOCOL,day,asOf:now,reportVersion:(prior?.data.reportVersion||0)+1,previousReportHash:prior?.hash||null,report};
      faultInjector?.('before-report-write',value); allowed();
      const dir=location('days',day,true); allowed();
      const event=journal.appendEvent(dir,'diagnostic',value,{now,
        requestId:'daily-'+journal.digest([day,value.previousReportHash,report.inputFingerprint]).slice(0,64)});
      return {...view(event,day,now),reused:false};
    });
  }
  function runEvents(runDay,now) {
    const events=journal.readEvents(location('runs',runDay),{asOf:now}), attempts=new Map(),completed=new Set();
    for (const event of events) {
      const value=event.data;
      if (event.kind!=='diagnostic' || value?.mode!==RUN_PROTOCOL || value.runDay!==runDay ||
          aShareCalendarDate(event.recordedAt)!==runDay || value.asOf!==event.recordedAt ||
          !dayOk(value.day) || value.day>runDay || !dayOk(value.cursor) || value.cursor>runDay)
        throw Error('执行日报调度证据损坏');
      if (value.action==='attempt') {
        if (attempts.size>=MAX_RUNS_PER_DAY || !hashOk(event.hash)) throw Error('执行日报调度次数超限');
        attempts.set(event.hash,event);
      } else if (value.action==='result') {
        const attempt=attempts.get(value.attemptHash);
        if (!attempt || completed.has(value.attemptHash) || attempt.data.day!==value.day ||
            !['saved','unchanged','unavailable'].includes(value.status) ||
            !Number.isSafeInteger(value.reportVersion) || value.reportVersion<0 ||
            !(value.reportHash===null || hashOk(value.reportHash)) ||
            value.status!=='unavailable'&&(!value.reportVersion||!hashOk(value.reportHash))) throw Error('执行日报调度结果与原尝试不一致');
        completed.add(value.attemptHash);
      } else throw Error('执行日报调度证据类型无效');
    }
    return {events,attempts:[...attempts.values()],completed};
  }
  function schedule({now=clock()}={}) {
    now=nowOf(now); const runDay=aShareCalendarDate(now), current=runEvents(runDay,now);
    let cursor=current.attempts.at(-1)?.data.cursor||null;
    if (!cursor) {
      const priorDay=days('runs').filter(day=>day<runDay).at(-1);
      if (priorDay) cursor=runEvents(priorDay,now).attempts.at(-1)?.data.cursor||null;
    }
    return {runDay,cursor,attempts:current.attempts.map(event=>({id:event.hash,day:event.data.day,at:event.recordedAt,
      completed:current.completed.has(event.hash)})),limits:{maxRunsPerDay:MAX_RUNS_PER_DAY,maxTargetRunsPerDay:MAX_TARGET_RUNS_PER_DAY,
      minRunGapMs:MIN_RUN_GAP,minTargetGapMs:MIN_TARGET_GAP}};
  }
  function reserve({day,now=clock(),cursor=day}={}) {
    now=nowOf(now);
    if (!dayOk(day) || !dayOk(cursor) || day>aShareCalendarDate(now) || cursor>aShareCalendarDate(now) || now<closeAt(day))
      throw Error('执行日报调度目标或游标无效');
    allowed(); const base=journal.privateRoot(root,true);
    return withAccountLock(path.join(base,'scheduler'),()=>{
      allowed(); const state=schedule({now}), own=state.attempts.filter(row=>row.day===day),last=state.attempts.at(-1);
      if (last && now<last.at) throw Error('执行日报调度时钟回退');
      if (state.attempts.length>=MAX_RUNS_PER_DAY) return {reserved:false,status:'daily-limit'};
      if (own.length>=MAX_TARGET_RUNS_PER_DAY) return {reserved:false,status:'target-daily-limit'};
      if (last && now-last.at<MIN_RUN_GAP || own.length && now-own.at(-1).at<MIN_TARGET_GAP) return {reserved:false,status:'backoff'};
      const value={mode:RUN_PROTOCOL,action:'attempt',runDay:state.runDay,day,cursor,asOf:now};
      faultInjector?.('before-reserve-write',value); allowed();
      const dir=location('runs',state.runDay,true); allowed();
      const event=journal.appendEvent(dir,'diagnostic',value,{now,requestId:'execution-run-'+crypto.randomUUID()});
      return {reserved:true,status:'reserved',runDay:state.runDay,day,cursor,attemptHash:event.hash,recordedAt:now};
    });
  }
  function complete(attempt,{status,reportVersion=0,reportHash=null,reason='',now=clock()}={}) {
    now=nowOf(now);
    if (!attempt?.reserved || !dayOk(attempt.runDay) || !hashOk(attempt.attemptHash) ||
        !['saved','unchanged','unavailable'].includes(status) || !Number.isSafeInteger(reportVersion) || reportVersion<0 ||
        !(reportHash===null || hashOk(reportHash)) || status!=='unavailable'&&(!reportVersion||!hashOk(reportHash))) throw Error('执行日报调度回执无效');
    // A run crossing midnight retains its original attempt; a later run will
    // reconcile the report. Never misdate a completion into yesterday's log.
    if (aShareCalendarDate(now)!==attempt.runDay) return {status:'unrecorded-next-day'};
    allowed(); const base=journal.privateRoot(root,true);
    return withAccountLock(path.join(base,'scheduler'),()=>{
      allowed(); const state=runEvents(attempt.runDay,now), original=state.attempts.find(row=>row.hash===attempt.attemptHash);
      if (!original || original.data.day!==attempt.day) throw Error('执行日报缺少持久调度尝试');
      const old=state.events.find(row=>row.data.action==='result'&&row.data.attemptHash===attempt.attemptHash);
      if (old) return {status:old.data.status,reused:true};
      const value={mode:RUN_PROTOCOL,action:'result',runDay:attempt.runDay,day:attempt.day,cursor:original.data.cursor,asOf:now,
        attemptHash:attempt.attemptHash,status,reportVersion,reportHash,reason:safeReason(reason)};
      allowed(); journal.appendEvent(location('runs',attempt.runDay,true),'diagnostic',value,{now,requestId:'run-result-'+attempt.attemptHash});
      return {status,reused:false};
    });
  }
  return {read,history,save,days:()=>days('days'),schedule,reserve,complete};
}

module.exports = {createPaperExecutionReportStore,MAX_VERSIONS,MAX_RUNS_PER_DAY,MAX_TARGET_RUNS_PER_DAY,MIN_RUN_GAP,MIN_TARGET_GAP};
