#!/usr/bin/env node
'use strict';
/**
 * Local private risk observer. It does NOT fetch quotes, access a brokerage,
 * schedule cloud jobs, or send anything unless --send and consent are explicit.
 * The holdings JSON must be updated by an operator-authorized process.
 */
const fs=require('node:fs'),path=require('node:path');
const {run:runOnce}=require('./private-risk-notify');
function parse(argv){
 if(!Array.isArray(argv)||argv.length<2||argv.length>6)
  throw Error('用法: private-risk-monitor.js /private/holdings.json /private/receipt.json [--monitor] [--interval-ms 5000] [--send]');
 const [holdings,receipt,...flags]=argv;
 if(![holdings,receipt].every(p=>typeof p==='string'&&path.isAbsolute(p)&&p.length<=2048)||
    holdings===receipt)throw Error('持仓文件和去重文件必须为两个不同的本机绝对路径');
 let monitor=false,send=false,intervalMs=5000;
 const seen=new Set();
 for(let i=0;i<flags.length;i++){
  const flag=flags[i];
  if(seen.has(flag))throw Error('巡检参数重复');
  seen.add(flag);
  if(flag==='--monitor')monitor=true;
  else if(flag==='--send')send=true;
  else if(flag==='--interval-ms'){
   const text=flags[++i];
   if(!/^\d+$/.test(text||''))throw Error('巡检周期无效');
   intervalMs=Number(text);
  }else throw Error('巡检参数无效');
 }
 if(intervalMs<5000||intervalMs>60000||!Number.isSafeInteger(intervalMs)||
   (seen.has('--interval-ms')&&!monitor))throw Error('巡检间隔须为5至60秒且仅监控模式使用');
 return {holdings,receipt,monitor,send,intervalMs};
}
function createRiskMonitor(config,{run=runOnce,env=process.env}={}){
 if(!config||typeof run!=='function')throw Error('巡检运行器无效');
 let busy=false,closed=false;
 async function tick(){
  if(closed)return {mode:'private-risk-monitor',status:'stopped',canTrade:false,deliveredToDevice:false};
  if(busy)return {mode:'private-risk-monitor',status:'busy',canTrade:false,deliveredToDevice:false};
  busy=true;
  try{
   if(config.send&&env.V6_RISK_NOTIFY_CONSENT!=='YES')
    throw Error('未授权');
   const args=[config.holdings,config.receipt,...(config.send?['--send']:[])];
   const r=await run(args,env);
   // No holdings, stock symbols, URLs, credentials or raw errors in stdout.
   const statuses=new Set(['dry-run','no-actionable-risk','gateway-accepted',
    'gateway-rejected','pending-unknown','cooldown','daily-limit']);
   const status=String(r?.status||'');
   if(!statuses.has(status)&&!status.startsWith('deduplicated-'))
    throw Error('异常运行状态');
   return {mode:'private-risk-monitor',status,
    gatewayAccepted:r.gatewayAccepted===true,deliveredToDevice:false,
    canTrade:false,counts:({positions:r.counts?.positions??0,
     warning:r.counts?.warning??0,critical:r.counts?.critical??0,
     unknown:r.counts?.unknown??0})};
  }catch{return {mode:'private-risk-monitor',status:'input-or-gateway-error',
    gatewayAccepted:false,deliveredToDevice:false,canTrade:false};}
  finally{busy=false;}
 }
 return {tick,stop(){closed=true;}};
}
async function main(argv,{env=process.env,runner=runOnce}={}){
 const cfg=parse(argv);
 if(cfg.send&&env.V6_RISK_NOTIFY_CONSENT!=='YES')
  throw Error('发送需要 V6_RISK_NOTIFY_CONSENT=YES');
 const monitor=createRiskMonitor(cfg,{run:runner,env});
 if(!cfg.monitor)return monitor.tick();
 // One local poller per receipt ledger. A killed process leaves a lock requiring manual review.
 const lock=cfg.receipt+'.monitor.lock';
 if(fs.existsSync(lock)||fs.lstatSync(path.dirname(lock)).isSymbolicLink())
  throw Error('已存在监控实例或巡检路径不安全');
 const fd=fs.openSync(lock,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
 fs.writeSync(fd,String(process.pid));fs.closeSync(fd);
 let timer;
 function end(){
  monitor.stop();clearInterval(timer);
  try{fs.unlinkSync(lock);}catch{/* no auto-removal of unknown unrelated state */}
 }
 process.once('SIGINT',()=>{end();process.exit(0);});
 process.once('SIGTERM',()=>{end();process.exit(0);});
 const print=async()=>{const result=await monitor.tick();
  process.stdout.write(JSON.stringify(result)+'\n');};
 await print();
 timer=setInterval(print,cfg.intervalMs);
 return {mode:'private-risk-monitor',status:'running',canTrade:false,
  deliveredToDevice:false,stop:end};
}
if(require.main===module){main(process.argv.slice(2)).then(result=>{
 if(result?.status!=='running')console.log(JSON.stringify(result));
}).catch(()=>{console.error('本机私有风险巡检配置或监控锁无效');process.exitCode=1;});}
module.exports={parse,createRiskMonitor,main};
