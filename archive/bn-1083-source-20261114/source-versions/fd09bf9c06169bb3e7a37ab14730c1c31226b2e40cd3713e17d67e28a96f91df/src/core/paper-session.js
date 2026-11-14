'use strict';
/** Append-only, crash-safe offline paper account. No live orders, no invented candles. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {validateDataset}=require('./historical-validation');
const {reconcileAccount}=require('./account-reconciliation');
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
 const fail=()=>{throw Error('模拟账户文件完整性校验失败');};
 if(!s||s.schemaVersion!==1||s.mode!=='offline-paper-session'||s.canTrade!==false||s.verifiedLive!==false||
   !Number.isSafeInteger(s.revision)||s.revision<1||!s.config||typeof s.config!=='object'||Array.isArray(s.config)||
   sha(s.history)!==s.historyHash||sha(s.report)!==s.reportHash)fail();
 if(s.configHash!==undefined&&sha(s.config)!==s.configHash)fail();
 const ds=validateDataset(s.history),r=s.report;
 if(!r||r.mode!=='offline-paper-replay'||r.canTrade!==false||r.verifiedLive!==false||r.fingerprint!==s.historyHash||
   s.lastDate!==ds.lastDate||r.dataset?.lastDate!==ds.lastDate||!Array.isArray(r.equity)||!r.equity.length)fail();
 if(!r.config||Object.keys(s.config).some(k=>sha(r.config[k])!==sha(s.config[k])))fail();
 const last=r.equity.at(-1);
 if(last.date!==s.lastDate||!Number.isFinite(last.equity)||last.equity<0||!Number.isFinite(last.cash)||last.cash< -0.011||
   Math.abs(last.equity-r.metrics?.finalEquity)>0.011||!Number.isFinite(r.metrics?.finalEquity))fail();
 if(r.cashFlows)reconcileAccount(r);
 return s;
}
function loadSession(filename){
 const stat=fs.statSync(filename);
 if(!stat.isFile()||stat.size>60*1024*1024)throw Error('账户文件超过60MB或不是普通文件');
 const raw=fs.readFileSync(filename,'utf8');
 if(Buffer.byteLength(raw)>60*1024*1024)throw Error('账户文件超过60MB');
 return validateSession(JSON.parse(raw));
}
function saveSession(filename,session){
 validateSession(session);
 const target=path.resolve(filename),dir=path.dirname(target);
 fs.mkdirSync(dir,{recursive:true});
 const tmp=path.join(dir,'.'+path.basename(target)+'.'+crypto.randomBytes(8).toString('hex')+'.tmp');
 let fd;
 try{
  fd=fs.openSync(tmp,'wx',0o600);
  fs.writeFileSync(fd,JSON.stringify(session,null,2)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  fs.renameSync(tmp,target);
  try{const d=fs.openSync(dir,'r');fs.fsyncSync(d);fs.closeSync(d);}catch{}
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch{}}
}
function summary(s){return {mode:s.mode,revision:s.revision,lastDate:s.lastDate,source:s.history.source,verifiedLive:false,canTrade:false,metrics:s.report.metrics,historyHash:s.historyHash,reportHash:s.reportHash};}
module.exports={buildSession,loadSession,saveSession,summary,assertAppend,validateSession};
