#!/usr/bin/env node
'use strict';
// Unified release gate: evidence presence is NOT production acceptance.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
function runGate(opts={}){
 const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
 const ledger=JSON.parse(read('docs/V6_52项统一验收台账.json'));
 const ids=ledger.tasks.map(t=>t.id);
 const duplicateIds=ids.filter((id,i)=>ids.indexOf(id)!==i);
 const required=['server.js','package.json','docs/V6_唯一统一总任务大纲.md','docs/V6_52项统一验收台账.json','scripts/unified-strategy-project.js','scripts/python-native-evidence.js','scripts/native-strategy-daily.js','scripts/market-data-sync.js'];
 const missingFiles=required.filter(p=>!fs.existsSync(path.join(root,p)));
 const main=read('docs/V6_唯一统一总任务大纲.md');
 const masterIds=[...main.matchAll(/^\|\s*([A-F]\d{2})\s*\|/gm)].map(m=>m[1]);
 const duplicateMasterIds=masterIds.filter((id,i)=>masterIds.indexOf(id)!==i);
 const evidence=ledger.tasks.map(t=>({id:t.id,accepted:t.accepted===true,task:t.task}));
 const blockers=[
  {id:'EXT-MARKET',reason:'真实 A 股供应商授权、行情连通及历史数据核对尚无本次外部验收凭据'},
  {id:'EXT-PYTHON',reason:'原始 Python 三轮策略程序与逐日输出尚无本次原生执行验收凭据'},
  {id:'EXT-DEVICE',reason:'电脑与手机真机端到端、生产 HTTPS 和多人并发尚无本次验收凭据'},
  {id:'EXT-RECOVERY',reason:'生产备份恢复、设备撤权及短信 OTP 供应商尚无本次验收凭据'}
 ];
 const accepted=evidence.filter(t=>t.accepted).length;
 const report={schema:1,kind:'V6-unified-acceptance-gate',baseline:'batch64',inventory:{mainTaskCount:masterIds.length,featureTaskCount:ids.length,acceptedFeatureTasks:accepted},checks:{requiredFilesPresent:missingFiles.length===0,featureLedgerCount:ids.length===52,featureIdsUnique:duplicateIds.length===0,mainTaskCount:masterIds.length===24,mainIdsUnique:duplicateMasterIds.length===0},missingFiles,duplicateIds,duplicateMasterIds,externalBlockers:blockers,releaseReady:false,note:'自动化静态门禁只验证结构与记录，不能证明真实行情、策略盈利、生产安全或真机验收'};
 report.structurePassed=Object.values(report.checks).every(Boolean);
 if(opts.strict)report.exitCode=report.structurePassed&&report.releaseReady?0:2;
 return report;
}
if(require.main===module){
 const args=process.argv.slice(2);if(args.some(a=>!['--strict','--json'].includes(a))){console.error('usage: node scripts/unified-acceptance-gate.js [--strict] [--json]');process.exit(64)}
 const result=runGate({strict:args.includes('--strict')});console.log(JSON.stringify(result,null,2));process.exit(result.exitCode??(result.structurePassed?0:1));
}
module.exports={runGate};
