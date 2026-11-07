'use strict';
/** Restart-safe research-only journal: no real brokerage connection or alerts. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {scanUniverse}=require('../strategy/universe-scanner');
const {freezeSignals,evaluateForwardOutcomes}=require('../strategy/signal-outcome-journal');
const HASH=data=>crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
const MAX_FILE=32*1024*1024;
function noSymlink(p){
 const full=path.resolve(p);let curr=path.parse(full).root;
 for(const part of full.slice(curr.length).split(path.sep).filter(Boolean)){
  curr=path.join(curr,part);
  if(fs.existsSync(curr)&&fs.lstatSync(curr).isSymbolicLink())throw Error('研究存储路径禁止符号链接');
 }
 return full;
}
function readState(file){
 if(!fs.existsSync(file))return {schemaVersion:1,lifecycle:[],journal:[],revision:0};
 noSymlink(file);
 const stat=fs.statSync(file);
 if(!stat.isFile()||stat.size>MAX_FILE)throw Error('研究归档不是正常的受限文件');
 const r=JSON.parse(fs.readFileSync(file,'utf8'));
 const {integrity,...data}=r;
 if(integrity!==HASH(data)||data.schemaVersion!==1||!Array.isArray(data.lifecycle)||!Array.isArray(data.journal))
  throw Error('研究归档哈希校验失败，拒绝覆盖可能损坏的历史');
 return data;
}
function atomicWrite(file,content){
 noSymlink(file);
 const tmp=file+'.tmp-'+process.pid+'-'+crypto.randomBytes(5).toString('hex');
 const bytes=Buffer.from(content);
 if(bytes.length>MAX_FILE)throw Error('研究输出过大');
 let fd;
 try{
  fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);
  fs.closeSync(fd);fd=null;fs.renameSync(tmp,file);
  const d=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
 }finally{if(fd!==undefined&&fd!==null)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch{}}
}
function createSixLinkageRunner({outputDir}={}){
 if(typeof outputDir!=='string'||!path.isAbsolute(outputDir))throw Error('需要绝对路径的研究归档目录');
 const dir=noSymlink(outputDir);fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const stateFile=path.join(dir,'six-linkages-state.json');
 function runOnce(input){
  if(!input||typeof input!=='object'||!Array.isArray(input.stocks)||input.stocks.length>5000||
    !Number.isFinite(input.asOfMs)||input.asOfMs<=0||input.asOfMs>Date.now()+60000)
   throw Error('需要带真实评估时间和股票K线的研究快照');
  // Never run a less recent input over a newer persisted state.
  const previous=readState(stateFile);
  if(previous.asOfMs&&input.asOfMs<previous.asOfMs)throw Error('研究输入早于上一版快照，拒绝倒序覆盖');
  const scan=scanUniverse({stocks:input.stocks,market:input.market||{},now:input.asOfMs,
   previousStates:previous.lifecycle,requireReal:false});
  const frozen=freezeSignals({items:scan.items,stocks:input.stocks,
   journal:previous.journal,now:input.asOfMs});
  const evaluation=evaluateForwardOutcomes({journal:frozen.journal,stocks:input.stocks,now:input.asOfMs});
  const data={schemaVersion:1,revision:previous.revision+1,asOfMs:input.asOfMs,
   lifecycle:scan.lifecycle.states,journal:frozen.journal,
   metrics:evaluation.metrics,updatedAt:new Date().toISOString()};
  const seal={...data,integrity:HASH(data)};
  atomicWrite(stateFile,JSON.stringify(seal));
  return {mode:'research-only',revision:data.revision,asOfMs:input.asOfMs,
   scanTotal:scan.total,observations:scan.lifecycle.states.length,
   pools:scan.lifecycle.pools,patternPools:scan.patternPools,linkagePools:scan.linkagePools,
   issuerPools:scan.issuerPools,newSignals:frozen.added.length,recordedSignals:frozen.journal.length,
   outcomeMetrics:evaluation.metrics,originalScoresPreserved:true,canTrade:false,canNotify:false,
   stateFile,note:'所有结果来自显式提供的快照，只有部署并调度且接通实际数据源才能持续自动运行'};
 }
 return {runOnce,read:()=>readState(stateFile),stateFile};
}
module.exports={createSixLinkageRunner,readState};
