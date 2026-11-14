'use strict';
/** External historical OHLCV ingestion, fail-closed provenance and atomic handoff to paper monitor. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {validateDataset}=require('./historical-validation');
const {assertAppend}=require('./paper-session');
const {aShareCalendarDate,assessDailyBarFinality}=require('./a-share-calendar');
const {compareMarketFeeds}=require('./market-feed-consensus');
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const stable=x=>JSON.stringify(x);
function atomicWrite(file,content){
 const dest=path.resolve(file),dir=path.dirname(dest);fs.mkdirSync(dir,{recursive:true});
 const tmp=path.join(dir,'.'+path.basename(dest)+'.'+crypto.randomBytes(8).toString('hex')+'.tmp');
 let fd;try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,content);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,dest);
 try{const d=fs.openSync(dir,'r');fs.fsyncSync(d);fs.closeSync(d);}catch{}}
 finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch{}}
}
function validateSourceUrl(value){
 const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port&&u.port!=='443')throw Error('外部行情接口必须是无凭据的标准 HTTPS 地址');
 if(!u.hostname.includes('.')||u.hostname==='localhost'||/^(?:\d{1,3}\.){3}\d{1,3}$/.test(u.hostname)||u.hostname.endsWith('.local'))throw Error('行情地址必须是公网域名');
 return u.toString();
}
function validateImport(data,{provider,datasetId,now=Date.now()}={}){
 if(!provider||!datasetId||!/^[a-zA-Z0-9_.:-]{3,100}$/.test(provider)||!/^[a-zA-Z0-9_.:-]{3,120}$/.test(datasetId))throw Error('缺少可信数据源标识');
 if(!data||data.source!=='imported'||data.provider!==provider||data.datasetId!==datasetId)throw Error('行情来源与配置不一致');
 const details=validateDataset(data);
 if(!details.firstDate||!details.lastDate)throw Error('外部行情必须包含完整交易日期');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(data.asOf)||data.asOf<details.lastDate)throw Error('行情截至日期无效');
 // Imported historical snapshots cannot claim knowledge of a future trading day.
 const today=aShareCalendarDate(now);
 if(data.asOf>today||details.lastDate>today)throw Error('外部行情包含未来日期，拒绝导入');
 if(data.stocks.some(s=>s.bars.some(b=>b.date>data.asOf)))throw Error('存在未来交易日');
 // A live import must not bypass the same-day close gate enforced by the
 // research upload and cached K-line adapters. This is not provider certification.
 const gate=assessDailyBarFinality(details.lastDate,{observedAt:now,now});
 if(!gate.usable)throw Error(gate.reason||'日K完成度门禁未通过');
 return details;
}
function createMarketDataCenter({url,outputFile,provider,datasetId,fetchImpl=globalThis.fetch,timeoutMs=12000,maxBytes=30*1024*1024,clock=Date.now,secondaryFile}={}){
 const sourceUrl=validateSourceUrl(url);
 if(!outputFile||typeof fetchImpl!=='function'||typeof clock!=='function')throw Error('需要输出文件、fetch及可信时钟实现');
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000||!Number.isInteger(maxBytes)||maxBytes<1024||maxBytes>30*1024*1024)throw Error('请求限制无效');
 let lastAttempt=null,lastSuccess=null,lastError=null,lastDigest=null,updates=0,busy=false;
 async function sync(){
  if(busy)return {updated:false,reason:'busy'};
  busy=true;lastAttempt=new Date().toISOString();
  try{
   const response=await fetchImpl(sourceUrl,{method:'GET',redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{Accept:'application/json'}});
   if(!response.ok)throw Error('行情服务返回 HTTP '+response.status);
   const contentType=response.headers?.get?.('content-type');
   if(contentType&&!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|\s*$)/i.test(contentType))throw Error('行情响应必须是 JSON 类型');
   const length=Number(response.headers?.get?.('content-length'));
   if(Number.isFinite(length)&&length>maxBytes)throw Error('行情响应体超过限制');
   let total=0;const chunks=[];
   if(!response.body||typeof response.body[Symbol.asyncIterator]!=='function')throw Error('行情响应缺少可读数据流');
   for await(const chunk of response.body){total+=chunk.length;if(total>maxBytes)throw Error('行情响应体超过限制');chunks.push(chunk);}
   const raw=Buffer.concat(chunks).toString('utf8');const incoming=JSON.parse(raw);
   const observedAt=clock();
   const details=validateImport(incoming,{provider,datasetId,now:observedAt});
   let consensus=null;
   if(secondaryFile){
    // Optional independent feed gate: on disagreement do not alter the last good file.
    const stat=fs.lstatSync(secondaryFile);
    if(!stat.isFile()||stat.size>maxBytes)throw Error('独立行情对照文件无效或超过上限');
    const reference=JSON.parse(fs.readFileSync(secondaryFile,'utf8'));
    consensus=compareMarketFeeds(incoming,reference);
    if(!consensus.consensus)throw Error('双供应商行情不一致，共 '+consensus.discrepancies+' 项差异');
    // The optional comparison file is a WRITE GATE, not just a displayed
    // diagnostic: distinct names or equal numbers alone never authorize import.
    if(consensus.evidenceQuality?.status!=='consistent-research-only')
     throw Error('双源上游、时间、股数、实际成交额或逐日停牌状态证据不足，拒绝写入历史');
    if(incoming.observedAt>observedAt||reference.observedAt>observedAt)
     throw Error('双源采集时点位于导入时钟未来，拒绝写入历史');
   }
   let changed=true;
   if(fs.existsSync(outputFile)){
    const previous=JSON.parse(fs.readFileSync(outputFile,'utf8'));
    validateImport(previous,{provider,datasetId,now:observedAt});
    changed=assertAppend(previous,incoming);
   }
   if(changed){atomicWrite(outputFile,stable(incoming)+'\n');updates++;}
   lastDigest=digest(stable(incoming));lastSuccess=new Date().toISOString();lastError=null;
   return {updated:changed,hash:lastDigest,details,asOf:incoming.asOf,consensus:consensus?{matched:consensus.consensus,comparedBars:consensus.comparedBars,secondary:consensus.secondary,evidenceQuality:consensus.evidenceQuality,bySymbol:consensus.bySymbol,suspensionCoverage:consensus.suspensionCoverage}:null};
  }catch(e){lastError=e.message;return {updated:false,error:lastError};}
  finally{busy=false;}
 }
 function status(){return {mode:'external-history-import',provider,datasetId,verifiedLive:false,canTrade:false,lastAttempt,lastSuccess,lastError,lastDigest,updates,busy};}
 return {sync,status};
}
module.exports={createMarketDataCenter,validateImport,validateSourceUrl,atomicWrite};
