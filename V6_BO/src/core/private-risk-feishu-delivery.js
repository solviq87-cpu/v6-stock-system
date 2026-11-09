'use strict';
/**
 * Explicitly opted-in Feishu risk-summary delivery, separated from the paper
 * account, market adapters and research selection.  Gateway acceptance is not
 * proof of a delivered phone notification.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const chinaDay=now=>new Date(now+8*3600000).toISOString().slice(0,10);
const HOST='open.feishu.cn';

function prepareRiskSummary(report,{now=Date.now()}={}){
 if(!Number.isSafeInteger(now)||now<=0||!report||
   report.mode!=='manual-holding-risk-readonly'||report.schemaVersion!==1||
   report.status!=='evaluated'||report.canTrade!==false||
   report.canNotify!==false||report.verifiedLive!==false||
   !Array.isArray(report.alerts)||!report.counts)
  throw Error('持仓风险报告不符合只读协议');
 const observed=Date.parse(report.asOf);
 if(!Number.isFinite(observed)||observed>now||now-observed>15000||
   chinaDay(now)!==chinaDay(observed))throw Error('风险评估已经过期');
 const alerts=report.alerts;
 if(alerts.length>200||alerts.some(a=>!a||typeof a.code!=='string'||
   !['critical','warning','unknown'].includes(a.severity)||
   a.canNotify!==false))throw Error('风险提醒行结构不合格');
 const warning=alerts.filter(a=>a.severity==='warning');
 const critical=alerts.filter(a=>a.severity==='critical');
 const unknown=alerts.filter(a=>a.severity==='unknown');
 const count=report.counts.positions;
 if(!Number.isSafeInteger(count)||count<0||count>100||
   report.counts.warningAlerts!==warning.length+critical.length)
   throw Error('风险汇总与原报告不一致');
 const counts={positions:count,critical:critical.length,warning:warning.length,
   unknown:unknown.length,validQuotes:report.counts.withRecentSourceQuote,
   conflicts:report.counts.conflictingQuotes};
 if(!Number.isSafeInteger(counts.validQuotes)||counts.validQuotes<0||
   counts.validQuotes>count||!Number.isSafeInteger(counts.conflicts)||
   counts.conflicts<0||counts.conflicts>count)throw Error('报价覆盖率无效');
 const day=chinaDay(now),codes=alerts.filter(a=>a.severity!=='unknown')
   .map(a=>a.code).sort();
 const fingerprint=sha({day,counts,codes});
 const message='V6 本机只读风险观察（'+day+'）\n高风险 '+counts.critical+
   ' 条，普通风险 '+counts.warning+' 条，未知/待核验 '+counts.unknown+
   ' 条；观察持仓 '+count+' 只。\n数据来源与报价未经独立认证，消息不代表券商持仓或交易指令。请到自己的本机页面核对。';
 return {day,counts,fingerprint,message,actionable:counts.critical+counts.warning>0,
   containsPositions:false,canTrade:false,sourceVerified:false};
}
function checkUrl(value){
 if(typeof value!=='string'||value.length>256)throw Error('飞书地址未配置');
 let u;
 try{u=new URL(value);}catch{throw Error('飞书地址无效');}
 if(u.protocol!=='https:'||u.hostname!==HOST||u.port||
   u.username||u.password||u.search||u.hash||
   !/^\/open-apis\/bot\/v2\/hook\/[0-9a-zA-Z_-]{20,128}$/.test(u.pathname))
  throw Error('仅支持官方飞书机器人HTTPS地址');
 return u.toString();
}
function checkState(file){
 if(typeof file!=='string'||!path.isAbsolute(file)||file.length>2048)
  throw Error('需要本机绝对路径去重记录');
 const dir=path.dirname(file);
 if(!fs.statSync(dir).isDirectory()||fs.lstatSync(dir).isSymbolicLink())
  throw Error('去重目录无效');
 if(fs.existsSync(file)){
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192)
   throw Error('去重记录不安全');
 }
 return file;
}
function readState(file){
 if(!fs.existsSync(file))return null;
 const x=JSON.parse(fs.readFileSync(file,'utf8'));
 if(x?.schemaVersion!==1||x.mode!=='v6-private-feishu-gateway-receipt'||
   typeof x.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x.day)||
   !/^[a-f0-9]{64}$/.test(x.fingerprint||'')||
   !['pending-unknown','gateway-accepted','gateway-rejected'].includes(x.status)||
   !Number.isSafeInteger(x.at))throw Error('持久化提醒记录损坏');
 return x;
}
function writeState(file,state){
 const tmp=file+'.'+process.pid+'.tmp';
 let fd;
 try{
  fd=fs.openSync(tmp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
  fs.writeFileSync(fd,JSON.stringify(state)+'\n','utf8');
  fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  fs.renameSync(tmp,file);
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch{}}
}
async function sendPrivateRiskSummary({report,webhookUrl,stateFile,
 fetchImpl=globalThis.fetch,now=Date.now(),enableDelivery=false}={}){
 const summary=prepareRiskSummary(report,{now});
 if(!summary.actionable)return {status:'no-actionable-risk',canTrade:false,
   gatewayAccepted:false,deliveredToDevice:false,counts:summary.counts};
 if(!enableDelivery)return {status:'dry-run',canTrade:false,
   gatewayAccepted:false,deliveredToDevice:false,counts:summary.counts};
 // Strictly validate all input and persist a pending reservation BEFORE network I/O.
 const url=checkUrl(webhookUrl),file=checkState(stateFile);
 if(typeof fetchImpl!=='function')throw Error('缺少HTTP发送实现');
 const lock=file+'.lock';
 let lockFd;
 try{
  lockFd=fs.openSync(lock,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
  const old=readState(file);
  // Unknown results never automatically resend; manual inspection is required.
  if(old&&old.day===summary.day&&old.fingerprint===summary.fingerprint)
   return {status:'deduplicated-'+old.status,canTrade:false,
     gatewayAccepted:old.status==='gateway-accepted',deliveredToDevice:false,
     counts:summary.counts};
  const record={schemaVersion:1,mode:'v6-private-feishu-gateway-receipt',
    day:summary.day,fingerprint:summary.fingerprint,status:'pending-unknown',at:now};
  writeState(file,record);
  let status='pending-unknown',accepted=false;
  const controller=new AbortController();
  let timer;
  try{
   timer=setTimeout(()=>controller.abort(),6000);
   const response=await fetchImpl(url,{method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({msg_type:'text',content:{text:summary.message}}),
    signal:controller.signal,redirect:'error'});
   if(response?.ok){
    const payload=await response.json();
    if(payload&&((payload.code===0)||(payload.StatusCode===0))){
     status='gateway-accepted';accepted=true;
    }else status='gateway-rejected';
   }else if(response&&response.status>=400&&response.status<500)
    status='gateway-rejected';
   // 5xx / socket close / invalid JSON are unknown and must not be retried.
  }catch{/* unknown, do not automatically retry */}
  finally{clearTimeout(timer);}
  writeState(file,{...record,status,at:now});
  return {status,canTrade:false,gatewayAccepted:accepted,
    deliveredToDevice:false,counts:summary.counts};
 }finally{
  if(lockFd!==undefined){fs.closeSync(lockFd);fs.unlinkSync(lock);}
 }
}
module.exports={prepareRiskSummary,sendPrivateRiskSummary};
