'use strict';
/** Append-only, crash-safe offline paper account. No live orders, no invented candles. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {validateDataset}=require('./historical-validation');
const {replayPaperAccount}=require('./paper-replay');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const clone=x=>JSON.parse(JSON.stringify(x));
function normalize(history){
 validateDataset(history);
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
 if(next.stocks[0].bars.length===oldData.stocks[0].bars.length){
  if(sha(next)!==sha(oldData))throw Error('历史数据变动但未追加新交易日');
  return false;
 }
 if(next.asOf<oldData.asOf)throw Error('截至日期不可倒退');
 return true;
}
function buildSession(history,config={},previous=null){
 const data=normalize(history);
 if(previous){
  if(previous.schemaVersion!==1||previous.mode!=='offline-paper-session'||sha(previous.history)!==previous.historyHash||sha(previous.report)!==previous.reportHash)throw Error('模拟账户文件完整性校验失败');
  if(sha(config)!==sha(previous.config))throw Error('已创建账户的交易参数不可修改');
  const changed=assertAppend(previous.history,data);
  if(!changed)return {session:previous,updated:false};
 }
 const report=replayPaperAccount(data,config);
 const session={schemaVersion:1,mode:'offline-paper-session',canTrade:false,verifiedLive:false,
  config:clone(config),history:data,historyHash:sha(data),report,reportHash:sha(report),
  lastDate:report.dataset.lastDate,revision:previous?previous.revision+1:1};
 return {session,updated:true};
}
function loadSession(filename){
 const raw=fs.readFileSync(filename,'utf8');
 if(Buffer.byteLength(raw)>60*1024*1024)throw Error('账户文件超过60MB');
 const s=JSON.parse(raw);
 if(!s||s.schemaVersion!==1||s.mode!=='offline-paper-session'||s.canTrade!==false||s.verifiedLive!==false||sha(s.history)!==s.historyHash||sha(s.report)!==s.reportHash)throw Error('模拟账户文件完整性校验失败');
 return s;
}
function writeAtomic(target,contents){
 const dir=path.dirname(target);
 fs.mkdirSync(dir,{recursive:true});
 const tmp=path.join(dir,'.'+path.basename(target)+'.'+crypto.randomBytes(8).toString('hex')+'.tmp');
 let fd;
 try{
  fd=fs.openSync(tmp,'wx',0o600);
  fs.writeFileSync(fd,contents);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  fs.renameSync(tmp,target);
  try{const d=fs.openSync(dir,'r');fs.fsyncSync(d);fs.closeSync(d);}catch{}
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch{}}
}
function assertRegularTarget(target){
 try{const st=fs.lstatSync(target);if(!st.isFile()||st.isSymbolicLink())throw Error('拒绝覆盖非普通账户文件或符号链接');}
 catch(e){if(e.code!=='ENOENT')throw e;}
}
/** Backups are verified snapshots, never silently substituted for a corrupt live account. */
function assertReplayConsistent(session){
 if(!Number.isSafeInteger(session.revision)||session.revision<1)throw Error('账户版本号无效');
 const validated=normalize(session.history);
 const replay=replayPaperAccount(validated,session.config);
 if(sha(replay)!==sha(session.report))throw Error('账户成交报告与独立回放不一致');
 if(session.lastDate!==replay.dataset.lastDate)throw Error('账户最后交易日与历史行情不一致');
}
function saveSession(filename,session){
 const target=path.resolve(filename);
 if(!session||session.mode!=='offline-paper-session'||session.canTrade!==false||session.verifiedLive!==false||sha(session.history)!==session.historyHash||sha(session.report)!==session.reportHash)throw Error('拒绝保存完整性校验失败的账户');
 assertReplayConsistent(session);
 assertRegularTarget(target);
 if(fs.existsSync(target)){
  const previous=loadSession(target); // refuse to overwrite corruption
  assertReplayConsistent(previous);
  if(session.revision<=previous.revision)throw Error('账户版本必须递增');
  if(session.revision!==previous.revision+1)throw Error('账户版本不连续');
  if(sha(session.config)!==sha(previous.config))throw Error('账户交易参数不可更改');
  assertAppend(previous.history,session.history);
  const backup=target+'.bak';assertRegularTarget(backup);
  writeAtomic(backup,fs.readFileSync(target));
 }
 writeAtomic(target,JSON.stringify(session,null,2)+'\n');
}
function recoverSession(filename,{dryRun=true}={}){
 const target=path.resolve(filename),backup=target+'.bak';
 assertRegularTarget(target);assertRegularTarget(backup);
 const recovered=loadSession(backup);
 assertReplayConsistent(recovered);
 let currentValid=false,currentRevision=null;
 try{const current=loadSession(target);currentValid=true;currentRevision=current.revision;}catch{}
 if(currentValid)throw Error('当前账户有效，禁止用旧备份覆盖');
 if(dryRun)return {restorable:true,revision:recovered.revision,lastDate:recovered.lastDate,backup,restored:false};
 if(fs.existsSync(target)){
  const damaged=target+'.corrupt.'+crypto.randomBytes(6).toString('hex');
  fs.renameSync(target,damaged);
 }
 writeAtomic(target,fs.readFileSync(backup));
 return {restorable:true,revision:recovered.revision,lastDate:recovered.lastDate,restored:true};
}
function summary(s){return {mode:s.mode,revision:s.revision,lastDate:s.lastDate,source:s.history.source,verifiedLive:false,canTrade:false,metrics:s.report.metrics,historyHash:s.historyHash,reportHash:s.reportHash};}
module.exports={buildSession,loadSession,saveSession,recoverSession,summary,assertAppend};
