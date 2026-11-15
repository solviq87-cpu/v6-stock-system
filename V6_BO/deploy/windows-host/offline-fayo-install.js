'use strict';
// Explicit one-off deployment of an already downloaded, byte-pinned release.
// This is not the network auto-updater and does not change its live CI gates.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const host=require('./host-runtime'),updater=require('./safe-updater');
const PLAN=Object.freeze({sourceSha:'cd3ad68268941d26cff0b6a22fed5e005c24f252',allowedInstalledSha:'0f192dbee7f9f2d738d45089725921eee3bb7380',sumsHash:'85b46204f75c8879a04f625b4b8f698d908ecb7f067435e4bd6d47be1aeb3fbf',manifestHash:'c165647f01ac7960997e4ebb3e584273d8a33c59ea10455daf8fda8784857356',tests:4053,ciUrls:['https://github.com/solviq87-cpu/v6-stock-system/actions/runs/43721268436','https://github.com/solviq87-cpu/v6-stock-system/actions/runs/43721268400']});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(code){throw Object.assign(Error(code),{code});}
function read(file,max=64*1024*1024){const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const s=fs.fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.size>max)fail('offline-file-invalid');return fs.readFileSync(fd);}finally{fs.closeSync(fd);}}
function verify(bundle,plan=PLAN){
 const sums=read(path.join(bundle,'SHA256SUMS.txt'),2*1024*1024);if(hash(sums)!==plan.sumsHash||hash(read(path.join(bundle,'manifest.json'),2*1024*1024))!==plan.manifestHash)fail('offline-package-not-approved');
 for(const line of sums.toString().trim().split('\n')){const m=/^([a-f0-9]{64})  ([^\r\n]+)$/.exec(line);if(!m||m[2].includes('\\')||m[2].startsWith('/')||m[2].split('/').some(p=>!p||p==='.'||p==='..'))fail('offline-manifest-invalid');if(hash(read(path.join(bundle,m[2])))!==m[1])fail('offline-package-changed');}
 const result=host.verifyBundle(bundle);if(result.manifest.sourceSha!==plan.sourceSha)fail('offline-package-wrong-version');return result;
}
async function install({bundle,root},deps={}){
 const plan=deps.plan||PLAN,runtime=deps.runtime||host,updates=deps.updater||updater,progress=deps.progress||(()=>{});
 const approved=verify(bundle,plan);runtime.safeStartup(root);const before=await runtime.checkHost({root});
 if(![plan.allowedInstalledSha,plan.sourceSha].includes(before.sourceSha))fail('offline-installed-version-unexpected');
 const discover=async installed=>{verify(bundle,plan);if(![plan.allowedInstalledSha,plan.sourceSha].includes(installed))fail('offline-installed-version-unexpected');return{sha:plan.sourceSha,changed:installed!==plan.sourceSha,files:approved.manifest.files.map(f=>'V6_BO/'+f.path),ciUrls:plan.ciUrls};};
 progress('正在核对本地完整包，不会下载代码或Python工具。');
 const result=await updates.update({root,action:'apply',approveSensitive:plan.sourceSha},{runtime,discover,prepare:async(candidate,work)=>{
  verify(bundle,plan);const staging=path.join(work,'offline-smoke');await host.initialize({root:staging,bundle});const port=deps.stagingPort||18787;
  try{await host.start({root:staging,smoke:true},{port});await updater.installedAssets(staging,candidate);}finally{await host.stop({root:staging});}
  return{bundle,manifest:approved.manifest,packageHash:plan.sumsHash,tests:plan.tests,skipped:0};
 },step:async stage=>{if(stage==='stopped')progress('正在完整备份原安装并验证恢复。');if(stage==='before-switch')progress('正在保留原账户，替换为绯曜程序。');}});
 if(!['local-update-installed','no-update'].includes(result.code))return result;
 let state=await runtime.checkHost({root});if(state.code==='running'&&state.mode==='smoke'){await runtime.stop({root});state=await runtime.checkHost({root});}
 if(state.code!=='running')await runtime.start({root,smoke:false});const after=await runtime.checkHost({root});if(after.code!=='running'||!after.health||after.sourceSha!==plan.sourceSha)fail('offline-start-not-ready');
 return{...result,code:'fayo-offline-ready',sourceSha:after.sourceSha,offline:true,phoneConnected:false};
}
if(require.main===module){process.umask(0o077);const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--bundle'||args[2]!=='--home'){console.error('offline-usage');process.exitCode=1;}else install({bundle:args[1],root:args[3]},{progress:m=>console.log(m)}).then(r=>{console.log(r.code);if(r.code!=='fayo-offline-ready')process.exitCode=1;}).catch(e=>{console.error(/^[a-z][a-z0-9-]{1,70}$/.test(e.code||'')?e.code:'offline-install-failed');process.exitCode=1;});}
module.exports={install,verify,PLAN};
