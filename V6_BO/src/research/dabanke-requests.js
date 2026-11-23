'use strict';
const {requestResearchBytes}=require('../core/research-curl-bytes');
function createDabankeRequests({request=requestResearchBytes,clock=Date.now}={}){
  const pages=new Map();
  return function read(url,options={}){
    if(!/^https:\/\/www\.dabanke\.com\/(?:(?:index|lhb)-\d{8}\.html|fpb\.html)?$/.test(url))throw Error('无效的打板客公开页面');
    const now=clock(),slot=pages.get(url);
    if(slot&&(slot.busy||now<slot.until))return slot.promise;
    for(const [k,v] of pages)if(!v.busy&&(now>=v.until||pages.size>=16))pages.delete(k);
    if(pages.size>=16)return Promise.reject(Error('行情采集繁忙'));
    const next={busy:true,until:0};
    next.promise=Promise.resolve().then(()=>request(url,{compressed:true,timeoutMs:10000,processTimeoutMs:11500,maxBytes:2*1024*1024,...options})).then(reply=>{
      const receivedAt=clock();next.until=receivedAt+30000;
      return {...reply,receivedAt};
    }).catch(error=>{next.until=clock()+30000;throw error;}).finally(()=>{next.busy=false;});
    pages.set(url,next);return next.promise;
  };
}
module.exports={createDabankeRequests,fetchDabankePage:createDabankeRequests()};
