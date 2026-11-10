'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateDailySectorStrength:evaluate}=require('../src/strategy/daily-sector-strength');
const tradeDate='2026-11-10',asOf=Date.parse('2026-11-10T14:50:00+08:00');
const observedAt=asOf-60_000,provider='licensed-public-snapshot';
const quote=(symbol,changePct,isLimitUp=false)=>({symbol,changePct,isLimitUp,
 source:provider,observedAt,tradeDate,tradingStatus:'trading'});
function sample(){
 const sector=(code,name,pct,returns,category='industry')=>({
  code,name,category,source:provider,observedAt,tradeDate,
  memberCount:returns.length,changePct:pct,
  stocks:returns.map((ret,i)=>quote(String(600001+Number(code.slice(-1))*50+i),ret))
 });
 return {source:'imported',provider,tradeDate,observedAt,marketChangePct:.2,sectors:[
  sector('BK1','广泛强势',3,[2,2.5,3,3,4,4,4.5,5,5,6]),
  sector('BK2','龙头拉动',3,[20,18,-1,-1,-2,-2,-3,-3,-4,-5]),
  sector('BK3','疲弱板块',-2,[-3,-2,-1,-2,-1,-2,-3,-2,1,0])
 ]};
}
test('broad participation outranks a two-stock spike with the same sector return',()=>{
 const input=sample(),copy=structuredClone(input),r=evaluate(input,{asOf,tradeDate});
 assert.equal(r.status,'imported-unverified');
 const broad=r.sectors.find(s=>s.code==='BK1');
 const concentrated=r.sectors.find(s=>s.code==='BK2');
 assert.equal(broad.rank,1);assert.equal(broad.state,'broad-strength');
 assert.equal(broad.upCount,10);assert.equal(broad.upPct,100);
 assert.equal(concentrated.state,'leader-concentrated');
 assert.equal(concentrated.upCount,2);
 assert.ok(concentrated.topTwoPositiveSharePct>=70);
 assert.ok(broad.score>concentrated.score);
 assert.equal(r.sectors.find(s=>s.code==='BK3').state,'weak');
 assert.equal(r.canTrade,false);assert.equal(r.autoPromotion,false);
 assert.equal(r.verifiedLive,false);assert.equal(r.weightsChanged,false);
 assert.deepEqual(input,copy);
});
test('missing limits are unknown, not counted as zero; scores marked partial',()=>{
 const input=sample();delete input.sectors[0].stocks[0].isLimitUp;
 const r=evaluate(input,{asOf});
 const broad=r.sectors.find(s=>s.code==='BK1');
 assert.equal(broad.status,'partial-evidence');assert.equal(broad.limitUpCount,null);
 assert.ok(broad.warnings.some(x=>x.includes('缺少')));
});
test('insufficient constituent coverage prevents strong-sector classification',()=>{
 const input=sample();input.sectors[0].memberCount=15;
 const r=evaluate(input,{asOf});
 const broad=r.sectors.find(s=>s.code==='BK1');
 assert.equal(broad.status,'unknown');assert.equal(broad.rank,null);
 assert.equal(broad.score,null);
 assert.equal(r.rankedSectorCount,0,'two remaining valid sectors cannot claim a ranking');
});
test('stale, future, wrong-day, mock and cross-provider snapshots fail closed',()=>{
 const mutations=[
  s=>s.observedAt=asOf+1,
  s=>s.observedAt=asOf-3600000,
  s=>s.tradeDate='2026-11-09',
  s=>s.provider='synthetic',
  s=>s.source='simulated',
  s=>s.marketChangePct=NaN
 ];
 for(const modify of mutations){const input=sample();modify(input);
  const r=evaluate(input,{asOf});
  assert.equal(r.status,'unknown',r.reason);
  assert.equal(r.sectors.length,0);
 }
 for(const modify of [
  x=>x.source='another-provider',x=>x.tradeDate='2026-11-09',
  x=>x.observedAt=asOf+1,x=>x.changePct='5'
 ]){
  const input=sample();modify(input.sectors[0].stocks[0]);
  const r=evaluate(input,{asOf});
  assert.equal(r.sectors.find(x=>x.code==='BK1').status,'unknown');
 }
});
test('halted, missing and duplicate members are not invented or double counted',()=>{
 const s=sample();s.sectors[0].stocks[0]={...s.sectors[0].stocks[0],tradingStatus:'halted',changePct:null};
 const r=evaluate(s,{asOf}),broad=r.sectors.find(x=>x.code==='BK1');
 assert.equal(broad.haltedCount,1);assert.equal(broad.observedStocks,9);
 assert.equal(broad.upCount,9);assert.equal(broad.coveragePct,90);
 const d=sample();d.sectors[0].stocks[1].symbol=d.sectors[0].stocks[0].symbol;
 assert.equal(evaluate(d,{asOf}).sectors.find(x=>x.code==='BK1').status,'unknown');
});
test('independent industry and concept rankings, never mixed; no 3-sector proof means no rank',()=>{
 const s=sample();s.sectors.push({...structuredClone(s.sectors[0]),code:'GN4',name:'算力概念',category:'concept'});
 const r=evaluate(s,{asOf});
 assert.equal(r.sectors.find(x=>x.code==='GN4').rank,null);
 assert.equal(r.sectors.find(x=>x.code==='BK1').rank,1);
});
test('zero return and no positive leaders never divide by zero',()=>{
 const s=sample();s.sectors[0].stocks.forEach(x=>x.changePct=0);
 s.sectors[0].changePct=0;
 const r=evaluate(s,{asOf}),v=r.sectors.find(x=>x.code==='BK1');
 assert.equal(v.topTwoPositiveSharePct,null);
 assert.equal(v.upPct,0);assert.equal(v.state,'mixed');
});
