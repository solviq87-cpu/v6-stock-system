#!/usr/bin/env node
'use strict';
// Read-only comparison for independently preserved shadow research archives.
// Never writes, restores, deletes or resets a consumed-holdout trial ledger.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {safeNew}=require('./factor-shadow-evolution');
const {SEED_MODE,verifySeedRegistrationMetadata}=require('../src/core/factor-candidate-prereg');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const bytesHash=x=>crypto.createHash('sha256').update(x).digest('hex');
const SHADOW=/^shadow-\d{4}-\d{2}-\d{2}-[a-f0-9]{12}\.json$/;
const PREREG=/^prereg-[a-f0-9]{12}\.json$/;
const HEX=/^[a-f0-9]{64}$/;
// WATCH heartbeat is MUTABLE operational metadata, not an immutable model.
// Allow this one exact file with full schema/hash verification, but never
// count it as archived training evidence or silently accept other files.
const HEARTBEAT_NAME='.shadow-worker-heartbeat.json';
const HEARTBEAT_FIELDS=['canTrade','integrity','intervalMs','lastStatus','mode',
 'observedAt','outcome','pid','productionWeightsChanged','schemaVersion'];
function verifyOperationalHeartbeat(root,entry){
 const file=safeNew(path.join(root,HEARTBEAT_NAME));
 if(!entry.isFile()||entry.isSymbolicLink())
  throw Error('研究值守心跳不是可信普通文件');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 let data;
 try{
  const before=fs.fstatSync(fd);
  if(!before.isFile()||before.size<2||before.size>4096)
   throw Error('研究值守心跳文件大小无效');
  data=fs.readFileSync(fd);
  const after=fs.fstatSync(fd);
  if(before.dev!==after.dev||before.ino!==after.ino||
     before.size!==after.size||before.mtimeMs!==after.mtimeMs)
   throw Error('研究值守心跳扫描期间被更改');
 }finally{fs.closeSync(fd);}
 let pulse;
 try{pulse=JSON.parse(data.toString('utf8'));}
 catch{throw Error('研究值守心跳JSON无效');}
 if(!pulse||typeof pulse!=='object'||Array.isArray(pulse)||
    JSON.stringify(Object.keys(pulse).sort())!==JSON.stringify(HEARTBEAT_FIELDS)||
    pulse.schemaVersion!==1||pulse.mode!=='v6-shadow-watch-heartbeat-v1'||
    !Number.isSafeInteger(pulse.observedAt)||pulse.observedAt<=0||
    !Number.isSafeInteger(pulse.intervalMs)||pulse.intervalMs<30000||
    pulse.intervalMs>3600000||
    !Number.isSafeInteger(pulse.pid)||pulse.pid<=0||
    !['tick-success','tick-error'].includes(pulse.outcome)||
    typeof pulse.lastStatus!=='string'||pulse.lastStatus.length>90||
    !/^[a-z0-9-]+$/.test(pulse.lastStatus)||
    pulse.canTrade!==false||pulse.productionWeightsChanged!==false)
  throw Error('研究值守心跳字段或不可交易合同无效');
 const {integrity,...payload}=pulse;
 if(integrity!==hash(payload))throw Error('研究值守心跳完整性校验失败');
}
const STATUSES=new Set(['shadow-updated','shadow-retained','paused-market-shock',
 'paused-shadow-decay','paused-shadow-cooldown','shadow-recovered']);
