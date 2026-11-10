#!/usr/bin/env node
'use strict';
/**
 * Explicitly opted-in, SINGLE full-market snapshot for private sector research.
 * No login, credential persistence, scheduling, real trades or paper trading.
 * Existing eastmoney-market-snapshot fetch is reused unchanged.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {fetchEastmoneySnapshot}=require('../src/core/eastmoney-market-snapshot');
const {aShareCalendarDate}=require('../src/core/a-share-calendar');
const {adaptBaoStockIndustryMembership}=require('../src/core/baostock-industry-membership-adapter');
const {bridgeExistingMarketSector}=require('../src/core/sector-breadth-market-bridge');
const {runOnce:publishChain}=require('./sector-daily-chain');
const MAX_BYTES=32*1024*1024;
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&
 Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(Date.parse(d+'T00:00:00Z')).toISOString().slice(0,10)===d;
const validTime=t=>Number.isSafeInteger(t)&&t>946684800000&&t<4102444800000;
const chinaMinute=t=>{const d=new Date(t+8*3600000);
 return d.getUTCHours()*60+d.getUTCMinutes();};
function safePath(p){
 if(typeof p!=='string'||!path.isAbsolute(p)||p.includes('\0'))throw Error('需要私有绝对路径');
 const full=path.resolve(p);
 if(full.split(path.sep).includes('public'))throw Error('研究输入输出禁止放在静态公开目录');
 let at=path.parse(full).root;
 for(const part of full.slice(at.length).split(path.sep).filter(Boolean)){
  at=path.join(at,part);
  if(fs.existsSync(at)&&fs.lstatSync(at).isSymbolicLink())throw Error('私有归档路径不能含符号链接');
 }
 return full;
}
function parse(argv){
 const [mode,classificationFile,calendarFile,outputRoot,...rest]=argv||[];
 if(!['preview','collect'].includes(mode)||typeof classificationFile!=='string'||
  typeof calendarFile!=='string'||typeof outputRoot!=='string'||
  (mode==='preview'&&rest.length!==0)||
  (mode==='collect'&&(rest.length!==1||rest[0]!=='--allow-research-fetch')))
  throw Error('用法: sector-market-capture.js preview|collect <已采集行业JSON> <明确交易日历JSON> <私有研究根目录> [--allow-research-fetch]');
 const classification=safePath(classificationFile),calendar=safePath(calendarFile),root=safePath(outputRoot);
 if(new Set([classification,calendar,root]).size!==3||
  [classification,calendar].some(p=>p.startsWith(root+path.sep)||root.startsWith(p+path.sep)))
  throw Error('输入来源和输出根目录必须独立');
 return {mode,classificationFile:classification,calendarFile:calendar,outputRoot:root,
  allowResearchFetch:mode==='collect'};
}
function read(file,limit){
 const stat=fs.lstatSync(safePath(file));
 if(!stat.isFile()||stat.size<1||stat.size>limit)throw Error('私有研究输入不是受限普通JSON');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
function immutable(file,body){
 file=safePath(file);const dir=path.dirname(file);
 fs.mkdirSync(dir,{recursive:true,mode:0o700});safePath(dir);
 const stage=path.join(dir,'.v6-sector-capture-'+process.pid+'-'+crypto.randomBytes(8).toString('hex'));
 let fd;
 try{
  fd=fs.openSync(stage,'wx',0o600);fs.writeFileSync(fd,body);fs.fsyncSync(fd);
  fs.closeSync(fd);fd=undefined;
  try{fs.linkSync(stage,file);}
  catch(e){
   if(e.code!=='EEXIST')throw e;
   const stat=fs.lstatSync(file);
   if(!stat.isFile()||stat.size>MAX_BYTES||fs.readFileSync(file,'utf8')!==body)
    throw Error('同一时间的行情存档存在不同内容，拒绝覆盖');
   return false;
  }
  const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
  return true;
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(stage);}catch{}}
}
function preflight(conf,{now=Date.now()}={}){
 if(!validTime(now))throw Error('研究时钟无效');
 safePath(conf.outputRoot);
 const day=aShareCalendarDate(now);
 const cal=read(conf.calendarFile,1024*1024),raw=read(conf.classificationFile,8*1024*1024);
 const days=cal?.tradeDates;
 if(cal?.source!=='imported'||!Array.isArray(days)||days.length<3||days.length>30||
  days.some((d,i)=>!validDate(d)||(i>0&&d<=days[i-1]))||days.at(-1)!==day)
  return {status:'blocked-trading-calendar',canTrade:false,canFetch:false,
   reason:'需显式导入当前中国市场交易日及前序交易日'};
 const weekday=new Date(day+'T00:00:00Z').getUTCDay();
 const minute=chinaMinute(now);
 if(weekday===0||weekday===6||
  !((minute>=9*60+35&&minute<=11*60+30)||
    (minute>=13*60+5&&minute<=15*60)))
  return {status:'blocked-market-session',canTrade:false,canFetch:false,
   reason:'仅允许指定A股交易日盘中采集时段，禁止休市旧价伪装当日'};
 if(raw?.schemaVersion!==1||raw.source!=='baostock:query_stock_industry'||
  raw.completed!==true||!['证监会行业分类','申万一级行业'].includes(raw.standard)||
  !validDate(raw.updateDate)||raw.updateDate>day||
  (Date.parse(day+'T00:00:00Z')-Date.parse(raw.updateDate+'T00:00:00Z'))/86400000>28||
  !validTime(raw.observedAt)||raw.observedAt>=now||
  aShareCalendarDate(raw.observedAt)!==day||
  !Array.isArray(raw.rows)||raw.rows.length<15||raw.rows.length>10000||
  raw.declaredRows!==raw.rows.length)
  return {status:'blocked-classification',canTrade:false,canFetch:false,
   reason:'行业分类来源、日期、完整性或冻结时点不合格'};
 const symbols=new Set();
 for(const row of raw.rows){
  const symbol=row?.code;
  if(typeof symbol!=='string'||!/^(?:sh\.(?:60|68)\d{4}|sz\.(?:00|30)\d{4})$/.test(symbol)||
   symbols.has(symbol)||row.updateDate!==raw.updateDate||
   row.industryClassification!==raw.standard||typeof row.industry!=='string'||
   row.industry.length>80||/[\u0000-\u001f<>]/.test(row.industry))
   return {status:'blocked-classification',canTrade:false,canFetch:false,
    reason:'行业分类记录存在重复、缺失或混合版本'};
  symbols.add(symbol);
 }
 const inputFingerprint=crypto.createHash('sha256').update(JSON.stringify([raw,cal])).digest('hex');
 const snapshots=safePath(path.join(conf.outputRoot,'snapshots',day));
 if(fs.existsSync(snapshots)){
  if(!fs.lstatSync(snapshots).isDirectory())throw Error('快照目录不是普通目录');
  const files=fs.readdirSync(snapshots);
  if(files.length>500||files.some(f=>!/^\d{13}\.json$/.test(f)))
   throw Error('快照目录文件数或文件名不符合冻结存档协议');
  const newest=Math.max(0,...files.map(f=>Number(f.slice(0,13))));
  if(newest>now)return {status:'blocked-future-snapshot',canTrade:false,canFetch:false};
  if(now-newest<60000)return {status:'blocked-capture-interval',canTrade:false,canFetch:false,
   reason:'上一份快照距当前不足60秒，禁止频繁重复采集'};
 }
 return {status:'preflight-ready',tradeDate:day,inputFingerprint,classificationDate:raw.updateDate,
  classificationObservedAt:raw.observedAt,calendarSessions:days.length,
  provider:'eastmoney-clist-unverified-live',canTrade:false,canFetch:false,
  verifiedLive:false,providerLicenseIndependentlyVerified:false,
  note:'仅完成本地数据完整性、时间段和路径预检；尚未认证数据许可，也尚未发出请求'};
}
async function runOnce(conf,{now=Date.now(),clock=Date.now,
 fetchSnapshot=fetchEastmoneySnapshot}={}){
 let stage='preflight',completedStages=[],lockFd,lockFile;
 try{
  const pre=preflight(conf,{now});
  if(conf.mode==='preview'||pre.status!=='preflight-ready')
   return {...pre,changed:false,completedStages};
  if(conf.mode!=='collect'||conf.allowResearchFetch!==true)
   throw Error('只有显式许可的 collect 才能进行一次研究网络采集');
  if(typeof fetchSnapshot!=='function'||typeof clock!=='function')
   throw Error('行情采集函数或时钟不合法');
  stage='single-writer-lock';
  fs.mkdirSync(conf.outputRoot,{recursive:true,mode:0o700});safePath(conf.outputRoot);
  lockFile=safePath(path.join(conf.outputRoot,'.sector-capture.lock'));
  try{lockFd=fs.openSync(lockFile,'wx',0o600);}catch(e){
   if(e.code==='EEXIST')throw Error('已有研究采集进程，禁止并发重复外部请求');throw e;
  }
  fs.writeFileSync(lockFd,String(process.pid));fs.fsyncSync(lockFd);
  // Recheck input identity after acquiring the lock, BEFORE any provider call.
  const locked=preflight(conf,{now});
  if(locked.status!=='preflight-ready'||locked.inputFingerprint!==pre.inputFingerprint)
   return {status:'blocked-input-changed-before-fetch',changed:false,completedStages,canTrade:false};
  stage='single-market-fetch';
  const snapshot=await fetchSnapshot({now,clock});
  const finish=clock(),start=Date.parse(snapshot?.startedAt||''),
   end=Date.parse(snapshot?.retrievedAt||'');
  if(!validTime(finish)||finish<now||finish-now>180000||
   !validTime(start)||!validTime(end)||start<now||end<start||end>finish||
   end-start>120000||finish-end>600000||
   snapshot.date!==pre.tradeDate||aShareCalendarDate(finish)!==pre.tradeDate||
   snapshot.source!=='eastmoney-clist-unverified-live')
   return {status:'blocked-collected-snapshot-time',changed:false,completedStages,canTrade:false,
    reason:'采集时钟、耗时、数据日期或来源不匹配'};
  // A classification that was valid at preflight must have been frozen
  // BEFORE the start of this specific quote sampling batch.
  const raw=read(conf.classificationFile,8*1024*1024),
   calendar=read(conf.calendarFile,1024*1024);
  if(raw.observedAt>=start||calendar.tradeDates.at(-1)!==pre.tradeDate)
   return {status:'blocked-classification-after-quote-start',changed:false,completedStages,canTrade:false};
  // Changes to imported inputs between preflight and the fetch are rejected.
  const again=preflight(conf,{now});
  if(again.status!=='preflight-ready'||
   again.classificationObservedAt!==pre.classificationObservedAt||
   again.inputFingerprint!==pre.inputFingerprint||
   again.classificationDate!==pre.classificationDate)
   return {status:'blocked-input-changed-before-archive',changed:false,completedStages,canTrade:false};
  stage='validate-quote-provenance';
  const normalized=adaptBaoStockIndustryMembership(raw,snapshot),
   bridged=normalized.status==='imported-unverified'?
    bridgeExistingMarketSector(snapshot,normalized.membership,{asOf:end}):null;
  if(normalized.status!=='imported-unverified'||bridged?.status!=='imported-unverified'||
    bridged.study?.rankedSectorCount<3)
   return {status:'blocked-unverified-market-coverage',changed:false,
    reason:normalized.reason||bridged?.reason||'可比行业不足3组',
    completedStages,canTrade:false};
  const snapshotFile=safePath(path.join(conf.outputRoot,'snapshots',pre.tradeDate,String(end)+'.json'));
  const membershipFile=safePath(path.join(conf.outputRoot,'members',pre.tradeDate,String(end)+'.json'));
  const sectorDir=safePath(path.join(conf.outputRoot,'sector-archive')),
   rotationDir=safePath(path.join(conf.outputRoot,'rotation-archive'));
  const body=JSON.stringify(snapshot)+'\n';
  if(Buffer.byteLength(body)>MAX_BYTES)throw Error('行情研究快照超出32MiB');
  stage='freeze-original-snapshot';
  const changed=immutable(snapshotFile,body);
  completedStages.push({stage:'snapshot',changed});
  stage='daily-sector-chain';
  const output=publishChain({mode:'apply',
   classificationFile:conf.classificationFile,snapshotFile,
   calendarFile:conf.calendarFile,membershipFile,sectorDir,rotationDir},
   {now:finish});
  if(output.status!=='research-chain-published-unverified')
   throw Error('私有板块研究链拒绝发布');
  completedStages.push(...output.completedStages);
  return {status:'capture-and-sector-research-published-unverified',
   tradeDate:pre.tradeDate,observedAt:end,provider:snapshot.source,
   sourceTimeCoveragePct:bridged.marketQuoteCoveragePct,
   rankedSectors:bridged.study.rankedSectorCount,
   evaluatedThreeSession:output.evaluatedThreeSession,
   evaluatedFiveSession:output.evaluatedFiveSession,
   completedStages,changed:changed||output.changed,
   verifiedLive:false,canTrade:false,canNotify:false,weightsChanged:false,
   providerLicenseIndependentlyVerified:false,
   note:'仅一次按显式许可的公共接口研究请求，已保存未认证行情；未部署自动调度或真实交易'};
 }catch(e){e.stage=stage;e.completedStages=[...completedStages];throw e;}
 finally{if(lockFd!==undefined){fs.closeSync(lockFd);fs.unlinkSync(lockFile);}}
}
async function main(argv=process.argv.slice(2),options){
 return runOnce(parse(argv),options);
}
if(require.main===module){
 main().then(r=>{
  console.log(JSON.stringify(r));
  if(r.status.startsWith('blocked-'))process.exitCode=2;
 }).catch(e=>{
  console.error(JSON.stringify({status:'failed-stop-and-audit-before-retry',
   stage:e.stage||'preflight',completedStages:e.completedStages||[],canTrade:false}));
  process.exitCode=1;
 });
}
module.exports={parse,preflight,runOnce,main};
