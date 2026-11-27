'use strict';
/** Append-only, crash-safe offline paper account. No live orders, no invented candles. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {validateDataset}=require('./historical-validation');
const {reconcileAccount}=require('./account-reconciliation');
const {replayPaperAccount}=require('./paper-replay');
const {assertUnadjustedExecutionPriceBasis}=require('./historical-execution-price-basis');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const clone=x=>JSON.parse(JSON.stringify(x));
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?
 Object.fromEntries(Object.keys(x).sort().map(key=>[key,canonical(x[key])])):x;
const contextHash=x=>sha(canonical(x));
/** Candles alone do not freeze a historical decision. Membership/security
 * state, dated fees and settlements can change old results without touching
 * OHLCV. Compare only already captured dates: extending an interval or adding
 * a future status/fee/action remains lawful. The importer keeps rejected raw
 * revisions in its original quarantine; a review cannot replace frozen facts.
 */
function assertHistoricalContextAppend(previous,next){
 const dates=previous.stocks[0].bars.map(bar=>bar.date).filter(date=>typeof date==='string');
 if(!dates.length)return;
 if(contextHash(previous.universeHistory??null)!==contextHash(next.universeHistory??null)){
  const index=rows=>{
   const grouped=new Map();
   for(const row of rows||[]){
    const {from,through,...state}=row;
    if(!grouped.has(row.symbol))grouped.set(row.symbol,[]);
    grouped.get(row.symbol).push({from,through,hash:contextHash(state)});
   }
   for(const list of grouped.values())list.sort((a,b)=>a.from.localeCompare(b.from));
   return grouped;
  };
  const before=index(previous.universeHistory),after=index(next.universeHistory);
  const reader=(rows,declared)=>{
   let cursor=0;
   return date=>{
    if(!declared)return 'legacy-undeclared';
    while(cursor<rows.length&&rows[cursor].through<date)cursor++;
    const row=rows[cursor];return row&&row.from<=date?row.hash:'no-dated-membership';
   };
  };
  for(const stock of previous.stocks){
   const symbol=String(stock.symbol||stock.code),oldState=reader(before.get(symbol)||[],previous.universeHistory!=null),
    newState=reader(after.get(symbol)||[],next.universeHistory!=null);
   for(const date of dates)if(oldState(date)!==newState(date))throw Error('历史证券状态或历史股票池证据被改写，拒绝更新: '+symbol+' '+date);
  }
 }
 if(contextHash(previous.feeSchedules??null)!==contextHash(next.feeSchedules??null)){
  const {validateFeeSchedules}=require('./trading-fees');
  validateFeeSchedules(previous.feeSchedules);validateFeeSchedules(next.feeSchedules);
  const reader=rows=>{
   let cursor=-1;const hashes=(rows||[]).map(contextHash);
   return date=>{
    if(rows==null)return 'legacy-policy';
    while(cursor+1<rows.length&&rows[cursor+1].effectiveFrom<=date)cursor++;
    return cursor<0?'no-dated-fee-policy':hashes[cursor];
   };
  };
  const before=reader(previous.feeSchedules),after=reader(next.feeSchedules);
  for(const date of dates)if(before(date)!==after(date))throw Error('历史费用或费率来源证据被改写，拒绝更新: '+date);
 }
 const settlements=data=>(data.settlements||[]).filter(event=>event.effectiveDate<=dates.at(-1))
  .slice().sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate));
 if(contextHash(settlements(previous))!==contextHash(settlements(next)))
  throw Error('历史公司行为或历史权益结算证据被改写，拒绝更新');
}
function normalize(history){
 validateDataset(history);
 assertUnadjustedExecutionPriceBasis(history);
 if(history.stocks.some(s=>s.bars.some(b=>!b.date)))throw Error('持续模拟账户要求所有K线包含真实交易日期');
 return clone(history);
}
function assertAppend(oldData,next){
 if(next.source!==oldData.source||next.provider!==oldData.provider||next.datasetId!==oldData.datasetId)throw Error('数据来源不可变更');
 if(next.stocks.length!==oldData.stocks.length)throw Error('股票池不可变更');
 const map=new Map(next.stocks.map(s=>[String(s.symbol||s.code),s]));
 for(const s of oldData.stocks){
  const n=map.get(String(s.symbol||s.code));
  if(!n||n.bars.length<s.bars.length)throw Error('股票历史不可删除');
  const a={...s,bars:undefined},b={...n,bars:undefined};
  if(sha(a)!==sha(b))throw Error('股票元数据不可变更');
  for(let i=0;i<s.bars.length;i++)if(sha(s.bars[i])!==sha(n.bars[i]))throw Error('历史K线被改写，拒绝更新');
 }
 const growth=oldData.stocks.map(s=>map.get(String(s.symbol||s.code)).bars.length-s.bars.length);
 if(growth.some(n=>n!==growth[0]))throw Error('股票历史追加交易日数量不一致');
 assertHistoricalContextAppend(oldData,next);
 if(growth[0]===0){
  if(sha(next)!==sha(oldData))throw Error('历史数据变动但未追加新交易日');
  return false;
 }
 if(next.asOf<oldData.asOf)throw Error('截至日期不可倒退');
 return true;
}
function buildSession(history,config={},previous=null){
 const data=normalize(history);
 if(previous){
  validateSession(previous);
  if(sha(config)!==sha(previous.config))throw Error('已创建账户的交易参数不可修改');
  const changed=assertAppend(previous.history,data);
  if(!changed&&previous.report.cashFlows&&previous.configHash)return {session:previous,updated:false};
 }
 const report=replayPaperAccount(data,config);
 const session={schemaVersion:1,mode:'offline-paper-session',canTrade:false,verifiedLive:false,
  config:clone(config),configHash:sha(config),history:data,historyHash:sha(data),report,reportHash:sha(report),
  lastDate:report.dataset.lastDate,revision:previous?previous.revision+1:1};
 return {session,updated:true};
}
function validateSession(s){
 const fail=()=>{throw Object.assign(Error('模拟账户文件完整性校验失败'),{code:INVALID_CONTENT});};
 if(!s||s.schemaVersion!==1||s.mode!=='offline-paper-session'||s.canTrade!==false||s.verifiedLive!==false||
   !Number.isSafeInteger(s.revision)||s.revision<1||!s.config||typeof s.config!=='object'||Array.isArray(s.config)||
   !s.history||!s.report||sha(s.history)!==s.historyHash||sha(s.report)!==s.reportHash)fail();
 if(s.configHash!==undefined&&sha(s.config)!==s.configHash)fail();
 const ds=validateDataset(s.history),r=s.report;
 try{assertUnadjustedExecutionPriceBasis(s.history);}catch{fail();}
 if(!r||r.mode!=='offline-paper-replay'||r.canTrade!==false||r.verifiedLive!==false||r.fingerprint!==s.historyHash||
   s.lastDate!==ds.lastDate||r.dataset?.lastDate!==ds.lastDate||!Array.isArray(r.equity)||!r.equity.length)fail();
 if(!r.config||Object.keys(s.config).some(k=>sha(r.config[k])!==sha(s.config[k])))fail();
 const last=r.equity.at(-1);
 if(last.date!==s.lastDate||!Number.isFinite(last.equity)||last.equity<0||!Number.isFinite(last.cash)||last.cash< -0.011||
   Math.abs(last.equity-r.metrics?.finalEquity)>0.011||!Number.isFinite(r.metrics?.finalEquity))fail();
 if(r.cashFlows)reconcileAccount(r);
 return s;
}
const MAX_SESSION_BYTES=60*1024*1024;
const INVALID_CONTENT='PAPER_SESSION_INVALID_CONTENT';
function statTarget(target){
 try{const st=fs.lstatSync(target);if(!st.isFile()||st.isSymbolicLink())throw Error('拒绝读取或覆盖非普通账户文件或符号链接');return st;}
 catch(e){if(e.code==='ENOENT')return null;throw e;}
}
function sameStat(a,b){return a&&b&&['dev','ino','size','mtimeMs','ctimeMs','mode'].every(key=>a[key]===b[key]);}
function assertUnchanged(target,expected){
 const actual=statTarget(target);
 if(expected?!sameStat(expected,actual):actual!==null)throw Error('账户或备份文件已变化，拒绝覆盖');
}
function readSnapshot(filename){
 const expected=statTarget(filename),fd=fs.openSync(filename,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
 try{
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||!sameStat(expected,stat))throw Error('账户文件读取期间已变化');
  if(stat.size>MAX_SESSION_BYTES)throw Error('账户文件超过60MB');
  // Bound even a concurrently growing file; do not allocate from its new size.
  const bytes=Buffer.allocUnsafe(stat.size+1);let offset=0;
  while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,null);if(!n)break;offset+=n;}
  if(offset!==stat.size||!sameStat(stat,fs.fstatSync(fd)))throw Error('账户文件读取期间已变化');
  return {raw:bytes.subarray(0,offset),stat};
 }finally{fs.closeSync(fd);}
}
function decodeSession(raw){
 let value;
 try{value=JSON.parse(raw.toString('utf8'));}
 catch(error){throw Object.assign(Error('模拟账户文件完整性校验失败: '+error.message,{cause:error}),{code:INVALID_CONTENT});}
 // A newly unsupported historical policy or runtime validation error is not
 // proof of damaged bytes. Only the explicit integrity failures are restorable.
 return validateSession(value);
}
function optionalSnapshot(target){return statTarget(target)?readSnapshot(target):null;}
function loadSession(filename){return decodeSession(readSnapshot(filename).raw);}
function syncDirectory(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function writeAtomic(target,contents,{beforeRename,exclusive=false,strictDirectorySync=false}={}){
 const dir=path.dirname(target);
 fs.mkdirSync(dir,{recursive:true});
 const tmp=path.join(dir,'.'+path.basename(target)+'.'+crypto.randomBytes(8).toString('hex')+'.tmp');
 let fd,owned=false;
 try{
  fd=fs.openSync(tmp,'wx',0o600);owned=true;
  fs.writeFileSync(fd,contents);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  beforeRename?.();
  if(exclusive)fs.linkSync(tmp,target);else fs.renameSync(tmp,target);
  if(strictDirectorySync)syncDirectory(dir);else try{syncDirectory(dir);}catch{}
 }finally{if(fd!==undefined)fs.closeSync(fd);if(owned)try{fs.unlinkSync(tmp);}catch{}}
}
/** All original offline-session writers share the existing kernel guard. A
 * verified backup is never silently substituted for, or overwritten by, a
 * corrupt snapshot. The original schema and explicit recovery entry remain. */
function saveSession(filename,session){
 validateSession(session);
 const target=path.resolve(filename),backup=target+'.bak',raw=Buffer.from(JSON.stringify(session,null,2)+'\n');
 if(raw.length>MAX_SESSION_BYTES)throw Error('账户文件超过60MB，拒绝覆盖');
 fs.mkdirSync(path.dirname(target),{recursive:true});
 return require('./account-process-lock').withAccountLock(target,()=>{
  const current=optionalSnapshot(target),saved=optionalSnapshot(backup);
  if(!current&&saved)throw Error('原账户缺失但备份存在，请先显式恢复，禁止初始化覆盖');
  let backupStat=null;
  if(current){
   const previous=decodeSession(current.raw);
   if(session.revision<=previous.revision)throw Error('账户版本必须递增');
   if(session.revision!==previous.revision+1)throw Error('账户版本不连续');
   if(sha(session.config)!==sha(previous.config))throw Error('账户交易参数不可更改');
   assertAppend(previous.history,session.history);
   if(saved){
    const old=decodeSession(saved.raw);
    if(old.revision>previous.revision||sha(old.config)!==sha(previous.config)||
       old.revision===previous.revision&&(old.historyHash!==previous.historyHash||old.reportHash!==previous.reportHash))
     throw Error('账户备份版本或来源不一致，拒绝覆盖');
    if(old.revision<previous.revision)assertAppend(old.history,previous.history);
   }
   writeAtomic(backup,current.raw,{beforeRename:()=>{assertUnchanged(target,current.stat);assertUnchanged(backup,saved?.stat??null);}});
   // Verify the newly published recovery bytes, then bind the final primary
   // commit to that exact backup snapshot (or its absence on initialization).
   const published=readSnapshot(backup);
   if(!published.raw.equals(current.raw))throw Error('账户备份文件已变化，拒绝覆盖');
   backupStat=published.stat;
  }
  writeAtomic(target,raw,{beforeRename:()=>{assertUnchanged(target,current?.stat??null);assertUnchanged(backup,backupStat);}});
 });
}
function recoverSession(filename,{dryRun=true}={}){
 if(typeof dryRun!=='boolean')throw Error('账户恢复必须显式指定检查或恢复');
 const target=path.resolve(filename),backup=target+'.bak';
 const operation=()=>{
  const saved=readSnapshot(backup),recovered=decodeSession(saved.raw),current=optionalSnapshot(target);
  if(current){
   let valid=true;
   try{decodeSession(current.raw);}catch(error){if(error.code!==INVALID_CONTENT)throw error;valid=false;}
   if(valid)throw Error('当前账户有效，禁止用旧备份覆盖');
  }
  const receipt={restorable:true,revision:recovered.revision,lastDate:recovered.lastDate,backup,restored:false};
  if(dryRun)return receipt;
  // Preserve the damaged bytes first, without moving the authoritative name.
  // A failed archive or final rename leaves that name untouched.
  if(current){
   const damaged=target+'.corrupt.'+crypto.randomBytes(6).toString('hex');
   writeAtomic(damaged,current.raw,{exclusive:true,strictDirectorySync:true,beforeRename:()=>assertUnchanged(target,current.stat)});
  }
  // Publish the exact bytes that passed validation, not a second backup read.
  writeAtomic(target,saved.raw,{beforeRename:()=>{assertUnchanged(target,current?.stat??null);assertUnchanged(backup,saved.stat);}});
  return {...receipt,restored:true};
 };
 return dryRun?operation():require('./account-process-lock').withAccountLock(target,operation);
}
function summary(s){return {mode:s.mode,revision:s.revision,lastDate:s.lastDate,source:s.history.source,verifiedLive:false,canTrade:false,metrics:s.report.metrics,historyHash:s.historyHash,reportHash:s.reportHash};}
module.exports={buildSession,loadSession,saveSession,recoverSession,summary,assertAppend,validateSession};
