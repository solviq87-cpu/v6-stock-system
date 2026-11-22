'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createMarketRecovery}=require('../src/research/market-recovery');
const {createShortlineV6Reader}=require('../src/research/shortline-v6-data');
const now=Date.parse('2026-11-21T09:33:14+08:00');
const today='2026-11-20',prior='2026-11-19',before='2026-11-18';
const fixture=()=>[before,prior,today].map((date,i)=>({date,source:'原始市场统计',knownAt:now,availableAt:'2026-11-21 09:33',upLimit:25+i*12,downLimit:15-i*4,
  breakRate:35-i*4,height:3+i,leader:.5+i,diffusion:35+i*12,premium:i+.4,trend:'多头',sh:'多头',cy:'多头',adv:3300,dec:1400,amount:9162,
  fieldSources:{diffusion:{source:'完整涨停行业分布',knownAt:now}}}));
test('首次自动跨日补采共享请求、保存获知时间，逐指标回看及重启保留原日',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-recovery-'));t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
 let day=today,clock=now,rows=fixture(),fetches=0,saved=[];
 const options={file:path.join(dir,'observed.json'),clock:()=>clock,getDay:()=>day,collect:async()=>{
   fetches++;await new Promise(r=>setTimeout(r,10));return {rows,sources:[{name:'历史池',status:'available'}]};
 },save:async values=>{saved=values;return true;}};
 const runner=createMarketRecovery(options);
 await Promise.all([runner.tick(),runner.tick()]);
 let d=runner.display();assert.equal(fetches,1);assert.equal(d.phase,'ready');
 assert.equal(d.emotion.value,'发酵');assert.equal(d.metrics.diffusion.source,'完整涨停行业分布');
 const {marketAsOf}=await import('../public/nova/shortline/market.mjs');
 assert.equal(marketAsOf({market:saved},today,today+' 15:00').length,0);
 assert.equal(marketAsOf({market:saved},today,now).length,3);
 day='2026-11-23';clock+=3*86400000;rows=[{date:day,source:'当日宽度',knownAt:clock,adv:2300}];
 await runner.tick();d=runner.display();
 assert.equal(d.phase,'partial');assert.equal(d.metrics.adv.date,day);assert.equal(d.metrics.downLimit.date,today);
 assert.equal(d.emotion.date,today);assert.ok(d.nextRetryAt>clock);
 const restart=createMarketRecovery({...options,isReplica:()=>true});await restart.tick();
 assert.equal(restart.display().metrics.downLimit.date,today);assert.equal(fetches,2);
});
test('供应商失败后有界重试，恢复后自动归档',async()=>{
 let calls=0,clock=now;
 const job=createMarketRecovery({clock:()=>clock,getDay:()=>today,collect:async()=>{if(++calls===1)throw Error('断连');return {rows:fixture()};},save:async()=>true});
 await job.tick();assert.equal(job.display().phase,'partial');
 await job.tick();assert.equal(calls,1);clock=job.display().nextRetryAt;
 await job.tick();assert.equal(job.display().phase,'ready');assert.equal(calls,2);
});
test('没有股票池也能取得市场补采证据，互不依赖的供应商失败不清空已证据',async()=>{
 const read=createShortlineV6Reader({getState:()=>({}),clock:()=>now,getLatestClosedDay:()=>today,previousTradeDay:()=>prior,
    fetchPreviousPool:async()=>null,readCloseReviewEvidence:async()=>null,
    marketBackfill:async()=>({rows:fixture()}),breadthFallback:async()=>{throw Error('限频');}});
 const result=await read.readMarket(today);
 assert.equal(result.rows.length,3);assert.equal(result.rows.at(-1).upLimit,49);
 assert.equal(result.rows.at(-1).knownAt,now);
});

test('副本可独立读取公开行情，保持私有研究与磁盘只读',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-replica-public-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'market.json');
 const r=createMarketRecovery({file,getDay:()=>today,isReplica:()=>true,replicaPublicReads:true,clock:()=>now,
   collect:async()=>({rows:fixture()}),save:async()=>{throw Error('副本不应进入写入路径');}});
 await r.tick();assert.equal(r.display().phase,'ready');assert.equal(r.display().metrics.leader.date,today);
 assert.equal(fs.existsSync(file),false);
});

test('同日冲突时保留连续统计的指标及其原口径，公开成交额带沪深范围',async()=>{
 const read=createShortlineV6Reader({getState:()=>({}),clock:()=>now,getLatestClosedDay:()=>today,previousTradeDay:()=>prior,
   fetchPreviousPool:async()=>null,readCloseReviewEvidence:async()=>({day:today,down:99,marketTurnover:1422200422937.5}),
   marketBackfill:async()=>({rows:[{date:today,downLimit:58,knownAt:now,fieldSources:{downLimit:{source:'核验跌停池',knownAt:now-1}}}]})});
 const service=createMarketRecovery({getDay:()=>today,clock:()=>now,collect:read.readMarket,save:async()=>true});
 await service.tick();
 assert.deepEqual(service.display().metrics.downLimit,{value:58,source:'核验跌停池',date:today,knownAt:now-1});
 assert.equal(service.display().metrics.amount.scope,'沪深两市成交额');
 assert.equal(service.display().metrics.amount.value,14222.004229375);
});
