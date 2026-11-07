#!/usr/bin/env node
'use strict';
/** Release-preflight checks code layout and reproducible local execution, never self-signs production acceptance. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {runGate}=require('./unified-acceptance-gate');
const {makeOperations}=require('../src/core/continuous-research-ops');
const root=path.resolve(__dirname,'..');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const streams=[
 {id:'01-market',name:'行情与多源数据治理',files:['src/core/market-data-center.js','src/core/market-data-quality.js','src/core/market-feed-consensus.js','src/core/eastmoney-historical-feed.js'],external:'行情供应商授权、真实联网、除权除息和交易日历核验'},
 {id:'02-strategies',name:'四策略逐日原生执行',files:['src/core/native-strategy-daily-runner.js','src/core/python-native-bridge.js','myrules.js','bazi.js'],external:'原始 Python 三轮策略程序及真实同日因子'},
 {id:'03-backtest',name:'专业历史回测',files:['src/core/historical-validation.js','src/core/strategy-evidence-replay.js','src/core/strategy-portfolio-lab.js'],external:'真实历史样本与交易可成交性复核'},
 {id:'04-arena',name:'策略竞技场与失效监控',files:['src/core/independent-strategy-attribution.js','src/core/strategy-health-monitor.js'],external:'预先指定样本外窗口及足量真实交易样本'},
 {id:'05-paper',name:'持续模拟账户',files:['src/core/paper-session.js','src/core/paper-monitor.js','src/core/continuous-research-ops.js'],external:'多交易日连续值守及模拟成交对账'},
 {id:'06-risk',name:'风控与交易约束',files:['src/core/research-risk-gate.js','src/core/strategy-portfolio-lab.js'],external:'异常行情、资金、公司行为的生产风险演练'},
 {id:'07-auth',name:'账户与设备安全',files:['server.js','src/server/bootstrap.js'],external:'真实账户、设备撤权、权限边界及安全复核'},
 {id:'08-http',name:'HTTP与云端稳定性',files:['src/core/continuous-research-ops.js','server.js'],external:'生产 HTTPS、并发、断网、凭证轮换与可用性压测'},
 {id:'09-recovery',name:'灾备与恢复',files:['scripts/disaster-recovery.js','tests/disaster-recovery.test.js'],external:'独立主机与生产数据恢复演练'},
 {id:'10-ui',name:'电脑手机统一界面',files:['src/core/paper-monitor.js','src/core/continuous-research-ops.js'],external:'真实 iOS/Android 与桌面浏览器人工验收'},
 {id:'11-release',name:'工程部署与自动验收',files:['scripts/unified-acceptance-gate.js','scripts/integrated-run-bundle.js','scripts/v6-release-preflight.js'],external:'外部签署的最终上线验收证据'}
];
function runPreflight({historyPath,outputRoot,snapshotsPath,evidencePath}={}){
 const gate=runGate();const items=streams.map(s=>{
  const found=s.files.map(p=>({path:p,exists:fs.existsSync(path.join(root,p))}));
  return {id:s.id,name:s.name,codeFilesPresent:found.every(x=>x.exists),files:found,codeEvidenceSha256:found.every(x=>x.exists)?sha(Buffer.concat(s.files.map(p=>fs.readFileSync(path.join(root,p))))):null,
   productionAccepted:false,externalBlocker:s.external};
 });
 let runtime=null;
 if(historyPath||outputRoot){if(!historyPath||!outputRoot)throw Error('离线实测需要同时提供 historyPath 和 outputRoot');
  const controller=makeOperations({historyPath,outputRoot,snapshotsPath,evidencePath});const outcome=controller.runOnce();
  runtime=outcome.error?{verified:false,error:outcome.error}:{verified:true,runId:outcome.summary.runId,source:outcome.summary.source,asOf:outcome.summary.asOf,
    archiveReplay:outcome.summary.replayed,canTrade:false};
 }
 return {schemaVersion:1,mode:'V6-unified-release-preflight',generatedAt:new Date().toISOString(),nodeVersion:process.version,
  platform:process.platform,staticAcceptance:gate.checks,structurePassed:gate.structurePassed,
  workstreams:items,workstreamsWithCodeEvidence:items.filter(x=>x.codeFilesPresent).length,
  offlineRuntime:runtime,codeChecksPassed:gate.structurePassed&&items.every(x=>x.codeFilesPresent)&&(!runtime||runtime.verified),
  productionReady:false,canTrade:false,
  warnings:['源码存在、离线回归和运行档案可重放，不等于十一大工程生产验收完成',
   '真实行情授权、原始Python三轮程序、长期模拟盘、真实设备、生产安全与灾备演练仍需外部条件和证据']};
}
function parse(argv){const out={};const keys={'--history':'historyPath','--out':'outputRoot','--snapshots':'snapshotsPath','--evidence':'evidencePath'};
 for(let i=0;i<argv.length;i++){
  if(argv[i]==='--strict'||argv[i]==='--json'){if(out[argv[i]])throw Error('重复参数: '+argv[i]);out[argv[i]]=true;continue;}
  const k=keys[argv[i]];if(!k||!argv[i+1]||argv[i+1].startsWith('--')||out[k])throw Error('未知或缺失的验收参数: '+argv[i]);out[k]=path.resolve(argv[++i]);
 }
 return out;
}
if(require.main===module){try{const args=parse(process.argv.slice(2)),result=runPreflight(args);console.log(JSON.stringify(result,null,2));if(args['--strict'])process.exitCode=result.productionReady?0:2;else if(!result.codeChecksPassed)process.exitCode=1;}catch(err){console.error(err.message);process.exitCode=1;}}
module.exports={runPreflight,parse};
