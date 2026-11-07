#!/usr/bin/env node
'use strict';
// Eleven-workstream evidence inventory. Never equate code presence with production signoff.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const STREAMS=Object.freeze([
 ['MARKET','真实A股行情与数据治理'],['STRATEGY','四套原生策略逐日执行'],
 ['BACKTEST','专业回测'],['ARENA','策略竞技场'],['PAPER','持续模拟盘'],
 ['RISK','风险控制'],['AUTH','账户与设备安全'],['HTTP','HTTP及云端稳定性'],
 ['BACKUP','数据灾备'],['UI','电脑手机产品化'],['RELEASE','自动验收与一键交付']
]);
const REQUIRED=Object.freeze({
 MARKET:['provider-authorization','live-data-crosscheck'],
 STRATEGY:['original-python-three-rounds','four-strategy-native-replay'],
 BACKTEST:['real-history-walkforward','execution-cost-verification'],
 ARENA:['out-of-sample-strategy-comparison'],
 PAPER:['multi-day-account-reconciliation'],
 RISK:['risk-limits-integration'],
 AUTH:['device-revocation-integration','sms-otp-provider-verification'],
 HTTP:['https-deployment','concurrent-security-test'],
 BACKUP:['restore-drill'],
 UI:['desktop-browser-e2e','mobile-device-e2e'],
 RELEASE:['clean-install-startup','full-regression']
});
function sha256(data){return crypto.createHash('sha256').update(data).digest('hex')}
function inspectEvidence(manifest,options={}){
 const base=path.resolve(options.evidenceDir||path.join(ROOT,'acceptance-evidence'));
 const errors=[];
 const entries=manifest&&Array.isArray(manifest.entries)?manifest.entries:[];
 const used=new Set();
 const checked=[];
 for(const entry of entries){
  if(!entry||typeof entry!=='object'){errors.push('invalid evidence entry');continue}
  const {workstream,requirement,file,sha256:hash,verifiedAt,verdict}=entry;
  const key=`${workstream}:${requirement}`;
  if(used.has(key)){errors.push(`duplicate evidence: ${key}`);continue}
  used.add(key);
  if(!Object.hasOwn(REQUIRED,workstream)||!REQUIRED[workstream].includes(requirement)){
   errors.push(`unknown evidence requirement: ${key}`);continue;
  }
  if(verdict!=='pass'){errors.push(`nonpassing evidence: ${key}`);continue}
  if(typeof verifiedAt!=='string'||!/^\d{4}-\d\d-\d\dT/.test(verifiedAt)||!Number.isFinite(Date.parse(verifiedAt))){errors.push(`invalid verifiedAt: ${key}`);continue}
  if(typeof file!=='string'||!file||path.isAbsolute(file)||file.split(/[\\/]/).some(x=>x==='..'||x==='.')||file.includes('\0')){errors.push(`unsafe evidence path: ${key}`);continue}
  const target=path.resolve(base,file);
  if(!target.startsWith(base+path.sep)){errors.push(`unsafe evidence path: ${key}`);continue}
  let real;
  try{real=fs.realpathSync(target)}catch{errors.push(`missing evidence: ${key}`);continue}
  if(!real.startsWith(base+path.sep)){errors.push(`symlink escapes evidence directory: ${key}`);continue}
  const stat=fs.statSync(real);
  if(!stat.isFile()||stat.size===0||stat.size>10*1024*1024){errors.push(`invalid evidence file: ${key}`);continue}
  if(typeof hash!=='string'||!/^([a-f0-9]{64})$/.test(hash)||sha256(fs.readFileSync(real))!==hash){errors.push(`hash mismatch: ${key}`);continue}
  checked.push(key);
 }
 const verified=new Set(checked);
 const workstreams=STREAMS.map(([id,name])=>{
  const requirements=REQUIRED[id].map(requirement=>({requirement,verified:verified.has(`${id}:${requirement}`)}));
  return {id,name,requirements,accepted:requirements.every(r=>r.verified)};
 });
 return {schema:1,workstreams,acceptedWorkstreams:workstreams.filter(s=>s.accepted).length,requiredEvidenceCount:Object.values(REQUIRED).flat().length,verifiedEvidenceCount:checked.length,errors,releaseReady:errors.length===0&&workstreams.every(s=>s.accepted)};
}
function loadAndInspect(manifestPath,options={}){
 if(!manifestPath)return inspectEvidence({entries:[]},options);
 return inspectEvidence(JSON.parse(fs.readFileSync(manifestPath,'utf8')),options);
}
if(require.main===module){
 const args=process.argv.slice(2);let manifestPath=null,evidenceDir=null,strict=false;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--manifest'&&args[i+1])manifestPath=args[++i];
  else if(args[i]==='--evidence-dir'&&args[i+1])evidenceDir=args[++i];
  else if(args[i]==='--strict')strict=true;
  else {console.error('usage: node scripts/workstream-evidence.js [--manifest FILE] [--evidence-dir DIR] [--strict]');process.exit(64)}
 }
 try{const r=loadAndInspect(manifestPath,{evidenceDir});console.log(JSON.stringify(r,null,2));process.exit(r.errors.length?1:(strict&&!r.releaseReady?2:0))}
 catch(e){console.error(`evidence verification failed: ${e.message}`);process.exit(1)}
}
module.exports={STREAMS,REQUIRED,sha256,inspectEvidence,loadAndInspect};
