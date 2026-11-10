#!/usr/bin/env node
'use strict';
/**
 * Opt-in research scheduler for the EXISTING single-fetch sector-market-capture.
 * "status" is read-only. "once/watch" require an explicit consent flag.
 * No daemon is installed by this module; deployment is operator-controlled.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {aShareCalendarDate}=require('../src/core/a-share-calendar');
const {parse:parseCapture,preflight,runOnce:captureOnce}=require('./sector-market-capture');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const MAX_STATE=65536;
function safePath(p){
 if(typeof p!=='string'||!path.isAbsolute(p)||p.includes('\0'))
  throw Error('调度路径必须是显式绝对路径');
 const full=path.resolve(p);
 if(full.split(path.sep).includes('public'))throw Error('调度状态不得放到公开静态目录');
 let at=path.parse(full).root;
 for(const piece of full.slice(at.length).split(path.sep).filter(Boolean)){
  at=path.join(at,piece);
  if(fs.existsSync(at)&&fs.lstatSync(at).isSymbolicLink())
   throw Error('调度状态路径禁止符号链接');
 }
 return full;
}
function parse(argv){
 const [mode,configFile,...extra]=argv||[];
 if(!['status','once','watch'].includes(mode)||typeof configFile!=='string'||
   extra.length!==(mode==='status'?0:1)||
   (mode!=='status'&&extra[0]!=='--allow-research-fetch'))
  throw Error('用法: sector-capture-supervisor.js status|once|watch <私有config.json绝对路径> [--allow-research-fetch]');
 const file=safePath(configFile),st=fs.lstatSync(file);
 if(!st.isFile()||st.size<2||st.size>32768)throw Error('调度配置须为32768字节以内的普通JSON文件');
 const conf=JSON.parse(fs.readFileSync(file,'utf8'));
 if(conf?.schemaVersion!==1||conf.mode!=='sector-capture-supervisor'||
   !Number.isSafeInteger(conf.intervalMs)||conf.intervalMs<300000||conf.intervalMs>3600000||
   !Number.isSafeInteger(conf.maxDailyAttempts)||conf.maxDailyAttempts<1||conf.maxDailyAttempts>30||
   !Number.isSafeInteger(conf.tripFailures)||conf.tripFailures<1||conf.tripFailures>5)
  throw Error('调度配置需合规的五分钟以上间隔、每日上限和熔断阈值');
 const capture=parseCapture(['collect',conf.classificationFile,conf.calendarFile,
  conf.outputRoot,'--allow-research-fetch']);
 const root=safePath(capture.outputRoot);
 if(file===root||file.startsWith(root+path.sep)||root.startsWith(file+path.sep))
  throw Error('调度配置不能与输出目录嵌套');
 const identity=sha({classificationFile:capture.classificationFile,
  calendarFile:capture.calendarFile,outputRoot:root,intervalMs:conf.intervalMs,
  maxDailyAttempts:conf.maxDailyAttempts,tripFailures:conf.tripFailures});
 return {mode,configFile:file,capture,identity,intervalMs:conf.intervalMs,
  maxDailyAttempts:conf.maxDailyAttempts,tripFailures:conf.tripFailures,
  stateFile:safePath(path.join(root,'.sector-capture-supervisor-state.json')),
  lockFile:safePath(path.join(root,'.sector-capture-supervisor.lock'))};
}
function defaultState(conf,day){
 return {schemaVersion:1,mode:'v6-sector-capture-supervisor-state',
  configFingerprint:conf.identity,day,revision:0,attempts:0,
  consecutiveFailures:0,lastAttemptAt:null,lastFinishedAt:null,
  inFlight:false,breakerOpen:false,lastOutcome:'none',
  verifiedLive:false,canTrade:false};
}
const seal=s=>({...s,integrity:sha(s)});
function readState(conf,now){
 if(!Number.isSafeInteger(now)||now<=0)throw Error('当前时钟无效');
 const day=aShareCalendarDate(now);
 if(!fs.existsSync(conf.stateFile))return defaultState(conf,day);
 safePath(conf.stateFile);
 const stat=fs.lstatSync(conf.stateFile);
 if(!stat.isFile()||stat.size<10||stat.size>MAX_STATE)
  throw Error('熔断状态格式/大小异常，禁止继续采集');
 const stored=JSON.parse(fs.readFileSync(conf.stateFile,'utf8'));
 const {integrity,...record}=stored;
 if(integrity!==sha(record)||record.schemaVersion!==1||
  record.mode!=='v6-sector-capture-supervisor-state'||
  record.configFingerprint!==conf.identity||
  typeof record.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(record.day)||
  !Number.isSafeInteger(record.revision)||record.revision<0||
  !Number.isSafeInteger(record.attempts)||record.attempts<0||
  !Number.isSafeInteger(record.consecutiveFailures)||record.consecutiveFailures<0||
  typeof record.inFlight!=='boolean'||typeof record.breakerOpen!=='boolean'||
  record.verifiedLive!==false||record.canTrade!==false||
  (record.lastAttemptAt!==null&&
   (!Number.isSafeInteger(record.lastAttemptAt)||record.lastAttemptAt<=0))||
  (record.lastFinishedAt!==null&&
   (!Number.isSafeInteger(record.lastFinishedAt)||record.lastFinishedAt<=0))||
  record.attempts>0&&record.lastAttemptAt===null||
  record.inFlight&&record.lastOutcome!=='started'||
  record.lastAttemptAt!==null&&aShareCalendarDate(record.lastAttemptAt)!==record.day||
  record.lastAttemptAt!==null&&record.lastAttemptAt>now||
  record.lastFinishedAt!==null&&record.lastFinishedAt>now||
  record.day>day)
  throw Error('熔断状态损坏、时钟回退或配置被更换，拒绝自动重试');
 // An unfinished batch may already have consumed provider quota or written an
 // immutable snapshot. Midnight must not erase this recovery obligation.
 // Only a resolved prior-day journal can roll over to a fresh daily budget.
 if(record.day!==day&&record.inFlight)
  throw Error('跨日存在未完成采集批次，请先人工核对归档和供应商请求，禁止自动重试');
 return record.day===day?record:defaultState(conf,day);
}
function writeState(conf,state){
 const file=safePath(conf.stateFile),dir=path.dirname(file);
 const body=JSON.stringify(seal(state))+'\n';
 if(Buffer.byteLength(body)>MAX_STATE)throw Error('熔断状态超过上限');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});safePath(dir);
 const tmp=file+'.tmp-'+process.pid+'-'+crypto.randomBytes(6).toString('hex');
 let fd;
 try{
  fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,body);fs.fsyncSync(fd);
  fs.closeSync(fd);fd=undefined;
  safePath(file);fs.renameSync(tmp,file);
  const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch{}}
}
function policy(conf,s,now){
 if(s.inFlight)return 'blocked-unfinished-attempt';
 if(s.breakerOpen||s.consecutiveFailures>=conf.tripFailures)return 'blocked-circuit-open';
 if(s.attempts>=conf.maxDailyAttempts)return 'blocked-daily-budget';
 if(s.lastAttemptAt!==null&&now-s.lastAttemptAt<conf.intervalMs)return 'blocked-minimum-interval';
 return null;
}
function publicState(state){
 return {tradeDate:state.day,attempts:state.attempts,
  consecutiveFailures:state.consecutiveFailures,lastAttemptAt:state.lastAttemptAt,
  lastFinishedAt:state.lastFinishedAt,breakerOpen:state.breakerOpen,
  inFlight:state.inFlight,lastOutcome:state.lastOutcome,
  verifiedLive:false,canTrade:false,canNotify:false,weightsChanged:false};
}
function failureKind(err){
 const msg=String(err?.message||'');
 if(/\b(?:429|403)\b|rate.limit|too.many.requests|限流|拒绝访问/i.test(msg))
  return 'provider-rate-or-permission';
 if(/\b(?:500|502|503|504)\b|timeout|abort|超时|网关/i.test(msg))
  return 'provider-unavailable';
 return 'research-chain-or-input-error';
}
async function tick(conf,{now=Date.now(),clock=Date.now,fetchSnapshot}={}){
 if(conf.mode==='status'){
  const state=readState(conf,now);
  return {status:'read-only-status',...publicState(state),
   wouldBlock:policy(conf,state,now),changed:false};
 }
 if(!Number.isSafeInteger(now)||now<=0||typeof clock!=='function')throw Error('调度时钟无效');
 const check=preflight(conf.capture,{now});
 if(check.status!=='preflight-ready')
  return {status:'paused-preflight',preflightStatus:check.status,canTrade:false,
   verifiedLive:false,changed:false,captureAttempts:0};
 // No state changes if exchange hours, holiday calendar or frozen members fail.
 let fd,stage='supervisor-lock';
 try{
  fs.mkdirSync(conf.capture.outputRoot,{recursive:true,mode:0o700});
  safePath(conf.capture.outputRoot);
  try{fd=fs.openSync(conf.lockFile,'wx',0o600);}
  catch(e){if(e.code==='EEXIST')
   return {status:'blocked-supervisor-lock',canTrade:false,changed:false,captureAttempts:0};
   throw e;}
  fs.writeFileSync(fd,String(process.pid));fs.fsyncSync(fd);
  stage='locked-preflight';
  const again=preflight(conf.capture,{now});
  if(again.status!=='preflight-ready'||again.inputFingerprint!==check.inputFingerprint)
   return {status:'blocked-input-changed',canTrade:false,changed:false,captureAttempts:0};
  let state=readState(conf,now);
  const blocked=policy(conf,state,now);
  if(blocked)return {status:blocked,...publicState(state),changed:false,captureAttempts:0};
  const pending={...state,revision:state.revision+1,attempts:state.attempts+1,
   lastAttemptAt:now,inFlight:true,lastOutcome:'started'};
  // Persist in-flight BEFORE the network request; a crash requires review
  // rather than silently repeating a possibly billable/limited request.
  stage='persist-attempt';
  writeState(conf,pending);
  let result,kind=null,errStage=null;
  stage='single-opt-in-capture';
  try{
   result=await captureOnce(conf.capture,{
    now,clock,...(fetchSnapshot===undefined?{}:{fetchSnapshot})});
   if(result.status!=='capture-and-sector-research-published-unverified')
    kind=result.status.startsWith('blocked-')?'upstream-'+result.status:'unexpected-capture-result';
  }catch(e){kind=failureKind(e);errStage=e.stage||null;}
  const success=kind===null;
  const fails=success?0:pending.consecutiveFailures+1;
  // A previous-stage archive may already exist; retrying the network cannot
  // repair that stage safely. Rate / permissions errors also stop for the day.
  const manualReview=errStage==='daily-sector-chain'||kind==='provider-rate-or-permission';
  const finished={...pending,revision:pending.revision+1,
   inFlight:false,consecutiveFailures:fails,
   breakerOpen:manualReview||fails>=conf.tripFailures,
   lastFinishedAt:now,lastOutcome:success?'success':kind};
  stage='persist-completion';
  writeState(conf,finished);
  return {status:success?'research-capture-succeeded-unverified':
   finished.breakerOpen?'blocked-circuit-open':'research-capture-failed',
   ...(success?{tradeDate:result.tradeDate,rankedSectors:result.rankedSectors,
    evaluatedThreeSession:result.evaluatedThreeSession,
    evaluatedFiveSession:result.evaluatedFiveSession}:{}),
   failureCategory:kind,failedStage:errStage,captureAttempts:1,
   ...publicState(finished),changed:success?result.changed:false};
 }catch(e){e.stage=stage;throw e;}
 finally{if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(conf.lockFile);}}
}
function main(argv=process.argv.slice(2),deps){
 const conf=parse(argv);
 if(conf.mode!=='watch')return tick(conf,deps);
 let busy=false,stopped=false,last=null;
 const run=async()=>{
  if(busy||stopped)return;
  busy=true;
  try{
   const r=await tick(conf),out=JSON.stringify(r);
   if(out!==last)console.log(out);
   last=out;
  }catch(e){
   const out=JSON.stringify({status:'failed-stop-and-audit-before-retry',
    stage:e.stage||'supervisor',canTrade:false});
   if(out!==last)console.error(out);
   last=out;
   // Corrupt state, permission errors and disk failures must not spin forever.
   stopped=true;clearInterval(timer);process.exitCode=1;
  }finally{busy=false;}
 };
 const timer=setInterval(run,conf.intervalMs);
 run();
 process.once('SIGINT',()=>{stopped=true;clearInterval(timer);});
 process.once('SIGTERM',()=>{stopped=true;clearInterval(timer);});
 return Promise.resolve({status:'watch-started-opt-in',intervalMs:conf.intervalMs,canTrade:false});
}
if(require.main===module){
 Promise.resolve().then(()=>main()).then(r=>{
  if(r.status!=='watch-started-opt-in')console.log(JSON.stringify(r));
 }).catch(e=>{
  console.error(JSON.stringify({status:'failed-stop-and-audit-before-retry',
   stage:e.stage||'preflight',canTrade:false}));process.exitCode=1;
 });
}
module.exports={parse,readState,seal,policy,preflight,tick,main};
