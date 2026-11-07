'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const { createDashboardServer } = require('../src/server/bootstrap');
async function run({ method = 'GET', path = '/api/health', body, origin = 'http://localhost', sourceCheck = () => true, handle = (req,res,u,data) => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({path:u.pathname,body:data})); } } = {}) {
  const { server } = createDashboardServer({ handle, sameOriginOk: sourceCheck, bodyLimit: 32, host:'127.0.0.1', port:0 });
  await new Promise((resolve,reject)=>server.listening?resolve():server.once('listening',resolve).once('error',reject));
  try {
    return await new Promise((resolve,reject)=>{
      const req=http.request({host:'127.0.0.1',port:server.address().port,method,path,headers:{origin}},res=>{
        let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,data}));
      });
      req.on('error',reject);
      if(body)req.write(body);
      req.end();
    });
  } finally { await new Promise(resolve=>server.close(resolve)); }
}
test('GET 路由',async()=>{const r=await run();assert.equal(r.status,200);assert.equal(JSON.parse(r.data).path,'/api/health');});
test('POST 请求体',async()=>{const r=await run({method:'POST',body:'{"x":1}'});assert.equal(r.status,200);assert.equal(JSON.parse(r.data).body,'{"x":1}');});
test('POST 超限',async()=>{const r=await run({method:'POST',body:'x'.repeat(33)});assert.equal(r.status,413);});
test('拒绝跨站 API',async()=>{const r=await run({sourceCheck:()=>false});assert.equal(r.status,403);});
test('同步异常返回 500',async()=>{const r=await run({handle:()=>{throw Error('test');}});assert.equal(r.status,500);});
test('异步异常返回 500',async()=>{const r=await run({handle:async()=>{throw Error('test');}});assert.equal(r.status,500);});
test('来源校验抛错返回 400 而非崩溃',async()=>{const r=await run({sourceCheck:()=>{throw Error('test');}});assert.equal(r.status,400);});
test('配置非法请求体限制立即拒绝',()=>{assert.throws(()=>createDashboardServer({handle:()=>{},sameOriginOk:()=>true,bodyLimit:0,port:0,host:'127.0.0.1'}),RangeError);});

test('POST 正好达到请求体上限仍放行',async()=>{const r=await run({method:'POST',body:'x'.repeat(32)});assert.equal(r.status,200);assert.equal(JSON.parse(r.data).body.length,32);});
test('跨站非 API 静态路径不被 API 拦截误伤',async()=>{const r=await run({path:'/index.html',sourceCheck:()=>false});assert.equal(r.status,200);});
test('跨站 POST API 在分发前被拒绝',async()=>{let invoked=false;const r=await run({method:'POST',body:'{}',sourceCheck:()=>false,handle:()=>{invoked=true;}});assert.equal(r.status,403);assert.equal(invoked,false);});
test('来源校验拒绝时不返回允许跨站头',async()=>{const r=await run({sourceCheck:()=>false});assert.equal(r.status,403);});
test('缺失处理函数直接拒绝启动',()=>{assert.throws(()=>createDashboardServer({sameOriginOk:()=>true,bodyLimit:32,port:0,host:'127.0.0.1'}),TypeError);});
test('缺失来源校验函数直接拒绝启动',()=>{assert.throws(()=>createDashboardServer({handle:()=>{},bodyLimit:32,port:0,host:'127.0.0.1'}),TypeError);});
