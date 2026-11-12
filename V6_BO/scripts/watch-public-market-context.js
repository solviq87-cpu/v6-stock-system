#!/usr/bin/env node
'use strict';
// This collector only archives public research context. It never trains models,
// changes strategy parameters, places orders or claims a continuously deployed host.
const fs=require('node:fs'),path=require('node:path');
const {capturePublicContext}=require('./capture-public-market-context');
function privateRoot(outputDir){
 if(typeof outputDir!=='string'||!path.isAbsolute(outputDir)||outputDir.includes('\0'))throw Error('必须显式指定私有绝对输出目录');
 const root=path.resolve(outputDir);if(root===path.parse(root).root||root.split(path.sep).includes('public'))throw Error('禁止公开输出路径');
 let current=path.parse(root).root;for(const part of root.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);try{if(fs.lstatSync(current).isSymbolicLink())throw Error('输出路径禁止符号链接');}catch(e){if(e.code!=='ENOENT')throw e;}}
 fs.mkdirSync(root,{recursive:true,mode:0o700});if((fs.statSync(root).mode&0o077)!==0)throw Error('输出目录必须为0700');return root;
}
function createPublicContextWatcher({outputDir,intervalMs=15*60000,symbol,sectorCode,historyDays=120,maxConsecutiveFailures=5,capture=capturePublicContext,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,onStatus=record=>process.stdout.write(JSON.stringify(record)+'\n')}={}){
 if(!Number.isSafeInteger(intervalMs)||intervalMs<60000||intervalMs>86400000||!Number.isSafeInteger(maxConsecutiveFailures)||maxConsecutiveFailures<1||maxConsecutiveFailures>20)throw Error('间隔须为60秒至24小时，失败上限须为1至20');
 if(symbol!==undefined&&!/^(?:60|68|00|30|43|83|87|88|92)\d{4}$/.test(symbol)||sectorCode!==undefined&&!/^BK\d{4}$/.test(sectorCode)||!Number.isSafeInteger(historyDays)||historyDays<1||historyDays>120)throw Error('股票、板块或历史长度无效');
 const root=privateRoot(outputDir),logFile=path.join(root,'public-context-watch.jsonl'),options={historyDays,...(symbol?{symbol}:{}),...(sectorCode?{sectorCode}:{})};
 let running=false,timer=null,inFlight=null,attempts=0,failures=0,nextDelayMs=intervalMs,last=null,halted=false;
 function emit(record){
  // Opening without following links protects an existing private log, too.
  const fd=fs.openSync(logFile,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_APPEND|(fs.constants.O_NOFOLLOW||0),0o600);
  try{const st=fs.fstatSync(fd);if(!st.isFile()||(st.mode&0o077)!==0||st.size>8*1024*1024)throw Error('私有状态日志类型、权限或8MiB上限无效');fs.writeSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  onStatus(record);
 }
 function status(){return {running,inFlight:!!inFlight,attempts,consecutiveFailures:failures,nextDelayMs:running?nextDelayMs:null,halted,last,logFile};}
 function runOnce(){
  if(inFlight)return Promise.reject(Error('上下文采集仍在进行，禁止重叠请求'));
  if(halted)return Promise.reject(Error('连续失败已达上限；需明确重启采集器'));
  const startedAt=now();attempts++;
  inFlight=(async()=>{
   let result=null,error=null,missing=[];
   try{
    result=await capture(root,options,{now});const report=result?.report;
    if(!report||report.canTrade!==false)throw Error('采集器未返回研究上下文');
    if(report.marketFlow?.status!=='observed-unverified')missing.push('marketFlow');
    if(report.limitPools?.complete!==true)missing.push('limitPools');
    if(symbol&&report.stockFlow?.status!=='observed-unverified')missing.push('stockFlow');
    if(sectorCode&&report.sectorFlow?.status!=='observed-unverified')missing.push('sectorFlow');
   }catch(e){error=String(e.message||e).slice(0,240);}
   const complete=!error&&!missing.length;failures=complete?0:failures+1;
   nextDelayMs=Math.min(86400000,intervalMs*2**Math.min(failures,16));
   if(failures>=maxConsecutiveFailures){halted=true;running=false;}
   last={schemaVersion:1,type:'public-context-capture',status:error?'failed':complete?'complete':'partial',startedAt,finishedAt:now(),attempt:attempts,consecutiveFailures:failures,maxConsecutiveFailures,halted,nextDelayMs:running?nextDelayMs:null,
    requestedDate:result?.report?.requestedDate||null,tradeDate:result?.report?.tradeDate||null,artifact:result?.file||null,artifactHash:result?.hash||null,missing,error,sourceErrors:result?.report?.errors||[],sourceTimestamp:null,canTrade:false,canNotify:false,modelsChanged:false,ordersChanged:false};
   try{emit(last);}catch(e){halted=true;running=false;throw e;}
   return last;
  })().finally(()=>{inFlight=null;});
  return inFlight;
 }
 async function tick(){
  try{await runOnce();}catch(e){halted=true;running=false;onStatus({type:'public-context-watch-error',error:String(e.message||e).slice(0,240),canTrade:false});}
  if(running)timer=setTimer(()=>{timer=null;void tick();},nextDelayMs);
 }
 async function start(){if(running||inFlight)throw Error('采集器已经运行');if(halted)throw Error('采集器已因连续失败停止');running=true;await tick();return status();}
 async function stop(){running=false;if(timer!==null){clearTimer(timer);timer=null;}if(inFlight)await inFlight;return status();}
 return {runOnce,start,stop,status};
}
function parseArgs(args){
 const mode=args.shift()||'once';if(!['once','watch'].includes(mode))throw Error('模式须为once或watch');
 const allowed=new Set(['--output-dir','--interval-seconds','--symbol','--sector','--history-days','--max-failures']),values={};
 for(let i=0;i<args.length;i+=2){if(!allowed.has(args[i])||!args[i+1]||Object.hasOwn(values,args[i]))throw Error('无效、重复或缺失CLI参数');values[args[i]]=args[i+1];}
 return {mode,config:{outputDir:values['--output-dir'],...(values['--interval-seconds']?{intervalMs:Number(values['--interval-seconds'])*1000}:{}),...(values['--symbol']?{symbol:values['--symbol']}:{}),...(values['--sector']?{sectorCode:values['--sector']}:{}),...(values['--history-days']?{historyDays:Number(values['--history-days'])}:{}),...(values['--max-failures']?{maxConsecutiveFailures:Number(values['--max-failures'])}:{})}};
}
if(require.main===module){
 let watcher;const shutdown=()=>{if(watcher)void watcher.stop().catch(e=>{process.stderr.write(String(e.message||e)+'\n');process.exitCode=1;});};
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
 Promise.resolve().then(async()=>{const {mode,config}=parseArgs(process.argv.slice(2));watcher=createPublicContextWatcher(config);if(mode==='watch')await watcher.start();else{const result=await watcher.runOnce();if(result.status!=='complete')process.exitCode=2;}}).catch(e=>{process.stderr.write(JSON.stringify({error:String(e.message||e),canTrade:false})+'\n');process.exitCode=1;}).finally(()=>{if(watcher&&!watcher.status().running){process.removeListener('SIGTERM',shutdown);process.removeListener('SIGINT',shutdown);}});
}
module.exports={createPublicContextWatcher,parseArgs};
