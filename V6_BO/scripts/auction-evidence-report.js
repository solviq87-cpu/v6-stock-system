#!/usr/bin/env node
'use strict';
// Offline input-only auction research. Never requests a feed, places an order,
// modifies a watchlist, sends Feishu or persists a private account.
const fs=require('node:fs'),path=require('node:path');
const {evaluateAuctionBatch}=require('../src/strategy/auction-evidence-rules');
function run(argv){
 if(!Array.isArray(argv)||argv.length!==1||!path.isAbsolute(argv[0]))
  throw Error('用法: node scripts/auction-evidence-report.js /安全路径/竞价历史.json');
 const st=fs.lstatSync(argv[0]);
 if(!st.isFile()||st.isSymbolicLink()||st.size<=0||st.size>3*1024*1024)
  throw Error('竞价输入文件不安全或超过3MB');
 const report=evaluateAuctionBatch(JSON.parse(fs.readFileSync(argv[0],'utf8')));
 return report;
}
if(require.main===module){
 try{process.stdout.write(JSON.stringify(run(process.argv.slice(2)),null,2)+'\n');}
 catch(e){process.stderr.write('竞价研究无法评估：'+String(e.message||e).slice(0,130)+'\n');process.exitCode=1;}
}
module.exports={run};
