'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assessWeakMarketSectorPreference:assess,sectorFamilies}
 =require('../src/strategy/weak-market-sector-preference');
const {historicalExplanations}=require('../src/core/research-explanation-projection');
const day='2026-11-06';
function evidence(name='银行',marketRegime='systemic-selloff-observed'){
 return {price:{status:'imported-unverified',date:day},
  sector:{status:'imported-unverified',name,source:'sector-declared'},
  marketSectorResilience:{status:'market-sector-observed-unverified',
   tradeDate:day,marketRegime,sectorName:name,sectorSource:'sector-declared'}};
}
test('four user-excluded sector families are lower priority only under dated weak market evidence',()=>{
 assert.deepEqual(sectorFamilies.map(x=>x.id),['banking','insurance','brokerage','baijiu']);
 for(const name of ['银行','保险','证券','券商','白酒','商业银行','酿酒-白酒']){
  const r=assess(evidence(name));
  assert.equal(r.status,'observed-unverified');
  assert.equal(r.action,'deprioritize',name);
  assert.equal(r.researchDeprioritized,true);
  assert.equal(r.originalRulesChanged,false);
  assert.equal(r.weightsChanged,false);assert.equal(r.canTrade,false);
  assert.equal(r.autoPromotion,false);
  assert.match(r.reason,/保留命中与风险证据/);
 }
});
test('strong markets, non-excluded sectors and unknown data never lower research priority',()=>{
 for(const r of [
  assess(evidence('银行','broad-advance-observed')),
  assess(evidence('银行','mixed-observed')),
  assess(evidence('算力设备','broad-selloff-observed'))
 ])assert.equal(r.researchDeprioritized,false);
 const mutations=[
  x=>x.price.date='2026-11-05',
  x=>x.price.status='simulation',
  x=>x.sector.status='unknown',
  x=>x.marketSectorResilience.status='unverified',
  x=>x.marketSectorResilience.tradeDate='2026-11-04',
  x=>x.marketSectorResilience.sectorName='证券',
  x=>x.marketSectorResilience.sectorSource='other',
  x=>x.marketSectorResilience.marketRegime='unknown'
 ];
 for(const mutate of mutations){
  const x=evidence();mutate(x);
  const r=assess(x);
  assert.equal(r.status,'unknown');
  assert.equal(r.researchDeprioritized,false);
 }
});
function sampleHistory(){
 const dates=[];
 for(let i=0;dates.length<65;i++){
  const d=new Date(Date.UTC(2026,0,5+i));
  if(d.getUTCDay()===0||d.getUTCDay()===6)continue;
  dates.push(d.toISOString().slice(0,10));
 }
 const bars=dates.map((date,i)=>{
  const price=10+i*.06;
  return {date,open:price,high:price+.2,low:price-.2,close:price+.06,
   volume:1000000,amount:11000000};
 });
 return {source:'imported',provider:'declared-historical',
  asOf:dates.at(-1),stocks:[
   {symbol:'600001',name:'银行研究样本',market:'main',bars:structuredClone(bars)},
   {symbol:'600002',name:'设备研究样本',market:'main',bars:structuredClone(bars)}
  ]};
}
function marketFor(date){
 const observedAt=Date.parse(date+'T14:55:00+08:00');
 const index=changePct=>({source:'declared-index',tradeDate:date,observedAt,changePct});
 const sector=name=>({name,source:'declared-sector',tradeDate:date,observedAt,
  relativeStrengthScore:82,changePct:1});
 return {linkage:{
  market:{source:'declared-index',tradeDate:date,observedAt,breadthScore:18,coverage:.95,
   indices:{shanghai:index(-3.5),shenzhen:index(-4),chinext:index(-4.5)}},
  sectors:{'600001':sector('银行'),'600002':sector('算力设备')}
 }};
}
test('historical full flow retains all candidates and rule hits, only changing opt-in researched watch order',()=>{
 const h=sampleHistory(),before=structuredClone(h);
 const without=historicalExplanations(h);
 const withContext=historicalExplanations(h,{market:marketFor(h.asOf)});
 assert.deepEqual(h,before);
 assert.equal(withContext.verifiedLive,false);assert.equal(withContext.canTrade,false);
 assert.equal(withContext.officialCandidates,0);
 assert.equal(withContext.candidates.length,without.candidates.length);
 assert.deepEqual(withContext.candidates.map(x=>x.symbol),without.candidates.map(x=>x.symbol));
 for(const symbol of ['600001','600002']){
  const original=without.candidates.find(x=>x.symbol===symbol);
  const revised=withContext.candidates.find(x=>x.symbol===symbol);
  assert.ok(original);assert.ok(revised);
  assert.deepEqual(revised.rationale.selection.rules,original.rationale.selection.rules);
  assert.equal(revised.historicalModelPassed,original.historicalModelPassed);
 }
 const bank=withContext.candidates.find(x=>x.symbol==='600001');
 const equipment=withContext.candidates.find(x=>x.symbol==='600002');
 assert.equal(bank.rationale.weakMarketPreference.researchDeprioritized,true);
 assert.equal(equipment.rationale.weakMarketPreference.researchDeprioritized,false);
 assert.equal(bank.rationale.selection.watchEligible,equipment.rationale.selection.watchEligible);
 assert.deepEqual(withContext.researchWatchlist.map(x=>x.symbol),['600002','600001']);
 assert.ok(withContext.researchWatchlist[1].researchDeprioritized);
 assert.equal(without.candidates[0].rationale.weakMarketPreference.researchDeprioritized,false);
});
