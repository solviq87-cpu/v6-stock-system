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
