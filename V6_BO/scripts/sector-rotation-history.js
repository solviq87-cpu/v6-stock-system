#!/usr/bin/env node
'use strict';
/**
 * Private research-only daily rotation projection from immutable same-day
 * sector-strength archives. No market requests, order routing or notifications.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {aShareCalendarDate}=require('../src/core/a-share-calendar');
const {evaluateSectorRotation}=require('../src/strategy/sector-rotation-history');
const MAX_BYTES=32*1024*1024;
const dateOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
function safePath(p){
 if(typeof p!=='string'||!path.isAbsolute(p)||p.includes('\0'))throw Error('输入输出必须为绝对路径');
 const full=path.resolve(p);
 if(full.split(path.sep).includes('public'))throw Error('禁止写入或读取公开静态资源目录');
 let at=path.parse(full).root;
 for(const part of full.slice(at.length).split(path.sep).filter(Boolean)){
  at=path.join(at,part);
  if(fs.existsSync(at)&&fs.lstatSync(at).isSymbolicLink())throw Error('归档目录禁止符号链接');
 }
 return full;
}
function parse(argv){
 const [mode,archiveRoot,calendarFile,outputDir,...extra]=argv;
 if(!['once','watch'].includes(mode))throw Error('用法：sector-rotation-history.js once|watch <板块快照归档目录> <显式交易日历JSON> <私有研究输出目录> [--interval 60000]');
 const root=safePath(archiveRoot),calendar=safePath(calendarFile),out=safePath(outputDir);
 if(root===out||out.startsWith(root+path.sep)||root.startsWith(out+path.sep)||
   out===calendar||root===calendar)throw Error('归档、日历与输出目录必须互相独立');
 if(extra.length&&(mode!=='watch'||extra.length!==2||extra[0]!=='--interval'))
  throw Error('只有 watch 模式可指定轮询间隔');
 const interval=extra.length?Number(extra[1]):60000;
 if(!Number.isSafeInteger(interval)||interval<30000||interval>3600000)
  throw Error('轮询间隔必须为30000至3600000毫秒');
 return {mode,archiveRoot:root,calendarFile:calendar,outputDir:out,interval};
}
function read(file){
 file=safePath(file);
 const s=fs.lstatSync(file);
 if(!s.isFile()||s.size<1||s.size>MAX_BYTES)throw Error('导入归档文件大小或类型异常');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
function stampMinute(ms){
 const date=new Date(ms+8*3600000);
 return date.getUTCHours()*60+date.getUTCMinutes();
}
function readDaily(root,day,now,{anchorMinute=null}={}){
 const dir=safePath(path.join(root,day));
 if(!fs.existsSync(dir))return null;
 if(!fs.lstatSync(dir).isDirectory())throw Error('日期归档不是文件夹');
 const names=fs.readdirSync(dir);
 if(names.length>512)throw Error('单日归档文件超过512个，需先检查重复采集');
 const candidates=[];
 for(const name of names){
  if(!/^\d{13}\.json$/.test(name))throw Error('归档目录存在未知文件名，拒绝猜测');
  const ms=Number(name.slice(0,13));
  if(!Number.isSafeInteger(ms)||ms<=0||aShareCalendarDate(ms)!==day)throw Error('归档文件名的行情时点与日期不符');
  if(ms>now)continue;
  const minute=stampMinute(ms);
  if(anchorMinute!==null&&(minute>anchorMinute||minute<anchorMinute-30))continue;
  candidates.push({file:path.join(dir,name),ms});
 }
 candidates.sort((a,b)=>b.ms-a.ms);
 if(!candidates.length)return null;
 const selected=candidates[0],record=read(selected.file);
 if(record?.observedAt!==selected.ms||record?.tradeDate!==day)
  throw Error('归档正文与不可变文件名的时点或交易日冲突');
 return record;
}
function immutable(file,raw){
 file=safePath(file);
 const dir=path.dirname(file);
 fs.mkdirSync(dir,{recursive:true,mode:0o700});safePath(dir);
 const stage=path.join(dir,'.sector-rotation-'+process.pid+'-'+crypto.randomBytes(8).toString('hex'));
 let fd;
 try{
  fd=fs.openSync(stage,'wx',0o600);fs.writeFileSync(fd,raw);fs.fsyncSync(fd);
  fs.closeSync(fd);fd=undefined;
  try{fs.linkSync(stage,file);}
  catch(e){
   if(e.code!=='EEXIST')throw e;
   const st=fs.lstatSync(file);
   if(!st.isFile()||st.size>MAX_BYTES||fs.readFileSync(file,'utf8')!==raw)
    throw Error('已有不同的同日轮动证据，拒绝覆盖');
   return false;
  }
  const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
  return true;
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(stage);}catch{}}
}
function runOnce(conf,{now=Date.now()}={}){
 if(!Number.isSafeInteger(now)||now<=0)throw Error('研究时钟无效');
 const cal=read(conf.calendarFile);
 if(cal?.source!=='imported'||!Array.isArray(cal.tradeDates)||
   cal.tradeDates.length<3||cal.tradeDates.length>30||
   cal.tradeDates.some((d,i)=>!dateOK(d)||(i>0&&d<=cal.tradeDates[i-1])))
  throw Error('需要明确导入、按交易日升序排列的交易日历；自然日不能替代交易日');
 const dates=cal.tradeDates.slice(-5),today=dates.at(-1);
 if(today>aShareCalendarDate(now))throw Error('交易日历最后一天位于当前时钟之后');
 if(conf.mode==='watch'&&today!==aShareCalendarDate(now))
  return {status:'not-current-trading-day',changed:false,canTrade:false};
 const last=readDaily(conf.archiveRoot,today,now);
 if(!last)return {status:'latest-session-archive-missing',changed:false,canTrade:false};
 const anchorMinute=stampMinute(last.observedAt);
 const records=dates.map(d=>d===today?last:
  readDaily(conf.archiveRoot,d,now,{anchorMinute})).filter(Boolean);
 const report=evaluateSectorRotation(records,{tradeDates:cal.tradeDates,asOf:last.observedAt});
 // A blocked report is diagnostic only; do not publish an apparent sector ranking.
 if(report.status!=='imported-unverified')
  return {status:report.status,reason:report.reason,changed:false,canTrade:false};
 const record={schemaVersion:1,mode:'dated-sector-rotation-research',
  tradeDate:today,observedAt:last.observedAt,calendarSource:'operator-imported-unverified',
  report,verifiedLive:false,canTrade:false,weightsChanged:false};
 const integrity=crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex');
 const raw=JSON.stringify({...record,integrity})+'\n';
 if(Buffer.byteLength(raw)>MAX_BYTES)throw Error('轮动输出超过32MiB');
 const file=path.join(conf.outputDir,today,String(last.observedAt)+'.json');
 const changed=immutable(file,raw);
 return {status:report.status,tradeDate:today,changed,
  evaluatedThreeSession:report.evaluatedThreeSession,
  evaluatedFiveSession:report.evaluatedFiveSession,
  sectorCount:report.sectors.length,canTrade:false,verifiedLive:false};
}
function main(argv=process.argv.slice(2)){
 const conf=parse(argv);
 if(conf.mode==='once')return runOnce(conf);
 let busy=false,previous=null;
 const tick=()=>{
  if(busy)return;busy=true;
  try{
   const out=runOnce(conf),line=JSON.stringify(out);
   if(out.changed||line!==previous)console.log(line);
   previous=line;
  }catch(e){
   const line=JSON.stringify({status:'blocked-invalid-evidence',reason:String(e.message).slice(0,150),canTrade:false});
   if(line!==previous)console.error(line);previous=line;
  }finally{busy=false;}
 };
 tick();
 const timer=setInterval(tick,conf.interval);
 for(const signal of ['SIGINT','SIGTERM'])
  process.once(signal,()=>{clearInterval(timer);process.exitCode=0;});
 return {mode:'watch',running:true,canTrade:false};
}
if(require.main===module){
 try{const r=main();if(r.mode!=='watch')console.log(JSON.stringify(r));}
 catch(e){console.error(JSON.stringify({status:'blocked-invalid-evidence',reason:String(e.message).slice(0,150),canTrade:false}));process.exitCode=1;}
}
module.exports={parse,readDaily,runOnce,main};
