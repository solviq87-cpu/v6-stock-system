'use strict';
// Explicit editor read only. One bounded worker, no new account, no disk archive,
// no unbounded queue, no account details or error strings in runtime metrics.
const fs=require('node:fs'),path=require('node:path');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const {performance}=require('node:perf_hooks');
const {accountExitDiagnostics,unavailable}=require('../core/advanced-account-risk');
const {aShareCalendarDate}=require('../core/a-share-calendar');
const mode='advanced-account-risk-readonly';
const samples=[];
let active=false;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const stamp=x=>Number.isSafeInteger(x)&&x>0&&x<=8e15;
const absoluteRoot=x=>typeof x==='string'&&x.length<=4096&&!x.includes('\0')&&path.isAbsolute(x);
function boundedPortfolioContext(value){
 if(!plain(value))throw Error('invalid portfolio context');
 const allowed=['history','plans','planChecks','classifications','equityEvidence','opportunityEvidence','scenarioPolicy'];
 let bytes=0,nodes=0;
 const seen=new Set();
 const copy=(item,depth=0)=>{
  if(++nodes>350000||depth>12)throw Error('portfolio context depth/size');
  if(item===null||typeof item==='boolean'){bytes+=5;return item;}
  if(typeof item==='number'){if(!Number.isFinite(item))throw Error('invalid number');bytes+=24;return item;}
  if(typeof item==='string'){if(item.length>2048)throw Error('oversized string');bytes+=Buffer.byteLength(item,'utf8')+2;if(bytes>8*1024*1024)throw Error('portfolio byte budget');return item;}
  if(typeof item!=='object'||seen.has(item))throw Error('invalid or cyclic context');
  seen.add(item);let out;
  if(Array.isArray(item)){
   if(item.length>16000)throw Error('portfolio row budget');bytes+=item.length+2;out=item.map(x=>copy(x,depth+1));
  }else{
   if(!plain(item))throw Error('invalid context object');
   const keys=Object.keys(item);if(keys.length>2000)throw Error('portfolio object budget');out={};
   for(const key of keys){
    if(key.length>128||['__proto__','constructor','prototype'].includes(key))throw Error('invalid context key');
    bytes+=Buffer.byteLength(key,'utf8')+4;
    if(item[key]!==undefined)out[key]=copy(item[key],depth+1);
   }
  }
  seen.delete(item);if(bytes>8*1024*1024)throw Error('portfolio byte budget');return out;
 };
 const selected={};for(const key of allowed)if(value[key]!==undefined)selected[key]=value[key];
 return copy(selected);
}
// Worker construction clones its input synchronously in the parent. A row count
// alone is not a memory/time bound: copy only the original gate's small scalar
// fields, and reject oversized provenance instead of silently truncating it.
function boundedContext(input,now){
 if(!plain(input)||!absoluteRoot(input.root)||input.historyRoot!==undefined&&!absoluteRoot(input.historyRoot)||
   !stamp(input.requestAt)||input.requestAt>now||now-input.requestAt>5000||input.day!==aShareCalendarDate(input.requestAt)||
   typeof input.marketOpen!=='boolean'||typeof input.continuous!=='boolean'||input.continuous&&!input.marketOpen||!plain(input.quotes))return null;
 const keys=Object.keys(input.quotes);if(keys.length>220)return null;
 const quotes={};
 for(const code of keys){
  const row=input.quotes[code],raw=row?.quote;
  if(!/^\d{6}$/.test(code)||!plain(row)||!plain(raw)||raw.code!==code)return null;
  const quote={code};
  for(const key of ['price','quoteAt','receivedAt']){
   const value=raw[key];
   if(value!==undefined&&value!==null&&(key==='price'?typeof value!=='number'||!Number.isFinite(value):!stamp(value)))return null;
   if(value!==undefined)quote[key]=value;
  }
  for(const [key,max] of [['quoteSource',100],['quoteMode',80],['mode',80],['tradeDate',10]]){
   const value=raw[key];
   if(value!==undefined&&value!==null&&(typeof value!=='string'||value.length>max))return null;
   if(value!==undefined)quote[key]=value;
  }
  for(const key of ['canTrade','canNotify','simulated','readOnlyBackup','imported','fixture','mock','synthetic','tradable','suspended']){
   const value=raw[key];
   if(value!==undefined&&value!==null&&typeof value!=='boolean')return null;
   if(value!==undefined)quote[key]=value;
  }
  for(const key of ['limitDown','suspended'])if(row[key]!==undefined&&row[key]!==null&&typeof row[key]!=='boolean')return null;
  quotes[code]={quote,limitDown:row.limitDown??null,suspended:row.suspended??null};
 }
 const output={root:input.root,requestAt:input.requestAt,day:input.day,marketOpen:input.marketOpen,continuous:input.continuous,quotes,replica:false};
 if(input.historyRoot!==undefined)output.historyRoot=input.historyRoot;
 if(input.portfolioContext!==undefined){
  try{output.portfolioContext=boundedPortfolioContext(input.portfolioContext);output.portfolioContextStatus='bounded';}
  catch{output.portfolioContextStatus='invalid-or-over-budget';}
 }
 return output;
}
function metrics(){
 const sorted=samples.map(x=>x.ms).sort((a,b)=>a-b),pct=p=>sorted.length?sorted[Math.ceil(sorted.length*p)-1]:null;
 return {stage:'advanced-account-risk-read',sampleCount:sorted.length,p50Ms:pct(.5),p95Ms:pct(.95),failures:samples.filter(x=>x.status!=='observed').length,scope:'this-process bounded worker requests only'};
}
function portfolioFor(book,input,account,now){
 const context={...(input.portfolioContext||{})};
 // History must come from the existing server-owned archive and its hash/PIT
 // checks. A caller's context cannot replace it, even when that context fits.
 delete context.history;
 const held=Object.entries(book.account.positions).filter(([,row])=>row?.quantity>0).map(([code])=>code);
 const plans=Array.isArray(context.plans?.[account])?context.plans[account]:[];
 const codes=[...new Set([...held,...plans.map(plan=>plan?.code)].filter(code=>typeof code==='string'&&/^\d{6}$/.test(code)))].slice(0,20);
 if(input.historyRoot)try{
  context.history=require('../core/center-history').readCenterHistory({root:input.historyRoot,codes,now});
 }catch{context.history={coverage:{status:'unavailable',reason:'ORIGINAL_HISTORY_READ_UNAVAILABLE'}};}
 return context;
}
function readBooks(input){
 const now=Date.now(),day=aShareCalendarDate(now);
 if(day!==input.day)return {mode,status:'clock-changed',accounts:[],canTrade:false,writesAccount:false};
 const governance={pool:null,pre:null};
 const accounts=['pool','pre'].map(account=>{
  try{
   const file=path.join(input.root,account+'.json'),st=fs.lstatSync(file);
   if(!st.isFile()||st.isSymbolicLink()||st.size>20*1024*1024)return unavailable(account,'INVALID_EXISTING_ACCOUNT_FILE');
   // Use the exact original service's integrity and cash/order/fill validation.
   const book=require('../core/paper-application-service').createPaperApplicationService({file,readOnly:true}).read();
   const portfolioContext=portfolioFor(book,input,account,Date.now());
   governance[account]=portfolioContext.history?.coverage?.governance??null;
   const checkedAt=Date.now();
   if(aShareCalendarDate(checkedAt)!==day)return unavailable(account,'CLOCK_CHANGED');
   return accountExitDiagnostics(book,{...input,portfolioContext,account,now:checkedAt,
    continuous:input.continuous&&checkedAt-input.requestAt<=5000});
  }catch{return unavailable(account,'ORIGINAL_READ_REJECTED_OR_UNAVAILABLE');}
 });
 return {mode,status:accounts.every(x=>x.status==='observed-unverified')?'observed':'incomplete',accounts,governance,canTrade:false,writesAccount:false};
}
function runAdvancedAccountRiskJob(input){
 const empty=status=>({mode,status,accounts:[],canTrade:false,writesAccount:false,telemetry:metrics()});
 if(input?.replica===true)return Promise.resolve(empty('replica'));
 if(active)return Promise.resolve(empty('busy'));
 let bounded;try{bounded=boundedContext(input,Date.now());}catch{return Promise.resolve(empty('invalid-context'));}
 if(!bounded)return Promise.resolve(empty('invalid-context'));
 active=true;const start=performance.now();
 return new Promise(resolve=>{
  let worker,timer,done=false;
  const finish=async result=>{
   if(done)return;done=true;clearTimeout(timer);
   try{await worker?.terminate();}catch{}finally{
    active=false;
    samples.push({ms:Math.round(performance.now()-start),status:result.status});if(samples.length>128)samples.shift();
    resolve({...result,telemetry:metrics()});
   }
  };
  try{
   worker=new Worker(__filename,{workerData:{kind:mode,input:bounded},resourceLimits:{maxOldGenerationSizeMb:128}});
   worker.once('message',finish);
   worker.once('error',()=>finish(empty('worker-error')));
   worker.once('exit',()=>finish(empty('worker-exit')));
   timer=setTimeout(()=>finish(empty('timeout')),8000);
  }catch{void finish(empty('worker-start-failed'));}
 });
}
if(!isMainThread&&workerData?.kind===mode){
 try{parentPort.postMessage(readBooks(workerData.input));}
 catch{parentPort.postMessage({mode,status:'unavailable',accounts:[],canTrade:false,writesAccount:false});}
}
module.exports={runAdvancedAccountRiskJob};
