'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluatePublicRuleForwardAudit:evaluate}=require('../src/strategy/public-rule-forward-audit');
function dataset(count=220){
 const dates=[];
 for(let i=0;dates.length<count;i++){
  const d=new Date(Date.UTC(2025,0,2+i));
  if(d.getUTCDay()===0||d.getUTCDay()===6)continue;
  dates.push(d.toISOString().slice(0,10));
 }
 const bars=dates.map((date,i)=>{
  const close=10+i*.05+(i%15===5?1:0);
  return {date,open:close,high:close+.15,low:close-.15,close,
   volume:i%15===5?2400000:1000000,amount:close*1000000};
 });
 const stock={symbol:'600001',name:'历史研究样本',market:'main',limitPct:10,
  corporateActionsVerified:true,bars};
 const history={source:'imported',provider:'unit-source',datasetId:'linked-rule-audit',
  asOf:dates.at(-1),priceAdjustment:{mode:'unadjusted',provider:'unit-source'},stocks:[stock]};
 const line=(v,step)=>dates.map((date,i)=>({date,close:v+step*i}));
 const linkedSeries={'600001':{source:'imported',provider:'index-sector-study',
  market:{id:'shanghai',source:'index-sector-study',bars:line(300,.08)},
  sector:{name:'设备板块',source:'index-sector-study',bars:line(100,.2)}}};
 return {history,linkedSeries,dates};
}
const opts={windows:2,testDays:25,gapDays:2};
test('default two public rules remain unchanged when linked validation is not enabled',()=>{
 const {history}=dataset(),a=evaluate(history,opts),b=evaluate(history,{...opts,includeLinkedRules:false});
 assert.deepEqual(a.rules.map(x=>x.id),['vnpy_boll_cci_atr','vnpy_atr_rsi']);
 assert.deepEqual(a.events,b.events);
 assert.equal(a.configuration.includeLinkedRules,undefined);
});
test('explicit opt-in evaluates five independent rule IDs at 1/5/20/60 sessions',()=>{
 const {history,linkedSeries}=dataset(),before=structuredClone(history);
 const r=evaluate(history,{...opts,includeLinkedRules:true,linkedSeries});
 assert.equal(r.rules.length,5);
 assert.equal(r.configuration.includeLinkedRules,true);
 assert.ok(r.ruleInputDiagnostics.sector_market_relative20.candidateDays>0);
 assert.equal(r.ruleInputDiagnostics.sector_market_relative20.unverifiedInputDays,0);
 assert.equal(r.verifiedLive,false);assert.equal(r.canTrade,false);
 assert.equal(r.autoPromotion,false);assert.equal(r.weightsChanged,false);
 assert.ok(r.events.some(x=>x.ruleId==='donchian20_liquidity'));
 assert.ok(r.events.some(x=>x.ruleId==='narrow_range_expansion'));
 assert.ok(r.events.some(x=>x.ruleId==='sector_market_relative20'));
 assert.equal(r.folds.length,2);
 assert.deepEqual(r.configuration.horizons,[1,5,20,60]);
 for(const entry of r.rules){
  assert.deepEqual(Object.keys(entry.byHorizon),['1','5','20','60']);
  for(const h of [1,5,20,60]){
   const summary=entry.byHorizon[h];
   assert.equal(summary.realizedTradingReturn,false);
   assert.equal(summary.statisticallyCertified,false);
   assert.equal(summary.signals,summary.modeled+Object.values(summary.blocked).reduce((a,b)=>a+b,0));
  }
 }
 assert.deepEqual(history,before,'never mutate historical input or original parameters');
});
test('without aligned market/sector series, relative momentum produces zero signals but technical rules still evaluate',()=>{
 const {history}=dataset();
 const r=evaluate(history,{...opts,includeLinkedRules:true});
 const relative=r.rules.find(x=>x.id==='sector_market_relative20');
 assert.ok(relative);
 assert.ok(Object.values(relative.byHorizon).every(x=>x.signals===0&&x.averageNetReturnPct===null));
 assert.ok(r.events.some(x=>x.ruleId==='donchian20_liquidity'||x.ruleId==='narrow_range_expansion'));
 assert.equal(r.configuration.includeLinkedRules,true);
 assert.ok(r.ruleInputDiagnostics.sector_market_relative20.unverifiedInputDays>0);
 assert.equal(r.ruleInputDiagnostics.sector_market_relative20.candidateDays,0);
});
test('dated linked series are cut off on each signal date; later benchmarks cannot alter earlier signals',()=>{
 const {history,linkedSeries,dates}=dataset();
 const baseline=evaluate(history,{...opts,includeLinkedRules:true,linkedSeries});
 const altered=structuredClone(linkedSeries);
 const lastTestDay=dates.indexOf(baseline.folds.at(-1).testEndDate);
 for(let i=lastTestDay+1;i<dates.length;i++){
  altered['600001'].market.bars[i].close*=9;
  altered['600001'].sector.bars[i].close*=.1;
 }
 const changed=evaluate(history,{...opts,includeLinkedRules:true,linkedSeries:altered});
 const ids=r=>r.events.filter(x=>x.ruleId==='sector_market_relative20')
  .map(x=>[x.symbol,x.signalDate,x.ruleId,x.horizon,x.marketRegime]);
 assert.ok(ids(baseline).length>0);
 assert.deepEqual(ids(changed),ids(baseline));
});
test('incorrect provider or mismatched historical dates block relative momentum without synthetic zeroes',()=>{
 const {history,linkedSeries}=dataset();
 const variants=[
  x=>x['600001'].market.source='different',
  x=>x['600001'].sector.bars.forEach(b=>b.date='2025-01-01'),
  x=>x['600001'].source='simulated',
  x=>x['600001'].market.id='a50'
 ];
 for(const modify of variants){
  const x=structuredClone(linkedSeries);modify(x);
  const r=evaluate(history,{...opts,includeLinkedRules:true,linkedSeries:x});
  assert.equal(r.rules.find(y=>y.id==='sector_market_relative20').byHorizon[1].signals,0);
 }
});
test('corporate-action evidence failures remain blocked; no strategy can report made-up gains',()=>{
 const {history,linkedSeries}=dataset();history.stocks[0].corporateActionsVerified=false;
 const r=evaluate(history,{...opts,includeLinkedRules:true,linkedSeries});
 assert.ok(r.events.length>0);
 assert.ok(r.events.every(x=>x.status==='unverified-corporate-actions'));
 assert.ok(r.rules.every(x=>Object.values(x.byHorizon).every(y=>y.modeled===0&&y.winRatePct===null)));
 assert.equal(r.sampleIntegrity.eventsRetained,r.events.length);
});
test('rejected linked audit configuration does not silently fall back to legacy results',()=>{
 const {history}=dataset();
 for(const extra of [
  {includeLinkedRules:'yes'},
  {linkedSeries:[]},
  {linkedSeries:{evil:{}}},
  {linkedSeries:Object.fromEntries(Array.from({length:21},(_,i)=>[String(i).padStart(6,'0'),{}]))}
 ]){
  assert.throws(()=>evaluate(history,{...opts,...extra}));
 }
});

