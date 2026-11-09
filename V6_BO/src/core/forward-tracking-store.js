'use strict';
/**
 * Persistent, single-writer, research-only forward signal observations.
 * The authoritative signal producer must have frozen the cohort before outcomes.
 * This module cannot infer past signals from the present selection list.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {evaluateForward}=require('./forward-signal-observer');
const {auditForwardRules}=require('./forward-rule-audit');
const MAX_BYTES=4*1024*1024;
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function localPath(file){
 if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0'))
  throw Error('追踪归档必须位于显式绝对路径');
 const target=path.resolve(file);let cursor=path.parse(target).root;
 for(const piece of target.slice(cursor.length).split(path.sep).filter(Boolean)){
  cursor=path.join(cursor,piece);
  if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink())
   throw Error('追踪归档路径禁止符号链接');
 }
 if(target.split(path.sep).includes('public'))throw Error('追踪归档不能放在静态公开目录');
 return target;
}
function readJson(file){
 file=localPath(file);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.size===0||stat.size>MAX_BYTES)throw Error('追踪JSON大小或文件类型无效');
  return JSON.parse(fs.readFileSync(fd,'utf8'));
 }finally{fs.closeSync(fd);}
}
function seal(record){return {...record,integrity:digest(record)};}
function validateSnapshot(data){
 if(!data||data.schemaVersion!==1||data.mode!=='v6-forward-tracking-snapshot'||
  !Number.isSafeInteger(data.revision)||data.revision<1||
  !Number.isFinite(data.observedAt)||data.observedAt<=0||
  !data.report||data.report.mode!=='forward-signal-price-observation'||
  data.report.canTrade!==false||data.report.verifiedLive!==false||
  data.report.prospectiveCertified!==false||data.report.executionSimulated!==false||
  data.report.feed?.source!=='imported'||typeof data.integrity!=='string')
  throw Error('追踪归档证据协议无效');
 const {integrity,...unsealed}=data;
 if(integrity!==digest(unsealed))throw Error('追踪归档完整性校验失败');
 if(data.report.observedAt!==data.observedAt)throw Error('观察时间不一致');
 // Recompute the descriptive audit; never trust unvalidated saved aggregates.
 const expected=auditForwardRules(data.report);
 if(JSON.stringify(data.audit)!==JSON.stringify(expected))
  throw Error('规则审核指标与冻结价格报告不一致');
 return data;
}
function readSnapshot(file){
 file=localPath(file);
 if(!fs.existsSync(file))return null;
 return validateSnapshot(readJson(file));
}
function writeAtomic(file,raw){
 file=localPath(file);const tmp=file+'.tmp-'+process.pid+'-'+crypto.randomBytes(6).toString('hex');
 const bytes=Buffer.from(raw);
 if(bytes.length>MAX_BYTES)throw Error('追踪归档过大');
 let fd;
 try{
  fd=fs.openSync(tmp,'wx',0o600);
  fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
  fs.renameSync(tmp,file);
  const parent=fs.openSync(path.dirname(file),'r');
  try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
 }finally{
  if(fd!==null&&fd!==undefined)fs.closeSync(fd);
  try{fs.unlinkSync(tmp);}catch{}
 }
}
function writeImmutable(file,raw){
 file=localPath(file);
 if(fs.existsSync(file)){
  if(fs.readFileSync(file,'utf8')!==raw)throw Error('已存在不同的不可变历史快照');
  return;
 }
 const tmp=file+'.tmp-'+process.pid+'-'+crypto.randomBytes(6).toString('hex');
 let fd;
 try{
  fd=fs.openSync(tmp,'wx',0o600);
  fs.writeFileSync(fd,raw);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
  fs.linkSync(tmp,file);
  const parent=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
 }finally{if(fd!==null&&fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch{}}
}
function noObservedRegression(previous,next){
 if(previous.report.cohortFingerprint!==next.cohortFingerprint||
  JSON.stringify(previous.report.feed)!==JSON.stringify(next.feed))
  throw Error('冻结信号指纹或同源数据发生变化，拒绝覆盖既有观察');
 if(next.asOf<previous.report.asOf||next.observedAt<previous.observedAt)
  throw Error('更旧的行情不能覆盖较新追踪证据');
 const former=new Map(previous.report.records.map(x=>[x.signalId,x]));
 const latest=new Map(next.records.map(x=>[x.signalId,x]));
 if(former.size!==latest.size)throw Error('冻结信号数量改变，拒绝覆盖');
 for(const [id,a] of former){
  const b=latest.get(id);
  if(!b||a.symbol!==b.symbol||a.signalDate!==b.signalDate||
    a.baselineClose!==b.baselineClose||a.system!==b.system||a.cohort!==b.cohort)
   throw Error('冻结信号被替换或篡改');
  for(let i=0;i<a.windows.length;i++){
   const old=a.windows[i],fresh=b.windows[i];
   if(old.status==='observed'&&
     (fresh.status!=='observed'||fresh.targetDate!==old.targetDate||
      fresh.priceReturnPct!==old.priceReturnPct))
    throw Error('已经成熟的观察发生倒退或改价，需独立对账');
  }
 }
}
function runOnce({cohort,market,stateFile,now=Date.now()}){
 stateFile=localPath(stateFile);
 if(!cohort||!market||cohort.feed?.source!=='imported'||market.feed?.source!=='imported')
  throw Error('自动归档仅接受明确导入的冻结信号与同源行情，模拟数据不得发布');
 if(!Number.isFinite(now)||now<=0)throw Error('评估时间非法');
 const dir=path.dirname(stateFile);localPath(dir);
 fs.mkdirSync(dir,{recursive:true,mode:0o700});localPath(stateFile);
 const lock=stateFile+'.lock';let lockFd;
 try{
  lockFd=fs.openSync(lock,'wx',0o600);
 }catch(e){
  if(e.code==='EEXIST')throw Error('已有追踪归档锁，禁止并发写入；异常中断请人工检查');
  throw e;
 }
 try{
  fs.writeFileSync(lockFd,String(process.pid));fs.fsyncSync(lockFd);
  const old=readSnapshot(stateFile);
  const report=evaluateForward(cohort,market,{now});
  if(old)noObservedRegression(old,report);
  if(old&&old.report.marketFingerprint===report.marketFingerprint&&
    old.report.cohortFingerprint===report.cohortFingerprint&&
    old.report.asOf===report.asOf)
   return {ok:true,changed:false,revision:old.revision,asOf:old.report.asOf,signalCount:report.records.length};
  const record={
   schemaVersion:1,mode:'v6-forward-tracking-snapshot',revision:(old?.revision||0)+1,
   observedAt:report.observedAt,report,audit:auditForwardRules(report)
  };
  const raw=JSON.stringify(seal(record))+'\n';
  const historyDir=path.join(dir,'forward-tracking-history');localPath(historyDir);
  fs.mkdirSync(historyDir,{recursive:true,mode:0o700});localPath(historyDir);
  const archived=path.join(historyDir,String(record.revision).padStart(8,'0')+'-'+report.asOf+'.json');
  writeImmutable(archived,raw);
  writeAtomic(stateFile,raw);
  return {ok:true,changed:true,revision:record.revision,asOf:report.asOf,
   observedAt:report.observedAt,signalCount:report.records.length,
   auditedGroups:record.audit.groups.length,canTrade:false,canNotify:false};
 }finally{
  if(lockFd!==undefined){fs.closeSync(lockFd);fs.unlinkSync(lock);}
 }
}
module.exports={runOnce,readSnapshot,readJson,localPath,writeImmutable,writeAtomic,seal};
