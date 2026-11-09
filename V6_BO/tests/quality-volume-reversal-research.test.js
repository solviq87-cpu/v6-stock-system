'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {catalog,evaluateQualityMomentumResearch:evaluate}=require('../src/strategy/quality-volume-reversal-research');
const {historicalExplanations}=require('../src/core/research-explanation-projection');
function sample(kind='trend',source='imported'){
 const bars=[];let price=10;
 for(let i=0;bars.length<55;i++){
  const day=new Date(Date.UTC(2026,0,5+i));
  if(day.getUTCDay()===0||day.getUTCDay()===6)continue;
  const ix=bars.length;
  if(kind==='trend')price=10*Math.pow(1.003,ix);
  if(kind==='obv')price+=ix%2===0?.085:-.035;
  if(kind==='reversal')price=ix===54?10.3:ix===53?9.75:10;
  const volume=kind==='obv'?(ix%2===0?2000:500):ix===54?2000:1000;
  const high=kind==='reversal'?(ix===54?10.6:10.5):price+.11;
  const low=kind==='reversal'?9.7:price-.11;
  const b={date:day.toISOString().slice(0,10),open:price,high,low,close:price,
    volume,amount:volume*price};
  bars.push(b);
 }
 return {source,provider:'declared-historical-feed',asOf:bars.at(-1).date,
   stocks:[{symbol:'600001',name:'测试股票',market:'main',bars}]};
}
const run=(kind,opts)=>evaluate(sample(kind).stocks[0],opts);
test('public feature family catalog cites sources, with no certified performance',()=>{
 assert.equal(catalog.length,3);
 assert.deepEqual(catalog.map(x=>x.family),['trend-quality','volume-accumulation','reversal-confirmation']);
 assert.ok(catalog.every(x=>x.source.startsWith('https://')&&!x.validatedPerformance));
});
test('monotonic 20-session log trend confirms regression quality with explicit conditions',()=>{
 const data=sample('trend'),before=structuredClone(data),r=evaluate(data.stocks[0]);
 assert.equal(r.strategies[0].status,'candidate');
 assert.equal(r.strategies[0].metrics.r2,1);
 assert.ok(r.strategies[0].metrics.slopePctPerDay>.15);
 assert.ok(r.strategies[0].reasons.every(x=>x.startsWith('通过：')));
 assert.equal(r.verifiedLive,false);assert.equal(r.canTrade,false);assert.equal(r.weightsChanged,false);
 assert.deepEqual(data,before);
});
test('signed directional volume is not actual net fund flow and is independent of pure trend quality',()=>{
 const r=run('obv');
 assert.equal(r.strategies[0].status,'not_matched');
 assert.equal(r.strategies[1].status,'candidate');
 assert.equal(r.strategies[1].metrics.signedVolumeRatio,.6);
 assert.ok(r.factors.find(x=>x.id==='signed_volume20').label.includes('非资金流'));
 assert.ok(r.factors.find(x=>x.id==='price_volume_corr20').value>.9);
 assert.equal(r.strategies[1].eligibleForResearch,true);
});
test('RSV recovery triggers only after a preceding low-zone date and confirmed volume',()=>{
 const input=sample('reversal'),r=evaluate(input.stocks[0]);
 assert.equal(r.strategies[2].status,'candidate');
 assert.ok(r.strategies[2].metrics.rsv14Previous<=30);
 assert.ok(r.strategies[2].metrics.rsv14Current>=45);
 const lowVolume=sample('reversal');lowVolume.stocks[0].bars.at(-1).volume=950;
 assert.equal(evaluate(lowVolume.stocks[0]).strategies[2].status,'not_matched');
 const noRecovery=sample('reversal');noRecovery.stocks[0].bars.at(-1).close=9.8;
 assert.equal(evaluate(noRecovery.stocks[0]).strategies[2].status,'not_matched');
});
test('unknown correlation from constant volumes is explicitly unknown, never zero',()=>{
 const r=run('trend');
 const metric=r.factors.find(x=>x.id==='price_volume_corr20');
 assert.equal(metric.value,null);assert.equal(metric.status,'unknown');
});
test('risk off retains research candidate but never promotes, trades or changes weights',()=>{
 const r=run('trend',{marketRisk:'risk_off'});
 assert.equal(r.marketRisk,'risk_off');
 assert.equal(r.strategies[0].status,'candidate');
 assert.ok(r.strategies[0].marketWarning.includes('弱市'));
 assert.equal(r.autoPromotion,false);assert.equal(r.canTrade,false);
});
test('insufficient, undated, stale-shape, mixed volume and incomplete dates fail closed',()=>{
 const cases=[
  s=>s.bars.splice(0,25),s=>s.bars.at(-1).close=null,
  s=>s.bars.at(-1).volume='2000',s=>s.bars.at(-1).complete=false,
  s=>s.bars.at(-1).date=s.bars.at(-2).date,
  s=>delete s.bars.at(-1).date,
  s=>s.bars.at(-1).high=s.bars.at(-1).low-.01
 ];
 for(const mutate of cases){
  const s=sample('reversal').stocks[0];mutate(s);
  const r=evaluate(s);
  assert.ok(r.strategies.every(x=>x.status==='insufficient_data'));
  assert.equal(r.canTrade,false);
 }
});
test('ST/halted/IPO no-limit and zero volume block new research signals',()=>{
 const cases=[
  s=>s.isST=true,s=>s.suspended=true,s=>s.tradable=false,
  s=>s.bars.at(-1).isST=true,s=>s.bars.at(-1).suspended=true,
  s=>s.bars.at(-1).volume=0,s=>s.bars.at(-1).noPriceLimit=true
 ];
 for(const mutate of cases){
  const s=sample('trend').stocks[0];mutate(s);
  const r=evaluate(s);
  assert.ok(r.strategies.every(x=>x.status==='risk_blocked'));
 }
});
test('integrated historical stock reasons include actual new family hits and six factors',()=>{
 const data=sample('trend'),report=historicalExplanations(data);
 assert.equal(report.candidates.length,1);
 const stock=report.candidates[0],ids=stock.rationale.selection.rules.map(x=>x.id);
 assert.ok(ids.includes('quality:linear_trend_quality20'));
 assert.equal(stock.rationale.qualityResearch.strategies.length,3);
 assert.equal(stock.rationale.qualityFactors.length,6);
 assert.equal(report.qualityResearchCatalog.length,3);
 assert.equal(stock.rationale.selection.officialCandidate,false);
 assert.equal(report.canTrade,false);
 assert.ok(report.researchWatchlist[0].matchedRules.some(x=>x.id==='quality:linear_trend_quality20'));
});
test('simulation can show why the indicator matched, but cannot enter public research watchlist',()=>{
 const input=sample('reversal','fixture'),report=historicalExplanations(input);
 assert.ok(report.candidates[0].rationale.selection.rules.some(x=>x.id==='quality:rsv14_reversal_confirmation'));
 assert.equal(report.researchWatchlist.length,0);
 assert.equal(report.candidates[0].rationale.selection.watchEligible,false);
});
