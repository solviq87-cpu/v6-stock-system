'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/sw.js'),'utf8');
function worker(){
 const listeners={},stores=new Map(),calls=[];
 const key=r=>typeof r==='string'?new URL(r,'https://v6.test').href:r.url;
 const caches={
  async open(name){
   if(!stores.has(name))stores.set(name,new Map());
   const store=stores.get(name);
   return {addAll:async()=>{},put:async(r,v)=>store.set(key(r),v.clone()),match:async r=>store.get(key(r))?.clone()};
  },async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);}
 };
 let network=async()=>new Response('fresh');
 vm.runInNewContext(source,{URL,Response,caches,self:{location:{origin:'https://v6.test'},clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(n,f)=>listeners[n]=f},fetch:async(r,opts)=>{calls.push({url:r.url,opts});return network(r);}});
 return {stores,caches,calls,network(fn){network=fn;},async event(name){let job;listeners[name]({waitUntil:p=>job=p});await job;},async get(url,options){let response;listeners.fetch({request:new Request(new URL(url,'https://v6.test'),options),respondWith:p=>response=p});return response;}};
}
test('old worker caches removed on activation without deleting another application cache',async()=>{
 const w=worker();await w.caches.open('quant-dashboard-m-20261109cv');await w.caches.open('another-application');await w.event('activate');
 assert.deepEqual(await w.caches.keys(),['another-application']);
});
test('unchanged CSS/JS URL refreshes online and only new release shell is used offline',async()=>{
 const w=worker();const old=await w.caches.open('quant-dashboard-m-20261109cv');await old.put('/assets/app.css',new Response('old-style'));
 w.network(async()=>new Response('new-style'));assert.equal(await(await w.get('/assets/app.css')).text(),'new-style');
 assert.equal(w.calls[0].opts.cache,'no-store');w.network(async()=>{throw Error('offline');});
 assert.equal(await(await w.get('/assets/app.css')).text(),'new-style');
 assert.equal((await w.get('/assets/never-seen.js')).status,503);
});
test('cached private quotes, identity and account are never returned offline',async()=>{
 const w=worker(),old=await w.caches.open('quant-dashboard-m-20261109cv');
 for(const url of ['/api/status?token=private','/api/paper/accounts','/api/lock/status'])await old.put(url,new Response('private-old-result'));
 w.network(async()=>{throw Error('offline');});
 for(const url of ['/api/status?token=private','/api/paper/accounts','/api/lock/status']){
  const r=await w.get(url);assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal((await r.json()).offline,true);
 }
 assert.equal((await w.caches.keys()).length,0);
});
test('late writes from a retired worker are purged after a current private request',async()=>{
 const w=worker();await w.event('activate');
 const old=await w.caches.open('quant-dashboard-m-20261109cv');await old.put('/api/account',new Response('retired-private'));
 assert.equal((await w.get('/api/account')).status,200);
 assert.deepEqual(await w.caches.keys(),[]);
});
test('server revocation is returned unchanged; a previous successful API response is never cached',async()=>{
 const w=worker();w.network(async()=>new Response('valid-private-result'));assert.equal((await w.get('/api/paper/accounts')).status,200);
 assert.equal(w.stores.size,0);w.network(async()=>new Response('revoked',{status:403}));const r=await w.get('/api/paper/accounts');assert.equal(r.status,403);assert.equal(await r.text(),'revoked');
});
test('source downloads, credential URLs and Authorization assets never enter offline storage',async()=>{
 const w=worker();for(const url of ['/srcpkg/private.zip','/assets/export.js?token=private','/index.html?sharecode=private'])assert.equal((await w.get(url)).status,200);
 await w.get('/assets/secure.js',{headers:{Authorization:'Bearer private'}});assert.equal(w.stores.size,0);
 await w.get('/assets/secure.js',{headers:{'X-QD-Token':'private-fixture'}});assert.equal(w.stores.size,0);
 w.network(async()=>{throw Error('offline');});
 assert.equal((await w.get('/assets/secure.js',{headers:{'X-QD-Token':'private-fixture'}})).status,503,'application-header responses never fall back to a public shell cache');
});
test('HTTP errors never silently fall back to old styles and cache quota failure preserves fresh response',async()=>{
 const w=worker();await w.get('/assets/app.css');w.network(async()=>new Response('unavailable',{status:503}));assert.equal((await w.get('/assets/app.css')).status,503);
 w.caches.open=async()=>{throw Error('quota');};w.network(async()=>new Response('fresh-without-storage'));assert.equal(await(await w.get('/assets/app.css')).text(),'fresh-without-storage');
 w.network(async()=>{throw Error('offline');});assert.equal((await w.get('/assets/app.css')).status,503);
});
