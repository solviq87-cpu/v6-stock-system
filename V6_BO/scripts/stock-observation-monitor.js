#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createStockObservationMonitor}=require('../src/core/stock-observation-monitor');
function loadConfig(file){
 if(typeof file!=='string'||!path.isAbsolute(file)||file.split(path.sep).some(s=>s.toLowerCase()==='public'))throw Error('需要私有绝对配置路径');
 let cursor=path.parse(file).root;for(const part of file.slice(cursor.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);if(fs.lstatSync(cursor).isSymbolicLink())throw Error('配置路径禁止符号链接');}
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));let config;
 try{const st=fs.fstatSync(fd);if(!st.isFile()||st.size>8192||st.mode&0o077)throw Error('配置文件需要私有权限且不超过8KiB');config=JSON.parse(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}
 if(config.schemaVersion!==1||config.mode!=='stock-observation-monitor'||config.canTrade!==false||!config.jobOptions)throw Error('观察配置协议无效');
 const roots=[config.queueRoot,config.jobOptions.observationRoot,config.jobOptions.memoryRoot];
 for(const p of roots)if(typeof p!=='string'||!path.isAbsolute(p)||p.split(path.sep).some(s=>s.toLowerCase()==='public'))throw Error('研究目录无效');
 if(roots.some((p,i)=>roots.some((q,j)=>i!==j&&(p===q||p.startsWith(q+path.sep)||q.startsWith(p+path.sep)))))throw Error('研究目录必须独立');
 return config;
}
async function main(args){
 const [mode,file,symbol]=args;if(!['once','watch','capture'].includes(mode)||args.length!==(mode==='capture'?3:2))throw Error('用法: stock-observation-monitor.js once|watch <私有配置> 或 capture <私有配置> <股票代码>');
 const config=loadConfig(file);
 if(mode==='capture'){
  const result=await require('../src/server/stock-observation-job').runStockObservationJob({symbol,provider:'auto',historyDays:120,includeContext:true},config.jobOptions);
  if(!result.ok)throw Error('股票采集失败');
  const r=result.result;return {status:r.status,symbol:r.stock?.symbol||symbol,source:r.history?.provider,asOf:r.asOf,observation:r.observation,memory:r.memory,
   calendar:r.calendar?.status,targetDate:r.analysis?.targetDate,currentFormation:r.currentFormation?.status,blockers:r.readiness?.blockers,researchOnly:true,canTrade:false};
 }
 const monitor=createStockObservationMonitor({...config,keepAlive:mode==='watch'});
 if(mode==='once')return monitor.runOnce();
 const stop=()=>{void monitor.stop().catch(()=>{process.exitCode=1;});};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);monitor.start();
 return {status:'watching-private-queue',researchOnly:true,canTrade:false};
}
if(require.main===module)main(process.argv.slice(2)).then(value=>{process.stdout.write(JSON.stringify(value)+'\n');if(value.status==='unavailable')process.exitCode=2;}).catch(()=>{process.stderr.write(JSON.stringify({status:'blocked-observation-config-or-intake',canTrade:false})+'\n');process.exitCode=1;});
module.exports={loadConfig,main};
