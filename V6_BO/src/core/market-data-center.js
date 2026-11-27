'use strict';
/** External historical OHLCV ingestion, fail-closed provenance and atomic handoff to paper monitor. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {validateDataset}=require('./historical-validation');
const {assertAppend}=require('./paper-session');
const {aShareCalendarDate,assessDailyBarFinality}=require('./a-share-calendar');
const {compareMarketFeeds}=require('./market-feed-consensus');
const evidence=require('./market-data-evidence');
const {withAccountLock}=require('./account-process-lock');
const researchStore=require('./research-workspace-store');
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const stable=x=>JSON.stringify(x);
function atomicWrite(file,content,{beforeRename}={}){
 const dest=path.resolve(file),dir=path.dirname(dest);fs.mkdirSync(dir,{recursive:true});
 const tmp=path.join(dir,'.'+path.basename(dest)+'.'+crypto.randomBytes(8).toString('hex')+'.tmp');
 let fd;try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,content);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
 // Recheck time-sensitive invariants after staging I/O, while the authoritative
 // destination is still untouched. A rejected synchronous guard uses the same cleanup.
 if(beforeRename!==undefined)beforeRename();
 fs.renameSync(tmp,dest);
 try{const d=fs.openSync(dir,'r');fs.fsyncSync(d);fs.closeSync(d);}catch{}}
 finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch{}}
}
function validateSourceUrl(value){
 const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port&&u.port!=='443')throw Error('外部行情接口必须是无凭据的标准 HTTPS 地址');
 if(!u.hostname.includes('.')||u.hostname==='localhost'||/^(?:\d{1,3}\.){3}\d{1,3}$/.test(u.hostname)||u.hostname.endsWith('.local'))throw Error('行情地址必须是公网域名');
 return u.toString();
}
function validateImport(data,{provider,datasetId,now=Date.now()}={}){
 if(!Number.isSafeInteger(now)||now<=0||!Number.isFinite(new Date(now).getTime()))throw Error('行情校验时钟无效');
 if(!provider||!datasetId||!/^[a-zA-Z0-9_.:-]{3,100}$/.test(provider)||!/^[a-zA-Z0-9_.:-]{3,120}$/.test(datasetId))throw Error('缺少可信数据源标识');
 if(!data||data.source!=='imported'||data.provider!==provider||data.datasetId!==datasetId)throw Error('行情来源与配置不一致');
 if(data.observedAt!==undefined&&(!Number.isSafeInteger(data.observedAt)||data.observedAt<=0||data.observedAt>now))throw Error('行情声明的采集时点无效或位于接收时钟未来');
 const details=validateDataset(data);
 if(!details.firstDate||!details.lastDate)throw Error('外部行情必须包含完整交易日期');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(data.asOf)||data.asOf<details.lastDate)throw Error('行情截至日期无效');
 // Imported historical snapshots cannot claim knowledge of a future trading day.
 const today=aShareCalendarDate(now);
 if(data.asOf>today||details.lastDate>today)throw Error('外部行情包含未来日期，拒绝导入');
 if(data.stocks.some(s=>s.bars.some(b=>b.date>data.asOf)))throw Error('存在未来交易日');
 // A live import must not bypass the same-day close gate enforced by the
 // research upload and cached K-line adapters. This is not provider certification.
 const gate=assessDailyBarFinality(details.lastDate,{observedAt:data.observedAt??now,now});
 if(!gate.usable)throw Error(gate.reason||'日K完成度门禁未通过');
 return details;
}
function createMarketDataCenter({url,outputFile,provider,datasetId,fetchImpl=globalThis.fetch,timeoutMs=12000,maxBytes=30*1024*1024,clock=Date.now,secondaryFile,evidenceRoot,canWrite=()=>true}={}){
 const sourceUrl=validateSourceUrl(url);
 if(!outputFile||typeof fetchImpl!=='function'||typeof clock!=='function'||typeof canWrite!=='function')throw Error('需要输出文件、fetch及可信时钟实现');
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000||!Number.isInteger(maxBytes)||maxBytes<1024||maxBytes>30*1024*1024)throw Error('请求限制无效');
 const root=evidenceRoot||path.resolve(outputFile)+'.evidence';
 let lastAttempt=null,lastSuccess=null,lastError=null,lastDigest=null,lastEvidence=null,updates=0,busy=false;
 const writable=()=>{try{return canWrite()===true;}catch{return false;}};
 let clockHighWater=0;
 function sampleClock(){
  const now=clock();
  if(!Number.isSafeInteger(now)||now<=0||now>Date.now()||now<clockHighWater)throw Error('行情采集或回放时钟无效或倒退');
  clockHighWater=now;return now;
 }
 function decodeRaw(raw){
  const text=raw.toString('utf8');
  if(!Buffer.from(text,'utf8').equals(raw))throw Error('原始字节不是有效 UTF-8');
  return JSON.parse(text);
 }
 function processRaw(raw,{receivedAt,availableAt=receivedAt,replayOf=null,review=null,requestId}={}){
  let incoming,details=null,consensus=null,receipt=null,referenceRaw=null,referenceMetadata=null,
   independentReferenceRequired=Boolean(secondaryFile);
  const remember=(status,reason=null)=>evidence.appendReceipt({root,raw,provider,datasetId,receivedAt,availableAt,status,reason,details,
   sourceObservedAt:Number.isSafeInteger(incoming?.observedAt)?incoming.observedAt:null,
   factorVersion:typeof incoming?.factorVersion==='string'&&incoming.factorVersion.length<=128?incoming.factorVersion:null,
   replayOf,review,requestId,referenceRaw,referenceMetadata,independentReferenceRequired});
  try{
   if(!writable())throw Error('只读实例不能写入行情或复核结果');
   independentReferenceRequired=independentReferenceRequired||evidence.readReceipts(root,{provider,datasetId})
    .some(event=>event.data.gateRequirements.independentReferenceRequired);
   if(independentReferenceRequired&&!secondaryFile)throw Error('原历史回执要求独立对照来源，不得省略原双源门禁');
   try{incoming=decodeRaw(raw);}catch{throw Error('原始行情JSON解析失败');}
   // Replay uses the original receipt clock too. Waiting until close cannot
   // turn bytes collected before the close into a completed daily bar.
   details=validateImport(incoming,{provider,datasetId,now:receivedAt});
   if(secondaryFile){
    const fd=fs.openSync(secondaryFile,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
    try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>maxBytes)throw Error('独立行情对照文件无效或超过上限');referenceRaw=fs.readFileSync(fd);}
    finally{fs.closeSync(fd);}
    let reference;try{reference=decodeRaw(referenceRaw);}catch{throw Error('独立行情原始JSON解析失败');}
    referenceMetadata={provider:reference?.provider,datasetId:reference?.datasetId,observedAt:reference?.observedAt};
    consensus=compareMarketFeeds(incoming,reference);
    if(!consensus.consensus)throw Error('双供应商行情不一致，共 '+consensus.discrepancies+' 项差异');
    if(consensus.evidenceQuality?.status!=='consistent-research-only')
     throw Error('双源上游、时间、股数、实际成交额或逐日停牌状态证据不足，拒绝写入历史');
    if(incoming.observedAt>receivedAt||reference.observedAt>availableAt)
     throw Error('双源采集时点位于导入时钟未来，拒绝写入历史');
   }
   let changed=true;
   if(fs.existsSync(outputFile)){
    const previous=JSON.parse(fs.readFileSync(outputFile,'utf8'));
    validateImport(previous,{provider,datasetId,now:availableAt});changed=assertAppend(previous,incoming);
   }
   if(!writable())throw Error('只读实例不能写入行情或复核结果');
   // A durable raw receipt and original-gate decision precede the handoff.
   // Storage exhaustion or corruption therefore cannot silently bypass audit.
   receipt=remember('admitted');lastEvidence={id:receipt.hash,status:'admitted',availableAt};
   if(!writable())throw Error('只读实例不能写入行情或复核结果');
   if(changed){atomicWrite(outputFile,stable(incoming)+'\n',{beforeRename:()=>{if(!writable())throw Error('只读实例不能发布行情');sampleClock();}});updates++;}
   lastDigest=digest(stable(incoming));lastSuccess=new Date().toISOString();lastError=null;
   return {updated:changed,hash:lastDigest,details,asOf:incoming.asOf,evidence:{...lastEvidence,dataVersion:receipt.data.dataVersion},
    consensus:consensus?{matched:consensus.consensus,comparedBars:consensus.comparedBars,secondary:consensus.secondary,evidenceQuality:consensus.evidenceQuality,bySymbol:consensus.bySymbol,suspensionCoverage:consensus.suspensionCoverage}:null};
  }catch(error){
   lastError=error.message;
   if(!receipt&&writable()){
    try{const saved=remember('quarantined',lastError);lastEvidence={id:saved.hash,status:'quarantined',availableAt};}
    catch{lastError+='；原始隔离证据未能持久保存，未更新历史输出';lastEvidence={id:null,status:'evidence-storage-blocked',availableAt:null};}
   }
   return {updated:false,error:lastError,evidence:lastEvidence};
  }
 }
 function lockedProcess(raw,options){
  if(!writable())return {updated:false,error:'只读实例不能写入行情或复核结果'};
  researchStore.privateRoot(root,true);
  fs.mkdirSync(path.dirname(path.resolve(outputFile)),{recursive:true,mode:0o700});
  return withAccountLock(path.resolve(outputFile),()=>processRaw(raw,options));
 }
 async function sync(){
  if(busy)return {updated:false,reason:'busy'};
  if(!writable())return {updated:false,error:'只读实例不能采集或写入行情'};
  busy=true;
  try{
   lastAttempt=new Date(sampleClock()).toISOString();
   const response=await fetchImpl(sourceUrl,{method:'GET',redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{Accept:'application/json'}});
   sampleClock();
   if(response?.ok!==true||response.status!==200)throw Error('行情服务返回 HTTP '+response?.status);
   if(response.redirected===true||(response.url&&response.url!==sourceUrl))throw Error('行情响应发生重定向或地址不一致');
   const contentType=response.headers?.get?.('content-type');
   if(contentType&&!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|\s*$)/i.test(contentType))throw Error('行情响应必须是 JSON 类型');
   const declared=response.headers?.get?.('content-length');
   const length=declared==null?null:Number(declared);
   if(declared!=null&&(typeof declared!=='string'||!/^\d+$/.test(declared)||!Number.isSafeInteger(length)||length>maxBytes))throw Error('行情响应体长度无效或超过限制');
   let total=0;const chunks=[];
   if(!response.body||typeof response.body[Symbol.asyncIterator]!=='function')throw Error('行情响应缺少可读数据流');
   for await(const chunk of response.body){sampleClock();if(!(chunk instanceof Uint8Array))throw Error('行情响应不是原始字节流');total+=chunk.byteLength;if(total>maxBytes)throw Error('行情响应体超过限制');chunks.push(Buffer.from(chunk));}
   const encoding=response.headers?.get?.('content-encoding');
   if(length!==null&&(!encoding||encoding.toLowerCase()==='identity')&&total!==length)throw Error('行情响应体长度与声明不一致');
   const receivedAt=sampleClock();
   return lockedProcess(Buffer.concat(chunks),{receivedAt});
  }catch(e){lastError=e.message;return {updated:false,error:lastError};}
  finally{busy=false;}
 }
 // This internal API must be called with the authenticated server reviewer,
 // never a self-certified client gate. It cannot alter source bytes or gates.
 async function replay({quarantineId,reviewerId,reason,requestId}={}){
  if(!/^[a-f0-9]{64}$/.test(quarantineId||'')||typeof reviewerId!=='string'||!reviewerId.trim()||reviewerId.length>128||/[\x00-\x1f\x7f]/.test(reviewerId)||
     typeof reason!=='string'||reason.trim().length<8||reason.length>1000||/[\x00-\x1f\x7f]/.test(reason)||!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId||''))
   throw Error('隔离回放需要原回执、审核人、原因及请求ID');
  if(busy)return {updated:false,reason:'busy'};
  if(!writable())return {updated:false,error:'只读实例不能复核行情'};
  busy=true;
  try{
   const now=sampleClock();
   const events=evidence.readReceipts(root,{asOf:now,provider,datasetId,verifyRaw:true}),prior=events.find(event=>event.requestId===requestId);
   if(prior){
    if(prior.data.replayOf!==quarantineId||prior.data.review?.reviewerId!==reviewerId||prior.data.review?.reason!==reason)throw Error('复核请求ID内容冲突');
    return {updated:false,reused:true,evidence:{id:prior.hash,status:prior.data.status,availableAt:prior.recordedAt},canTrade:false};
   }
   const original=events.find(event=>event.hash===quarantineId&&event.data.status==='quarantined');
   if(!original)throw Error('原隔离行情回执不存在或尚不可用');
   if(original.data.gateRequirements.independentReferenceRequired&&!secondaryFile)
    throw Error('原隔离回执要求独立对照来源，复核不得省略原双源门禁');
   const raw=evidence.readRaw(root,original.data.rawEvidence);
   return lockedProcess(raw,{receivedAt:original.data.receivedAt,availableAt:now,replayOf:quarantineId,
    review:{reviewerId,reason,reviewedAt:now,method:'immutable-raw-original-import-gates'},requestId});
  }catch(error){lastError=error.message;return {updated:false,error:lastError};}
  finally{busy=false;}
 }
 function status(){return {mode:'external-history-import',provider,datasetId,verifiedLive:false,canTrade:false,lastAttempt,lastSuccess,lastError,lastDigest,updates,busy,evidence:lastEvidence};}
 return {sync,status,replay,governance:()=>evidence.readMarketDataEvidence({root,provider,datasetId}),
  asOf:decisionAt=>evidence.readMarketDataAsOf({root,provider,datasetId,decisionAt})};
}
module.exports={createMarketDataCenter,validateImport,validateSourceUrl,atomicWrite};
