#!/usr/bin/env node
'use strict';
const {createMarketDataCenter}=require('../src/core/market-data-center');
const [url,outputFile,provider,datasetId]=process.argv.slice(2);
if(!url||!outputFile||!provider||!datasetId){console.error('用法: node scripts/market-data-sync.js <https数据接口> <历史行情.json> <provider> <datasetId>');process.exit(2);}
let center;try{center=createMarketDataCenter({url,outputFile,provider,datasetId});}catch(e){console.error(e.message);process.exit(2);}
const interval=Number(process.env.V6_MARKET_SYNC_INTERVAL_MS||0);
async function run(){const result=await center.sync();console.log(JSON.stringify({time:new Date().toISOString(),...result,status:center.status()}));if(result.error){if(!interval)process.exitCode=1;}else process.exitCode=0;}
run().then(()=>{if(interval){if(!Number.isSafeInteger(interval)||interval<60000){console.error('自动同步间隔至少60000毫秒');process.exitCode=2;return;}setInterval(run,interval);}});
