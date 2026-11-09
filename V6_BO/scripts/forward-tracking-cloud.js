#!/usr/bin/env node
'use strict';
// Cloud-side worker: source snapshots arrive from an independently authorized
// collector. It does not fetch paid/unauthorized data or generate signals.
const {readJson,runOnce}=require('../src/core/forward-tracking-store');
function parse(argv){
 const [mode,cohortFile,marketFile,stateFile,...rest]=argv;
 if(!['once','watch'].includes(mode)||!cohortFile||!marketFile||!stateFile||
    rest.length>2||rest.length===1||rest.length===2&&rest[0]!=='--interval')
  throw Error('用法: forward-tracking-cloud.js once|watch <已冻结信号.json> <同源日线快照.json> <持久归档绝对路径> [--interval 毫秒]');
 if(mode==='once'&&rest.length)throw Error('once 不能使用轮询参数');
 const interval=rest.length?Number(rest[1]):60000;
 if(!Number.isSafeInteger(interval)||interval<15000||interval>3600000)
  throw Error('轮询间隔必须在15000-3600000毫秒之间');
 return {mode,cohortFile,marketFile,stateFile,interval};
}
function execute(args){
 return runOnce({cohort:readJson(args.cohortFile),market:readJson(args.marketFile),
  stateFile:args.stateFile});
}
function main(argv){
 const args=parse(argv);
 if(args.mode==='once'){
  const result=execute(args);process.stdout.write(JSON.stringify(result)+'\n');
  return;
 }
 let running=false,closing=false;
 const tick=()=>{
  if(running||closing)return;
  running=true;
  try{process.stdout.write(JSON.stringify(execute(args))+'\n');}
  catch(error){process.stderr.write(JSON.stringify({ok:false,error:String(error.message).slice(0,250)})+'\n');}
  finally{running=false;}
 };
 tick();
 const timer=setInterval(tick,args.interval);
 const close=()=>{closing=true;clearInterval(timer);process.exitCode=0;};
 process.once('SIGTERM',close);process.once('SIGINT',close);
}
if(require.main===module){try{main(process.argv.slice(2));}catch(error){
 process.stderr.write(JSON.stringify({ok:false,error:String(error.message).slice(0,250)})+'\n');
 process.exitCode=1;}}
module.exports={parse,execute};
