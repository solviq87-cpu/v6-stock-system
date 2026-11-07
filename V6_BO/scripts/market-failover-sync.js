#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createMarketFailover}=require('../src/core/market-failover');
const {atomicWrite}=require('../src/core/market-data-center');
const [configFile]=process.argv.slice(2);
try{
 if(!configFile)throw Error('用法: node scripts/market-failover-sync.js <配置.json>');
 const cfg=JSON.parse(fs.readFileSync(configFile,'utf8'));
 const center=createMarketFailover({...cfg,directory:path.resolve(cfg.directory)});
 if(!cfg.outputFile)throw Error('必须配置outputFile');
 const interval=cfg.intervalMs??0;if(!Number.isSafeInteger(interval)||interval<0||interval>0&&interval<60000)throw Error('轮询间隔至少60000毫秒');
 async function sync(){const result=await center.sync();if(result.reason==='busy')return;
  // A stale fallback is visible in status but must never advance a paper account.
  if(result.data&&!result.stale)atomicWrite(cfg.outputFile,JSON.stringify(result.data)+'\n');
  atomicWrite(cfg.outputFile+'.status.json',JSON.stringify(center.status(),null,2)+'\n');
  console.log(JSON.stringify(center.status()));if(!interval&&result.error)process.exitCode=1;
 }
 sync().then(()=>{if(interval)setInterval(()=>sync().catch(()=>console.error('同步写入失败')),interval);}).catch(e=>{console.error(e.message);process.exitCode=1;});
}catch(e){console.error(e.message);process.exitCode=2;}
