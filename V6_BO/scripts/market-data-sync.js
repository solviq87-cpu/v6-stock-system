#!/usr/bin/env node
'use strict';
const {createMarketDataCenter}=require('../src/core/market-data-center');
if(process.argv[2]==='--background-as-of'){
 try{
  const [root,provider,scope,asOf,...extra]=process.argv.slice(3);
  if(!root||!provider||!scope||!asOf||extra.length)throw Error('用法: --background-as-of <private-archive-root> <provider> <scope-json> <ISO时点>');
  const decisionAt=Date.parse(asOf);
  if(!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(asOf))throw Error('历史查询需要明确时区');
  console.log(JSON.stringify(require('../src/core/market-data-evidence').readBackgroundAsOf({root,provider,scope:JSON.parse(scope),decisionAt})));
 }catch(e){console.error('背景档案读取失败: '+e.message);process.exitCode=1;}
 return;
}
const [url,outputFile,provider,datasetId,secondaryFile,...extra]=process.argv.slice(2);
if(!url||!outputFile||!provider||!datasetId||extra.length){console.error('用法: node scripts/market-data-sync.js <https数据接口> <历史行情.json> <provider> <datasetId> [独立对照行情.json]');process.exit(2);}
let center;try{center=createMarketDataCenter({url,outputFile,provider,datasetId,secondaryFile});}catch(e){console.error(e.message);process.exit(2);}
const interval=Number(process.env.V6_MARKET_SYNC_INTERVAL_MS||0);
async function run(){const result=await center.sync();console.log(JSON.stringify({time:new Date().toISOString(),...result,status:center.status()}));if(result.error){if(!interval)process.exitCode=1;}else process.exitCode=0;}
run().then(()=>{if(interval){if(!Number.isSafeInteger(interval)||interval<60000){console.error('自动同步间隔至少60000毫秒');process.exitCode=2;return;}setInterval(run,interval);}});
