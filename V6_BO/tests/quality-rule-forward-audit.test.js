'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluatePublicRuleForwardAudit:evaluate}=require('../src/strategy/public-rule-forward-audit');
function dataset(count=240,{verified=true}={}){
 const dates=[];
 for(let i=0;dates.length<count;i++){
  const d=new Date(Date.UTC(2025,0,2+i));
  if(d.getUTCDay()===0||d.getUTCDay()===6)continue;
  dates.push(d.toISOString().slice(0,10));
 }
 const stocks=['trend','obv','reversal'].map((kind,k)=>{
  let value=10;
  const bars=dates.map((date,i)=>{
   if(kind==='trend')value=10*Math.pow(1.003,i);
   if(kind==='obv')value+=i%2===0?.085:-.035;
   if(kind==='reversal')value=i%16===15?10.3:i%16===14?9.75:10;
   const high=kind==='reversal'?(i%16===15?10.6:10.5):value+.11;
   const low=kind==='reversal'?9.7:value-.11;
   const volume=kind==='obv'?(i%2===0?2000:500):
     kind==='reversal'&&i%16===15?2000:1000;
   return {date,open:value,high,low,close:value,volume,amount:volume*value};
  });
  return {symbol:String(600001+k),name:kind,market:'main',
   limitPct:10,corporateActionsVerified:verified,bars};
 });
 return {source:'imported',provider:'unit-specified-historical',datasetId:'study-trend-volume-reversal',
  asOf:dates.at(-1),priceAdjustment:{mode:'unadjusted',provider:'unit-specified-historical'},stocks};
}
const windows={windows:2,testDays:25,gapDays:2};
test('legacy and prior five-rule results stay compatible unless quality opt-in is true',()=>{
 const history=dataset();
 const original=evaluate(history,windows),quality=evaluate(history,{...windows,includeQualityRules:true});
 const linked=evaluate(history,{...windows,includeLinkedRules:true});
 assert.deepEqual(original.rules.map(x=>x.id),['vnpy_boll_cci_atr','vnpy_atr_rsi']);
 assert.equal(quality.rules.length,5);
 assert.equal(linked.rules.length,5);
 assert.equal(quality.configuration.includeQualityRules,true);
 assert.equal(original.configuration.includeQualityRules,undefined);
 assert.deepEqual(original.events,quality.events.filter(x=>['vnpy_boll_cci_atr','vnpy_atr_rsi'].includes(x.ruleId)));
});
test('all three quality rules produce genuine dated signals at 1/5/20/60 session horizons',()=>{
 const history=dataset(),before=structuredClone(history);
 const r=evaluate(history,{...windows,includeQualityRules:true});
 const ids=['linear_trend_quality20','obv_volume_accumulation20','rsv14_reversal_confirmation'];
 assert.ok(ids.every(id=>r.rules.some(x=>x.id===id)));
 for(const id of ids){
  assert.ok(r.events.some(x=>x.ruleId===id),id+' should actually match');
  assert.ok(r.ruleInputDiagnostics[id].candidateDays>0);
  const rule=r.rules.find(x=>x.id===id);
  for(const days of [1,5,20,60]){
   const stat=rule.byHorizon[days];
   assert.ok(stat.signals>0,id+' '+days);
   assert.equal(stat.signals,stat.modeled+Object.values(stat.blocked).reduce((s,v)=>s+v,0));
   assert.equal(stat.realizedTradingReturn,false);
  }
 }
 assert.equal(r.folds.length,2);
 assert.equal(r.historicalOnly,true);
 assert.equal(r.canTrade,false);assert.equal(r.autoPromotion,false);assert.equal(r.weightsChanged,false);
 assert.ok(r.events.every(x=>x.status!=='modeled'||x.entryDate>x.signalDate));
 assert.ok(r.events.every(x=>x.status!=='modeled'||x.exitDate>x.entryDate));
 assert.deepEqual(history,before);
});
test('quality-only and all-eight audit include independent family overlap descriptions, not weight writes',()=>{
 const history=dataset();
 const q=evaluate(history,{...windows,includeQualityRules:true});
 assert.equal(q.overlapDiagnostics.status,'descriptive-only');
 assert.equal(q.overlapDiagnostics.weightsChanged,false);
 assert.equal(q.overlapDiagnostics.sameFamilyDuplicateSignals>=0,true);
 const full=evaluate(history,{...windows,includeQualityRules:true,includeLinkedRules:true});
 assert.equal(full.rules.length,8);
 assert.ok(full.overlapDiagnostics.uniqueStockDays>0);
 assert.equal(full.configuration.includeLinkedRules,true);
 assert.equal(full.configuration.includeQualityRules,true);
 assert.ok(full.rules.every(x=>x.parameterTuning==='none'));
});
test('only complete bars on or before signal day may trigger new rule',()=>{
 const input=dataset(),before=evaluate(input,{...windows,includeQualityRules:true});
 const alt=structuredClone(input),dates=alt.stocks[0].bars.map(x=>x.date);
 const index=dates.indexOf(before.folds.at(-1).testEndDate);
 for(const stock of alt.stocks)for(let i=index+1;i<stock.bars.length;i++){
  stock.bars[i].close*=1.4;stock.bars[i].open*=1.4;
  stock.bars[i].high*=1.4;stock.bars[i].low*=1.4;
 }
 const after=evaluate(alt,{...windows,includeQualityRules:true});
 const keys=r=>r.events.filter(e=>['linear_trend_quality20','obv_volume_accumulation20','rsv14_reversal_confirmation'].includes(e.ruleId))
  .map(e=>[e.symbol,e.signalDate,e.ruleId,e.horizon]);
 assert.deepEqual(keys(after),keys(before),'future prices must not alter earlier signal dates');
});
test('corporate-action validation failure keeps every event as an unknown, with no synthetic profits',()=>{
 const r=evaluate(dataset(240,{verified:false}),{...windows,includeQualityRules:true});
 assert.ok(r.events.length>0);
 assert.ok(r.events.every(x=>x.status==='unverified-corporate-actions'));
 for(const rule of r.rules)for(const stats of Object.values(rule.byHorizon)){
  assert.equal(stats.modeled,0);assert.equal(stats.averageNetReturnPct,null);
 }
 assert.equal(r.sampleIntegrity.blockedEventsRetained,r.events.length);
});
test('quality audit option rejects malformed flags instead of silently turning off safeguards',()=>{
 assert.throws(()=>evaluate(dataset(),{...windows,includeQualityRules:'true'}),/布尔值/);
 assert.throws(()=>evaluate(dataset(),{...windows,includeQualityRules:0}),/布尔值/);
});
