#!/usr/bin/env node
'use strict';
/**
 * Run once, on the user's own machine. Never sends by default.
 * Enable only after confirming the destination belongs to the user.
 */
const path=require('node:path');
const {readManualHoldingWatchFile}=require('../src/core/manual-holding-risk-watch');
const {sendPrivateRiskSummary}=require('../src/core/private-risk-feishu-delivery');

async function run(argv,env=process.env,fetchImpl=globalThis.fetch){
 if(!Array.isArray(argv)||argv.length<2||argv.length>3||
   (argv.length===3&&argv[2]!=='--send'))
  throw Error('用法: node scripts/private-risk-notify.js /private/holdings.json /private/receipt.json [--send]');
 const stateFile=argv[1];
 if(!path.isAbsolute(argv[0])||!path.isAbsolute(stateFile))
  throw Error('请使用本机私有绝对路径');
 const report=readManualHoldingWatchFile(argv[0]);
 if(report.status!=='evaluated')throw Error('无法读取并核对本地私有持仓观察数据');
 const send=argv[2]==='--send';
 if(send&&env.V6_RISK_NOTIFY_CONSENT!=='YES')
  throw Error('未设置显式同意发送开关 V6_RISK_NOTIFY_CONSENT=YES');
 return sendPrivateRiskSummary({report,webhookUrl:env.V6_FEISHU_WEBHOOK,
  stateFile,fetchImpl,enableDelivery:send});
}
if(require.main===module){run(process.argv.slice(2)).then(x=>{
 console.log(JSON.stringify(x,null,2));
 if(['gateway-rejected','pending-unknown'].includes(x.status))process.exitCode=2;
}).catch(e=>{
 console.error('本机只读风险提醒：'+String(e.message||e).slice(0,150));
 process.exitCode=1;
});}
module.exports={run};
