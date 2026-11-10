#!/usr/bin/env node
'use strict';
/**
 * One private, fail-closed pipeline over files ALREADY supplied by the operator.
 * No network, provider login, paper account, live trading, or notifications.
 * preview => no writes; apply => immutable checkpoints with explicit stages.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {aShareCalendarDate}=require('../src/core/a-share-calendar');
const {adaptBaoStockIndustryMembership}=require('../src/core/baostock-industry-membership-adapter');
const {bridgeExistingMarketSector}=require('../src/core/sector-breadth-market-bridge');
const {freezeSectorMemberIdentity}=require('../src/core/sector-member-identity-proof');
const {runOnce:normalize}=require('./normalize-baostock-industry');
const {runOnce:sectorRun}=require('./sector-strength-research');
const {runOnce:rotationRun}=require('./sector-rotation-history');
const LIMIT=32*1024*1024;
function safePath(p){
 if(typeof p!=='string'||!path.isAbsolute(p)||p.includes('\0'))throw Error('研究路径必须是绝对路径');
 const full=path.resolve(p),pieces=full.split(path.sep);
 if(pieces.includes('public'))throw Error('研究路径不能指向公开静态目录');
 let cursor=path.parse(full).root;
 for(const piece of full.slice(cursor.length).split(path.sep).filter(Boolean)){
  cursor=path.join(cursor,piece);
  if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink())
   throw Error('研究路径禁止符号链接');
 }
 return full;
}
function parse(argv){
 if(!Array.isArray(argv)||argv.length!==7||!['preview','apply'].includes(argv[0]))
  throw Error('用法: sector-daily-chain.js preview|apply <BaoStock分类JSON> <现有行情快照JSON> <交易日历JSON> <私有冻结成员JSON输出> <私有板块快照归档目录> <私有轮动归档目录>');
 const [mode,...paths]=argv;
 const [classificationFile,snapshotFile,calendarFile,membershipFile,sectorDir,rotationDir]=paths.map(safePath);
 if(new Set(paths.map(p=>path.resolve(p))).size!==paths.length)
  throw Error('每条研究输入输出路径必须不同');
 for(const output of [membershipFile,sectorDir,rotationDir]){
  for(const input of [classificationFile,snapshotFile,calendarFile]){
   if(output.startsWith(input+path.sep)||input.startsWith(output+path.sep))
    throw Error('输入输出不能嵌套或相互覆盖');
  }
 }
 if(sectorDir.startsWith(rotationDir+path.sep)||rotationDir.startsWith(sectorDir+path.sep)||
  membershipFile.startsWith(sectorDir+path.sep)||
  membershipFile.startsWith(rotationDir+path.sep))
  throw Error('成员、板块和轮动输出必须分开存储');
 return {mode,classificationFile,snapshotFile,calendarFile,membershipFile,sectorDir,rotationDir};
}
function read(file,limit=LIMIT){
 file=safePath(file);
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.size<1||stat.size>limit)throw Error('研究输入不是有效的受限普通JSON文件');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
function dateOK(d){
 return typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&
  Number.isFinite(Date.parse(d+'T00:00:00Z'))&&
  new Date(Date.parse(d+'T00:00:00Z')).toISOString().slice(0,10)===d;
}
function preview(conf,{now=Date.now()}={}){
 if(!Number.isSafeInteger(now)||now<=0)throw Error('本地时钟无效');
 for(const k of ['classificationFile','snapshotFile','calendarFile','membershipFile','sectorDir','rotationDir'])
  safePath(conf[k]);
 const snapshot=read(conf.snapshotFile),raw=read(conf.classificationFile,8*1024*1024),
  calendar=read(conf.calendarFile,1024*1024);
 const inputFingerprint=crypto.createHash('sha256').update(JSON.stringify([raw,snapshot,calendar])).digest('hex');
 const end=Date.parse(snapshot?.retrievedAt||'');
 if(!Number.isSafeInteger(end)||end<=0||end>now||now-end>600000||
  snapshot.date!==aShareCalendarDate(now)||aShareCalendarDate(end)!==snapshot.date)
  return {status:'blocked-quote-freshness',reason:'行情快照非本交易日10分钟内完成',canTrade:false,applyAllowed:false};
 if(calendar?.source!=='imported'||!Array.isArray(calendar.tradeDates)||
  calendar.tradeDates.length<3||calendar.tradeDates.length>30||
  calendar.tradeDates.some((d,i)=>!dateOK(d)||(i>0&&d<=calendar.tradeDates[i-1]))||
  calendar.tradeDates.at(-1)!==snapshot.date)
  return {status:'blocked-calendar',reason:'缺少明确导入的连续交易日序列或最后一天与快照不符',canTrade:false,applyAllowed:false};
 const normalized=adaptBaoStockIndustryMembership(raw,snapshot);
 if(normalized.status!=='imported-unverified')
  return {status:'blocked-membership',reason:normalized.reason,canTrade:false,applyAllowed:false};
 const bridge=bridgeExistingMarketSector(snapshot,normalized.membership,{asOf:end});
 const memberIdentity=freezeSectorMemberIdentity(normalized.membership);
 if(bridge.status!=='imported-unverified'||bridge.study?.rankedSectorCount<3||
  memberIdentity.status!=='identity-frozen-unverified')
  return {status:'blocked-sector-evidence',
   reason:bridge.reason||'可比行业不足3个，不能形成同日行业强弱排名',
   canTrade:false,applyAllowed:false};
 // Before any mutations, refuse a divergent pre-existing membership or sector
 // checkpoint. Re-running after a crash must never quietly replace evidence.
 const expectedMembership=JSON.stringify(normalized.membership)+'\n';
 if(fs.existsSync(conf.membershipFile)){
  if(readFileText(conf.membershipFile)!==expectedMembership)
   return {status:'blocked-conflicting-membership',reason:'同一成员归档路径已有不同版本',canTrade:false,applyAllowed:false};
 }
 const sectorFile=path.join(conf.sectorDir,snapshot.date,String(end)+'.json');
 if(fs.existsSync(sectorFile)){
  const body=JSON.stringify({
   schemaVersion:1,mode:'dated-sector-research-only',status:bridge.status,
   reason:bridge.reason||null,tradeDate:bridge.tradeDate||snapshot.date||null,
   observedAt:bridge.observedAt||end||null,data:bridge,
   memberIdentity,
   verifiedLive:false,canTrade:false,weightsChanged:false
  })+'\n';
  if(readFileText(sectorFile)!==body)
   return {status:'blocked-conflicting-sector-archive',
    reason:'已有不同的同日同时点板块归档，拒绝覆盖',canTrade:false,applyAllowed:false};
 }
 return {status:'preview-ready',tradeDate:snapshot.date,inputFingerprint,
  classificationVersion:normalized.membership.classificationVersion,
  industryGroups:normalized.sectorCount,rankedSectors:bridge.study.rankedSectorCount,
  sourceQuoteCoveragePct:bridge.marketQuoteCoveragePct,
  explicitCalendarSessions:calendar.tradeDates.length,
  sectorReturnMethod:bridge.returnMethod,canTrade:false,verifiedLive:false,
  providerLicenseIndependentlyVerified:false,weightsChanged:false,
  applyAllowed:true,note:'仅核对已经取得的私有资料，没有获取报价或修改正式选股分数'};
}
function readFileText(file){
 const stat=fs.lstatSync(safePath(file));
 if(!stat.isFile()||stat.size>LIMIT)throw Error('已有归档内容或文件类型异常');
 return fs.readFileSync(file,'utf8');
}
function runOnce(conf,{now=Date.now()}={}){
 const result=preview(conf,{now});
 if(conf.mode==='preview'||result.status!=='preview-ready')
  return {...result,changed:false,completedStages:[]};
 let lockFd,stage='lock';
 const completedStages=[];
 const lock=safePath(conf.membershipFile+'.sector-chain.lock');
 try{
  fs.mkdirSync(path.dirname(lock),{recursive:true,mode:0o700});
  safePath(lock);
  try{lockFd=fs.openSync(lock,'wx',0o600);}
  catch(e){if(e.code==='EEXIST')throw Error('已有同日研究流程运行，需人工核对锁后重试');throw e;}
  fs.writeFileSync(lockFd,String(process.pid));fs.fsyncSync(lockFd);
  // Recheck after acquiring the single-writer lock; input files may have
  // been swapped by another process between the initial preview and apply.
  stage='locked-recheck';
  const again=preview(conf,{now});
  if(again.status!=='preview-ready'||
   again.classificationVersion!==result.classificationVersion||
   again.inputFingerprint!==result.inputFingerprint||
   again.sourceQuoteCoveragePct!==result.sourceQuoteCoveragePct)
   throw Error('原始输入在预检与执行之间改变，停止发布');
  stage='membership';
  const membership=normalize([conf.classificationFile,conf.snapshotFile,conf.membershipFile]);
  if(membership.status!=='prepared-unverified')throw Error('行业成员未通过冻结检查');
  completedStages.push({stage:'membership',changed:membership.changed});
  stage='sector';
  const sector=sectorRun({mode:'watch',snapshotFile:conf.snapshotFile,
   membershipFile:conf.membershipFile,output:conf.sectorDir,interval:60000},{now});
  if(sector.status!=='imported-unverified')
   throw Error('同日行情快照已过期或板块归档不可用');
  completedStages.push({stage:'sector',changed:sector.changed});
  stage='rotation';
  const rotation=rotationRun({mode:'watch',archiveRoot:conf.sectorDir,
   calendarFile:conf.calendarFile,outputDir:conf.rotationDir,interval:60000},{now});
  if(rotation.status!=='imported-unverified')
   throw Error('多日轮动研究未通过校验');
  completedStages.push({stage:'rotation',changed:rotation.changed});
  return {status:'research-chain-published-unverified',tradeDate:result.tradeDate,
   rankedSectors:result.rankedSectors,
   evaluatedThreeSession:rotation.evaluatedThreeSession,
   evaluatedFiveSession:rotation.evaluatedFiveSession,
   changed:completedStages.some(x=>x.changed),completedStages,
   verifiedLive:false,canTrade:false,canNotify:false,weightsChanged:false,
   note:'已完成私有研究归档；0个成熟多日观测仍属历史证据不足；未接行情调度或实盘'};
 }catch(e){
  e.stage=stage;e.completedStages=[...completedStages];
  throw e;
 }finally{
  if(lockFd!==undefined){fs.closeSync(lockFd);fs.unlinkSync(lock);}
 }
}
function main(argv=process.argv.slice(2),options){
 const conf=parse(argv);
 return runOnce(conf,options);
}
if(require.main===module){
 try{
  const r=main();
  console.log(JSON.stringify(r));
  if(r.status.startsWith('blocked-'))process.exitCode=2;
 }catch(e){
  // Never echo private paths, provider JSON, credentials or request payloads.
  console.error(JSON.stringify({status:'failed-stop-and-audit-before-retry',
   stage:e.stage||'preflight',completedStages:e.completedStages||[],
   verifiedLive:false,canTrade:false,weightsChanged:false}));
  process.exitCode=1;
 }
}
module.exports={parse,preview,runOnce,main};
