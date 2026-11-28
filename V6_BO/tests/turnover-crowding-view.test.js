'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTurnoverCrowding}=require('../src/core/turnover-crowding');
const times=[];for(let t=Date.parse('2026-09-01T10:02:00+08:00');times.length<21;t+=86400000)if(![0,6].includes(new Date(t).getUTCDay()))times.push(t);
function snap(at,amounts=[50,50]){return {date:new Date(at+28800000).toISOString().slice(0,10),source:'eastmoney-clist-unverified-live',universeSize:2,
 startedAt:new Date(at-10000).toISOString(),retrievedAt:new Date(at).toISOString(),sourceCoverage:{monetaryUnit:'provider-CNY-unverified'},
 stocks:amounts.map((amount,i)=>({code:String(i+1).padStart(6,'0'),amount,pctChange:1,vendorQuoteAt:at-2000}))};}
test('shared display shows measured HHI, historical percentile, observation time and non-flow disclaimer',async()=>{
 const {turnoverCrowdingView}=await import('../public/nova/turnover-crowding-view.mjs');const r=createTurnoverCrowding();
 for(const at of times.slice(0,20))r.observe(snap(at),{asOf:at});
 const at=times[20],v=turnoverCrowdingView(r.observe(snap(at,[0,100]),{asOf:at}));
 assert.match(v.description,/20 \/ 20.*不等于资金净流入/);assert.deepEqual(v.metrics.find(x=>x[0]==='同样本同时段历史分位'),['同样本同时段历史分位','100%']);
 assert.deepEqual(v.metrics.find(x=>x[0]==='全池成交额HHI'),['全池成交额HHI','1']);assert.match(v.metrics.find(x=>x[0]==='行业成交额HHI')[1],/缺少完整/);
});
test('insufficient history and permission-conflicting outputs never fabricate a percentile or zero',async()=>{
 const {turnoverCrowdingView}=await import('../public/nova/turnover-crowding-view.mjs'),at=times[0],r=createTurnoverCrowding();
 const v=r.observe(snap(at),{asOf:at});assert.match(turnoverCrowdingView(v).description,/历史可比交易日不足/);
 assert.equal(turnoverCrowdingView(v).metrics.some(x=>x[0]==='同样本同时段历史分位'),false);
 assert.deepEqual(turnoverCrowdingView({...v,canTrade:true}).metrics,[]);
 const zero=turnoverCrowdingView(r.observe(snap(at,[0,0]),{asOf:at}));assert.deepEqual(zero.metrics.find(x=>x[0]==='成交额有效证券覆盖'),['成交额有效证券覆盖','2 / 2']);assert.equal(zero.metrics.some(x=>x[0].includes('累计成交额')),false);assert.equal(turnoverCrowdingView(null),null);
});

test('F40 shared display uses full aligned amount and exposes missing coverage without a shrink conclusion',async()=>{
 const {turnoverCrowdingView}=await import('../public/nova/turnover-crowding-view.mjs');const tracker=createTurnoverCrowding();
 for(const at of times.slice(0,20))tracker.observe(snap(at),{asOf:at});
 const at=times[20],full=turnoverCrowdingView(tracker.observe(snap(at,[20,20]),{asOf:at}));
 assert.deepEqual(full.metrics.find(x=>x[0]==='同期成交额相对变化'),['同期成交额相对变化','-60%']);
 const missing=snap(at+1000);missing.stocks.pop();const v=turnoverCrowdingView(tracker.observe(missing,{asOf:at+1000}));
 assert.deepEqual(v.metrics.find(x=>x[0]==='成交额有效证券覆盖'),['成交额有效证券覆盖','1 / 2']);
 assert.match(v.metrics.find(x=>x[0]==='同期成交额比较')[1],/不判缩量/);
 assert.equal(v.metrics.some(x=>x[0]==='同期成交额相对变化'),false);
});
