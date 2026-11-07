'use strict';
const fs=require('node:fs');
const path=require('node:path');
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
  let busy=false,last=null;
  async function sync(){
    if(busy)return {updated:false,reason:'busy'};busy=true;const attempts=[];
    try{
      for(const [index,e] of entries.entries()){
        for(let attempt=0;attempt<=retries;attempt++){
          const result=await e.client.sync();
          attempts.push({id:e.source.id,attempt:attempt+1,ok:!result.error});
          if(!result.error){last={mode:index?'fallback':'primary',sourceId:e.source.id,provider:e.source.provider,datasetId:e.source.datasetId,updated:result.updated,stale:false,canTrade:false,verifiedLive:false,attempts,data:JSON.parse(fs.readFileSync(e.file,'utf8'))};return last;}
        }
      }
      for(const e of entries){try{
        const ageMs=clock()-fs.statSync(e.file).mtimeMs;
        if(ageMs<0||ageMs>maxCacheAgeMs)continue;
        const data=JSON.parse(fs.readFileSync(e.file,'utf8'));validateImport(data,{...e.source,now:clock()});
        last={mode:'cached-degraded',sourceId:e.source.id,provider:e.source.provider,datasetId:e.source.datasetId,updated:false,stale:true,cacheAgeMs:ageMs,canTrade:false,verifiedLive:false,attempts,data};return last;
      }catch{}}
      last={mode:'unavailable',updated:false,stale:true,canTrade:false,verifiedLive:false,attempts,error:'全部行情源及允许时效内缓存不可用'};return last;
    }finally{busy=false;}
  }
  return {sync,status:()=>last?{...last,data:undefined}: {mode:'not-started',canTrade:false,verifiedLive:false}};
}
module.exports={createMarketFailover};
