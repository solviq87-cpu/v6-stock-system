"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createDashboardServer}=require('../src/server/bootstrap');
function start(handle=(_req,res)=>res.end('ok')){
 return new Promise((resolve,reject)=>{
  let instance;
  instance=createDashboardServer({handle,sameOriginOk:()=>true,bodyLimit:32,port:0,host:'127.0.0.1',onListen:()=>resolve(instance)});
  instance.server.once('error',reject);
 });
}
function request(port,method='GET',data=''){
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port,path:'/api/check',method},res=>{
   let body='';res.setEncoding('utf8');res.on('data',x=>body+=x);res.on('end',()=>resolve({status:res.statusCode,body}));
  });req.on('error',reject);req.end(data);
 });
}
test('HTTP 请求头/请求体接收超时和头部数量均受限制',async()=>{
 const {server}=await start();
 try{
  assert.equal(server.requestTimeout,30000);
  assert.equal(server.headersTimeout,15000);
  assert.equal(server.maxHeadersCount,200);
  assert.deepEqual(await request(server.address().port),{status:200,body:'ok'});
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('请求体超限返回413，不分发给业务处理器',async()=>{
 let called=false;
 const {server}=await start((_req,res)=>{called=true;res.end('bad')});
 try{
  const r=await request(server.address().port,'POST','x'.repeat(100));
  assert.equal(r.status,413);assert.equal(called,false);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('Content-Length 已超限时无需上传请求体就立即返回 413',async()=>{
 let called=false;
 const {server}=await start((_req,res)=>{called=true;res.end('unexpected')});
 try {
  const result=await new Promise((resolve,reject)=>{
   const req=http.request({hostname:'127.0.0.1',port:server.address().port,
     path:'/api/check',method:'POST',headers:{'Content-Length':'1000000'}},res=>{
       let body='';res.on('data',x=>body+=x);res.on('end',()=>resolve({status:res.statusCode,body,connection:res.headers.connection}));
     });
   req.on('error',reject);
   req.flushHeaders();
  });
  assert.equal(result.status,413);
  assert.equal(result.connection,'close');
  assert.equal(called,false);
 } finally {await new Promise(resolve=>server.close(resolve));}
});
