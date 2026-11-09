'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {catalog,evaluateLinkedResearch}=require('../src/strategy/linked-factor-research');
const {historicalExplanations}=require('../src/core/research-explanation-projection');
const sample=(close=10.8)=>{const bars=[];
 for(let day=0;bars.length<35;day++){
  const d=new Date(Date.UTC(2026,0,5+day));
  if(d.getUTCDay()===0||d.getUTCDay()===6)continue;
  const last=bars.length===34;
  bars.push({date:d.toISOString().slice(0,10),open:last?10.25:10,
   high:last?11:10.2,low:last?10:9.8,close:last?close:10,
   volume:last?2000:1000});
 }
 return {source:'imported',provider:'unit-fixture',asOf:bars.at(-1).date,
  stocks:[{symbol:'600001',name:'研究股票',market:'main',bars}]};
};
function context(s,{sectorFinal=10.4,marketFinal=10.1}={}){
 const dates=s.stocks[0].bars.slice(-21).map(b=>b.date);
 const line=last=>dates.map((date,i)=>({date,close:i===20?last:10}));
 return {schemaVersion:1,source:'imported',provider:'declared-provider',
  asOf:s.asOf,market:{id:'shanghai',source:'declared-provider',bars:line(marketFinal)},
  sector:{name:'算力设备',source:'declared-provider',bars:line(sectorFinal)}};
}
test('three research rule IDs are public-source concepts, without certified returns or orders',()=>{
 assert.deepEqual(catalog.map(x=>x.id),
  ['donchian20_liquidity','narrow_range_expansion','sector_market_relative20']);
 assert.ok(catalog.every(x=>x.validatedPerformance===false&&x.source.startsWith('https://')));
});
test('price breakout and volatility squeeze fire only with complete bars and confirmed volume',()=>{
 const s=sample(),before=structuredClone(s);
 const r=evaluateLinkedResearch(s.stocks[0]);
 assert.deepEqual(r.strategies.map(x=>x.status),['candidate','candidate','insufficient_data']);
 assert.equal(r.canTrade,false);assert.equal(r.weightsChanged,false);assert.equal(r.autoPromotion,false);
 assert.equal(r.strategies[0].metrics.volumeRatio20,2);
 assert.equal(r.strategies[1].metrics.priorRangePct<8,true);
 assert.equal(r.factors.length,5);
 assert.equal(r.factors[4].value,null);
 assert.equal(r.factors[4].status,'unknown');
 assert.deepEqual(s,before);
});
test('same-date imported benchmark/sector shows actual cross-asset arithmetic without claiming a cause',()=>{
 const s=sample(),r=evaluateLinkedResearch(s.stocks[0],{marketContext:context(s)});
 assert.equal(r.strategies[2].status,'candidate');
 assert.equal(r.strategies[2].family,'market-sector-relative');
 assert.equal(r.contextEvidence.status,'imported-unverified');
 assert.equal(r.contextEvidence.metrics.stockReturn20Pct,8);
 assert.equal(r.contextEvidence.metrics.sectorReturn20Pct,4);
 assert.equal(r.contextEvidence.metrics.marketReturn20Pct,1);
 assert.equal(r.contextEvidence.metrics.sectorExcessOverMarketPct,3);
 assert.equal(r.contextEvidence.metrics.stockExcessOverSectorPct,4);
 assert.equal(r.factors[4].value,3);
 assert.equal(r.verifiedLive,false);assert.equal(r.canTrade,false);
});
test('weak sector or flat stock fails relative momentum even if other signal succeeds',()=>{
 const s=sample(),lowSector=evaluateLinkedResearch(s.stocks[0],{marketContext:context(s,{sectorFinal:10.15})});
 assert.equal(lowSector.strategies[2].status,'not_matched');
 assert.ok(lowSector.strategies[2].reasons.some(x=>x.startsWith('未通过')));
 const noBreakout=evaluateLinkedResearch(sample(10.05).stocks[0]);
 assert.equal(noBreakout.strategies[0].status,'not_matched');
 assert.equal(noBreakout.strategies[1].status,'not_matched');
});
test('market series must align every one of 21 trading sessions with the stock',()=>{
 const s=sample(),mutations=[
  c=>c.asOf='2026-01-01',
  c=>c.source='simulated',
  c=>c.market.source='different',
  c=>c.market.id='a50',
  c=>c.sector.bars[3].date='2025-12-31',
  c=>c.market.bars[0].close=null,
  c=>c.market.bars.shift(),
  c=>c.sector.simulated=true,
  c=>c.market.bars.at(-1).date='2099-01-01',
 ];
 for(const modify of mutations){
  const c=context(s);modify(c);
  const r=evaluateLinkedResearch(s.stocks[0],{marketContext:c});
  assert.equal(r.strategies[2].status,'insufficient_data',JSON.stringify(c).slice(0,140));
  assert.equal(r.factors[4].value,null);
  assert.equal(r.canTrade,false);
  assert.equal(r.strategies[0].status,'candidate');
 }
});
test('halt, ST, risks and zero volume block all three signals',()=>{
 const mutations=[
  stock=>stock.isST=true,stock=>stock.suspended=true,
  stock=>stock.tradable=false,stock=>stock.bars.at(-1).volume=0,
  stock=>stock.bars.at(-1).noPriceLimit=true
 ];
 for(const fn of mutations){
  const s=sample();fn(s.stocks[0]);
  const r=evaluateLinkedResearch(s.stocks[0],{marketContext:context(s)});
  assert.ok(r.strategies.every(x=>x.status==='risk_blocked'));
  assert.equal(r.canTrade,false);
 }
});
test('invalid, duplicate and incomplete Kline samples fail closed, not false zeroes',()=>{
 const mutations=[
  stock=>stock.bars.splice(0,8),
  stock=>stock.bars.at(-1).close=null,
  stock=>stock.bars.at(-1).complete=false,
  stock=>delete stock.bars.at(-1).date,
  stock=>stock.bars.at(-1).date=stock.bars.at(-2).date,
  stock=>stock.bars.at(-1).high=9.5,
  stock=>stock.bars.at(-1).volume='2000'
 ];
 for(const fn of mutations){
  const s=sample();fn(s.stocks[0]);const r=evaluateLinkedResearch(s.stocks[0]);
  assert.ok(r.strategies.every(x=>x.status==='insufficient_data'));
 }
});
test('weak market keeps research hits but never turns them into live buy instructions',()=>{
 const s=sample(),r=evaluateLinkedResearch(s.stocks[0],{marketContext:context(s),marketRisk:'risk_off'});
 assert.equal(r.strategies[0].status,'candidate');
 assert.equal(r.strategies[2].status,'candidate');
 assert.ok(r.strategies.every(x=>x.marketWarning?.includes('弱势')));
 assert.equal(r.canTrade,false);
});
test('V6 historical stock reasons include new rules and additional factors without counting correlated breakout twice',()=>{
 const s=sample(),result=historicalExplanations(s,{market:{factorContexts:{'600001':context(s)}}});
 assert.equal(result.candidates.length,1);
 const card=result.candidates[0],rules=card.rationale.selection.rules;
 assert.equal(result.linkedResearchCatalog.length,3);
 assert.ok(rules.some(x=>x.id==='linked:donchian20_liquidity'));
 assert.ok(rules.some(x=>x.id==='linked:narrow_range_expansion'));
 assert.ok(rules.some(x=>x.id==='linked:sector_market_relative20'));
 assert.equal(card.rationale.linkedFactors.length,5);
 const family=rules.filter(x=>x.id.startsWith('linked:')).map(x=>x.family);
 assert.deepEqual(new Set(family),new Set(['breakout-volume','market-sector-relative']));
 assert.equal(card.rationale.selection.officialCandidate,false);
 assert.equal(result.verifiedLive,false);assert.equal(result.canTrade,false);
 assert.ok(result.researchWatchlist[0].matchedRules.some(x=>x.id==='linked:sector_market_relative20'));
});
test('simulation cannot enter watchlist even if the extra technical conditions match',()=>{
 const s=sample();s.source='fixture';
 const out=historicalExplanations(s,{market:{factorContexts:{'600001':context(s)}}});
 assert.equal(out.researchWatchlist.length,0);
 assert.equal(out.candidates[0].rationale.selection.watchEligible,false);
 assert.ok(out.candidates[0].rationale.selection.rules.some(x=>x.id==='linked:donchian20_liquidity'));
});