const INSPECTED=new Set(['shadow-updated','shadow-retained','paused-market-shock']);
const MAX_FILE_BYTES=16*1024*1024;
function scan(dir){
 if(typeof dir!=='string'||!path.isAbsolute(dir))
  throw Error('研究备份核验必须使用私有绝对目录');
 const root=safeNew(dir);
 const d=fs.lstatSync(root);
 if(!d.isDirectory()||d.isSymbolicLink())throw Error('研究归档目录不是普通私有目录');
 if(fs.existsSync(path.join(root,'.shadow-worker.lock')))
  throw Error('研究归档目录仍有写入独占锁，必须先核对进程/锁再备份审计');
 const entries=fs.readdirSync(root,{withFileTypes:true});
 if(!entries.length||entries.length>1000)throw Error('研究归档目录为空或超出审计上限');
 const files=[],kinds={shadow:0,prereg:0},statuses={},seen=new Set();
 for(const e of entries){
  // PR #165 writes an operational WATCH pulse to this same private directory.
  // It may vary between a trusted backup and a stopped restore target; it
  // must NEVER replace or count as one of the immutable history records.
  if(e.name===HEARTBEAT_NAME){
   verifyOperationalHeartbeat(root,e);
   continue;
  }
  const name=e.name,kind=SHADOW.test(name)?'shadow':PREREG.test(name)?'prereg':null;
  if(!kind||!e.isFile()||e.isSymbolicLink()||seen.has(name))
   throw Error('研究归档目录存在未识别、重复或非普通文件：'+name.slice(0,110));
  seen.add(name);
  const file=safeNew(path.join(root,name));
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  let data;
  try{
   const before=fs.fstatSync(fd);
   if(!before.isFile()||before.size<2||before.size>MAX_FILE_BYTES)
    throw Error('研究归档文件大小或类型无效：'+name);
   data=fs.readFileSync(fd);
   const after=fs.fstatSync(fd);
   if(before.dev!==after.dev||before.ino!==after.ino||
      before.size!==after.size||before.mtimeMs!==after.mtimeMs)
    throw Error('研究归档扫描期间文件发生变化：'+name);
  }finally{fs.closeSync(fd);}
  let record;
  try{record=JSON.parse(data.toString('utf8'));}
  catch{throw Error('研究归档 JSON 无法解析：'+name);}
  if(!record||typeof record!=='object'||Array.isArray(record)||
     !HEX.test(record.fingerprint||'')||record.canTrade!==false||
     record.productionWeightsChanged!==false)
   throw Error('研究归档标记或不可交易边界无效：'+name);
  const {fingerprint,...payload}=record;
  if(hash(payload)!==fingerprint)
   throw Error('研究归档内部 SHA256 指纹不匹配：'+name);
  if(kind==='shadow'){
   if(record.mode!=='v6-factor-shadow-evolution-v1'||
      !STATUSES.has(record.status)||
      name!==`shadow-${record.trainingEnd}-${fingerprint.slice(0,12)}.json`)
    throw Error('影子研究报告状态或文件名不匹配：'+name);
   statuses[record.status]=(statuses[record.status]||0)+1;
   if(Object.hasOwn(record,'trialAudit')){
    const audit=record.trialAudit;
    if(!audit||audit.schemaVersion!==1||
       audit.status!==(INSPECTED.has(record.status)?'consumed':'not-evaluated'))
     throw Error('研究试验状态与封存审计不一致：'+name);
   }
  }else{
   if(!['v6-shadow-candidate-prereg-v1',SEED_MODE].includes(record.mode)||
      name!==`prereg-${fingerprint.slice(0,12)}.json`)
    throw Error('候选预注册档案模式或文件名不匹配：'+name);
   if(record.mode===SEED_MODE)verifySeedRegistrationMetadata(record);
  }
  kinds[kind]++;
  files.push({name,sha256:bytesHash(data),fingerprint,kind});
 }
 if(!files.length)throw Error('研究目录仅有运行状态，无任何不可变模型或预注册归档');
 files.sort((a,b)=>a.name.localeCompare(b.name,'en'));
 const after=fs.lstatSync(root);
 if(d.dev!==after.dev||d.ino!==after.ino||d.mtimeMs!==after.mtimeMs||
    fs.readdirSync(root).length!==entries.length)
  throw Error('研究归档扫描期间目录发生变化，不能认定为完整快照');
 return {files,kinds,statuses,digest:hash(files.map(x=>[x.name,x.sha256]))};
}
/**
 * Compare a trusted, independently preserved source with a would-be backup
 * or restore target. A valid additional immutable file is allowed; omitting
 * or modifying even one historical preregistration or spent trial is not.
 */
function compare(referenceDir,candidateDir){
 const ref=safeNew(referenceDir),candidate=safeNew(candidateDir);
 if(ref===candidate)throw Error('参考研究档案与待检查备份不得是同一目录');
 const baseline=scan(ref),proposed=scan(candidate);
 const lookup=new Map(proposed.files.map(x=>[x.name,x]));
 const missing=[],changed=[];
 for(const f of baseline.files){
  const entry=lookup.get(f.name);
  if(!entry)missing.push(f.name);
  else if(entry.sha256!==f.sha256||entry.fingerprint!==f.fingerprint)
   changed.push(f.name);
 }
 if(missing.length||changed.length)
  throw Error(`研究备份不完整或与参考历史冲突：缺失${missing.length}项，变更${changed.length}项；拒绝恢复/备份验收`);
 // Detect simple concurrent activity during comparison; not a substitute
 // for a filesystem snapshot or independently authenticated checkpoint.
 const refAgain=scan(ref),candidateAgain=scan(candidate);
 if(refAgain.digest!==baseline.digest||candidateAgain.digest!==proposed.digest)
  throw Error('研究归档在对账过程中被修改，拒绝视为有效备份');
 return {ok:true,status:'shadow-archive-preserved',referenceFiles:baseline.files.length,
  candidateFiles:proposed.files.length,additionalFiles:proposed.files.length-baseline.files.length,
  shadowReports:proposed.kinds.shadow,preregisteredCandidates:proposed.kinds.prereg,
  referenceDigest:baseline.digest,candidateDigest:proposed.digest,
  canTrade:false,productionWeightsChanged:false,readonly:true};
}
function main(args){
 if(args.length!==3||args[0]!=='compare')
  throw Error('用法: factor-shadow-archive-audit.js compare <可信历史私有目录> <待备份/待恢复私有目录>');
 return compare(args[1],args[2]);
}
if(require.main===module){
 try{console.log(JSON.stringify(main(process.argv.slice(2))));}
 catch(e){console.error(JSON.stringify({ok:false,error:String(e.message).slice(0,220),
  canTrade:false,readonly:true}));process.exitCode=1;}
}
module.exports={scan,compare,main};
