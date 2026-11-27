#!/usr/bin/env node
'use strict';
const path=require('node:path');
const {collectEiaSpotDaily}=require('../src/core/eia-spot-daily');
async function main(args){
 if(args.length!==4||!path.isAbsolute(args[3]))throw Error('用法: collect-eia-spot.js <RWTC|RBRTE> <YYYY-MM-DD> <YYYY-MM-DD> <私有绝对存证目录>');
 const [series,start,end,archiveRoot]=args;
 const r=await collectEiaSpotDaily({series,start,end,archiveRoot,apiKey:process.env.V6_EIA_API_KEY});
 console.log(JSON.stringify({provider:r.provider,series:r.series,coverage:r.coverage,archiveReceipt:r.archiveReceipt,canTrade:false}));
}
if(require.main===module)main(process.argv.slice(2)).catch(()=>{console.error('EIA采集失败：请检查密钥、来源授权、查询范围和私有存证目录。');process.exitCode=1;});
module.exports={main};
