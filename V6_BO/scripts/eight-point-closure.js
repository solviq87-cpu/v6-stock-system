#!/usr/bin/env node
'use strict';
/** Local-only one-run entrypoint. No network, account writes or deployments. */
const fs=require('node:fs'),path=require('node:path');
const {runCompleteWorkbench}=require('../src/core/complete-workbench');
const crypto=require('node:crypto');
const {readWatchJournal,commitWatchJournal}=require('../src/core/research-watch-journal');
function readPrivateJson(filename){
 if(typeof filename!=='string'||!filename.trim())throw Error('需要本地输入JSON文件');
 const file=path.resolve(filename),info=fs.lstatSync(file);
 if(!info.isFile()||info.isSymbolicLink()||info.size<1||info.size>30*1024*1024)
  throw Error('输入必须为小于30MB的本地普通文件，禁止软链接');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
function run(argv){
 if(argv.length!==1&&!(argv.length===3&&argv[1]==='--watch-state'))
  throw Error('用法: node scripts/eight-point-closure.js <本机研究输入.json> [--watch-state /private/watch.json]');
 const input=readPrivateJson(argv[0]),payload=input?.history?input:{history:input};
 if(payload.manualHoldings||payload.holdingWatchFile||payload.token||
  payload.apiKey||payload.brokerAccount||payload.holdings||payload.password)
  throw Error('研究离线报告不得上传私有持仓、令牌或券商资料');
 const statePath=argv.length===3?argv[2]:null;
 const previous=statePath?readWatchJournal(statePath):null;
 const report=runCompleteWorkbench(payload,
  {previousWatchStates:previous?.states||[]});
 const flow=report.eightPointFlow;
 if(statePath){
  if(payload.history?.source!=='imported'||!payload.history.provider||
     !payload.history.datasetId||flow.asOf!==payload.history.asOf||
     flow.dimensions.testing.marketDataReviewReady!==true||
     flow.dimensions.stock.status!=='historical-research-only')
   throw Error('本地跨日观察池需要来源明确、公司行为核对声明及同日的导入历史证据；本轮不保存');
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const saved=commitWatchJournal(statePath,{date:flow.asOf,inputFingerprint:fingerprint,
   states:flow.dimensions.stock.watchStates,expectedDigest:previous.digest});
  flow.dimensions.stock.journal={status:saved.reused?'same-day-reused':'local-private-saved',
   revision:saved.revision,date:saved.date,digest:saved.digest,
   sourceVerifiedExternally:false,canNotify:false};
  flow.dimensions.stock.notPersistedAcrossDates=false;
  flow.dimensions.stock.previousStateCount=previous.states.length;
  flow.dimensions.stock.watchStates=saved.states;
 }
 return flow;
}
if(require.main===module){
 try{process.stdout.write(JSON.stringify(run(process.argv.slice(2)),null,2)+'\n');}
 catch(e){console.error('八项研究流程校验失败：'+String(e.message||e).slice(0,180));process.exitCode=1;}
}
module.exports={run,readPrivateJson};
