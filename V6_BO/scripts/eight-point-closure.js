#!/usr/bin/env node
'use strict';
/** Local-only one-run entrypoint. No network, account writes or deployments. */
const fs=require('node:fs'),path=require('node:path');
const {runCompleteWorkbench}=require('../src/core/complete-workbench');
function readPrivateJson(filename){
 if(typeof filename!=='string'||!filename.trim())throw Error('需要本地输入JSON文件');
 const file=path.resolve(filename),info=fs.lstatSync(file);
 if(!info.isFile()||info.isSymbolicLink()||info.size<1||info.size>30*1024*1024)
  throw Error('输入必须为小于30MB的本地普通文件，禁止软链接');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
function run(argv){
 if(argv.length!==1)throw Error('用法: node scripts/eight-point-closure.js <本机研究输入.json>');
 const input=readPrivateJson(argv[0]),payload=input?.history?input:{history:input};
 if(payload.manualHoldings||payload.holdingWatchFile||payload.token||
  payload.apiKey||payload.brokerAccount)throw Error('研究离线报告不得上传私有持仓、令牌或券商资料');
 const report=runCompleteWorkbench(payload);
 return report.eightPointFlow;
}
if(require.main===module){
 try{process.stdout.write(JSON.stringify(run(process.argv.slice(2)),null,2)+'\n');}
 catch(e){console.error('八项研究流程校验失败：'+String(e.message||e).slice(0,180));process.exitCode=1;}
}
module.exports={run,readPrivateJson};
