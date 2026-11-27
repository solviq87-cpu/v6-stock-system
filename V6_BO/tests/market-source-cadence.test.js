'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMarketSourceCadence}=require('../src/core/market-source-cadence');

test('重复读合并为一轮请求，快慢来源按各自节奏更新',async()=>{
 let now=0,industryCalls=0,sealCalls=0;
 const read=createMarketSourceCadence(()=>now);
 const industry=()=>read('industry','20261120:session',60000,()=>({receivedAt:now,calls:++industryCalls}));
 const seal=()=>read('seal','20261120:session',10000,()=>({receivedAt:now,calls:++sealCalls}));
 const [first,overlap]=await Promise.all([industry(),industry(),seal()]);
 assert.equal(industryCalls,1);
 assert.equal(first.value,overlap.value);
 assert.equal(first.reused,false);
 assert.equal(overlap.reused,true);
 for(now=10000;now<=60000;now+=10000){
  const board=await industry();await seal();
  assert.equal(board.value.receivedAt,now===60000?now:0);
 }
 assert.equal(industryCalls,2);
 assert.equal(sealCalls,7);
});

test('失败也进入冷却，收盘或交易日换档重新取数',async()=>{
 let now=0,calls=0;
 const read=createMarketSourceCadence(()=>now);
 const collect=()=>{calls++;throw Error('503');};
 assert.equal((await read('cls','20261120:session',60000,collect)).reused,false);
 now=10000;
 const prior=await read('cls','20261120:session',60000,collect);
 assert.equal(prior.status,'rejected');
 assert.equal(prior.finishedAt,0);
 assert.equal(prior.reused,true);
 assert.equal(calls,1);
 const close=await read('cls','20261120:close',60000,()=>++calls);
 assert.equal(close.value,2);
 const next=await read('cls','20261123:session',60000,()=>++calls);
 assert.equal(next.value,3);
});

test('时钟回拨不得重新请求或返回未来缓存，恢复后仍遵守原冷却',async()=>{
 let now=100000,calls=0;
 const read=createMarketSourceCadence(()=>now),collect=()=>++calls;
 const get=()=>read('industry','session',60000,collect);
 assert.equal((await get()).value,1);
 now=120000;assert.equal((await get()).value,1);
 now=110000;const blocked=await get();
 assert.equal(blocked.status,'rejected');assert.equal(blocked.finishedAt,null);assert.equal(calls,1);
 now=120000;assert.equal((await get()).value,1);
 now=160000;assert.equal((await get()).value,2);
});
test('非法时钟或换档期间回拨不得触发请求',async()=>{
 let now=NaN,calls=0;
 const read=createMarketSourceCadence(()=>now),collect=()=>++calls;
 for(const invalid of [NaN,Infinity,-1,1.5]){
  now=invalid;assert.equal((await read('cls','session',60000,collect)).status,'rejected');
 }
 assert.equal(calls,0);
 now=100000;assert.equal((await read('cls','session',60000,collect)).value,1);
 now=99999;assert.equal((await read('cls','close',60000,collect)).status,'rejected');
 assert.equal(calls,1);
 now=100000;assert.equal((await read('cls','close',60000,collect)).value,2);
});
test('采集中时钟倒退，原结果和并发消费者均拒绝且保留冷却',async()=>{
 let now=100000,calls=0,release;
 const read=createMarketSourceCadence(()=>now);
 const collect=()=>{calls++;return new Promise(resolve=>{release=resolve;});};
 const first=read('industry','session',60000,collect);
 await Promise.resolve();
 now=110000;const overlap=read('industry','session',60000,collect);
 now=105000;release('untrusted-clock');
 for(const result of await Promise.all([first,overlap])){
  assert.equal(result.status,'rejected');assert.equal(result.finishedAt,null);assert.equal(result.value,undefined);
 }
 assert.equal(calls,1);
 now=110000;assert.equal((await read('industry','session',60000,()=>++calls)).status,'rejected');
 now=160000;assert.equal((await read('industry','session',60000,()=>++calls)).value,2);
});
test('跨来源共享时钟高水位，异常完成和抛出时钟错误均不可污染缓存',async()=>{
 let now=100000,throws=false,calls=0;
 const read=createMarketSourceCadence(()=>{if(throws)throw Error('bad clock');return now;});
 assert.equal((await read('a','session',10000,()=>++calls)).value,1);
 now=99999;assert.equal((await read('b','session',10000,()=>++calls)).status,'rejected');
 throws=true;assert.equal((await read('b','session',10000,()=>++calls)).status,'rejected');
 assert.equal(calls,1);
 throws=false;now=100000;
 const bad=await read('b','session',10000,()=>{calls++;throws=true;return 'bad';});
 assert.equal(bad.status,'rejected');assert.equal(bad.finishedAt,null);
 throws=false;now=110000;assert.equal((await read('b','session',10000,()=>++calls)).value,3);
});

test('queued collection rechecks the clock at actual dispatch and shares rejection',async()=>{
 let now=100000,calls=0;
 const read=createMarketSourceCadence(()=>now),collect=()=>++calls;
 const first=read('industry','session',10000,collect),peer=read('industry','session',10000,collect);
 now=99999;
 for(const result of await Promise.all([first,peer])){
  assert.equal(result.status,'rejected');assert.equal(result.finishedAt,null);assert.equal(result.value,undefined);
 }
 assert.equal(calls,0);
 now=100000;assert.equal((await read('industry','session',10000,collect)).status,'rejected');
 now=110000;assert.equal((await read('industry','session',10000,collect)).value,1);
});
test('throwing dispatch clock does not invoke the queued collector',async()=>{
 let bad=false,calls=0;
 const read=createMarketSourceCadence(()=>{if(bad)throw Error('clock');return 100000;});
 const first=read('seal','session',10000,()=>++calls);bad=true;
 const result=await first;assert.equal(result.status,'rejected');assert.equal(result.finishedAt,null);assert.equal(calls,0);
});
test('delayed actual dispatch starts the success cooldown at the wire attempt',async()=>{
 let now=100000,calls=0;
 const read=createMarketSourceCadence(()=>now),collect=()=>++calls;
 const first=read('industry','session',10000,collect);now=125000;
 assert.equal((await first).value,1);
 now=134999;const cached=await read('industry','session',10000,collect);assert.equal(cached.value,1);assert.equal(cached.reused,true);
 now=135000;assert.equal((await read('industry','session',10000,collect)).value,2);
});
test('delayed failed dispatch also starts cooldown at the actual attempt',async()=>{
 let now=100000,calls=0;
 const read=createMarketSourceCadence(()=>now),collect=()=>{calls++;throw Error('503');};
 const first=read('industry','session',10000,collect);now=125000;
 assert.equal((await first).status,'rejected');
 now=134999;const cached=await read('industry','session',10000,collect);assert.equal(cached.status,'rejected');assert.equal(cached.reused,true);assert.equal(calls,1);
 now=135000;assert.equal((await read('industry','session',10000,collect)).reused,false);assert.equal(calls,2);
});
