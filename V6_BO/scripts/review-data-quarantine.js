#!/usr/bin/env node
'use strict';
/** Operator-only extension of the existing centre archive. Default: inspect
 * immutable bytes through the original gates, with zero writes and no network.
 * The apply branch binds the configured archive and the original config.json
 * to hashes from preflight. It never grants an account, execution or notification
 * permission. Do not expose this CLI as a client-controlled HTTP wrapper.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const H=require('../src/core/center-history');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const HASH=/^[a-f0-9]{64}$/;
function parse(argv){
 if(!Array.isArray(argv)||argv.length<2||!/^(?:60|68|00|30)\d{4}$/.test(argv[0])||!HASH.test(argv[1]))
  throw Error('用法: review-data-quarantine.js <代码> <原隔离归档哈希> [--apply-reviewed-replay --reviewer-id ID --reason 理由 --request-id ID --expected-scope-hash HASH --expected-config-hash HASH]');
 const out={code:argv[0],captureHash:argv[1],apply:false},seen=new Set();
 const fields={'--reviewer-id':'reviewerId','--reason':'reason','--request-id':'requestId',
  '--expected-scope-hash':'scopeHash','--expected-config-hash':'configHash'};
 for(let i=2;i<argv.length;i++){
  const key=argv[i];if(seen.has(key))throw Error('重复复核参数');seen.add(key);
  if(key==='--apply-reviewed-replay'){out.apply=true;continue;}
  if(!fields[key]||typeof argv[i+1]!=='string'||argv[i+1].startsWith('--'))throw Error('复核参数或值无效');
  out[fields[key]]=argv[++i];
 }
 if(out.apply&&(!out.reviewerId||typeof out.reason!=='string'||out.reason.trim().length<8||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(out.requestId||'')||!HASH.test(out.scopeHash||'')||!HASH.test(out.configHash||'')))
  throw Error('实际回放必须明确审核人、理由、请求ID和两项预检哈希');
 return out;
}
function instanceConfig(applicationRoot){
 const file=path.resolve(applicationRoot,'config.json');let current=path.parse(file).root;
 for(const component of file.slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,component);const stat=fs.lstatSync(current);if(stat.isSymbolicLink())throw Error('原实例配置禁止符号链接');
 }
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
 try{
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.size<2||stat.size>1024*1024||stat.mode&0o022)throw Error('原实例配置类型、权限或容量无效');
  const raw=fs.readFileSync(fd),config=JSON.parse(raw.toString('utf8'));
  if(!config||Array.isArray(config)||typeof config!=='object')throw Error('原实例配置无效');
  // Same strict research-primary role as the server. QD_PUSH_FORCE cannot
  // turn a replica into an authorized historical-data writer.
  const role=String(config.pushRole||'primary');
  if(!['primary','replica'].includes(role))throw Error('原实例角色未知');
  return {role,hash:sha(raw)};
 }finally{fs.closeSync(fd);}
}
async function main(argv=process.argv.slice(2),{applicationRoot=path.resolve(__dirname,'..'),env=process.env,now=Date.now()}={}){
 const options=parse(argv),root=env.V6_CENTER_HISTORY_DIR||path.join(applicationRoot,'data','intelligence-center-history'),
  preflight=H.previewCenterHistoryQuarantine({root,code:options.code,captureHash:options.captureHash,now});
 let config;
 try{config=instanceConfig(applicationRoot);}catch{config={role:'unknown',hash:null};}
 const authorization={scope:'configured-center-history-research-only',instanceRole:config.role,instanceConfigHash:config.hash,
  archiveScopeHash:preflight.scopeHash,accountAuthority:false,canTrade:false,canNotify:false};
 if(!options.apply)return {...preflight,authorization,applied:false};
 if(options.scopeHash!==preflight.scopeHash||options.configHash!==config.hash||config.role!=='primary')
  throw Error('原实例不是主实例或预检配置/归档范围哈希已变化，拒绝回放');
 const canWrite=()=>{
  try{const current=instanceConfig(applicationRoot);return current.role==='primary'&&current.hash===options.configHash;}
  catch{return false;}
 };
 const result=await H.replayCenterHistoryQuarantine({root,code:options.code,captureHash:options.captureHash,
  reviewerId:options.reviewerId,reason:options.reason,requestId:options.requestId,
  authorizationScope:{mode:'local-private-research-archive',archiveScopeHash:preflight.scopeHash,
   instanceConfigHash:config.hash,operatorUid:process.getuid?.()??0}},{canWrite,clock:()=>now});
 return {...result,authorization,applied:result.ok===true};
}
if(require.main===module)main().then(result=>{
 process.stdout.write(JSON.stringify(result)+'\n');
 if(result.ok===false)process.exitCode=2;
}).catch(error=>{
 process.stderr.write(JSON.stringify({status:'blocked',reason:error.message,canTrade:false,canNotify:false,writesAccount:false})+'\n');
 process.exitCode=1;
});
module.exports={parse,instanceConfig,main};
