#!/usr/bin/env node
'use strict';
// Operator-enabled evidence-only daily research joiner. No network, no trades.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {readJson,runOnce:runForwardOnce}=require('../src/core/forward-tracking-store');
const {discoverCaptures,firstMaturedArchive,createManifest,hash}=
 require('../src/core/factor-maturity-manifest');
const {safeNew,writeNew}=require('./factor-shadow-evolution');
function parse(argv){
 const [mode,captureDir,marketFile,trackingDir,manifestFile,...rest]=argv;
 if(!['once','watch'].includes(mode)||![captureDir,marketFile,trackingDir,manifestFile]
     .every(x=>typeof x==='string'&&path.isAbsolute(x)))
  throw Error('用法: factor-maturity-link.js once|watch <每日冻结目录> <持续更新授权历史行情JSON> <私有观察归档目录> <共享manifest绝对路径> [--interval 60000]');
 if(rest.length&&(mode!=='watch'||rest.length!==2||rest[0]!=='--interval'))
  throw Error('仅watch允许 --interval 毫秒');
 const interval=rest.length?Number(rest[1]):60000;
 if(!Number.isSafeInteger(interval)||interval<30000||interval>3600000)
  throw Error('研究归档轮询只允许30000至3600000毫秒');
 safeNew(path.join(trackingDir,'worker-guard.json'));
 safeNew(manifestFile);
 return {mode,captureDir,marketFile,trackingDir,manifestFile,interval};
}
function immutableManifest(file,manifest){
 file=safeNew(file);
 if(fs.existsSync(file)){
  if(JSON.stringify(readJson(file))!==JSON.stringify(manifest))
   throw Error('相同指纹的不可变历史manifest发生冲突');
  return false;
 }
 writeNew(file,manifest);
 return true;
}
function atomicCurrent(file,manifest){
 file=safeNew(file);
 const dir=path.dirname(file);
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 safeNew(file);
 if(fs.existsSync(file)){
  const prior=readJson(file),{integrity,...body}=prior;
  if(prior?.mode!=='v6-forward-training-manifest'||integrity!==hash(body))
   throw Error('原共享manifest损坏，禁止覆盖或跳过');
  if(JSON.stringify(prior)===JSON.stringify(manifest))return false;
 }
 const stage=path.join(dir,'.manifest-current-'+process.pid+'-'+crypto.randomBytes(6).toString('hex'));
 let fd;
 try{
  fd=fs.openSync(stage,'wx',0o600);
  fs.writeFileSync(fd,JSON.stringify(manifest,null,2)+'\n');fs.fsyncSync(fd);
  fs.closeSync(fd);fd=null;
  fs.renameSync(stage,file);
  const d=fs.openSync(dir,'r');
  try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
 }finally{
  if(fd!==null&&fd!==undefined)fs.closeSync(fd);
  try{fs.unlinkSync(stage);}catch{}
 }
 return true;
}
function runOnce({captureDir,marketFile,trackingDir,manifestFile,now=Date.now()}={}){
 parse(['once',captureDir,marketFile,trackingDir,manifestFile]);
 if(!Number.isSafeInteger(now)||now<=0)throw Error('研究汇总时钟无效');
 fs.mkdirSync(trackingDir,{recursive:true,mode:0o700});
 safeNew(path.join(trackingDir,'worker-guard.json'));
 const lock=path.join(trackingDir,'.factor-maturity-link.lock');
 let fd;
 try{fd=fs.openSync(lock,'wx',0o600);}
 catch(error){
  if(error.code==='EEXIST')throw Error('已有前瞻因子汇总进程，禁止并发；残留锁必须核实');
  throw error;
 }
 try{
  fs.writeFileSync(fd,String(process.pid));fs.fsyncSync(fd);
  const captures=discoverCaptures(captureDir,{now});
  const market=readJson(marketFile);
  if(market?.schemaVersion!==1||market.feed?.source!=='imported'||
     typeof market.asOf!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(market.asOf)||
     !Array.isArray(market.stocks)||market.stocks.length>500)
   throw Error('需要当日有明确来源/交易日历的授权历史行情集合');
  const bySymbol=new Map();
  for(const stock of market.stocks){
   if(!stock||typeof stock.symbol!=='string'||bySymbol.has(stock.symbol))
    throw Error('授权历史行情股票代码无效或重复');
   bySymbol.set(stock.symbol,stock);
  }
  const matured=[],pending=[];
  for(const entry of captures){
   if(entry.date>market.asOf){pending.push(entry.date);continue;}
   const symbols=[...new Set(entry.cohort.signals.map(s=>s.symbol))];
   const selected=symbols.map(symbol=>bySymbol.get(symbol));
   if(selected.some(s=>!s))throw Error('候选股票缺少同源授权历史行情，拒绝跳过部分股票');
   const scopedMarket={...market,stocks:selected};
   const stateFile=safeNew(path.join(trackingDir,entry.date,'current.json'));
   // Durable observation, no regression, no rewriting previously observed H5.
   runForwardOnce({cohort:entry.cohort,market:scopedMarket,stateFile,now});
   const first=firstMaturedArchive(stateFile,entry.features,{now});
   if(first)matured.push({day:entry.date,featuresFile:entry.featuresFile,
    reportFile:first});
   else pending.push(entry.date);
  }
  if(!matured.length)
   return {ok:true,status:'no-matured-5day-observations',
    frozenDays:captures.length,maturedDays:0,pendingDays:pending.length,
    trainingReady:false,canTrade:false,productionWeightsChanged:false};
  const manifest=createManifest(matured);
  const history=path.join(path.dirname(manifestFile),'factor-manifest-history',
   'manifest-'+manifest.integrity+'.json');
  immutableManifest(history,manifest);
  const changed=atomicCurrent(manifestFile,manifest);
  return {ok:true,status:changed?'manifest-advanced':'manifest-unchanged',
   frozenDays:captures.length,maturedDays:matured.length,
   pendingDays:pending.length,trainingReady:matured.length>=36,
   manifestFingerprint:manifest.integrity,canTrade:false,
   productionWeightsChanged:false};
 }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
function main(argv){
 const options=parse(argv);
 if(options.mode==='once')return runOnce(options);
 let running=false,stopped=false,lastError=null;
 const tick=()=>{
  if(running||stopped)return;running=true;
  try{
   const result=runOnce(options);
   if(result.status!=='manifest-unchanged')console.log(JSON.stringify(result));
   lastError=null;
  }catch(error){
   const msg=String(error.message).slice(0,220);
   if(msg!==lastError)console.error(JSON.stringify({ok:false,error:msg}));
   lastError=msg;
  }finally{running=false;}
 };
 tick();
 const timer=setInterval(tick,options.interval);
 const stop=()=>{stopped=true;clearInterval(timer);};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 return {ok:true,mode:'watch',canTrade:false};
}
if(require.main===module){
 try{const result=main(process.argv.slice(2));
  if(result?.mode!=='watch')console.log(JSON.stringify(result));}
 catch(error){console.error(JSON.stringify({ok:false,error:String(error.message).slice(0,220)}));process.exitCode=1;}
}
module.exports={parse,runOnce,main};
