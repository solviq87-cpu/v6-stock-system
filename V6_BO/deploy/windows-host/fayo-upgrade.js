#!/usr/bin/env node
'use strict';
// A pinned, single-installation orchestration entry. Authority stays in the
// existing updater: CI, cold backup, rehearsal, private-state checks and rollback.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const runtime=require('./host-runtime');
const updater=require('./safe-updater');
const {readPublic}=require('./fayo-network');
const {ensureModelPython}=require('./fayo-model-tools');
const SHA=/^[a-f0-9]{40}$/;
function fail(code){throw Object.assign(Error(code),{code});}
function parseArgs(args){
 if(args.length!==4||args[0]!=='--expected-sha'||!SHA.test(args[1])||args[2]!=='--installation-name'||!/^\.tian-shu-[a-z0-9-]{1,60}$/.test(args[3]))fail('entry-usage');
 return {expectedSha:args[1],installationName:args[3]};
}
async function upgrade(options,deps={}){
 if(!SHA.test(options.expectedSha)||!/^\.tian-shu-[a-z0-9-]{1,60}$/.test(options.installationName))fail('entry-usage');
 const home=deps.home||os.homedir(),root=path.join(home,options.installationName);
 const host=deps.runtime||runtime,updates=deps.updater||updater,progress=deps.progress||(()=>{});
 progress('checking');
 // No initialization or alternative-directory fallback: this must be the
 // previously selected existing installation, including all its private data.
 if(!fs.existsSync(path.join(root,'installation.json')))fail('existing-installation-not-found');
 host.safeStartup(root);
 const before=await host.checkHost({root});
 if(!['running','stopped'].includes(before.code)||before.code==='running'&&!before.health)fail('installed-host-not-ready');
 const discover=async installed=>{const candidate=await updates.discover(installed,{fetchImpl:readPublic});if(candidate.sha!==options.expectedSha)fail('entry-target-changed');return candidate;};
 const candidate=await discover(before.sourceSha);
 progress('validating');
 let first=true;
 const previousPython=process.env.V6_MODEL_PYTHON;
 const modelPython=candidate.changed?await (deps.prepareModelTools||ensureModelPython)({home,env:process.env}):previousPython;
 let result;
 try {
 if(modelPython)process.env.V6_MODEL_PYTHON=modelPython;
 result=await updates.update({root,action:'apply',approveSensitive:options.expectedSha},{
  runtime:host,
  discover:async installed=>{if(first){first=false;return candidate;}return discover(installed);},
  step:async phase=>{if(phase==='stopped')progress('backing-up');if(phase==='before-switch')progress('switching');}
 });
 } finally {if(previousPython===undefined)delete process.env.V6_MODEL_PYTHON;else process.env.V6_MODEL_PYTHON=previousPython;}
 if(!['local-update-installed','no-update'].includes(result.code))return result;
 // Starting the research service is part of the named user action. Never
 // enable paper accounts, send credentials, change passwords or configure VPN.
 host.safeStartup(root);
 let status=await host.checkHost({root});
 if(status.code==='running'&&status.mode==='smoke'){await host.stop({root});status=await host.checkHost({root});}
 progress('starting');
 if(status.code!=='running')await host.start({root,smoke:false});
 const after=await host.checkHost({root});
 if(after.code!=='running'||!after.health||after.sourceSha!==options.expectedSha||after.mode==='smoke')fail('entry-start-not-ready');
 return {code:'fayo-ready',sourceSha:after.sourceSha,backupVerified:result.backupVerified===true,alreadyCurrent:result.code==='no-update',phoneConnected:false};
}
const messages={checking:'1/4 检查原安装，保留原账户和历史。',validating:'2/4 核对正式版本与CI，自动进行隔离验证。可能需要几分钟，请保持窗口打开。','backing-up':'3/4 正在停服备份，并验证备份可以恢复。',switching:'3/4 正在切换已验证的新版本。',starting:'4/4 正在启动绯曜。'};
if(require.main===module){
 process.umask(0o077);
 upgrade(parseArgs(process.argv.slice(2)),{progress:stage=>console.log(messages[stage]||stage)}).then(result=>{
  if(result.code==='fayo-ready'){console.log('FAYO_READY');process.exitCode=0;}
  else{console.error('未完成升级：'+String(result.code||'unknown'));if(result.rollback)console.error('回退状态：'+String(result.rollback));process.exitCode=1;}
 }).catch(error=>{console.error('未完成升级：'+(/^[a-z][a-z0-9-]{1,70}$/.test(error.code||'')?error.code:'entry-failed'));process.exitCode=1;});
}
module.exports={upgrade,parseArgs};
