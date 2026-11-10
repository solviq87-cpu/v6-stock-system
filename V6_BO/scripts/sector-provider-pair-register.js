#!/usr/bin/env node
'use strict';
/**
 * Explicit prospective local registration + later read-only replay of
 * imported sector quality episodes. No network, no trading, no learned weights.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {prepareSectorPairRegistration,verifySectorPairRegistration,
 verifyRegisteredSectorPairEvidence}=require('../src/core/sector-provider-pair-registration');
const MAX=32*1024*1024;
const canonical=x=>Array.isArray(x)?x.map(canonical):
 x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const safety={canTrade:false,canTrain:false,externallyTimestampCertified:false,
 prospectiveCertified:false,changed:false};
function safe(p){
 if(typeof p!=='string'||!path.isAbsolute(p)||p.includes('\0'))
  throw Error('本地研究登记需要私有绝对路径');
 const full=path.resolve(p);
 if(full.split(path.sep).includes('public'))
  throw Error('不能将研究证据写入公开页面文件夹');
 let part=path.parse(full).root;
 for(const item of full.slice(part.length).split(path.sep).filter(Boolean)){
  part=path.join(part,item);
  if(fs.existsSync(part)&&fs.lstatSync(part).isSymbolicLink())
   throw Error('研究登记路径禁止符号链接');
 }
 return full;
}
function parse(argv){
 const [mode,...args]=argv||[];
 if(!['register','preview','publish'].includes(mode)||
  (mode==='register'&&args.length!==2)||
  (mode==='preview'&&args.length!==2)||
  (mode==='publish'&&args.length!==3))
  throw Error('用法: register <plan.json> <receipt.json> | preview <receipt.json> <quality-evidence.json> | publish <receipt.json> <quality-evidence.json> <report.json>');
 const files=args.map(safe);
 if(new Set(files).size!==files.length)
  throw Error('输入、回执、报告不得指向同一位置');
 return {mode,files};
}
function read(p){
 p=safe(p);
 const stat=fs.lstatSync(p);
 if(!stat.isFile()||stat.size<2||stat.size>MAX)
  throw Error('输入证据不符合普通JSON文件大小限制');
 return JSON.parse(fs.readFileSync(p,'utf8'));
}
function immutable(file,content){
 file=safe(file);
 if(Buffer.byteLength(content)>MAX)throw Error('研究报告体积超限');
 const dir=path.dirname(file);
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 safe(dir);
 const tmp=path.join(dir,'.sector-registered-'+process.pid+'-'+
  crypto.randomBytes(8).toString('hex'));
 let fd;
 try{
  fd=fs.openSync(tmp,'wx',0o600);
  fs.writeFileSync(fd,content);fs.fsyncSync(fd);
  fs.closeSync(fd);fd=undefined;
  try{fs.linkSync(tmp,file);}
  catch(e){
   if(e.code!=='EEXIST')throw e;
   const st=fs.lstatSync(file);
   if(!st.isFile()||st.size>MAX||fs.readFileSync(file,'utf8')!==content)
    throw Error('已有不同内容的不可覆盖研究文件');
   return false;
  }
  const parent=fs.openSync(dir,'r');
  try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
  return true;
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch{}}
}
function runOnce(conf,{now=Date.now()}={}){
 const [f1,f2,f3]=conf.files;
 if(conf.mode==='register'){
  const plan=read(f1),planDigest=digest(plan);
  if(fs.existsSync(f2)){
   const old=read(f2),check=verifySectorPairRegistration(old,{asOf:now});
   if(check.status==='blocked'||old.sourcePlanSha256!==planDigest)
    return {...safety,status:'blocked-conflicting-existing-registration'};
   return {...safety,status:'already-registered-identical',
    studyId:old.studyId,registeredAt:old.registeredAt,
    receiptIntegrity:old.integrity};
  }
  const registration=prepareSectorPairRegistration(plan,{now});
  if(registration.status==='blocked')
   return {...safety,status:'blocked',reason:registration.reason};
  // Registering is the only operation that can create the receipt. It must
  // use the current injected OS clock, not an arbitrary timestamp in plan.
  const receipt={...registration.receipt,sourcePlanSha256:planDigest};
  // sourcePlanSha256 is calculated canonically in core, and plan input is
  // parsed JSON. Re-serialize consistently without rewriting integrity.
  const check=verifySectorPairRegistration(receipt,{asOf:now});
  if(check.status==='blocked')
   return {...safety,status:'blocked-unexpected-registration-integrity'};
  const changed=immutable(f2,JSON.stringify(receipt)+'\n');
  return {...safety,status:changed?'locally-registered-unverified':
   'blocked-registration-race',
   changed,studyId:receipt.studyId,
   receiptIntegrity:receipt.integrity,registeredAt:receipt.registeredAt};
 }
 const receipt=read(f1),evidence=read(f2);
 const report=verifyRegisteredSectorPairEvidence(receipt,evidence,{now});
 const summary={...safety,status:report.status,reason:report.reason||null,
  studyId:report.studyId||null,
  expectedSignalDays:report.expectedSignalDays||null,
  receivedEpisodeCount:report.receivedEpisodeCount||0,
  localReceiptMatched:report.localReceiptMatched===true,
  receiptIntegrity:report.receiptIntegrity||null,
  qualityWindows:report.quality?.horizons?.map(x=>({
   sessions:x.sessions,status:x.status,
   maturedSignalDays:x.maturedSignalDays,
   nonComparableRatePct:x.nonComparableRatePct,
   disagreementRatePct:x.disagreementRatePct,
   partialDisagreementDays:x.partialDisagreementDays?.length||0
  }))||[]};
 if(conf.mode==='preview'||report.status==='blocked'||report.status==='insufficient-evidence')
  return summary;
 const evidenceSha256=digest(evidence);
 if(fs.existsSync(f3)){
  const old=read(f3),{integrity,...payload}=old||{};
  if(old?.schemaVersion!==1||
   old.mode!=='immutable-locally-registered-quality-review'||
   integrity!==digest(payload)||
   old.receiptIntegrity!==receipt.integrity||
   old.evidenceSha256!==evidenceSha256||
   digest(old.report)!==digest(report)||
   !Number.isSafeInteger(old.publishedAt)||old.publishedAt>now||
   old.canTrade!==false||old.canTrain!==false)
   throw Error('existing-published-quality-evidence-conflicts');
  return {...summary,status:report.status,changed:false};
 }
 const record={schemaVersion:1,mode:'immutable-locally-registered-quality-review',
  receiptIntegrity:receipt.integrity,evidenceSha256,
  publishedAt:now,report,canTrade:false,canTrain:false,
  externallyTimestampCertified:false,prospectiveCertified:false};
 const body=JSON.stringify({...record,integrity:digest(record)})+'\n';
 return {...summary,changed:immutable(f3,body)};
}
function main(argv=process.argv.slice(2),options){return runOnce(parse(argv),options);}
if(require.main===module){
 try{const r=main();console.log(JSON.stringify(r));
  if(r.status.startsWith('blocked'))process.exitCode=2;
 }catch{
  console.error(JSON.stringify({...safety,status:'failed-private-evidence-validation'}));
  process.exitCode=1;
 }
}
module.exports={safe,parse,read,immutable,runOnce,main};
