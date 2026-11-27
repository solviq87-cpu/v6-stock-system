'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const load=()=>import('data:text/javascript;base64,'+fs.readFileSync(path.resolve(__dirname,'../public/nova/client.js')).toString('base64'));
function withBrowser(t){
 const location=global.location,fetch=global.fetch;
 global.location={origin:'http://fayo.test'};
 t.after(()=>{global.location=location;global.fetch=fetch;});
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const response=(data,status=200)=>({ok:status<400,status,json:async()=>data});
const errorOf=p=>p.then(()=>{throw Error('Expected rejection');},e=>e);
test('changing device identity rejects a late old response even without another request',async t=>{
 withBrowser(t);const {createClient}=await load(),wait=deferred();
 let token='fixture-old-token',denials=0;global.fetch=()=>wait.promise;
 const client=createClient({getToken:()=>token,onUnauthorized:()=>denials++});
 const old=errorOf(client.api('/api/state'));token='fixture-new-token';
 wait.resolve(response({private:'old'}));
 assert.equal((await old).name,'AbortError');assert.equal(denials,0);
});
test('new identity aborts earlier requests; stale 401 cannot revoke the new session',async t=>{
 withBrowser(t);const {createClient}=await load(),wait=deferred();
 let token='fixture-old-token',denials=0,oldSignal;
 global.fetch=(url,options)=>{if(options.headers.Authorization==='Bearer fixture-old-token'){oldSignal=options.signal;return wait.promise;}return Promise.resolve(response({ok:true,identity:'new'}));};
 const client=createClient({getToken:()=>token,onUnauthorized:()=>denials++});
 const old=errorOf(client.api('/api/state'));token='fixture-new-token';
 assert.equal((await client.api('/api/state')).identity,'new');
 assert.equal(oldSignal.aborted,true);wait.resolve(response(null,401));
 assert.equal((await old).name,'AbortError');assert.equal(denials,0);
});
test('pre-aborted requests never reach fetch and cancelled body reads cannot return private data',async t=>{
 withBrowser(t);const {createClient}=await load();let calls=0;
 const body=deferred(),started=deferred();global.fetch=async()=>{calls++;return {ok:true,status:200,json:()=>{started.resolve();return body.promise;}};};
 const client=createClient({getToken:()=> 'fixture-token'}),pre=new AbortController();pre.abort();
 const first=errorOf(client.api('/api/state',{signal:pre.signal}));
 if(calls)body.resolve({private:'stale'});
 const e=await first;assert.equal(e.name,'AbortError');assert.equal(calls,0);
 const active=new AbortController(),second=errorOf(client.api('/api/state',{signal:active.signal}));
 await started.promise;active.abort();body.resolve({private:'stale'});
 assert.equal((await second).name,'AbortError');assert.equal(calls,1);
});
test('401 with null or invalid JSON still invalidates pending authenticated requests',async t=>{
 withBrowser(t);const {createClient}=await load();
 for(const malformed of [false,true]){
  const wait=deferred();let signal,denials=0;
  global.fetch=(url,options)=>{if(new URL(url).pathname==='/api/slow'){signal=options.signal;return wait.promise;}return Promise.resolve({ok:false,status:401,json:async()=>{if(malformed)throw SyntaxError('bad JSON');return null;}});};
  const client=createClient({getToken:()=> 'fixture-token',onUnauthorized:()=>denials++});
  const old=errorOf(client.api('/api/slow')),denied=await errorOf(client.api('/api/state'));
  wait.resolve(response({private:'old'}));
  assert.equal(denied.status,401);assert.equal(denials,1);assert.equal(signal.aborted,true);
  assert.equal((await old).name,'AbortError');
 }
});
test('external abort listener is removed after success and ordinary errors',async t=>{
 withBrowser(t);const {createClient}=await load(),controller=new AbortController(),signal=controller.signal;
 let added=0,removed=0;const add=signal.addEventListener.bind(signal),remove=signal.removeEventListener.bind(signal);
 signal.addEventListener=(type,fn,opts)=>{added++;return add(type,fn,opts);};
 signal.removeEventListener=(type,fn)=>{removed++;return remove(type,fn);};
 global.fetch=async()=>response({ok:true});
 const client=createClient({getToken:()=> 'fixture-token'});
 await client.api('/api/state',{signal});
 global.fetch=async()=>{throw Error('isolated network error');};
 const e=await errorOf(client.api('/api/state',{signal}));assert.match(e.message,/network error/);
 assert.equal(added,2);assert.equal(removed,2);
});
