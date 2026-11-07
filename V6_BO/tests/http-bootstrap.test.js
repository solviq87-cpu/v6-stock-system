'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const { createDashboardServer } = require('../src/server/bootstrap');
async function run(method, path, body, handle, origin='http://localhost') {
  const {server} = createDashboardServer({
    handle, sameOriginOk: req => req.headers.origin !== 'http://blocked.example',
    bodyLimit: 32, port: 0, host: '127.0.0.1'
  });
  await new Promise((resolve,reject)=>server.listening?resolve():server.once('listening',resolve).once('error',reject));
  try {
    const port=server.address().port;
    return await new Promise((resolve,reject)=>{
      const req=http.request({hostname:'127.0.0.1',port,path,method,headers:{origin}},res=>{
        let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,text}));
      });
      req.on('error',reject);
      if(body)req.write(body);
      req.end();
    });
  } finally { await new Promise(resolve=>server.close(resolve)); }
}
const ok=(req,res,u,body)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({path:u.pathname,body}));};
test('GET 实际请求',async()=>{const r=await run('GET','/api/health',null,ok);assert.equal(r.status,200);assert.equal(JSON.parse(r.text).path,'/api/health');});
test('POST 请求体传递',async()=>{const r=await run('POST','/api/echo','{"a":1}',ok);assert.equal(r.status,200);assert.equal(JSON.parse(r.text).body,'{"a":1}');});
test('POST 超限返回 413',async()=>{const r=await run('POST','/api/echo','x'.repeat(33),ok);assert.equal(r.status,413);});
test('跨站 API 返回 403',async()=>{const r=await run('GET','/api/health',null,ok,'http://blocked.example');assert.equal(r.status,403);});
test('同步路由异常返回 500',async()=>{const r=await run('GET','/api/fail',null,()=>{throw Error('test sync');});assert.equal(r.status,500);});
test('异步路由异常返回 500',async()=>{const r=await run('GET','/api/fail',null,async()=>{throw Error('test async');});assert.equal(r.status,500);});
