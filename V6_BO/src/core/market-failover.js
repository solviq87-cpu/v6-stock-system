'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createMarketDataCenter,validateImport}=require('./market-data-center');
// Keep each provider's append-only history separate: fallback must not splice sources.
function createMarketFailover({sources,directory,fetchImpl=globalThis.fetch,retries=1,clock=Date.now,maxCacheAgeMs=86400000}={}){
  if(!Array.isArray(sources)||!sources.length||sources.length>5||!directory||!Number.isInteger(retries)||retries<0||retries>3||!Number.isFinite(maxCacheAgeMs)||maxCacheAgeMs<0)throw Error('备用行情配置无效');
  const ids=new Set();
  const entries=sources.map(source=>{
    if(!source||!/^[a-zA-Z0-9_-]{1,40}$/.test(source.id)||ids.has(source.id))throw Error('行情源ID重复或无效');ids.add(source.id);
    const file=path.join(directory,source.id+'.json');
    return {source,file,client:createMarketDataCenter({...source,outputFile:file,fetchImpl,clock})};
  });
  let busy=false,last=null,lastClock=null;
  const validClock=at=>Number.isSafeInteger(at)&&at>0&&at<8e15;
  function readClock(){
    const at=clock();
    if(!validClock(at)||lastClock!==null&&at<lastClock)throw Object.assign(Error('行情同步时钟无效或回退'),{code:'FAILOVER_CLOCK'});
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
      const data=JSON.parse(bytes.subarray(0,offset).toString('utf8'));
      validateImport(data,{...e.source,now});
      if(expectedHash!==undefined&&crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex')!==expectedHash)throw Error('行情文件与本次接收指纹不一致');
      return {data,mtimeMs:opened.mtimeMs};
    }finally{fs.closeSync(fd);}
  }
  async function sync(){
    if(busy)return {updated:false,reason:'busy'};busy=true;const attempts=[],unverified=new Set();
    const unavailable=()=>last={mode:'unavailable',updated:false,stale:true,canTrade:false,verifiedLive:false,attempts,error:'全部行情源及允许时效内缓存不可用'};
    try{
      readClock();
      for(const [index,e] of entries.entries()){
        for(let attempt=0;attempt<=retries;attempt++){
          let result;try{result=await e.client.sync();}catch{result=null;}
          const now=readClock(),receipt={id:e.source.id,attempt:attempt+1,ok:false};attempts.push(receipt);
          if(!result||result.error||result.reason==='busy'||typeof result.updated!=='boolean'||typeof result.hash!=='string'||!/^[a-f0-9]{64}$/.test(result.hash))continue;
          try{
            const {data}=readData(e,now,result.hash);readClock();
            receipt.ok=true;last={mode:index?'fallback':'primary',sourceId:e.source.id,provider:e.source.provider,datasetId:e.source.datasetId,updated:result.updated,stale:false,canTrade:false,verifiedLive:false,attempts,data};return last;
          }catch(error){if(error.code==='FAILOVER_CLOCK')throw error;unverified.add(e.source.id);}
        }
      }
      for(const e of entries){if(unverified.has(e.source.id))continue;try{
        const now=readClock(),{data,mtimeMs}=readData(e,now),ageMs=readClock()-mtimeMs;
        if(ageMs<0||ageMs>maxCacheAgeMs)continue;
        last={mode:'cached-degraded',sourceId:e.source.id,provider:e.source.provider,datasetId:e.source.datasetId,updated:false,stale:true,cacheAgeMs:ageMs,canTrade:false,verifiedLive:false,attempts,data};return last;
      }catch(error){if(error.code==='FAILOVER_CLOCK')throw error;}}
      return unavailable();
    }catch(error){if(error.code==='FAILOVER_CLOCK')return unavailable();throw error;}
    finally{busy=false;}
  }
  return {sync,status:()=>last?{...last,data:undefined}: {mode:'not-started',canTrade:false,verifiedLive:false}};
}
module.exports={createMarketFailover};
