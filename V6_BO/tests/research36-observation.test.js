'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {compileObservation}=require('../src/strategy/research36-observation');
function fixture(){
 const dates=Array.from({length:70},(_,i)=>new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10));
 const asOf=Date.parse(dates.at(-1)+'T16:30:00+08:00'),symbol='600000';
 const bars=dates.map((date,i)=>({date,open:10+i*.1,close:10.02+i*.1,high:10.1+i*.1,low:9.9+i*.1,volume:1000+i*10,knownAt:asOf}));
 return {dates,obs:{asOf,stock:{symbol,source:'tencent',provider:'tencent',priceBasis:'unadjusted',observedAt:asOf,bars},observation:{observationHash:'a'.repeat(64)},
  marketContext:{funds:{stock:{source:'eastmoney',symbol,unit:'CNY',fundsMethod:'vendor-order-size-estimate',rawHash:'b'.repeat(64),retrievedAt:asOf,
   records:dates.slice(-5).map(tradeDate=>({tradeDate,mainNetInflow:100}))}},indices:{source:'eastmoney',rawHash:'c'.repeat(64),retrievedAt:asOf,records:dates.map((tradeDate,i)=>({tradeDate,shanghaiClose:3000+i}))}}}};
}
test('existing observation derives timestamped technical, consecutive funds and Shanghai-relative fields with no production permission',()=>{
 const {obs,dates}=fixture(),{input,result}=compileObservation(obs,{tradingDates:dates});
 assert.equal(result.evaluations.length,36);assert.equal(result.canTrade,false);assert.equal(result.canNotify,false);
 assert.ok(result.pipeline.derivedFields.includes('ma5Over10'));assert.ok(result.pipeline.derivedFields.includes('bandWidthRatio'));assert.ok(result.pipeline.derivedFields.includes('priorBreakoutRetestHeld'));
 assert.equal(input.stock.features.netFlow5.value,500);assert.equal(input.stock.features.positiveFlowDays.value,5);
 assert.ok(input.stock.features.relativeReturn20Pct.value>0);assert.ok(input.stock.features.relativeReturn60Pct.value>0);
 assert.equal(input.stock.bars[0].availableAt,obs.asOf);assert.notEqual(input.stock.bars[0].observedAt,obs.asOf);
 assert.equal(input.stock.features.netFlow5.recordedAt,obs.asOf);assert.equal(result.predictionProbability,null);
});
test('zero flow is known and ends positive continuity while unknown or nonfinite flow prevents all window metrics',()=>{
 const {obs,dates}=fixture();obs.marketContext.funds.stock.records.at(-1).mainNetInflow=0;
 let x=compileObservation(obs,{tradingDates:dates});assert.equal(x.input.stock.features.positiveFlowDays.value,0);assert.equal(x.input.stock.features.netFlow5.value,400);
 for(const bad of [null,undefined,NaN,Infinity,'0']){obs.marketContext.funds.stock.records.at(-1).mainNetInflow=bad;x=compileObservation(obs,{tradingDates:dates});assert.equal(x.input.stock.features.netFlow5,undefined);}
});
test('fund window rejects wrong code/unit, missing raw identity, future receipt, simulated or duplicate sessions',()=>{
 for(const patch of [{symbol:'000001'},{unit:'lots'},{rawHash:null},{retrievedAt:Infinity},{simulated:true},{retracted:true}]){
  const {obs,dates}=fixture();Object.assign(obs.marketContext.funds.stock,patch);assert.equal(compileObservation(obs,{tradingDates:dates}).input.stock.features.netFlow5,undefined);
 }
 const {obs,dates}=fixture();obs.marketContext.funds.stock.retrievedAt=obs.asOf+1;assert.equal(compileObservation(obs,{tradingDates:dates}).input.stock.features.netFlow5,undefined);
 obs.marketContext.funds.stock.retrievedAt=obs.asOf;obs.marketContext.funds.stock.records[0].tradeDate=obs.marketContext.funds.stock.records[1].tradeDate;
 assert.equal(compileObservation(obs,{tradingDates:dates}).input.stock.features.netFlow5,undefined);
});
test('calendar gaps, bad OHLCV, missing clocks and cross-source bars do not silently shrink technical windows',()=>{
 const changes=[b=>b.splice(20,1),b=>b[20].knownAt=undefined,b=>b[20].source='eastmoney',b=>b[20].high=1,b=>b[20].date=b[19].date,b=>b[20]=null];
 for(const change of changes){const {obs,dates}=fixture();change(obs.stock.bars);assert.equal(compileObservation(obs,{tradingDates:dates}).result.pipeline.barsUsed,0);}
 const {obs}=fixture();assert.equal(compileObservation(obs).result.pipeline.barsUsed,0);
});
test('newly received history cannot be evaluated before its actual archive availability',()=>{
 const {obs,dates}=fixture();obs.asOf-=1;const result=compileObservation(obs,{tradingDates:dates}).result;
 assert.equal(result.matched,0);assert.equal(result.pipeline.barsUsed,0);assert.ok(result.evaluations.every(s=>s.score===null));
});
test('explicit config applies to automated observation without changing archive content or mutating the input',()=>{
 const {obs,dates}=fixture(),before=structuredClone(obs);
 const x=compileObservation(obs,{tradingDates:dates,config:{ma_trend:{enabled:false}}});
 assert.equal(x.result.evaluations.find(s=>s.id==='ma_trend').status,'disabled');assert.deepEqual(obs,before);
 assert.throws(()=>compileObservation(obs,{tradingDates:dates,config:{ma_trend:{weight:-1}}}));
});
test('missing and future index receipts cannot create relative strength or substitute a different horizon',()=>{
 const {obs,dates}=fixture();obs.marketContext.indices.records.splice(10,1);
 const r=compileObservation(obs,{tradingDates:dates}).input.stock.features;assert.equal(r.relativeReturn60Pct,undefined);assert.ok(r.relativeReturn20Pct);
 obs.marketContext.indices.retrievedAt=obs.asOf+1;assert.equal(compileObservation(obs,{tradingDates:dates}).input.stock.features.relativeReturn20Pct,undefined);
});
test('archive-based technical staleness uses last bar session, not the read or capture clock',()=>{
 const {obs,dates}=fixture();obs.asOf+=4*86400000;
 const result=compileObservation(obs,{tradingDates:dates}).result;
 assert.ok(result.evaluations.find(s=>s.id==='ma_trend').missing.some(c=>c.missing==='证据超过研究时效'));
});
module.exports={fixture};
