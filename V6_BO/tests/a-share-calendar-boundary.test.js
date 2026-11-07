'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {aShareCalendarDate}=require('../src/core/a-share-calendar');
const {validateImport}=require('../src/core/market-data-center');
const {analyzeMarketBreadth}=require('../src/core/market-breadth');
const {fetchEastmoneySnapshot}=require('../src/core/eastmoney-market-snapshot');
const {adaptCachedKline}=require('../src/strategy/cached-kline-adapter');
const {adaptCachedKline:adaptResearchV2}=require('../src/strategy/research-v2-cached-kline-adapter');
const before=Date.UTC(2026,10,4,15,59,59);
const after=Date.UTC(2026,10,4,16,0,0);
const localToday='2026-11-05';
const bars=()=>Array.from({length:30},(_,i)=>({
 date:new Date(Date.UTC(2026,9,7+i)).toISOString().slice(0,10),
 open:10,high:11,low:9,close:10,volume:1000
}));
const imported=()=>({source:'imported',provider:'licensed',datasetId:'sample-001',asOf:localToday,
 stocks:[{code:'000001',bars:Array.from({length:32},(_,i)=>({
 date:new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10),
 open:10,high:11,low:9,close:10,volume:1000
 }))}]});
const provenance={provider:'licensed',datasetId:'sample-001'};
test('A股日期在北京时间午夜切换，不依赖运行机器时区',()=>{
 assert.equal(aShareCalendarDate(before),'2026-11-04');
 assert.equal(aShareCalendarDate(after),localToday);
 assert.equal(aShareCalendarDate('2026-11-05T00:00:00+08:00'),localToday);
 assert.throws(()=>aShareCalendarDate('invalid'),/无效/);
});
test('进口历史数据允许北京时间已到当日但拒绝下一日或北京时间未到',()=>{
 assert.throws(()=>validateImport(imported(),{...provenance,now:before}),/未来日期/);
 assert.doesNotThrow(()=>validateImport(imported(),{...provenance,now:after}));
 assert.throws(()=>validateImport({...imported(),asOf:'2026-11-06'}, {...provenance,now:after}),/未来日期/);
});
test('市场宽度的快照交易日与分析asOf使用相同北京时间口径',()=>{
 const snapshot={date:localToday,source:'source',universeSize:1,stocks:[{code:'000001',pctChange:2,amount:1}]};
 assert.match(analyzeMarketBreadth(snapshot,{asOf:before}).reason,/未来/);
 assert.equal(analyzeMarketBreadth(snapshot,{asOf:after}).usable,true);
 assert.match(analyzeMarketBreadth({...snapshot,date:'2026-11-06'},{asOf:after}).reason,/未来/);
});
test('东方财富采样日期使用A股所在市场日，不改变数据来源的未认证标记',async()=>{
 const fetchImpl=async()=>({ok:true,json:async()=>({data:{total:1,diff:[{f12:'000001',f13:0,f3:2,f6:100}]}})});
 const early=await fetchEastmoneySnapshot({now:before,fetchImpl,pageSize:1,maxPages:1});
 const late=await fetchEastmoneySnapshot({now:after,fetchImpl,pageSize:1,maxPages:1});
 assert.equal(early.date,'2026-11-04');
 assert.equal(late.date,localToday);
 assert.equal(late.source,'eastmoney-clist-unverified-live');
});
test('两套K线适配器拒绝未来日和未收盘当日K线，尊重24小时缓存限制',()=>{
 const rows=bars();rows[rows.length-1].date=localToday;
 for(const adapt of [adaptCachedKline,adaptResearchV2]){
  assert.match(adapt('000001',{rows},{now:before,cachedAt:before}).error,/未来/);
  assert.match(adapt('000001',{rows},{now:after,cachedAt:after}).error,/15:10/);
  const afterClose=Date.UTC(2026,10,5,7,10);
  assert.ok(adapt('000001',{rows},{now:afterClose,cachedAt:afterClose}).stock);
  const tomorrow=rows.map((r,i)=>i===rows.length-1?{...r,date:'2026-11-06'}:r);
  assert.match(adapt('000001',{rows:tomorrow},{now:after,cachedAt:after}).error,/未来/);
  assert.match(adapt('000001',{rows},{now:after,cachedAt:after-86400001}).error,/24小时/);
 }
});

test('市场覆盖率阈值必须为有限数，NaN不能绕过低覆盖率门禁',()=>{
 const snapshot={date:localToday,source:'source',universeSize:10,stocks:[{code:'000001',pctChange:2}]};
 for(const minCoverage of [NaN,Infinity,-Infinity,0,1.2,'0.1']){
  assert.throws(()=>analyzeMarketBreadth(snapshot,{asOf:after,minCoverage}),/minCoverage/);
 }
 assert.equal(analyzeMarketBreadth(snapshot,{asOf:after,minCoverage:0.8}).usable,false);
});
test('东方财富缺失市场代码或空白涨跌幅不得被静默当作有效零值',()=>{
 const {toStock}=require('../src/core/eastmoney-market-snapshot');
 for(const f13 of [null,undefined,'','  '])assert.equal(toStock({f12:'000001',f13,f3:1,f6:2}),null);
 assert.equal(toStock({f12:'000001',f13:0,f3:'   ',f6:2}),null);
 assert.equal(toStock({f12:'000001',f13:0,f3:0,f6:2}).pctChange,0);
});
test('东方财富采集超时参数必须有限且在有界范围内',async()=>{
 for(const timeoutMs of [NaN,Infinity,0,50,60001,'500']){
  await assert.rejects(fetchEastmoneySnapshot({timeoutMs,fetchImpl:async()=>{throw Error('不应执行联网')}}),/超时时间/);
 }
});
