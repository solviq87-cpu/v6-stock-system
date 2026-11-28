'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTurnoverCrowding}=require('../src/core/turnover-crowding');
const times=[];for(let t=Date.parse('2026-09-01T10:02:00+08:00');times.length<22;t+=86400000)if(![0,6].includes(new Date(t).getUTCDay()))times.push(t);
function snapshot(at,amounts=[25,25,25,25],changes=[1,1,-1,0]){return {date:new Date(at+28800000).toISOString().slice(0,10),source:'eastmoney-clist-unverified-live',universeSize:4,startedAt:new Date(at-10000).toISOString(),retrievedAt:new Date(at).toISOString(),sourceCoverage:{monetaryUnit:'provider-CNY-unverified'},stocks:amounts.map((amount,i)=>({code:String(i+1).padStart(6,'0'),amount,pctChange:changes[i],vendorQuoteAt:at-2000-i*1000}))};}
const read=(r,s)=>r.observe(s,{asOf:Date.parse(s.retrievedAt)});
function seed(mutate){const r=createTurnoverCrowding();times.slice(0,20).forEach((at,i)=>{const s=snapshot(at);mutate?.(s,i);read(r,s);});return r;}
function context(v){const c=v.participationContext;assert.equal(c.canTrade,false);assert.equal(c.canNotify,false);assert.equal(c.liquidityVerified,false);assert.equal(c.indexLeadTimeMs,null);return c;}
test('matched 20-day original-minute full roster: report weak breadth plus low observed turnover as research only',()=>{
 const v=read(seed(),snapshot(times[20],[5,5,5,5],[-1,-1,-1,0])),c=context(v);
 assert.equal(c.status,'observed-unverified');assert.equal(c.referenceDays,20);assert.equal(c.currentUpShare,0);assert.equal(c.currentDownShare,.75);assert.equal(c.currentTurnover,20);assert.equal(c.historicalTurnoverMedian,100);assert.equal(c.turnoverRatioToMedian,.2);assert.equal(c.historicalUpShareQ20,.5);assert.equal(c.observation,'weak-breadth-low-turnover');assert.equal(v.empiricalPercentile,50);
 assert.ok(v.references.every(x=>x.minuteProfileHash===c.minuteProfileHash));
});
test('low turnover alone or weak breadth alone cannot emit a joint observation; ties are not low',()=>{
 for(const [amounts,changes] of [[[5,5,5,5],[1,1,-1,0]],[[25,25,25,25],[-1,-1,-1,0]],[[25,25,25,25],[1,1,-1,0]]]){const c=context(read(seed(),snapshot(times[20],amounts,changes)));assert.equal(c.status,'observed-unverified');assert.equal(c.observation,'no-joint-observation');}
});
test('cold start, different original minute profile and changed roster withhold joint comparison',()=>{
 let c=context(read(createTurnoverCrowding(),snapshot(times[20])));assert.equal(c.status,'insufficient-comparable-history');assert.equal(c.observation,null);assert.equal(c.turnoverRatioToMedian,null);
 const r=seed((s,i)=>{if(i===0)s.stocks[0].vendorQuoteAt-=60000;});const v=read(r,snapshot(times[20]));assert.equal(v.referenceDays,20);c=context(v);assert.equal(c.referenceDays,19);assert.equal(c.status,'insufficient-comparable-history');assert.equal(c.observation,null);
 const s=snapshot(times[20]);s.stocks[3].code='999999';assert.equal(context(read(seed(),s)).referenceDays,0);
});
test('same original quote and changed return is disputed, not a fresh breadth observation',()=>{
 const r=seed(),s=snapshot(times[20]);assert.equal(context(read(r,s)).status,'observed-unverified');const changed=structuredClone(s);changed.stocks[0].pctChange=-1;
 const v=read(r,changed);assert.equal(v.status,'disputed-slot');assert.equal(context(v).observation,null);assert.equal(read(r,s).status,'disputed-slot');assert.equal(context(read(r,snapshot(times[21]))).referenceDays,19);
});
test('same-slot later completion cannot reuse frozen history for new risk output; invalid amount stays null',()=>{
 const r=seed(),s=snapshot(times[20]);read(r,s);let v=read(r,snapshot(times[20]+30000,[5,5,5,5],[-1,-1,-1,0]));assert.equal(v.status,'slot-already-frozen');assert.equal(context(v).observation,null);
 const missing=snapshot(times[21]);missing.stocks[0].amount=null;v=read(r,missing);assert.equal(v.status,'invalid-or-incomplete-snapshot');assert.equal(context(v).currentTurnover,null);assert.equal(context(v).observation,null);
});
test('returned references do not mutate the frozen participation baseline',()=>{
 const r=seed(),v=read(r,snapshot(times[20]));v.references.at(-1).totalTurnover=100000;v.references.at(-1).upShare=0;
 const c=context(read(r,snapshot(times[21])));assert.equal(c.historicalTurnoverMedian,100);assert.equal(c.historicalUpShareQ20,.5);
});
test('shared original card reports breadth and turnover observation without claiming liquidity or index lead time',async()=>{
 const {turnoverCrowdingView}=await import('../public/nova/turnover-crowding-view.mjs');const v=read(seed(),snapshot(times[20],[5,5,5,5],[-1,-1,-1,0]));const view=turnoverCrowdingView(v);
 assert.deepEqual(view.metrics.find(x=>x[0]==='同时段广度'),['同时段广度','上涨 0% / 下跌 75%']);
 assert.deepEqual(view.metrics.find(x=>x[0]==='成交额 / 历史中位数'),['成交额 / 历史中位数','20%']);
 assert.match(view.metrics.find(x=>x[0]==='联合研究观察')[1],/弱广度与低成交额并存/);assert.match(view.description,/不代表真实流动性或领先指数/);
});
test('unknown history and contradictory or forged metrics cannot show a joint finding',async()=>{
 const {turnoverCrowdingView}=await import('../public/nova/turnover-crowding-view.mjs');const v=read(seed(),snapshot(times[20],[5,5,5,5],[-1,-1,-1,0]));
 const unknown=turnoverCrowdingView(read(createTurnoverCrowding(),snapshot(times[20])));assert.match(unknown.metrics.find(x=>x[0]==='联合研究观察')[1],/可比样本不足/);
 for(const mutate of [c=>c.canTrade=true,c=>c.canNotify=true,c=>c.liquidityVerified=true,c=>c.indexLeadTimeMs=30000,c=>c.referenceDays=19,c=>c.currentDownShare=2,c=>c.turnoverRatioToMedian=1,c=>c.observation='no-joint-observation',c=>c.historicalTurnoverQ20=10,c=>c.minuteProfileHash='bad']){const copy=structuredClone(v);mutate(copy.participationContext);assert.doesNotMatch(turnoverCrowdingView(copy).metrics.map(r=>r[1]).join(' '),/弱广度与低成交额并存/);}
 const altered=structuredClone(v);altered.references[0].minuteProfileHash='bad';assert.doesNotMatch(turnoverCrowdingView(altered).metrics.map(r=>r[1]).join(' '),/弱广度与低成交额并存/);
 assert.deepEqual(turnoverCrowdingView({...v,canTrade:true}).metrics,[]);
});
