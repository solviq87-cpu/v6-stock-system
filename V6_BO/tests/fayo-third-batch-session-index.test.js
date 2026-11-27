'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSessionIndexFeed}=require('../src/core/session-index-feed');
const at=Date.parse('2026-11-26T10:00:00+08:00'),session={day:'20261126',trading:true,openDay:true,minute:600};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const q=(source,price,quoteAt,receivedAt,extra={})=>({code:'1.000001',name:'上证',quoteSource:source,price,quoteAt,receivedAt,pct:1,...extra});
test('conflicting duplicate timestamp never preserves an arbitrary index price; a newer primary tick can recover',async()=>{
 let now=at,rows=[q('tencent-index',100,at-1000,at),q('tencent-index',110,at-1000,at)],updates=[];
 const feed=createSessionIndexFeed({primary:async()=>rows,backup:async()=>[],clock:()=>now,onUpdate:v=>updates.push(v)});
 feed.read(session);await flush();assert.equal(feed.read(session).indices.length,0);
 now+=6000;rows=[q('tencent-index',101,now-1000,now)];feed.read(session);await flush();
 assert.equal(feed.read(session).indices[0].price,101);
 now+=6000;rows=[q('tencent-index',102,now-7000,now)];feed.read(session);await flush();
 assert.equal(feed.read(session).indices.length,0);assert.equal(updates.at(-1).items.length,0);
});
test('equal-time contradictory independent sources do not enter the index view or callback',async()=>{
 let now=at,price=100;
 const feed=createSessionIndexFeed({clock:()=>now,primary:async()=>[q('tencent-index',price,now-1000,now)],backup:async()=>[q('sina-index',102,now-1000,now)]});
 feed.read(session);await flush();assert.equal(feed.read(session).indices.length,0);
 now+=6000;price=102;feed.read(session);await flush();
 const r=feed.read(session).indices[0];assert.equal(r.price,102);assert.equal(r.quoteSource,'tencent-index');assert.equal(r.canTrade,false);
});
test('a clock rollback clears future rows and fences a late response from the earlier epoch',async()=>{
 let now=at,resolvers=[];
 const feed=createSessionIndexFeed({clock:()=>now,primary:()=>new Promise(resolve=>resolvers.push(resolve)),backup:async()=>[]});
 feed.read(session);await flush();assert.equal(resolvers.length,1);
 now-=1000;assert.equal(feed.read(session).indices.length,0);
 now=at+6000;feed.read(session);await flush();assert.equal(resolvers.length,2);
 resolvers[1]([q('tencent-index',105,now-1000,now)]);await flush();
 resolvers[0]([q('tencent-index',999,now,now)]);await flush();
 assert.equal(feed.read(session).indices[0].price,105);
 now-=2000;assert.equal(feed.read(session).indices.length,0);
});
test('an explicitly conflicted quote, wrong provider and prior request receipt cannot be promoted',async()=>{
 for(const patch of [{sourceConflict:true},{quoteSource:'sina-index'},{receivedAt:at-1000},{pct:Infinity}]){
  const feed=createSessionIndexFeed({clock:()=>at,primary:async()=>[q('tencent-index',100,at-2000,at,patch)],backup:async()=>[]});
  feed.read(session);await flush();assert.equal(feed.read(session).indices.length,0,JSON.stringify(patch));
 }
});

test('delayed index dispatch rejects receipts predating actual invocation from either source',async()=>{
 let now=at,updates=[];
 const feed=createSessionIndexFeed({clock:()=>now,primary:async()=>[q('tencent-index',100,at+1000,at+2000)],backup:async()=>[q('sina-index',100,at+1000,at+2000)],onUpdate:v=>updates.push(v)});
 feed.read(session);now=at+10000;await flush();
 const view=feed.read(session);assert.equal(view.indices.length,0);assert.equal(updates.length,0);
 assert.equal(view.channels.length,2);assert.ok(view.channels.every(c=>c.status==='no-session-quote'&&c.count===0));
});
test('successful delayed index invocation starts both source cooldowns at dispatch',async()=>{
 let now=at,primary=0,backup=0;
 const feed=createSessionIndexFeed({clock:()=>now,primary:async()=>{primary++;return [q('tencent-index',100,now-1000,now)];},backup:async()=>{backup++;return [];}});
 feed.read(session);now=at+10000;await flush();assert.deepEqual([primary,backup],[1,1]);
 now=at+14999;const view=feed.read(session);assert.equal(view.indices[0].receivedAt,at+10000);assert.equal(view.indices[0].canTrade,false);await flush();assert.deepEqual([primary,backup],[1,1]);
 now=at+15000;feed.read(session);await flush();assert.deepEqual([primary,backup],[2,2]);
});
test('failed delayed index invocation is also cooled down from actual dispatch',async()=>{
 let now=at,primary=0,backup=0;
 const feed=createSessionIndexFeed({clock:()=>now,primary:async()=>{primary++;throw Error('503');},backup:async()=>{backup++;throw Error('429');}});
 feed.read(session);now=at+10000;await flush();assert.deepEqual([primary,backup],[1,1]);
 now=at+14999;const view=feed.read(session);assert.ok(view.channels.every(c=>c.status==='unavailable'));await flush();assert.deepEqual([primary,backup],[1,1]);
 now=at+15000;feed.read(session);await flush();assert.deepEqual([primary,backup],[2,2]);
});
test('physical dispatch cooldown survives an epoch reset after a delayed invocation',async()=>{
 let now=at,primary=0,backup=0;
 const feed=createSessionIndexFeed({clock:()=>now,primary:async()=>{primary++;return [q('tencent-index',100,now-1000,now)];},backup:async()=>{backup++;return [];}});
 feed.read(session);now=at+10000;await flush();assert.deepEqual([primary,backup],[1,1]);
 now=at+9999;assert.equal(feed.read(session).indices.length,0);
 now=at+11000;feed.read(session);await flush();assert.deepEqual([primary,backup],[1,1]);
 now=at+15000;feed.read(session);await flush();assert.deepEqual([primary,backup],[2,2]);
});
