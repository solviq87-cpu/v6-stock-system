'use strict';
const assert=require('node:assert/strict');
const http=require('node:http');
const {createDashboardServer}=require('../src/server/bootstrap');
(async()=>{
 for(const mode of ['sync','async','ok']){
  const {server}=createDashboardServer({port:0,host:'127.0.0.1',bodyLimit:1024,sameOriginOk:()=>true,
   handle:(_req,res)=>{if(mode==='sync')throw Error('sync');if(mode==='async')return Promise.reject(Error('async'));res.end('ok')}});
  await new Promise(r=>server.listening?r():server.once('listening',r));
  try {
   const result=await new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port:server.address().port,path:'/health'},res=>{
    let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,data}));
   }).on('error',reject));
   assert.equal(result.status,mode==='ok'?200:500);
   if(mode!=='ok')assert.equal(JSON.parse(result.data).ok,false);
   console.log(mode,'PASS',result.status);
  }finally{await new Promise(r=>server.close(r))}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