test('correlated signals are grouped by stock/day and family, not inflated by horizons or cherry-picked fills',()=>{
 const {history,linkedSeries}=dataset();
 const r=evaluate(history,{...opts,includeLinkedRules:true,linkedSeries});
 const d=r.overlapDiagnostics;
 assert.equal(d.status,'descriptive-only');
 assert.equal(d.rawRuleSignals,r.events.filter(e=>e.horizon===1).length);
 assert.equal(d.uniqueStockDays,new Set(r.events.filter(e=>e.horizon===1)
  .map(e=>e.symbol+'|'+e.signalDate)).size);
 assert.equal(d.sameFamilyDuplicateSignals,d.rawRuleSignals-d.independentFamilyExposures);
 assert.ok(d.sameFamilyDuplicateSignals>0,'two breakout variants should overlap on genuine signals');
 assert.ok(d.sameFamilyOverlapStockDays>0);
 assert.ok(d.byRule.donchian20_liquidity.sameFamilyOverlapDays>0);
 assert.ok(d.byRule.narrow_range_expansion.sameFamilyOverlapDays>0);
 assert.equal(d.byRule.sector_market_relative20.suggestedWeightAction,'unchanged');
 assert.equal(d.weightsChanged,false);assert.equal(d.autoPromotion,false);
 const oneHorizon=evaluate(history,{...opts,includeLinkedRules:true,linkedSeries,horizons:[1]});
 assert.deepEqual(d,oneHorizon.overlapDiagnostics,
  'one signal day must count once even when simulated over several exit horizons');
 history.stocks[0].corporateActionsVerified=false;
 const blocked=evaluate(history,{...opts,includeLinkedRules:true,linkedSeries});
 assert.deepEqual(blocked.overlapDiagnostics,d,
  'missing company-action evidence blocks returns but does not erase observed signal overlaps');
 assert.ok(blocked.events.every(e=>e.status==='unverified-corporate-actions'));
});
