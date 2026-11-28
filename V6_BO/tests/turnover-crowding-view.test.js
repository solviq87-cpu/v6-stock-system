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
 assert.deepEqual(turnoverCrowdingView(r.observe(snap(at,[0,0]),{asOf:at})).metrics,[]);assert.equal(turnoverCrowdingView(null),null);
});
