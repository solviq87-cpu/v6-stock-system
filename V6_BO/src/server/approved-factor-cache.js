'use strict';

// A private background read projects an already-approved t-day model onto the
// next original trading session. It never trains, approves, or executes orders.
const {aShareCalendarDate}=require('../core/a-share-calendar');
const TTL=15*60000,SCHEMA='fayo-numeric-orthogonal-v1';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const time=value=>Number.isSafeInteger(value)&&value>0;
const instant=value=>time(value)?value:typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const normalize=value=>String(value||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');

function projectApprovedFactors(report,{signalDay,targetDay,now,loadedAt=now}={}){
  const source=report?.factors?.approvedScoring;
  const result={protocol:'fayo-approved-factor-ranking-v1',status:'missing-approved-observations',signalDay,targetDay,
    loadedAt,modelVersion:null,modelFingerprint:null,approvedAt:null,rows:[],missing:[],
    canTrade:false,changesOriginalGates:false,changesSelectionScore:false,
    note:'原交易日 t 的已批准因子只用于相邻 t+1 候选排序；共振仍优先，缺可比分数时保留原精选排序。'};
  const approvedAt=instant(source?.approvedAt),trainCutoff=instant(source?.trainCutoff);
  if(report?.authority!=='fayo-intelligence-research'||report.day!==signalDay||source?.day!==signalDay||
     source?.factorSchema!==SCHEMA||!time(source.asOf)||source.asOf>now||source.asOf>loadedAt||
     !Number.isSafeInteger(source.modelVersion)||source.modelVersion<1||!hash(source.modelFingerprint)||
     !time(approvedAt)||approvedAt>source.asOf||!time(trainCutoff)||trainCutoff>approvedAt||
     !time(source.trainingLabelKnownAtMax)||source.trainingLabelKnownAtMax>=approvedAt||
     source.canTrade!==false||source.changesOriginalGates!==false||!Array.isArray(source.rows)){
    result.missing=['未取得具有原批准、训练截止和完整指纹的数值模型'];return result;
  }
  Object.assign(result,{modelVersion:source.modelVersion,modelFingerprint:source.modelFingerprint,approvedAt,
    trainCutoff,trainingSignalStart:source.trainingSignalStart,trainingSignalEnd:source.trainingSignalEnd,
    trainingLabelKnownAtMax:source.trainingLabelKnownAtMax});
  const seen=new Set(),duplicates=new Set();
  for(const row of source.rows){
    if(seen.has(row?.code))duplicates.add(row.code);seen.add(row?.code);
  }
  for(const row of source.rows){
    if(!row||duplicates.has(row.code)||!/^\d{6}$/.test(row.code||'')||row.eligibleForNextSession!==true||
       row.day!==signalDay||row.signalDay!==signalDay||row.targetDay!==targetDay||signalDay>=targetDay||
       !time(row.observationAt)||aShareCalendarDate(row.observationAt)!==signalDay||row.observationAt<approvedAt||
       !time(row.calendarKnownAt)||row.calendarKnownAt>row.observationAt||!row.calendarSource||
       !time(row.targetOpenAt)||aShareCalendarDate(row.targetOpenAt)!==targetDay||row.observationAt>=row.targetOpenAt||
       !time(row.scoredAt)||row.scoredAt<row.observationAt||row.scoredAt>source.asOf||
       row.modelVersion!==source.modelVersion||row.modelFingerprint!==source.modelFingerprint||
       !finite(row.score)||!finite(row.threshold)||!Array.isArray(row.missing)||row.missing.length||
       !Number.isSafeInteger(row.factorCount)||row.factorCount<1||!row.sourceCheckId||row.canTrade!==false)continue;
    result.rows.push({...row,scoreUnit:'approved-net-return-model-score',approvedAt});
  }
  if(result.rows.length)result.status='ready';
  else result.missing=['缺少与原已批模型、t 日观察和相邻 t+1 日历同时对应的完整分数'];
  return result;
}

function createApprovedFactorCache({clock=Date.now,isPrimary,enabled,session,calendar,readResearch}={}){
  if([clock,isPrimary,enabled,session,readResearch].some(fn=>typeof fn!=='function')||typeof calendar?.isOpen!=='function')
    throw Error('获批因子投影缺少原只读接口');
  let cached=null,busy=false,nextAt=0,lastError=null;
  const permitted=()=>isPrimary()===true&&enabled()===true;
  function read({day=aShareCalendarDate(clock())}={}){
    const now=clock();
    if(!permitted()||!cached||cached.targetDay!==day||cached.loadedAt>now||now-cached.loadedAt>TTL)
      return {protocol:'fayo-approved-factor-ranking-v1',status:'waiting-background-evidence',targetDay:day,signalDay:null,rows:[],
        missing:[lastError||'后台尚未完成前一交易日获批模型与观察的只读核对'],canTrade:false,changesOriginalGates:false,changesSelectionScore:false};
    return JSON.parse(JSON.stringify(cached));
  }
  async function tick(){
    const now=clock();if(!permitted()||busy||now<nextAt)return;
    const day=aShareCalendarDate(now),s=session(now),minute=new Date(now+28800000).getUTCHours()*60+new Date(now+28800000).getUTCMinutes();
    if(normalize(s?.day)!==day||s?.minute!==minute||minute<510||minute>=900||calendar.isOpen(day)!==true)return;
    let signalDay=null;
    for(let i=1;i<45;i++){
      const previous=new Date(Date.parse(day)-i*86400000).toISOString().slice(0,10);
      if(calendar.isOpen(previous)===true){signalDay=previous;break;}
    }
    if(!signalDay){lastError='原交易日历没有可核实的相邻前一交易日';return;}
    busy=true;nextAt=now+TTL;
    try{
      const result=await readResearch({day:signalDay,now});
      if(!permitted()||aShareCalendarDate(clock())!==day)return;
      if(result?.ok!==true)throw Error(result?.error||'获批因子研究证据读取未完成');
      cached=projectApprovedFactors(result.result,{signalDay,targetDay:day,now:clock(),loadedAt:clock()});lastError=null;
    }catch(error){cached=null;lastError=String(error.message||'获批因子暂不可用').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,300);}
    finally{busy=false;}
  }
  return {read,tick,status:()=>({loadedAt:cached?.loadedAt||null,status:cached?.status||'waiting-background-evidence',refreshing:busy,lastError})};
}

module.exports={createApprovedFactorCache,projectApprovedFactors,TTL,SCHEMA};
