'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {refreshHistorical}=require('../src/strategy/historical-refresh');
const {adaptCachedKline}=require('../src/strategy/research-v2-cached-kline-adapter');
const cache=require('../src/strategy/research-v2-persistent-research-cache');

test('三轮本机 HTTP 刷新：主源正常、重试后切备用、双源中断后保留可校验缓存',async()=>{
 let stage=0;
 const history=Array.from({length:32},(_,i)=>({date:new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10),
  open:10,close:10,high:10.1,low:9.9,volume:5000}));
 const calls=[];
 const server=http.createServer((req,res)=>{
  const [provider,code]=req.url.slice(1).split('/');calls.push([stage,provider,code]);
  if(stage===2||(stage===1&&provider==='primary')){res.writeHead(503);res.end();return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({rows:history}));
 });
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-cycle-'));
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const provider=name=>async(code,_n,{signal})=>{
   const r=await fetch('http://127.0.0.1:'+server.address().port+'/'+name+'/'+code,{signal});
   if(!r.ok)throw Error('HTTP '+r.status);return r.json();
  };
  const codes=['000001','000002'];
  for(stage=0;stage<3;stage++){
   const batch=await refreshHistorical({codes,retries:1,concurrency:2,fetchKline:provider('primary'),adapt:adaptCachedKline,
    authorizedFallbacks:[{name:'fixture-backup',authorized:true,fetchKline:provider('backup')}]});
   assert.equal(batch.success,stage===2?0:2);assert.equal(batch.verifiedLive,false);
   for(const item of batch.items){
    if(item.ok){
     assert.equal(item.provider,stage===0?'primary':'fixture-backup');
     cache.store(dir,{code:item.code,rows:item.kline.rows,origin:'simulated'});
    }
    const read=cache.read(dir,item.code);
    assert.equal(read.stock.feed.source,'simulated');
    assert.equal(read.stock.dataAudit.declaredSource,'simulated');assert.equal(read.stock.dataAudit.verifiedLive,false);
    assert.deepEqual(read.stock.bars,history);
   }
  }
  assert.equal(calls.filter(([s,p])=>s===0&&p==='backup').length,0);
  assert.equal(calls.filter(([s,p])=>s===1&&p==='primary').length,4);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});
