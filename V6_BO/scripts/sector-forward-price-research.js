#!/usr/bin/env node
'use strict';
/**
 * Offline freeze/evaluate CLI. Use previously archived snapshots and explicit
 * corporate-action coverage only; no network or simulated/real trading.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {aShareCalendarDate}=require('../src/core/a-share-calendar');
const {freezeSectorPriceCohort,evaluateSectorForwardPrices,HORIZONS}=
 require('../src/core/sector-frozen-forward-prices');
const MAX=32*1024*1024;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function safe(p){
 if(typeof p!=='string'||!path.isAbsolute(p)||p.includes('\0'))throw Error('输入输出需私有绝对路径');
 const dest=path.resolve(p);
 if(dest.split(path.sep).includes('public'))throw Error('禁止访问或写入公开静态目录');
 let at=path.parse(dest).root;
 for(const part of dest.slice(at.length).split(path.sep).filter(Boolean)){
  at=path.join(at,part);
  if(fs.existsSync(at)&&fs.lstatSync(at).isSymbolicLink())throw Error('禁止符号链接归档');
 }
 return dest;
}
function parse(argv){
 const [mode,...args]=argv||[];
 if(mode==='freeze'&&args.length===3){
  const [snapshotFile,membershipFile,outputFile]=args.map(safe);
  if(new Set([snapshotFile,membershipFile,outputFile]).size!==3)
   throw Error('基准快照、冻结成员和输出必须不同路径');
  return {mode,snapshotFile,membershipFile,outputFile};
 }
 if(mode==='evaluate'&&args.length===6){
  const [frozenFile,snapshotRoot,calendarFile,actionsFile,outputDir]=args.slice(0,5).map(safe);
  // One explicit format selector avoids treating raw snapshots as licensed closes.
  if(args[5]!=='--raw-intraday-only')
   throw Error('价格观察仅支持显式标记的未复权盘中原始报价');
  const items=[frozenFile,snapshotRoot,calendarFile,actionsFile,outputDir];
  if(new Set(items).size!==5||
    [frozenFile,calendarFile,actionsFile].some(p=>p.startsWith(outputDir+path.sep)||
      outputDir.startsWith(p+path.sep))||
    outputDir.startsWith(snapshotRoot+path.sep)||
    snapshotRoot.startsWith(outputDir+path.sep))
   throw Error('交易日历、原快照与研究输出必须不同位置');
  return {mode,frozenFile,snapshotRoot,calendarFile,actionsFile,outputDir};
 }
 throw Error('用法: sector-forward-price-research.js freeze <基准行情快照JSON> <当天冻结行业成员JSON> <私有冻结样本输出JSON> | evaluate <已冻结样本JSON> <原始快照归档目录> <显式交易日历JSON> <公司行为审计JSON> <私有研究输出目录> --raw-intraday-only');
}
function read(file){
 const stat=fs.lstatSync(safe(file));
 if(!stat.isFile()||stat.size<1||stat.size>MAX)throw Error('归档文件类型或大小不合格');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
function immutable(file,body){
 file=safe(file);
 if(Buffer.byteLength(body)>MAX)throw Error('研究输出超过32MiB');
 const dir=path.dirname(file);
 fs.mkdirSync(dir,{recursive:true,mode:0o700});safe(dir);
 const stage=path.join(dir,'.sector-forward-'+process.pid+'-'+crypto.randomBytes(6).toString('hex'));
 let fd;
 try{
  fd=fs.openSync(stage,'wx',0o600);fs.writeFileSync(fd,body);fs.fsyncSync(fd);
  fs.closeSync(fd);fd=undefined;
  try{fs.linkSync(stage,file);}
  catch(e){
   if(e.code!=='EEXIST')throw e;
   const old=fs.lstatSync(file);
   if(!old.isFile()||old.size>MAX||fs.readFileSync(file,'utf8')!==body)
    throw Error('已有不同内容的同身份研究证据，拒绝覆盖');
   return false;
  }
  const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
  return true;
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(stage);}catch{}}
}
function minute(ms){const d=new Date(ms+8*3600000);return d.getUTCHours()*60+d.getUTCMinutes();}
function loadTarget(root,day,observedMinute,now){
 const dir=safe(path.join(root,day));
 if(!fs.existsSync(dir))return null;
 if(!fs.lstatSync(dir).isDirectory())throw Error('行情归档日期不是目录');
 const names=fs.readdirSync(dir);
 if(names.length>512)throw Error('单日行情归档数量超过512，拒绝猜测');
 const candidates=[];
 for(const f of names){
  if(!/^\d{13}\.json$/.test(f))throw Error('归档目录文件名不符合时点协议');
  const t=Number(f.slice(0,13));
  if(!Number.isSafeInteger(t)||aShareCalendarDate(t)!==day)
   throw Error('行情文件名的时点与日期不符');
  if(t>now||Math.abs(minute(t)-observedMinute)>30)continue;
  candidates.push({file:path.join(dir,f),t});
 }
 candidates.sort((a,b)=>Math.abs(minute(a.t)-observedMinute)-
   Math.abs(minute(b.t)-observedMinute)||b.t-a.t);
 if(!candidates.length)return null;
 const selected=candidates[0],snapshot=read(selected.file);
 if(Date.parse(snapshot?.retrievedAt||'')!==selected.t||snapshot?.date!==day)
  throw Error('不可变行情档案正文与文件名冲突');
 return snapshot;
}
function runOnce(conf,{now=Date.now()}={}){
 if(!Number.isSafeInteger(now)||now<=0)throw Error('研究当前时钟无效');
 if(conf.mode==='freeze'){
  const frozen=freezeSectorPriceCohort(read(conf.snapshotFile),
   read(conf.membershipFile),{now});
  const record={schemaVersion:1,mode:'immutable-sector-frozen-price-cohort',
   frozen,canTrain:false,canTrade:false};
  const raw=JSON.stringify({...record,integrity:hash(record)})+'\n';
  const changed=immutable(conf.outputFile,raw);
  return {status:'frozen-unverified',changed,tradeDate:frozen.tradeDate,
   sectorCount:frozen.sectors.length,canTrain:false,canTrade:false,
   observedAt:frozen.observedAt,fingerprint:frozen.fingerprint};
 }
 const stored=read(conf.frozenFile);
 const {integrity,...data}=stored;
 if(stored?.schemaVersion!==1||stored.mode!=='immutable-sector-frozen-price-cohort'||
  stored.canTrain!==false||stored.canTrade!==false||
  integrity!==hash(data))throw Error('冻结研究样本完整性损坏');
 const frozen=stored.frozen,calendar=read(conf.calendarFile),actions=read(conf.actionsFile);
 if(calendar?.source!=='imported'||!Array.isArray(calendar.tradeDates)||
  calendar.tradeDates.length<2||calendar.tradeDates.length>120)
  throw Error('交易日历必须明确导入');
 const index=calendar.tradeDates.indexOf(frozen?.tradeDate);
 if(index<0)throw Error('冻结日不在交易日历');
 const slots=HORIZONS.map(h=>calendar.tradeDates[index+h]).filter(Boolean);
 const future=slots.map(day=>day>aShareCalendarDate(now)?null:
  loadTarget(conf.snapshotRoot,day,minute(frozen.observedAt),now)).filter(Boolean);
 const report=evaluateSectorForwardPrices(frozen,future,{tradeDates:calendar.tradeDates,
  corporateActions:actions,asOf:now});
 if(report.status==='blocked')
  return {status:'blocked',reason:report.reason,changed:false,canTrade:false};
 const record={schemaVersion:1,mode:'dated-sector-forward-price-research',
  tradeDate:frozen.tradeDate,observedAt:now,report,canTrain:false,canTrade:false};
 const raw=JSON.stringify({...record,integrity:hash(record)})+'\n';
 const file=safe(path.join(conf.outputDir,frozen.tradeDate,frozen.fingerprint,String(now)+'.json'));
 const changed=immutable(file,raw);
 return {status:report.status,changed,tradeDate:frozen.tradeDate,
  horizons:report.horizons.map(x=>({sessions:x.sessions,status:x.status,
   observedSectorCount:x.observedSectorCount})),
  canTrain:false,canTrade:false,verifiedLive:false};
}
function main(argv=process.argv.slice(2),deps){return runOnce(parse(argv),deps);}
if(require.main===module){
 try{console.log(JSON.stringify(main()));}
 catch(e){console.error(JSON.stringify({status:'blocked-invalid-or-conflicting-evidence',
  reason:String(e.message).slice(0,140),canTrain:false,canTrade:false}));process.exitCode=1;}
}
module.exports={parse,read,loadTarget,runOnce,main};
