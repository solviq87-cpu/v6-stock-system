#!/usr/bin/env node
'use strict';
// Opt-in local conversion of an ALREADY imported authorized history dataset.
// Never contacts a market provider, fabricates original observation timestamps,
// updates paper accounts, or publishes into public assets.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {adaptAuthorizedHistory}=require('../src/core/factor-authorized-market-bridge');
const {readJson}=require('../src/core/forward-tracking-store');
const {safeNew,writeNew}=require('./factor-shadow-evolution');

function parse(argv){
 const [mode,sourceFile,outputFile,...flags]=argv;
 if(!['once','sync','watch'].includes(mode)||
   ![sourceFile,outputFile].every(v=>typeof v==='string'&&path.isAbsolute(v)))
  throw Error('用法: authorized-factor-market.js once|sync|watch <已授权历史JSON绝对路径> <私有EOD输出JSON绝对路径> [--interval 60000]');
 if(flags.length&&(mode!=='watch'||flags.length!==2||flags[0]!=='--interval'))
  throw Error('仅watch可使用 --interval');
 const interval=flags.length?Number(flags[1]):60000;
 if(!Number.isSafeInteger(interval)||interval<30000||interval>3600000)
  throw Error('历史行情轮询间隔必须30000至3600000毫秒');
 safeNew(outputFile);safeNew(sourceFile);
 if(path.resolve(sourceFile)===path.resolve(outputFile))
  throw Error('授权行情输入与输出不能使用同一文件');
 return {mode,sourceFile,outputFile,interval};
}
function assertMarketAppend(previous,next){
 if(previous?.schemaVersion!==1||previous?.feed?.source!=='imported'||
    previous.feed.priceBasis!=='unadjusted'||
    !/^[a-f0-9]{64}$/.test(previous.externalSnapshotFingerprint||'')||
    JSON.stringify(previous.feed)!==JSON.stringify(next.feed)||
    !Array.isArray(previous.calendar)||!Array.isArray(previous.stocks)||
    previous.stocks.length!==next.stocks.length||
    !Number.isSafeInteger(previous.observedAt)||previous.observedAt>next.observedAt)
  throw Error('历史行情来源、上一版本或采集时钟不一致，拒绝覆盖');
 if(previous.asOf===next.asOf){
  if(JSON.stringify(previous)===JSON.stringify(next))return false;
  throw Error('同一交易日行情发生改价/改版本，需人工对账而非覆盖');
 }
 if(previous.asOf>next.asOf||previous.calendar.length>=next.calendar.length||
    previous.calendar.some((d,i)=>d!==next.calendar[i]))
  throw Error('历史交易日历被倒退、重排或删除');
 const incoming=new Map(next.stocks.map(x=>[x.symbol,x]));
 if(incoming.size!==next.stocks.length)throw Error('新数据股票代码重复');
 for(const old of previous.stocks){
  const stock=incoming.get(old.symbol);
  if(!stock||!Array.isArray(old.bars)||!Array.isArray(stock.bars)||
    old.bars.length>stock.bars.length||
    old.bars.some((b,i)=>JSON.stringify(b)!==JSON.stringify(stock.bars[i]))||
    !Array.isArray(old.corporateActions)||!Array.isArray(stock.corporateActions)||
    old.corporateActions.some((d,i)=>d!==stock.corporateActions[i]))
   throw Error('历史股票价格、停牌或公司行为发生回写，禁止无声学习');
 }
 return true;
}
function publishCurrent(file,market){
 file=safeNew(file);
 const dir=path.dirname(file);
 fs.mkdirSync(dir,{recursive:true,mode:0o700});safeNew(file);
 const stage=path.join(dir,'.factor-eod-'+process.pid+'-'+crypto.randomBytes(6).toString('hex'));
 let fd;
 try{
  fd=fs.openSync(stage,'wx',0o600);
  fs.writeFileSync(fd,JSON.stringify(market)+'\n');fs.fsyncSync(fd);
  fs.closeSync(fd);fd=undefined;
  safeNew(file);fs.renameSync(stage,file);
  const parent=fs.openSync(dir,'r');
  try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
 }finally{
  if(fd!==undefined)fs.closeSync(fd);
  try{fs.unlinkSync(stage);}catch{}
 }
}
function runOnce({sourceFile,outputFile,mode='sync',now=Date.now()}={}){
 const conf=parse([mode,sourceFile,outputFile]);
 if(!Number.isSafeInteger(now)||now<=0)throw Error('市场观测时间无效');
 fs.mkdirSync(path.dirname(conf.outputFile),{recursive:true,mode:0o700});
 safeNew(conf.outputFile);
 const lock=conf.outputFile+'.lock';
 let fd;
 try{fd=fs.openSync(lock,'wx',0o600);}
 catch(e){if(e.code==='EEXIST')throw Error('已有单写入市场桥进程运行，残留锁需人工核对');throw e;}
 try{
  fs.writeFileSync(fd,String(process.pid));fs.fsyncSync(fd);
  const original=readJson(conf.sourceFile);
  const converted=adaptAuthorizedHistory(original,{now});
  if(fs.existsSync(conf.outputFile)){
   const previous=readJson(conf.outputFile);
   if(conf.mode==='once'){
    if(JSON.stringify(previous)!==JSON.stringify(converted))
     throw Error('已有不同的不可覆盖EOD历史证据');
    return {ok:true,status:'unchanged',asOf:converted.asOf,
     stocks:converted.stocks.length,canTrade:false};
   }
   if(!assertMarketAppend(previous,converted))
    return {ok:true,status:'unchanged',asOf:converted.asOf,
     stocks:converted.stocks.length,canTrade:false};
  }
  if(conf.mode==='once')writeNew(conf.outputFile,converted);
  else publishCurrent(conf.outputFile,converted);
  return {ok:true,status:'authorized-contract-adapted',
   asOf:converted.asOf,stocks:converted.stocks.length,
   tradingDates:converted.calendar.length,
   snapshotFingerprint:converted.externalSnapshotFingerprint,
   provenanceCertified:false,providerAuthorizedIndependently:false,
   canTrade:false,productionWeightsChanged:false};
 }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
function main(argv){
 const conf=parse(argv);
 if(conf.mode!=='watch')return runOnce(conf);
 let busy=false,stopped=false,lastError=null;
 const tick=()=>{
  if(busy||stopped)return;busy=true;
  try{
   const out=runOnce({...conf,mode:'sync'});
   if(out.status!=='unchanged')console.log(JSON.stringify(out));
   lastError=null;
  }catch(e){
   const reason=String(e.message).slice(0,200);
   if(reason!==lastError)console.error(JSON.stringify({ok:false,error:reason}));
   lastError=reason;
  }finally{busy=false;}
 };
 tick();
 const timer=setInterval(tick,conf.interval);
 const stop=()=>{stopped=true;clearInterval(timer);};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 return {ok:true,mode:'watch',canTrade:false};
}
if(require.main===module){
 try{const result=main(process.argv.slice(2));
  if(result.mode!=='watch')console.log(JSON.stringify(result));}
 catch(e){console.error(JSON.stringify({ok:false,error:String(e.message).slice(0,200)}));process.exitCode=1;}
}
module.exports={parse,assertMarketAppend,runOnce,main};
