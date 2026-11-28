'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRecentMarketExpansion}=require('../src/core/recent-market-expansion');
const t=Date.parse('2026-11-05T10:00:00+08:00');
const snap=(at,changes)=>({date:'2026-11-05',source:'eastmoney-clist-unverified-live',universeSize:2,
 startedAt:new Date(at-1000).toISOString(),retrievedAt:new Date(at).toISOString(),
 stocks:changes.map((pctChange,i)=>({code:String(i+1).padStart(6,'0'),pctChange,vendorQuoteAt:at-2000}))});
test('shared UI projects actual paired research with time, sample and percentage-point units',async()=>{
 const {marketExpansionView}=await import('../public/nova/market-expansion-view.mjs');
 const r=createRecentMarketExpansion();r.observe(snap(t,[-1,1]));
 const p=marketExpansionView(r.observe(snap(t+60000,[1,1])));
 assert.equal(p.title,'同样本市场扩散速度');assert.match(p.description,/上涨范围扩大.*2 \/ 2.*非交易所认证/);
 assert.equal(p.metrics[1][1],'50 个百分点');assert.equal(p.metrics[2][1],'50 个百分点/分钟');
 assert.equal(p.metrics[3][1],'1 / 0');assert.equal(p.metrics[4][1],'60 秒');
});
test('unavailable and malformed research cannot render a fabricated zero expansion',async()=>{
 const {marketExpansionView}=await import('../public/nova/market-expansion-view.mjs');
 const r=createRecentMarketExpansion(),baseline=r.observe(snap(t,[-1,1]));
 assert.match(marketExpansionView(baseline).description,/等待第二次合格采样/);
 assert.deepEqual(marketExpansionView(baseline).metrics,[]);
 assert.deepEqual(marketExpansionView({...baseline,status:'observed-unverified'}).metrics,[]);
 assert.equal(marketExpansionView(null),null);
});
