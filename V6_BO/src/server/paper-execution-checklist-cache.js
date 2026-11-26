'use strict';

const {aShareCalendarDate} = require('../core/a-share-calendar');
const {performance}=require('node:perf_hooks');
const REFRESH_MS=60000,BUSY_RETRY_MS=1000,MAX_BUSY_RETRIES=3;
const {buildPaperExecutionChecklist, dayOk, LABELS} = require('../core/paper-execution-checklist');
const {validateObservation, alertsForRecord} = require('../core/paper-plan-observer');

// The homepage reads this memory projection synchronously. Only the bounded
// background refresh reads private archives; it never replays a day's batches.
function createPaperExecutionChecklistCache({clock=Date.now,monotonicClock=()=>performance.now(),isPrimary,enabled,readArchive,
  readBook,readConditionalOrders,readDailyReport}={}) {
  if ([clock,monotonicClock,isPrimary,enabled,readArchive,readBook,readConditionalOrders,readDailyReport].some(fn=>typeof fn!=='function'))
    throw Error('执行清单缓存缺少原只读证据接口');
  let requestedDay=null,cached=null,loadedAt=0,nextAt=0,busy=false,epoch=0,lastError=null;
  let retryAt=null,busyRetries=0;
  let observationDay=null,points=new Map();
  const permitted=()=>isPrimary()===true&&enabled()===true;
  const clone=value=>JSON.parse(JSON.stringify(value));
  function invalidate(){epoch++;loadedAt=0;nextAt=0;retryAt=null;busyRetries=0;}
  function observe({records=[]}={}) {
    if(!permitted())return;
    const now=clock(),day=aShareCalendarDate(now);
    if(!Array.isArray(records)||records.length>1000)throw Error('执行清单最新观察数量无效');
    if(observationDay!==day){observationDay=day;points=new Map();}
    for(const record of records){
      validateObservation(record,{now,day});
      // Retain one latest sample and the first source-backed trigger per kind.
      // This is a small live cache, not evidence of full-session coverage.
      points.set(record.planId+'/latest',record);
      for(const alert of alertsForRecord(record))if(alert.kind!=='entry'){
        const key=record.planId+'/'+alert.kind;
        if(!points.has(key))points.set(key,record);
      }
    }
    if(points.size>3000){points.clear();lastError='当日最新观察缓存达到容量，风险状态保留未知';}
  }
  function unavailable(day,candidates,reason,status='warming') {
    const items=(Array.isArray(candidates)?candidates:[]).filter(card=>card?.authority==='fayo-decision-center'&&
      card.day===day&&/^\d{6}$/.test(card.code||'')).slice(0,3).map(card=>({planId:null,planVersion:null,
      code:card.code,name:card.name||card.row?.name||card.code,day,decisionId:card.decisionId,
      state:'unknown',label:LABELS.unknown,reason,entry:null,intent:null,risk:[],review:null,missing:[reason]}));
    return {protocol:'paper-execution-checklist-v1',day,generatedAt:clock(),account:'pool',status,items,
      counts:Object.fromEntries(Object.keys(LABELS).map(key=>[key,key==='unknown'?items.length:0])),missing:[reason],
      canTrade:false,canNotify:false,accountMutated:false,researchOnly:true,cache:{loadedAt:null,refreshing:busy}};
  }
  function read({day,candidates=[]}={}) {
    if(!dayOk(day)||day>aShareCalendarDate(clock()))throw Error('执行清单请求日期无效');
    if(requestedDay!==day){requestedDay=day;invalidate();}
    if(!permitted())return unavailable(day,candidates,'执行清单需原主实例启用后核对私有账本','disabled-or-replica');
    if(!cached||cached.day!==day||!loadedAt||clock()<loadedAt||clock()-loadedAt>120000)
      return unavailable(day,candidates,lastError||'后台正在核对原冻结计划与持久成交；当前执行状态未知');
    const result=clone(cached),represented=new Set(result.items.map(row=>row.code));
    // Only a completed archive read can support the "not planned" statement.
    for(const card of candidates){
      if(card?.authority!=='fayo-decision-center'||card.day!==day||!/^\d{6}$/.test(card.code||'')||represented.has(card.code))continue;
      represented.add(card.code);result.items.push({planId:null,planVersion:null,code:card.code,name:card.name||card.row?.name||card.code,
        day,decisionId:card.decisionId,state:'not-planned',label:LABELS['not-planned'],reason:'本次原研究档案尚无该候选的冻结计划',
        entry:null,intent:null,risk:[],review:null,missing:[]});
    }
    result.counts=Object.fromEntries(Object.keys(LABELS).map(key=>[key,result.items.filter(row=>row.state===key).length]));
    result.cache={loadedAt,refreshing:busy,observationScope:'current-process-latest-and-first-triggers',
      note:'盘中缓存不声明全天采样覆盖；收盘评分独立读取完整持久观察。'};
    return result;
  }
  async function tick(){
    const now=clock(),mono=monotonicClock();
    if(!permitted()||busy||!Number.isFinite(mono))return;
    if(retryAt!==null){
      if(mono<retryAt)return;
      retryAt=null;
    }else{
      if(now<nextAt)return;
      busyRetries=0;
    }
    const day=requestedDay||aShareCalendarDate(now),version=epoch;
    busy=true;nextAt=now+REFRESH_MS;
    const current=()=>permitted()&&version===epoch&&(requestedDay===null||requestedDay===day);
    try{
      const archive=await readArchive();if(!current())return;
      // A rejected shared worker admission is not an archive failure or proof of
      // no plans. Allow a few background-only retries, without spawning a new
      // timer, blocking a page GET, or changing the worker resource ceiling.
      if(archive?.ok===false&&archive.httpStatus===503&&archive.code==='WORKSPACE_BUSY'){
        loadedAt=0;lastError='原研究档案线程暂忙，执行状态保持未知';
        const retryClock=monotonicClock();
        if(busyRetries<MAX_BUSY_RETRIES&&Number.isFinite(retryClock)&&retryClock>=mono){
          busyRetries++;retryAt=retryClock+BUSY_RETRY_MS;
        }
        return;
      }
      if(archive?.ok!==true||!Array.isArray(archive.state?.plans))throw Error('原冻结计划档案尚未完成核验');
      const conditional=await readConditionalOrders();if(!current())return;
      if(!Array.isArray(conditional?.orders))throw Error('原条件意图尚未完成核验');
      const book=await readBook();if(!current())return;
      const daily=await readDailyReport({day});if(!current())return;
      const observations=observationDay===day?[...new Map([...points.values()].map(row=>[row.fingerprint,row])).values()]:[];
      const result=buildPaperExecutionChecklist({day,now:clock(),plans:archive.state.plans,book,conditionalOrders:conditional.orders,
        observations,dailyReport:daily,observationScope:'current-process-latest-and-first-triggers'});
      if(!current())return;
      cached=result;loadedAt=clock();lastError=null;retryAt=null;busyRetries=0;
    }catch(error){
      if(current()){loadedAt=0;lastError=String(error?.message||'原执行证据暂不可用').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,300);}
    }finally{busy=false;}
  }
  return {read,tick,observe,invalidate,status:()=>({day:requestedDay,loadedAt:loadedAt||null,refreshing:busy,lastError})};
}

module.exports={createPaperExecutionChecklistCache};
