#!/usr/bin/env node
'use strict';
/**
 * Research-only one-shot replay:
 * node scripts/run-six-linkages.js /absolute/path/snapshot.json /absolute/path/research-output
 * Automatic schedule (cron / cloud worker) is external and must be separately deployed.
 */
const fs=require('node:fs'),path=require('node:path');
const {createSixLinkageRunner}=require('../src/core/six-linkage-research-runner');
function main(args=process.argv.slice(2)){
 if(args.length!==2||!args.every(x=>path.isAbsolute(x))){
  throw Error('用法: node scripts/run-six-linkages.js <绝对路径snapshot.json> <绝对路径研究输出目录>');
 }
 const f=args[0],st=fs.statSync(f);
 if(!st.isFile()||st.size>16*1024*1024||st.size<=0)throw Error('研究快照不是有效的16MB以内文件');
 const input=JSON.parse(fs.readFileSync(f,'utf8'));
 const report=createSixLinkageRunner({outputDir:args[1]}).runOnce(input);
 // Do not print user portfolio contents, credentials or private bot channels.
 return {mode:report.mode,revision:report.revision,asOfMs:report.asOfMs,scanTotal:report.scanTotal,
  newSignals:report.newSignals,recordedSignals:report.recordedSignals,
  outcomeMetrics:report.outcomeMetrics,canTrade:false,canNotify:false,
  note:'离线研究文件已写入；不代表自动全市场扫描、实时持仓盯盘或手机消息已部署'};
}
if(require.main===module){try{console.log(JSON.stringify(main(),null,2));}catch(e){console.error(String(e.message||e));process.exitCode=1;}}
module.exports={main};
