'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createMarketDataCenter,validateImport}=require('./market-data-center');
// Keep each provider's append-only history separate: fallback must not splice sources.
function createMarketFailover({sources,directory,fetchImpl=globalThis.fetch,retries=1,clock=Date.now,maxCacheAgeMs=86400000,requestGovernor}={}){
  if(!Array.isArray(sources)||!sources.length||sources.length>5||!directory||!Number.isInteger(retries)||retries<0||retries>3||!Number.isFinite(maxCacheAgeMs)||maxCacheAgeMs<0)throw Error('备用行情配置无效');
  const ids=new Set();
  // Physical default requests share the existing supplier governor; injected
  // adapters may explicitly provide a deterministic governor for testing.
  const governor=requestGovernor??(fetchImpl===globalThis.fetch&&sources.every(s=>typeof s?.url==='string')?require('./market-request-governor').marketRequests:null);
  const entries=sources.map(source=>{
    if(!source||typeof source.id!=='string'||!/^[a-zA-Z0-9_-]{1,40}$/.test(source.id)||ids.has(source.id.toLowerCase()))throw Error('行情源ID重复或无效');ids.add(source.id.toLowerCase());
    const file=path.join(directory,source.id+'.json'),root=source.evidenceRoot||path.resolve(file)+'.evidence',
      entry={source,file,root,restriction:null,verified:null,archiveExpected:!!source.evidenceRoot};
    const guardedFetch=async(target,options)=>{
      const response=await fetchImpl(target,options);
      if(governor){try{governor.checkResponse(target,response?.status,response?.headers);}
      catch(error){entry.restriction=error;throw error;}}
      return response;
    };
    entry.client=createMarketDataCenter({...source,outputFile:file,fetchImpl:guardedFetch,clock:readClock});
    return entry;
  });
  let busy=false,last=null,lastClock=null,clockFault=false;
  const validClock=at=>Number.isSafeInteger(at)&&at>0&&at<8e15;
  function readClock(){
    let at;try{at=clock();}catch{at=null;}
    if(clockFault||!validClock(at)||lastClock!==null&&at<lastClock){
      clockFault=true;throw Object.assign(Error('行情同步时钟无效或回退'),{code:'FAILOVER_CLOCK'});
    }
    lastClock=at;return at;
  }
  function readData(e,now,expectedHash){
    const before=fs.lstatSync(e.file),limit=e.source.maxBytes??30*1024*1024;
    if(!before.isFile()||before.size>limit)throw Error('行情文件无效或超限');
    const fd=fs.openSync(e.file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
    const same=(a,b)=>a.isFile()&&b.isFile()&&['dev','ino','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
    try{
      const opened=fs.fstatSync(fd);if(!same(before,opened))throw Error('行情文件已变化');
      const bytes=Buffer.alloc(opened.size+1);let offset=0;
      while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!n)break;offset+=n;}
      if(offset!==opened.size||!same(opened,fs.fstatSync(fd))||!same(opened,fs.lstatSync(e.file)))throw Error('行情文件已变化');
      const raw=bytes.subarray(0,offset),text=raw.toString('utf8');
      if(!Buffer.from(text,'utf8').equals(raw))throw Error('行情文件不是有效UTF-8');
      const data=JSON.parse(text),hash=crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
      validateImport(data,{...e.source,now});
      if(expectedHash!==undefined&&hash!==expectedHash)throw Error('行情文件与本次接收指纹不一致');
      return {data,hash,mtimeMs:opened.mtimeMs};
    }finally{fs.closeSync(fd);}
  }
  // A history file is a projection of the original receipt, not its authority.
  // Only genuinely unarchived legacy files retain the old mtime-only downgrade.
  // Once a receipt directory was observed (or explicitly configured), a missing
  // or broken archive cannot be silently relabelled as a legacy cache.
  const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
  function readArchive(e,data,hash,now,result){
    if(result?.evidence!==undefined)e.archiveExpected=true;
    let stat;
    try{stat=fs.lstatSync(e.root);}catch(error){
      if(error.code==='ENOENT'&&!e.archiveExpected)return null;
      throw error;
    }
    e.archiveExpected=true;
    if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('原行情存证目录无效');
    const archive=require('./market-data-evidence').readMarketDataAsOf({root:e.root,
      provider:e.source.provider,datasetId:e.source.datasetId,decisionAt:now});
    if(archive?.status!=='available-research-snapshot'||archive.decisionAt!==now||
       archive.canTrade!==false||archive.researchOnly!==true||
       !validHash(archive.archiveHash)||!validHash(archive.dataVersion)||
       !validClock(archive.receivedAt)||!validClock(archive.availableAt)||
       archive.receivedAt>archive.availableAt||archive.availableAt>now||
       archive.data?.provider!==e.source.provider||archive.data?.datasetId!==e.source.datasetId||
       archive.data?.asOf!==data.asOf||
       crypto.createHash('sha256').update(JSON.stringify(archive.data)).digest('hex')!==hash)
      throw Error('行情文件未绑定有效的原始入库回执');
    if(result){
      const receipt=result.evidence;
      if(receipt?.id!==archive.archiveHash||receipt.status!=='admitted'||
         receipt.availableAt!==archive.availableAt||receipt.dataVersion!==archive.dataVersion)
        throw Error('本次行情回执与原始存证不一致');
    }
    return {archiveHash:archive.archiveHash,dataVersion:archive.dataVersion,
      receivedAt:archive.receivedAt,availableAt:archive.availableAt};
  }
  async function sync(){
    if(busy)return {updated:false,reason:'busy'};busy=true;clockFault=false;const attempts=[],unverified=new Set();
    const unavailable=()=>last={mode:'unavailable',updated:false,stale:true,canTrade:false,verifiedLive:false,attempts,error:'全部行情源及允许时效内缓存不可用'};
    try{
      readClock();
      for(const [index,e] of entries.entries()){
        for(let attempt=0;attempt<=retries;attempt++){
          let result;e.restriction=null;
          try{result=await (governor?governor.run(e.source.url,()=>e.client.sync()):e.client.sync());}
          catch(error){result=null;if(error?.code==='MARKET_RESTRICTED')e.restriction=error;}
          const now=readClock(),receipt={id:e.source.id,attempt:attempt+1,ok:false};attempts.push(receipt);
          if(e.restriction){
            receipt.status='restricted';
            receipt.httpStatus=[403,429].includes(e.restriction.status)?e.restriction.status:null;
            receipt.resumeAt=validClock(e.restriction.resumeAt)?e.restriction.resumeAt:null;
            if(e.restriction.stateUnavailable===true)return structuredClone(unavailable());
            break; // never retry a restricted route inside this sync
          }
          if(!result||result.error||result.reason==='busy'||typeof result.updated!=='boolean'||typeof result.hash!=='string'||!/^[a-f0-9]{64}$/.test(result.hash)){
            if(result?.updated===true||result?.hash!==undefined)unverified.add(e.source.id);
            continue;
          }
          try{
            const {data,hash}=readData(e,now,result.hash);
            if(result.asOf!==data.asOf)throw Error('接收回执与行情截至日不一致');
            const archive=readArchive(e,data,hash,readClock(),result);
            // Re-read the published projection after archive verification. A
            // later admission alone never repairs a missing or different file.
            if(archive)readData(e,readClock(),hash);
            const acceptedAt=readClock();
            e.verified={hash,acceptedAt:archive?.receivedAt??acceptedAt};
            receipt.ok=true;last={mode:index?'fallback':'primary',sourceId:e.source.id,provider:e.source.provider,datasetId:e.source.datasetId,updated:result.updated,stale:false,canTrade:false,verifiedLive:false,attempts,data,
              archiveEvidence:archive};return structuredClone(last);
          }catch(error){if(error.code==='FAILOVER_CLOCK')throw error;unverified.add(e.source.id);}
        }
      }
      for(const e of entries){if(unverified.has(e.source.id))continue;try{
        const now=readClock(),{data,hash,mtimeMs}=readData(e,now);
        const archive=readArchive(e,data,hash,readClock());
        const checked=archive?readData(e,readClock(),hash):null,finished=readClock();
        if(!Number.isFinite(mtimeMs)||mtimeMs<=0||mtimeMs>finished||
           checked&&(!Number.isFinite(checked.mtimeMs)||checked.mtimeMs<=0||checked.mtimeMs>finished)||
           e.verified&&hash!==e.verified.hash)continue;
        const anchors=[mtimeMs];
        if(checked)anchors.push(checked.mtimeMs);
        if(archive)anchors.push(archive.receivedAt);
        if(e.verified)anchors.push(e.verified.acceptedAt);
        if(data.observedAt!==undefined){if(!validClock(data.observedAt)||data.observedAt>finished)continue;anchors.push(data.observedAt);}
        const ageMs=finished-Math.min(...anchors);
        if(ageMs<0||ageMs>maxCacheAgeMs)continue;
        last={mode:'cached-degraded',sourceId:e.source.id,provider:e.source.provider,datasetId:e.source.datasetId,updated:false,stale:true,cacheAgeMs:ageMs,
          cacheAgeBasis:archive?'original-archived-receipt-bounded-by-local-and-source-times':data.observedAt!==undefined?'declared-source-observation-bounded-by-local-times':e.verified?'verified-this-process-receipt-and-file-time':'legacy-file-time-only-unverified',
          archiveEvidence:archive,originalObservationAt:data.observedAt??null,canTrade:false,verifiedLive:false,attempts,data};return structuredClone(last);
      }catch(error){if(error.code==='FAILOVER_CLOCK')throw error;}}
      return structuredClone(unavailable());
    }catch(error){if(error.code==='FAILOVER_CLOCK')return structuredClone(unavailable());throw error;}
    finally{busy=false;}
  }
  return {sync,status:()=>last?structuredClone({...last,data:undefined}): {mode:'not-started',canTrade:false,verifiedLive:false}};
}
module.exports={createMarketFailover};
