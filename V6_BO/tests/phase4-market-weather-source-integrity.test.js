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

const cases=[
 ['older same-source batch cannot hide a newer incomplete batch',s=>{s.marketRecovery={coverage:[{...s.marketDistribution}]};Object.assign(s.marketDistribution,{quoteAt:now-1000,knownAt:now-500,total:10000});},false],
 ['the current provider alias is not an independent backup',s=>{s.marketRecovery={coverage:[{...s.marketDistribution}]};Object.assign(s.marketDistribution,{source:'打板客',quoteAt:now-1000,knownAt:now-500,total:10000});},false],
 ['a different valid source may supply an independent qualified batch',s=>{s.marketRecovery={coverage:[{...s.marketDistribution,source:'独立全市场来源'}]};Object.assign(s.marketDistribution,{quoteAt:now-1000,knownAt:now-500,total:10000});},true],
 ['simultaneous same-scope conflicting providers must not depend on input order',s=>{s.marketRecovery={coverage:[{...s.marketDistribution,source:'独立全市场来源',adv:1000,dec:3000}]};},false],
 ['scope formatting cannot hide an equivalent conflicting batch',s=>{s.marketRecovery={coverage:[{...s.marketDistribution,scope:'沪深京A股(含ST)',adv:1000,dec:3000}]};},false],
 ['identical comparable sources are still usable',s=>{s.marketRecovery={coverage:[{...s.marketDistribution,source:'独立全市场来源',scope:'沪深京A股(含ST)'}]};},true],
 ['a sector-labelled distribution cannot certify the full market',s=>{s.marketDistribution.scope='芯片行业板块';},false],
 ['an explicitly simulated distribution is ineligible',s=>{s.marketDistribution.simulated=true;},false],
 ['an explicitly imported distribution is ineligible',s=>{s.marketDistribution.imported=true;},false],
 ['a known-null original sealing page clock is not a receipt-only record',s=>{s.dabanke.market.quoteAt=null;},false],
 ['a missing clock in a present original page object is invalid',s=>{s.dabanke.market={};},false],
 ['the previous receipt-only ecology compatibility remains labelled',s=>{delete s.dabanke.market;},true],
 ['a future partial batch cannot revoke a currently known valid receipt',s=>{s.marketRecovery={coverage:[{...s.marketDistribution,quoteAt:now+1000,knownAt:now+2000,total:10000}]};},true],
 ['a newly recovered valid batch remains eligible',s=>{s.marketRecovery={coverage:[{...s.marketDistribution,total:10000}]};Object.assign(s.marketDistribution,{quoteAt:now-1000,knownAt:now-500});},true]
];
for(const [name,change,allowed] of cases)test('market source integrity: '+name,async()=>{
 const {buildDecisionBoard}=await model,s=state();change(s);
 const before=JSON.stringify(s),result=buildDecisionBoard(s,{now});
 assert.equal(result.weather.canConsider,allowed);
 assert.equal(result.cards.length,allowed?1:0);
 assert.equal(JSON.stringify(s),before);
 if(!s.dabanke.market)assert.equal(result.weather.basis.find(row=>row.kind==='sealing').clockBasis,'receipt-only');
});
test('market weather comparison does not mutate input or pick a favourable provider ordering',async()=>{
 const {buildDecisionBoard}=await model,s=state(),a=s.marketDistribution,b={...a,source:'独立全市场来源',adv:1000,dec:3000};
 for(const [first,second] of [[a,b],[b,a]]){
  const x={...s,marketDistribution:first,marketRecovery:{coverage:[second]}};
  const before=JSON.stringify(x),result=buildDecisionBoard(x,{now});
  assert.equal(result.cards.length,0);assert.match(result.weather.summary,/冲突/);assert.equal(JSON.stringify(x),before);
 }
});
