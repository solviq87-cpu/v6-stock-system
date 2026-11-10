#!/usr/bin/env node
'use strict';
// User-initiated, private, read-only conversion of an existing market snapshot.
// "watch" rereads local files only. It never fetches additional quotes or orders.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {bridgeExistingMarketSector}=require('../src/core/sector-breadth-market-bridge');
const {freezeSectorMemberIdentity}=require('../src/core/sector-member-identity-proof');
const MAX_BYTES=32*1024*1024;
function parse(argv){
 const [mode,snapshotFile,membershipFile,output,...rest]=argv;
 if(!['once','watch'].includes(mode)||![snapshotFile,membershipFile,output]
   .every(x=>typeof x==='string'&&path.isAbsolute(x)))
  throw Error('用法: sector-strength-research.js once|watch <已取得的行情快照绝对路径> <冻结板块成员绝对路径> <输出文件或目录绝对路径> [--interval 60000]');
 if(path.resolve(snapshotFile)===path.resolve(membershipFile)||
    path.resolve(output)===path.resolve(snapshotFile)||
    path.resolve(output)===path.resolve(membershipFile))
  throw Error('输入输出必须是不同的私有路径');
 if(rest.length&&(mode!=='watch'||rest.length!==2||rest[0]!=='--interval'))
  throw Error('只有 watch 可用 --interval');
 const interval=rest.length?Number(rest[1]):60000;
 if(!Number.isSafeInteger(interval)||interval<30000||interval>3600000)
  throw Error('刷新间隔须在30000至3600000毫秒');
 return {mode,snapshotFile,membershipFile,output,interval};
}
function read(file){
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.size<1||stat.size>MAX_BYTES)
  throw Error('输入必须为已存在、非软链接且不超过32MiB的普通JSON文件');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
function newAtomic(file,body){
 const dir=path.dirname(file);
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 if(!fs.lstatSync(dir).isDirectory())throw Error('输出目录无效');
 const stage=path.join(dir,'.sector-study-'+process.pid+'-'+crypto.randomBytes(8).toString('hex'));
 let fd;
 try{
  fd=fs.openSync(stage,'wx',0o600);fs.writeFileSync(fd,body);fs.fsyncSync(fd);
  fs.closeSync(fd);fd=undefined;
  try{fs.linkSync(stage,file);}
  catch(e){
   if(e.code!=='EEXIST')throw e;
   const stat=fs.lstatSync(file);
   if(!stat.isFile()||stat.size>MAX_BYTES||
     fs.readFileSync(file,'utf8')!==body)
    throw Error('同一输出身份下研究内容冲突，拒绝覆盖');
   return false;
  }
  const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
  return true;
 }finally{
  if(fd!==undefined)fs.closeSync(fd);
  try{fs.unlinkSync(stage);}catch{}
 }
}
function runOnce(conf,{now=Date.now()}={}){
 if(!Number.isSafeInteger(now)||now<=0)throw Error('当前时钟无效');
 const market=read(conf.snapshotFile),members=read(conf.membershipFile);
 const end=Date.parse(market.retrievedAt||'');
 if(conf.mode==='watch'&&(!Number.isSafeInteger(end)||now-end>600000||end>now||
   new Date(now+8*3600000).toISOString().slice(0,10)!==market.date))
  return {status:'not-current-snapshot',changed:false,canTrade:false,
   reason:'本地输入并非当前交易日10分钟内的新快照，不生成实时研究结论'};
 const result=bridgeExistingMarketSector(market,members,{asOf:end});
 const identity=result.status==='imported-unverified'?freezeSectorMemberIdentity(members):null;
 // Never publish an apparently comparable dated study if identity proof fails.
 if(result.status==='imported-unverified'&&identity?.status!=='identity-frozen-unverified')
  throw Error('板块成员身份冻结失败，拒绝生成可比归档');
 const record={schemaVersion:1,mode:'dated-sector-research-only',status:result.status,
  reason:result.reason||null,tradeDate:result.tradeDate||market.date||null,
  observedAt:result.observedAt||end||null,
  data:result,memberIdentity:identity,
  verifiedLive:false,canTrade:false,weightsChanged:false};
 const body=JSON.stringify(record)+'\n';
 if(Buffer.byteLength(body)>MAX_BYTES)throw Error('报告超过32MiB限制');
 const output=conf.mode==='watch'?
  path.join(conf.output, 
   /^\d{4}-\d{2}-\d{2}$/.test(market.date||'')?market.date:'unknown',
   Number.isSafeInteger(end)?String(end)+'.json':'unknown.json'):
  conf.output;
 const changed=newAtomic(output,body);
 return {status:result.status,reason:result.reason||null,changed,
  tradeDate:record.tradeDate,rankedSectorCount:result.study?.rankedSectorCount||0,
  evaluatedSectorCount:result.study?.evaluatedSectorCount||0,
  quoteCoveragePct:result.marketQuoteCoveragePct??null,
  returnMethod:result.returnMethod,canTrade:false,verifiedLive:false};
}
function main(argv=process.argv.slice(2)){
 const conf=parse(argv);
 if(conf.mode==='once')return runOnce(conf);
 let busy=false,previous=null;
 const run=()=>{
  if(busy)return;busy=true;
  try{
   const result=runOnce(conf),line=JSON.stringify(result);
   if(result.changed||line!==previous)console.log(line);
   previous=line;
  }catch(e){
   const line=JSON.stringify({status:'blocked-invalid-evidence',reason:String(e.message).slice(0,140),canTrade:false});
   if(line!==previous)console.error(line);previous=line;
  }finally{busy=false;}
 };
 run();const timer=setInterval(run,conf.interval);
 for(const signal of ['SIGINT','SIGTERM'])
  process.once(signal,()=>{clearInterval(timer);process.exitCode=0;});
 return {mode:'watch',running:true,canTrade:false};
}
if(require.main===module){
 try{const r=main();if(r.mode!=='watch')console.log(JSON.stringify(r));}
 catch(e){console.error(JSON.stringify({status:'blocked-invalid-evidence',reason:String(e.message).slice(0,140),canTrade:false}));process.exitCode=1;}
}
module.exports={parse,runOnce,main};
