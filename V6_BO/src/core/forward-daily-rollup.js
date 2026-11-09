'use strict';
/** Combine independently sealed day-cohort observations without rewriting them. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {readSnapshot,localPath,seal,writeImmutable,writeAtomic}=require('./forward-tracking-store');
const {auditForwardRules}=require('./forward-rule-audit');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function publishRollup({snapshots=[],stateFile}={}){
 stateFile=localPath(stateFile);
 if(!Array.isArray(snapshots)||!snapshots.length||snapshots.length>180)
  throw Error('需要1至180个独立日批次追踪归档');
 // Strictly validate each on-disk snapshot, not caller-supplied report objects.
 const verified=snapshots.map(file=>readSnapshot(localPath(file)));
 if(verified.some(x=>!x))throw Error('某日冻结归档不存在');
 const newest=verified[0].report,feed=JSON.stringify(newest.feed);
 if(newest.feed?.source!=='imported'||verified.some(x=>JSON.stringify(x.report.feed)!==feed||
  x.report.asOf!==newest.asOf||x.report.observedAt!==newest.observedAt||
  x.report.marketFingerprint!==newest.marketFingerprint))
  throw Error('跨日追踪汇总的行情来源或观察截止不一致');
 const all=[],ids=new Set(),cohorts=[];
 for(const s of verified){
  cohorts.push(s.report.cohortFingerprint);
  for(const e of s.report.records){
   if(ids.has(e.signalId))throw Error('不同日冻结批次含有重复信号ID');
   ids.add(e.signalId);all.push(e);
  }
 }
 all.sort((a,b)=>b.signalDate.localeCompare(a.signalDate)||a.symbol.localeCompare(b.symbol)||
  a.signalId.localeCompare(b.signalId));
 // UI projection and existing research audit contract max 500 signals.
 const records=all.slice(0,500);
 const report={...newest,cohortFingerprint:sha(cohorts.sort()),records,groups:[],
  warning:'来自 '+verified.length+' 个按日不可变冻结批次；最近'+records.length+
    ' 条独立研究信号；源真实性未独立认证，价格变化非含费率交易净收益'+
    (all.length>500?'；历史更早信号仅在独立日归档保留，超出当前展示上限':'')};
 const old=readSnapshot(stateFile);
 if(old){
  if(old.report.asOf>report.asOf||old.observedAt>report.observedAt||
   JSON.stringify(old.report.feed)!==JSON.stringify(report.feed))
   throw Error('不允许倒序覆盖或换数据源汇总');
  const newerIds=new Map(records.map(x=>[x.signalId,x]));
  for(const previous of old.report.records){
   const next=newerIds.get(previous.signalId);
   if(!next){
    if(records.length<500)throw Error('未达展示上限却丢失历史冻结信号');
    continue;
   }
   if(previous.baselineClose!==next.baselineClose||previous.signalDate!==next.signalDate||
    previous.cohort!==next.cohort)throw Error('历史信号基准或规则被替换');
   for(let i=0;i<previous.windows.length;i++){
    const a=previous.windows[i],b=next.windows[i];
    if(a.status==='observed'&&
      (b.status!=='observed'||a.targetDate!==b.targetDate||a.priceReturnPct!==b.priceReturnPct))
     throw Error('已经成熟的跨日观察不允许倒退或更改');
   }
  }
  if(old.report.cohortFingerprint===report.cohortFingerprint&&
   old.report.marketFingerprint===report.marketFingerprint&&
   old.report.asOf===report.asOf)
   return {ok:true,changed:false,revision:old.revision,signals:records.length};
 }
 const record={schemaVersion:1,mode:'v6-forward-tracking-snapshot',revision:(old?.revision||0)+1,
  observedAt:report.observedAt,report,audit:auditForwardRules(report)};
 const dir=path.dirname(stateFile);fs.mkdirSync(dir,{recursive:true,mode:0o700});localPath(stateFile);
 const lock=stateFile+'.lock';let fd;
 try{fd=fs.openSync(lock,'wx',0o600);}
 catch(e){if(e.code==='EEXIST')throw Error('汇总发布锁已经存在，禁止并发');throw e;}
 try{
  fs.writeFileSync(fd,String(process.pid));fs.fsyncSync(fd);
  // Recheck while holding the publication lock.
  const current=readSnapshot(stateFile);
  if((current?.revision||0)!==(old?.revision||0))throw Error('并发修订冲突');
  const raw=JSON.stringify(seal(record))+'\n';
  const history=path.join(dir,'forward-tracking-history');
  localPath(history);fs.mkdirSync(history,{recursive:true,mode:0o700});
  writeImmutable(path.join(history,String(record.revision).padStart(8,'0')+'-'+report.asOf+'.json'),raw);
  writeAtomic(stateFile,raw);
 }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
 return {ok:true,changed:true,revision:record.revision,signals:records.length,
  cohorts:verified.length,totalArchivedSignals:all.length,canTrade:false,canNotify:false};
}
module.exports={publishRollup};
