#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {fetchEastmoneyHistory}=require('../src/core/eastmoney-historical-feed');
if(require.main===module)(async()=>{try{
 const args=process.argv.slice(2);if(args.length!==4&&!(args.length===5&&args[4]==='--unadjusted'))throw Error('用法: node scripts/eastmoney-historical-import.js <000001,600000> <YYYY-MM-DD起> <YYYY-MM-DD止> <新输出文件.json> [--unadjusted]');
 const [symbols,start,end,file]=args;
 const output=path.resolve(file);
 if(fs.existsSync(output))throw Error('行情文件已存在，拒绝覆盖原始历史');
 const r=await fetchEastmoneyHistory({symbols:symbols.split(','),start,end,adjustmentMode:args[4]==='--unadjusted'?'unadjusted':'qfq'});
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(r.dataset,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({file:output,...r.metadata}));
 }catch(e){console.error(e.message);process.exitCode=1;}})();
