'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../em.js'),'utf8');
const start=Date.parse('2026-11-26T10:00:00+08:00');
const quote=(source='eastmoney',patch={})=>({code:'600001',price:10,pct:1,quoteAt:start-1000,receivedAt:start,quoteSource:source,canTrade:true,...patch});
function fixture(primary,secondary=[quote('tencent',{price:12})],backup=[]){
 const a=source.indexOf('async function fetchBatchSnapshot(codes)'),b=source.indexOf('async function fetchBatchSnapshotEM',a);
 assert.ok(a>=0&&b>a);
 const calls=[];
 class Clock extends Date{static now(){return start;}}
 const c={Date:Clock,_srcWarn(){},fetchBatchSnapshotEM:async()=>{calls.push('primary');return primary;},fetchBatchSnapshotTx:async()=>{calls.push('secondary');return secondary;},require:()=>({photoQuoteFallback:()=>backup})};
 vm.createContext(c);vm.runInContext(source.slice(a,b),c);return {calls,read:()=>c.fetchBatchSnapshot(['600001'])};
}
test('D06 equal-time contradictory primary observations require independently sourced fallback',async()=>{
 for(const rows of [[quote(),quote('eastmoney',{price:11})],[quote('eastmoney',{price:11}),quote()]]){const f=fixture(rows),r=await f.read();assert.equal(r[0].quoteSource,'tencent');assert.equal(r[0].price,12);assert.deepEqual(f.calls,['primary','secondary']);}
});
test('D06 a wrong source label cannot establish primary recovery',async()=>{const f=fixture([quote('tencent',{price:99})]),r=await f.read();assert.equal(r[0].price,12);assert.deepEqual(f.calls,['primary','secondary']);});
test('D06 explicit synthetic or conflicting evidence cannot establish a live source',async()=>{
 for(const patch of [{synthetic:true},{sourceConflict:true},{quoteSourceConflict:true},{quoteStatus:'conflict'},{evidenceStatus:'conflict'},{testSample:true}]){const f=fixture([quote('eastmoney',patch)]);assert.equal((await f.read())[0].quoteSource,'tencent');}
});
test('D06 contradictory secondary evidence is not published without a valid third route',async()=>{const f=fixture([],[quote('tencent'),quote('tencent',{price:11})]);assert.equal((await f.read()).length,0);});
test('D06 a research-only third route can never grant a transaction permission',async()=>{const f=fixture([],[],[quote('read-only-research')]);const r=await f.read();assert.equal(r[0].canTrade,false);});
test('D07 a strictly newer valid primary tick can supersede an older contradictory pair',async()=>{const f=fixture([quote(),quote('eastmoney',{price:11}),quote('eastmoney',{price:13,quoteAt:start-500})]);const r=await f.read();assert.equal(r[0].price,13);assert.deepEqual(f.calls,['primary']);});
test('D07 identical same-time primary rows retain a single valid observation and original time',async()=>{const f=fixture([quote(),quote()]);const r=await f.read();assert.equal(r.length,1);assert.equal(r[0].quoteAt,start-1000);assert.deepEqual(f.calls,['primary']);});

test('D46 an asserted research fallback notification or training flag cannot escape read-only policy',async()=>{
 const f=fixture([],[],[quote('read-only-research',{canTrade:true,canNotify:true,verifiedLive:true,canTrain:true})]);const rows=await f.read();
 assert.equal(rows.length,1);for(const k of ['canTrade','canNotify','verifiedLive','canTrain'])assert.equal(rows[0][k],false);
});
test('D06 conflicting same-time notification rights cannot pick a more permissive main copy',async()=>{
 const f=fixture([quote('eastmoney',{canNotify:true}),quote('eastmoney',{canNotify:false})]);const rows=await f.read();
 assert.equal(rows[0].quoteSource,'tencent');assert.equal(rows[0].price,12);
});
