'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {analyzeMarketBreadth}=require('../src/core/market-breadth');
const {classifyObservedMarket}=require('../src/core/observed-market-regime');
const day='2026-11-05',at=Date.parse(day+'T10:00:00+08:00');
const scoreSource='fixture-index',scores={indexTrendScore:75,marketVolumeScore:60,riskScore:20,volatilityScore:30,sentimentScore:70,
 asOf:at,observedAt:at+1000,knownAt:at+2000};
const opts={asOf:at+3000,scoreSource,scoreDate:day,scores};
const snap=(values,universeSize=values.length)=>({date:day,source:'fixture-market',universeSize,returnWindow:'session-to-date',
 asOf:at,observedAt:at+1000,knownAt:at+2000,sourceCoverage:{monetaryUnit:'provider-CNY-unverified'},
 stocks:values.map((pctChange,i)=>({code:String(i+1).padStart(6,'0'),pctChange,vendorQuoteAt:at-1000,amount:100}))});
const index=(returnPct=1)=>({code:'000300',source:'fixture-index-feed',tradeDate:day,returnWindow:'session-to-date',returnPct,
 asOf:at,observedAt:at+1000,knownAt:at+2000});
const breadth=s=>analyzeMarketBreadth(s,opts);
const classify=(s,i=index(),o={})=>classifyObservedMarket(s,{...opts,indexObservation:i,...o});
const part=s=>breadth(s).participation;
const changeRow=(s,change)=>({...s,stocks:s.stocks.map((r,i)=>i===0?{...r,...change}:r)});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,String(a)+' vs '+String(b));
test('equal-weight mean and median preserve true negative and zero values',()=>{
 const p=part(snap([10,-4,-3,0]));close(p.sampleMeanPct,.75);close(p.sampleMedianPct,-1.5);
 assert.equal(p.status,'complete-declared');assert.equal(p.certified,false);assert.equal(p.canTrade,false);
});
test('odd sample median independent of order; all flat yields no majority',()=>{
 assert.equal(part(snap([1,9,-2])).sampleMedianPct,1);
 const p=part(snap([0,0,0]));assert.equal(p.sampleMeanPct,0);assert.equal(p.sampleMedianPct,0);assert.equal(p.majority,'no-majority');
});
test('missing rows remain uncertain, never neutral or excluded from universe denominator',()=>{
 const p=part(snap([3,2,1,0],5));assert.equal(p.status,'partial-declared');assert.equal(p.missing,1);
 assert.deepEqual(p.upShareBounds,{lower:.6,upper:.8});assert.deepEqual(p.downShareBounds,{lower:0,upper:.2});assert.equal(p.majority,'majority-up');
});
test('sample majority does not certify universe majority when missing could change it',()=>{
 const p=part(snap([1,1,-1,-1,1,0,0,0],10));assert.equal(p.majority,'no-majority');
 const q=part(snap([1,1,1,1,1,-1,-1,-1],10));assert.equal(q.majority,'unknown');assert.deepEqual(q.upShareBounds,{lower:.5,upper:.7});
});
test('exactly half is not a majority; unrounded counts determine the boundary',()=>{
 const p=part(snap([1,1,-1,-1]));assert.equal(p.majority,'no-majority');
 assert.equal(part(snap([-1,-1,-1,1],5)).majority,'majority-down');
});
test('duplicate data stays descriptive in old fields but abstains from participation claim',()=>{
 const s=snap([2,-1]);s.stocks.push({...s.stocks[0],pctChange:-9});const b=breadth(s);
 assert.equal(b.usable,true);assert.equal(b.duplicateCount,1);assert.equal(b.participation.status,'conflict');assert.equal(b.participation.sampleMedianPct,null);
});
test('coerced identities, conflicting aliases, provider/date or trading-status metadata block new claims',()=>{
 const s=snap([2,-1]);for(const conflict of [{code:123456},{symbol:'123456'},{source:'other'},{date:'2026-11-04'},{tradeDate:'2026-11-04'},{suspended:'false'}]){
  const p=part(changeRow(s,conflict));assert.equal(p.status,'conflict');assert.equal(p.majority,'unknown');
 }
});
test('head decile amount share and HHI use complete comparable amount evidence only',()=>{
 const s=snap([1,2,3,4,5,6,7,8,9,10]);s.stocks[0].amount=900;
 const c=part(s).concentration;assert.equal(c.status,'declared-unverified');assert.equal(c.headCount,1);close(c.headShare,.5);close(c.hhi,.25+9/324);
});
test('zero amounts are legitimate; a zero total cannot define shares',()=>{
 let s=snap([1,2]);s.stocks[0].amount=0;let c=part(s).concentration;close(c.headShare,1);close(c.hhi,1);
 s.stocks[1].amount=0;c=part(s).concentration;assert.equal(c.status,'unknown');assert.equal(c.hhi,null);
});
test('partial market, missing or invalid amount, missing or mixed unit, and overflow abstain',()=>{
 const s=snap([1,2,3,4]);const samples=[{...s,universeSize:5},{...s,sourceCoverage:{}},...[
  {amount:null},{amount:-1},{amount:'100'},{amountUnit:'other'},{monetaryUnit:'other'}].map(x=>changeRow(s,x)),
  {...s,stocks:s.stocks.map(r=>({...r,amount:Number.MAX_VALUE}))}];
 for(const sample of samples){const c=part(sample).concentration;assert.equal(c.status,'unknown');assert.equal(c.headShare,null);assert.equal(c.hhi,null);}
});
test('same-window index rise and majority loss is a descriptive divergence, not bull classification or trading permission',()=>{
 const s=snap([-3,-2,-1,2]);const r=classify(s);assert.equal(r.usable,true);assert.equal(r.indexParticipation.relation,'index-up-majority-down');
 assert.equal(r.indexParticipation.status,'declared-unverified');assert.equal(r.indexParticipation.indexSource,'fixture-index-feed');assert.equal(r.indexParticipation.certified,false);
 assert.equal(r.indexParticipation.canTrade,false);assert.equal(r.regime,classifyObservedMarket(s,opts).regime);
 assert.deepEqual(r.weights,classifyObservedMarket(s,opts).weights);
});
test('opposite divergence and same-direction majority, flat index, and balanced market remain distinct',()=>{
 for(const [v,i,relation] of [[[1,2,3,-1],-1,'index-down-majority-up'],[[1,2,3,-1],1,'index-up-majority-up'],[[-1,-2,-3,1],-1,'index-down-majority-down'],[[1,2,3,-1],0,'index-flat'],[[1,1,-1,-1],1,'no-majority']])assert.equal(classify(snap(v),index(i)).indexParticipation.relation,relation);
});
test('unknown index return never inferred from an index score',()=>{
 const r=classifyObservedMarket(snap([-1,-2,-3,1]),opts);assert.equal(r.indexParticipation.status,'unknown');assert.equal(r.indexParticipation.indexReturnPct,null);
});
test('ambiguous denominator blocks divergence even if observed sample looks weak',()=>{
 const r=classify(snap([-1,-1,-1,-1,-1,1,1,1],10));assert.equal(r.indexParticipation.status,'unknown');assert.equal(r.indexParticipation.reason,'missing-rows-could-change-majority');
});
test('different window, trade date, cutoff, bad return, invalid source and unavailable index observation are rejected',()=>{
 const s=snap([-1,-2,-3,1]);for(const change of [{returnWindow:'daily'},{tradeDate:'2026-11-04'},{asOf:at-1},{knownAt:at+3001},{observedAt:at-1},{receivedAt:at-1},{returnPct:'1'},{returnPct:null},{source:''},{date:'2026-11-04'}]){
  const r=classify(s,{...index(),...change});assert.equal(r.indexParticipation.status,'unknown');
 }
});
test('unknown market cutoff or incomplete row-time coverage cannot authenticate comparison',()=>{
 const s=snap([-1,-2,-3,1]);const without={...s,asOf:null};assert.equal(classify(without).indexParticipation.status,'unknown');
 for(const vendorQuoteAt of [null,at-90001])assert.equal(classify(changeRow(s,{vendorQuoteAt})).indexParticipation.reason,'observed-quote-time-coverage-insufficient');
 assert.equal(classify(changeRow(s,{vendorQuoteAt:at-90000})).indexParticipation.relation,'index-up-majority-down');
});
