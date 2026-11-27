'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const model=import('../src/core/decision-model.mjs');
const day='2026-11-25',at=clock=>Date.parse(day+'T'+clock+'+08:00');
const now=at('10:00:00');
const stock=(t)=>({code:'600001',name:'公开报价候选',price:10,pct:2,score:85,
 quoteAt:t-1000,receivedAt:t-500,quoteSource:'tencent',quoteMode:'public-live-unverified',canTrade:true,
 poolDay:day,volume:100000,amount:1000000,paths:['横盘放量'],
 levels:{ma5:9.8,stop:9.7,t1:11}});
const state=(t=now)=>({trading:true,marketClock:{day,trading:true},poolDay:day,pool:[stock(t)],
 marketDistribution:{kind:'market-distribution-intraday',source:'打板客盘中涨跌分布',scope:'沪深京 A 股（含 ST）',
  day,quoteAt:t-30000,knownAt:t-20000,adv:3000,dec:1000,flat:100,observed:4100,total:4100,upLimit:70,downLimit:10},
 dabanke:{day,knownAt:t-20000,mode:'盘中',market:{quoteAt:t-30000},ecology:[{label:'当日封板',success:70,total:90}]},
 paper:{pool:{enabled:true,equity:100000,cash:100000,positions:[],executionPolicy:{maxPositions:5,allocationPct:19.6}}}});
const fallback=(s,t=now,total=4100)=>{
 delete s.marketDistribution;
 s.breadth={day,at:t-30000,up:3000,down:1000,n:4100,...(total==null?{}:{total})};
 const base={source:'原盘中同批专题池',scope:'同口径',date:day,quoteAt:t-30000,knownAt:t-20000};
 s.marketRecovery={metrics:{upLimit:{...base,value:70},downLimit:{...base,value:10}}};
 return s;
};
test('a market breadth receipt cannot revive a quote older than the existing 15-minute collector bound',async()=>{
 const {buildDecisionBoard}=await model;
 for(const [age,allowed] of [[900000,true],[900001,false],[3600000,false]]){
  const s=state();s.marketDistribution.quoteAt=now-age;
  const r=buildDecisionBoard(s,{now});
  assert.equal(r.weather.canConsider,allowed);assert.equal(r.cards.length,allowed?1:0);
 }
});
test('afternoon buy weather never reuses the morning or preopen observation',async()=>{
 const {buildDecisionBoard}=await model,t=at('13:02:00'),s=state(t);
 s.marketDistribution.quoteAt=at('11:30:00');
 assert.equal(buildDecisionBoard(s,{now:t}).cards.length,0);
 const open=at('09:32:00'),a=state(open);a.marketDistribution.quoteAt=at('09:25:00');
 assert.equal(buildDecisionBoard(a,{now:open}).cards.length,0);
 assert.equal(buildDecisionBoard(state(t),{now:t}).cards.length,1);
});
test('coverage below the existing 80% floor and a tiny universe cannot generate buy cards',async()=>{
 const {buildDecisionBoard}=await model;
 for(const [observed,total,allowed] of [[4000,5000,true],[3999,5000,false],[100,100,false]]){
  const s=state(),row=s.marketDistribution;
  Object.assign(row,{observed,total,adv:observed-10,dec:10,flat:0,upLimit:9,downLimit:1});
  const r=buildDecisionBoard(s,{now});assert.equal(r.weather.canConsider,allowed);assert.equal(r.cards.length,allowed?1:0);
 }
});
test('identical market retries are harmless but contradictory same-batch observations are not chosen by array order',async()=>{
 const {buildDecisionBoard}=await model,s=state(),original=structuredClone(s.marketDistribution);
 s.marketRecovery={coverage:[structuredClone(original)]};
 assert.equal(buildDecisionBoard(s,{now}).cards.length,1);
 s.marketRecovery.coverage[0].adv--;s.marketRecovery.coverage[0].dec++;
 const before=JSON.stringify(s),r=buildDecisionBoard(s,{now});
 assert.equal(r.weather.status,'unknown');assert.equal(r.cards.length,0);assert.match(r.weather.summary,/冲突/);
 assert.equal(JSON.stringify(s),before);
});
test('an explicit current distribution conflict cannot fall back to a different sample to allow a buy',async()=>{
 const {buildDecisionBoard}=await model,s=fallback(state());
 s.marketDistribution={...state().marketDistribution,sourceConflict:true};
 const r=buildDecisionBoard(s,{now});assert.equal(r.cards.length,0);assert.match(r.weather.summary,/冲突/);
});
test('stale or conflicting sealing evidence cannot produce a green or yellow buy card',async()=>{
 const {buildDecisionBoard}=await model;
 for(const alter of [s=>{s.dabanke.market.quoteAt=now-900001;},s=>{s.dabanke.mode='收盘';},
  s=>{s.dabanke.knownAt=now-900001;delete s.dabanke.market;},
  s=>{s.dabanke.ecology.push({label:'当日封板',success:80,total:90});}]){
  const s=state();alter(s);const r=buildDecisionBoard(s,{now});assert.equal(r.cards.length,0);assert.equal(r.weather.metrics.sealRate,null);
 }
});
test('fallback width keeps descriptive counts but requires a valid denominator and original clocks for buy weather',async()=>{
 const {buildDecisionBoard}=await model,good=fallback(state());
 assert.equal(buildDecisionBoard(good,{now}).cards.length,1);
 for(const alter of [s=>delete s.breadth.total,s=>{s.breadth.total=6000;},s=>delete s.marketRecovery.metrics.upLimit.quoteAt,
  s=>{s.marketRecovery.metrics.downLimit.quoteAt-=1000;},s=>{s.marketRecovery.metrics.upLimit.quoteAt=now-900001;}]){
  const s=structuredClone(good);alter(s);assert.equal(buildDecisionBoard(s,{now}).cards.length,0);
 }
 const missing=fallback(state(),now,null),r=buildDecisionBoard(missing,{now});
 assert.equal(r.weather.metrics.breadth,73.17);assert.match(r.weather.summary,/覆盖率/);
});
test('dated market history remains readable and the existing red-market restriction remains intact',async()=>{
 const {buildDecisionBoard}=await model,t=at('16:00:00'),s=state(t);
 s.trading=false;s.marketClock.trading=false;
 s.marketDistribution.kind='market-distribution';s.marketDistribution.quoteAt=at('15:00:00');
 s.marketDistribution.knownAt=at('15:10:00');s.dabanke.mode='收盘';
 const r=buildDecisionBoard(s,{now:t});assert.equal(r.cards.length,0);assert.equal(r.weather.metrics.breadth,73.17);
 const weak=state();weak.marketDistribution.adv=1000;weak.marketDistribution.dec=3000;
 assert.equal(buildDecisionBoard(weak,{now}).weather.status,'red');
 assert.equal(buildDecisionBoard(weak,{now}).cards.length,0);
});
