'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateSectorCohortRps:evaluate}=require('../src/strategy/sector-cohort-rps');
const {historicalExplanations}=require('../src/core/research-explanation-projection');
function sample(){
 const dates=[];
 for(let i=0;dates.length<46;i++){
  const date=new Date(Date.UTC(2026,0,5+i));
  if([0,6].includes(date.getUTCDay()))continue;
  dates.push(date.toISOString().slice(0,10));
 }
 const series=(last)=>dates.slice(-21).map((date,i)=>({date,close:i===20?last:10}));
 const history={source:'imported',provider:'fixture-historical',asOf:dates.at(-1),stocks:[]};
 const factorContexts={};
 for(const [index,sector,final] of [[0,'设备',11],[1,'材料',10.5],[2,'医药',9.9]]){
  const symbol=String(600001+index),bars=dates.map(date=>({
   date,open:10,high:10.3,low:9.7,close:10,volume:1000
  }));
  history.stocks.push({symbol,name:sector,market:'main',bars});
  factorContexts[symbol]={schemaVersion:1,source:'imported',provider:'unit-provider',
   asOf:history.asOf,market:{id:'shanghai',source:'unit-provider',bars:series(10.1)},
   sector:{name:sector,source:'unit-provider',bars:series(final)}};
 }
 return {history,factorContexts};
}
test('three distinct aligned sectors yield cohort-only historical percentiles',()=>{
 const {history,factorContexts}=sample(),copy=structuredClone(factorContexts);
 const r=evaluate(history,{factorContexts});
 assert.equal(r.status,'imported-unverified');
 assert.equal(r.scope,'provided-history-cohort-only');
 assert.equal(r.distinctSectorCount,3);
 assert.equal(r.includedStocks,3);
 assert.equal(r.bySymbol['600001'].rpsPct,100);
 assert.equal(r.bySymbol['600002'].rpsPct,50);
 assert.equal(r.bySymbol['600003'].rpsPct,0);
 assert.equal(r.canTrade,false);assert.equal(r.weightsChanged,false);
 assert.deepEqual(factorContexts,copy);
});
test('another stock in the same sector does not add a duplicate sector to percentile denominator',()=>{
 const {history,factorContexts}=sample();
 history.stocks.push({...structuredClone(history.stocks[0]),symbol:'600004'});
 factorContexts['600004']=structuredClone(factorContexts['600001']);
 const r=evaluate(history,{factorContexts});
 assert.equal(r.status,'imported-unverified');
 assert.equal(r.distinctSectorCount,3);assert.equal(r.includedStocks,4);
 assert.equal(r.bySymbol['600004'].rpsPct,100);
 assert.equal(r.sectors.find(x=>x.sector==='设备').representedStocks,2);
});
test('incompatible, simulated, conflicting or partial contexts never invent rankings',()=>{
 const mutations=[
  ({history})=>{history.source='fixture';},
  ({factorContexts})=>{delete factorContexts['600003'];},
  ({factorContexts})=>{factorContexts['600003'].asOf='2025-01-01';},
  ({factorContexts})=>{factorContexts['600003'].market.bars[4].date='2020-01-01';},
  ({factorContexts})=>{factorContexts['600002'].provider='other-provider';},
  ({factorContexts})=>{factorContexts['600002'].market.id='a50';},
  ({factorContexts})=>{factorContexts['600003'].market.bars[0].close=12;},
  ({factorContexts})=>{factorContexts['600003'].sector.simulated=true;}
 ];
 for(const change of mutations){
  const input=sample();change(input);
  const r=evaluate(input.history,{factorContexts:input.factorContexts});
  assert.equal(r.status,'unknown',JSON.stringify(r).slice(0,150));
  assert.deepEqual(r.bySymbol,{});assert.equal(r.canTrade,false);
 }
});
test('conflicting duplicate sector series are dropped rather than double counted',()=>{
 const {history,factorContexts}=sample();
 history.stocks.push({...structuredClone(history.stocks[0]),symbol:'600004'});
 factorContexts['600004']=structuredClone(factorContexts['600001']);
 factorContexts['600004'].sector.bars.at(-1).close=12;
 const r=evaluate(history,{factorContexts});
 assert.equal(r.status,'unknown','only two consistent sectors remain after conflict exclusion');
});
test('study is exposed through historical stock explanations without granting candidate status',()=>{
 const {history,factorContexts}=sample();
 const out=historicalExplanations(history,{market:{factorContexts}});
 assert.equal(out.sectorCohortStudy.status,'imported-unverified');
 assert.equal(out.sectorCohortStudy.distinctSectorCount,3);
 assert.equal(out.officialCandidates,0);assert.equal(out.canTrade,false);
 for(const candidate of out.candidates){
  assert.equal(candidate.rationale.sectorCohortRps.status,'imported-unverified');
  assert.equal(candidate.rationale.selection.officialCandidate,false);
 }
});
