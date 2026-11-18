'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const load=()=>import('data:text/javascript;base64,'+fs.readFileSync(path.resolve(__dirname,'../public/nova/client.js')).toString('base64'));
const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
function fixture(){
 let now=0,serial=0;const tasks=new Map(),page=new EventTarget();page.visibilityState='visible';
 return {page,tasks,setInterval(fn,ms){const id=++serial;tasks.set(id,{fn,ms,at:now+ms});return id;},clearInterval(id){tasks.delete(id);},advance(ms){const end=now+ms;while(true){const entry=[...tasks.entries()].sort((a,b)=>a[1].at-b[1].at)[0];if(!entry||entry[1].at>end)break;now=entry[1].at;entry[1].at+=entry[1].ms;entry[1].fn();}now=end;},visible(value){page.visibilityState=value?'visible':'hidden';page.dispatchEvent(new Event('visibilitychange'));}};
}
test('shared snapshot reads run every five seconds, pause hidden and immediately resume visible',async()=>{
 const {createSnapshotPoller}=await load(),f=fixture(),controller=new AbortController();let reads=0;
 const stop=createSnapshotPoller({read:async()=>reads++,signal:controller.signal,page:f.page,setInterval:f.setInterval,clearInterval:f.clearInterval});
 f.advance(4999);await flush();assert.equal(reads,0);f.advance(1);await flush();assert.equal(reads,1);
 f.visible(false);assert.equal(f.tasks.size,0);f.advance(30000);await flush();assert.equal(reads,1);
 f.visible(true);await flush();assert.equal(reads,2);f.advance(5000);await flush();assert.equal(reads,3);
 stop();assert.equal(f.tasks.size,0);f.advance(10000);f.visible(false);f.visible(true);await flush();assert.equal(reads,3);
});
test('slow snapshot reads remain single flight and abort prevents polling or visibility resurrection',async()=>{
 const {createSnapshotPoller}=await load(),f=fixture(),controller=new AbortController();let reads=0,release;
 createSnapshotPoller({read:()=>{reads++;return new Promise(resolve=>release=resolve);},signal:controller.signal,page:f.page,setInterval:f.setInterval,clearInterval:f.clearInterval});
 f.advance(5000);await flush();assert.equal(reads,1);f.advance(20000);await flush();assert.equal(reads,1);
 f.visible(false);f.visible(true);await flush();assert.equal(reads,1);controller.abort();assert.equal(f.tasks.size,0);release();await flush();f.advance(20000);f.visible(false);f.visible(true);await flush();assert.equal(reads,1);
});
test('an initially hidden session waits for visibility and a failed read does not stop subsequent reads',async()=>{
 const {createSnapshotPoller}=await load(),f=fixture(),controller=new AbortController();f.visible(false);let reads=0;
 createSnapshotPoller({read:async()=>{reads++;if(reads===1)throw Error('offline fixture');},signal:controller.signal,page:f.page,setInterval:f.setInterval,clearInterval:f.clearInterval});
 f.advance(10000);await flush();assert.equal(reads,0);assert.equal(f.tasks.size,0);
 f.visible(true);await flush();assert.equal(reads,1);f.advance(5000);await flush();assert.equal(reads,2);controller.abort();
 const denied=new AbortController();denied.abort();createSnapshotPoller({read:async()=>assert.fail('revoked session must not read'),signal:denied.signal,page:f.page,setInterval:f.setInterval,clearInterval:f.clearInterval});assert.equal(f.tasks.size,0);
});
