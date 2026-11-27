'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../public/sw.js'),'utf8');
const ORIGIN='https://fayo.invalid';
const OLD='quant-dashboard-m-20261126ab-integration-audit-2';
const OTHER='unrelated-app-cache';
const MODULES=['/nova/index-continuity-view.mjs','/nova/market-expansion-view.mjs','/nova/turnover-crowding-view.mjs'];
function worker(){
 const listeners={},stores=new Map([[OLD,new Map()],[OTHER,new Map()]]),requests=[];
 const absolute=x=>new URL(typeof x==='string'?x:x.url,ORIGIN).href;
 let installed=null,claimed=false;
 vm.runInNewContext(source,{
  URL,Response,
  self:{location:{origin:ORIGIN},addEventListener:(type,fn)=>listeners[type]=fn,
   skipWaiting:()=>Promise.resolve(),clients:{claim:async()=>{claimed=true;}}},
  caches:{keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name),open:async name=>{
   if(!stores.has(name))stores.set(name,new Map());const items=stores.get(name);
   return {addAll:async urls=>{installed=name;for(const url of urls)items.set(absolute(url),'public:'+url);},
    match:async req=>items.get(absolute(req)),put:async(req,response)=>items.set(absolute(req),response)};
  }},
  fetch:async(req,opts)=>{requests.push({url:req.url,cache:opts.cache});throw Error('offline');}
 });
 async function lifecycle(type){let pending;listeners[type]({waitUntil:p=>{pending=p;}});assert.ok(pending);await pending;}
 function request(url,headers={}){const req=new Request(new URL(url,ORIGIN),{headers});let result;listeners.fetch({request:req,respondWith:p=>{result=p;}});assert.ok(result);return result;}
 return {stores,requests,lifecycle,request,installed:()=>installed,claimed:()=>claimed};
}
test('new Task 5 view modules are all installed and available from the public shell offline',async()=>{
 const w=worker();await w.lifecycle('install');const cache=w.stores.get(w.installed());
 for(const url of MODULES){assert.ok(cache.has(ORIGIN+url),'missing installed module: '+url);assert.equal(await w.request(url),'public:'+url);}
 assert.ok([...cache.keys()].every(url=>!new URL(url).pathname.startsWith('/api/')));
});
test('updated shell has a new cache generation and activation removes only superseded application caches',async()=>{
 const w=worker();await w.lifecycle('install');assert.notEqual(w.installed(),OLD);
 await w.lifecycle('activate');assert.equal(w.claimed(),true);assert.equal(w.stores.has(OLD),false);assert.equal(w.stores.has(OTHER),true);assert.ok(w.stores.has(w.installed()));
});
test('offline private responses, source archives and credential-bearing asset requests remain network-only',async()=>{
 const w=worker();await w.lifecycle('install');const cache=w.stores.get(w.installed());
 for(const [url,headers] of [['/api/state',{}],['/srcpkg/archive.js',{}],['/nova/market.js',{Authorization:'Bearer fixture-only'}],['/nova/market.js',{'X-QD-Token':'fixture-only'}],['/nova/market.js?token=fixture-only',{}]]){
  cache.set(ORIGIN+url,'must-not-be-returned');const response=await w.request(url,headers);
  assert.equal(response.status,503);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal((await response.json()).offline,true);
 }
 assert.ok(w.requests.every(x=>x.cache==='no-store'));
});
