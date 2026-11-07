'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fetchEastmoneySnapshot,fetchEastmoneyBreadth,toStock}=require('../src/core/eastmoney-market-snapshot');
const make=(total,items)=>({ok:true,json:async()=>({data:{total,diff:items}})});
const item=(n,pct)=>({f12:String(n).padStart(6,'0'),f13:0,f3:pct,f6:100});
test('parses two complete pages and produces sourced breadth',async()=>{
 let calls=0;const fetchImpl=async()=>++calls===1?make(4,[item(1,1),item(2,-2)]):make(4,[item(3,0),item(4,3)]);
 const result=await fetchEastmoneyBreadth({fetchImpl,pageSize:2,now:Date.UTC(2026,10,5)});
 assert.equal(calls,2);assert.equal(result.breadth.usable,true);assert.equal(result.breadth.up,2);
 assert.equal(result.breadth.down,1);assert.equal(result.breadth.flat,1);
 assert.equal(result.snapshotMetadata.source,'eastmoney-clist-unverified-live');
});
test('rejects incomplete pagination without inventing breadth',async()=>{
 await assert.rejects(fetchEastmoneySnapshot({fetchImpl:async()=>make(5,[item(1,1)]),pageSize:2,maxPages:2}),/提前结束|未完整抓取|分页记录数异常/);
});
test('rejects changing universe size across pages',async()=>{
 let n=0;await assert.rejects(fetchEastmoneySnapshot({fetchImpl:async()=>++n===1?make(3,[item(1,1),item(2,2)]):make(4,[item(3,3)]),pageSize:2}),/总数变化/);
});
test('rejects malformed gateway payload and invalid prices',async()=>{
 await assert.rejects(fetchEastmoneySnapshot({fetchImpl:async()=>({ok:true,json:async()=>({data:{total:0,diff:[]}})})}),/响应缺少/);
 assert.equal(toStock({f12:'000001',f13:0,f3:'-',f6:0}),null);
});
test('rejects gateway HTTP errors',async()=>{
 await assert.rejects(fetchEastmoneySnapshot({fetchImpl:async()=>({ok:false,status:502})}),/HTTP 502/);
});

test('rejects duplicate codes across pages instead of overstating completeness',async()=>{
 let calls=0;const fetchImpl=async()=>++calls===1?make(4,[item(1,1),item(2,2)]):make(4,[item(2,-1),item(4,3)]);
 await assert.rejects(fetchEastmoneySnapshot({fetchImpl,pageSize:2}),/跨页股票代码重复/);
});
test('rejects short intermediate page even when later pages might compensate',async()=>{
 await assert.rejects(fetchEastmoneySnapshot({fetchImpl:async()=>make(4,[item(1,1)]),pageSize:2}),/分页记录数异常/);
});
test('does not interpret missing percent change as zero',()=>{
 assert.equal(toStock({f12:'000001',f13:0,f6:100}),null);
 assert.equal(toStock({f12:'000001',f13:0,f3:'',f6:100}),null);
});
