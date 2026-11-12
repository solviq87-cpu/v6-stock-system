'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {modelExperiment}=require('../src/strategy/model-experiment');
const {names}=require('../src/strategy/model-features');
function fixture(){
 const dates=[];for(let i=0;dates.length<102;i++){const d=new Date(Date.UTC(2025,0,2+i));if(d.getUTCDay()%6!==0)dates.push(d.toISOString().slice(0,10));}
 return {source:'simulated',splitDay:88,models:['ridge'],tradingDates:dates,stocks:Array.from({length:6},(_,j)=>{
  const bars=dates.map((date,i)=>{const open=10+j+i*.03+.15*Math.sin(i/3+j),close=open+.03*Math.cos(i+j);return {date,open,high:Math.max(open,close)+.1,low:Math.min(open,close)-.1,close,volume:10000+i*13+100*Math.sin(i/2+j),availableAt:Date.parse(date+'T15:10:00+08:00')};});
  return {symbol:String(600000+j),bars,factorHistory:{metadataByDate:Object.fromEntries(dates.map(date=>[date,{source:'fixture-only',datasetVersion:'point-in-time-fixture',priceAdjustment:'split-dividend-adjusted',volumeAdjustment:'split-adjusted',volumeUnit:'shares',adjustmentAsOf:date+'T15:00:00+08:00'}])),bars:bars.map(b=>({...b,open:b.open*100,high:b.high*100,low:b.low*100,close:b.close*100,complete:true,availableAt:b.date+'T15:01:00+08:00'}))}};
 })};
}
test('public factor learning is opt-in and keeps adjusted research bars separate from execution prices',()=>{
 const input=fixture(),baseline=modelExperiment(input),newer=modelExperiment({...input,featureSet:'public-volume-v1'});
 assert.deepEqual(baseline.features,names);assert.equal(newer.features.length,names.length+3);
 assert.equal(newer.protocol.featureSet,'public-volume-v1');assert.match(newer.protocol.publicFactorCatalogFingerprint,/^[a-f0-9]{64}$/);
 assert.deepEqual(newer.summaries.v6Original,baseline.summaries.v6Original);
 assert.equal(newer.autoTrade,false);assert.ok(Number.isFinite(newer.latest[0].scores.ridge));
});
test('future adjusted factor inputs cannot alter earlier predictions or dataset fingerprint',()=>{
 const input=fixture(),end=94,first=modelExperiment({...input,end,featureSet:'public-volume-v1'});
 for(const stock of input.stocks)for(let i=end+1;i<stock.factorHistory.bars.length;i++)stock.factorHistory.bars[i].close=null;
 const second=modelExperiment({...input,end,featureSet:'public-volume-v1'});
 assert.deepEqual(second.latest,first.latest);assert.deepEqual(second.summaries,first.summaries);assert.equal(second.protocol.datasetSha256,first.protocol.datasetSha256);
});
test('new factor training rejects missing causal evidence, no amount substitution, and unknown feature-set selection',()=>{
 const input=fixture();for(const stock of input.stocks)delete stock.factorHistory;
 assert.throws(()=>modelExperiment({...input,featureSet:'public-volume-v1'}),/有效训练数据/);
 assert.throws(()=>modelExperiment({...fixture(),featureSet:'public-volume-liquidity-v1'}),/有效训练数据/);
 assert.throws(()=>modelExperiment({...fixture(),featureSet:'auto-best-profit'}),/featureSet/);
});

test('finite but late raw availability cannot authorize future factor data for earlier next-open trades',()=>{
 const input=fixture();for(const stock of input.stocks)for(const b of stock.bars)b.availableAt=Date.parse('2026-01-01T15:00:00+08:00');
 assert.throws(()=>modelExperiment({...input,featureSet:'public-volume-v1'}),/有效训练数据/);
});

test('optional monetary liquidity inputs have fixed declared units for tree models',()=>{
 const input=fixture();for(const stock of input.stocks){
  for(const meta of Object.values(stock.factorHistory.metadataByDate)){meta.amountUnit='CNY';meta.amountBasis='actual-unadjusted-turnover';}
  for(const b of stock.factorHistory.bars)b.amount=100000000+b.volume*100;
 }
 const out=modelExperiment({...input,featureSet:'public-volume-liquidity-v1'});
 assert.equal(out.protocol.featureInputTransforms.amihud_illiq20_rmb.multiplier,1e8);
 assert.equal(out.protocol.featureInputTransforms.amihud_illiq20_rmb.unit,'per-100-million-CNY');
 assert.ok(Number.isFinite(out.latest[0].scores.ridge));
});
