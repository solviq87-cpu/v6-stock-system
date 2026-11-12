'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {featureObservation,catalog,names}=require('../src/strategy/public-factor-features');
function fixture(){
  const tradingDates=[];
  for(let n=0;tradingDates.length<26;n++){
    const d=new Date(Date.UTC(2026,5,1+n));
    if(d.getUTCDay()!==0&&d.getUTCDay()!==6)tradingDates.push(d.toISOString().slice(0,10));
  }
  const bars=tradingDates.map((date,i)=>{
    const close=100+i+(i%3)*2;
    return {date,open:close-1,high:close+2,low:close-2,close,volume:1000+30*i+(i%4)*100,
      amount:120000+i*500,complete:true,availableAt:date+'T15:05:00+08:00'};
  });
  return {stock:{symbol:'600001',bars,factorMetadata:{source:'explicit-test-fixture',datasetVersion:'fixture-v1',
    priceAdjustment:'split-dividend-adjusted',volumeAdjustment:'split-adjusted',
    adjustmentAsOf:tradingDates[20]+'T15:06:00+08:00',volumeUnit:'shares',
    amountUnit:'CNY',amountBasis:'actual-unadjusted-turnover'}},
    options:{asOf:tradingDates[20],observedAt:tradingDates[20]+'T15:10:00+08:00',tradingDates}};
}
const run=f=>featureObservation(f.stock,f.options);
const approx=(actual,expected)=>assert.ok(Math.abs(actual-expected)<=1e-12*Math.max(1,Math.abs(expected)),`${actual} != ${expected}`);
function reject(change,reason){const f=fixture();change(f);const r=run(f);
  assert.equal(r.status,'unavailable');assert.ok(r.reasons.includes(reason),JSON.stringify(r.reasons));
  assert.ok(Object.values(r.values).every(v=>v===null));assert.equal(r.canTrade,false);}

test('catalog versions and independent research status preserve source/licensing distinctions',()=>{
  assert.equal(catalog.length,4);assert.equal(names.length,4);
  assert.ok(catalog.every(f=>f.orientation==='unverified'&&f.version==='1.0.0'&&f.source.startsWith('https://')));
  assert.ok(catalog.slice(0,3).every(f=>f.sourceLicense==='MIT'));
  assert.match(catalog[3].sourceLicense,/copyright reserved/);
  assert.throws(()=>{catalog[0].requiredFields.push('futureReturn');},TypeError);
});
test('four formulas agree with independently accumulated raw moments and telescoping volume numerator',()=>{
  const f=fixture(),before=structuredClone(f),r=run(f),b=f.stock.bars.slice(0,21);
  let sx=0,sy=0,sxx=0,syy=0,sxy=0,variation=0,sq=0,sqq=0,illiq=0;
  for(let i=1;i<=20;i++){
    const x=b[i].close/b[i-1].close,y=Math.log(1+b[i].volume/b[i-1].volume);
    const q=Math.abs(x-1)*b[i].volume;
    sx+=x;sy+=y;sxx+=x*x;syy+=y*y;sxy+=x*y;
    variation+=Math.abs(b[i].volume-b[i-1].volume);sq+=q;sqq+=q*q;
    illiq+=Math.abs(x-1)/b[i].amount;
  }
  approx(r.values.qlib_cord20,(20*sxy-sx*sy)/Math.sqrt((20*sxx-sx*sx)*(20*syy-sy*sy)));
  approx(r.values.qlib_vsumd20,(b[20].volume-b[0].volume)/variation);
  approx(r.values.qlib_wvma20,Math.sqrt((sqq-sq*sq/20)/19)/(sq/20));
  approx(r.values.amihud_illiq20_rmb,illiq/20);
  assert.equal(r.status,'available');assert.equal(r.provenance.sessions,21);
  assert.equal(r.provenance.verification,'declared-unverified');assert.deepEqual(f,before);
  assert.equal(r.canTrade,false);assert.equal(r.productionWeightsChanged,false);assert.equal(r.autoPromotion,false);
});
test('an earlier observation is byte-identical with truncated or corrupted future payloads',()=>{
  const f=fixture(),expected=run(f);
  f.stock.bars=f.stock.bars.slice(0,21);assert.deepEqual(run(f),expected);
  const g=fixture();for(const bar of g.stock.bars.slice(21)){
    bar.close=NaN;bar.volume=0;bar.complete=false;bar.availableAt='not-a-time';bar.amount=-3;
  }
  assert.deepEqual(run(g),expected);
});
test('window rolls on supplied session calendar without using older OHLCV',()=>{
  const f=fixture();f.options.asOf=f.options.tradingDates[25];
  f.options.observedAt=f.options.asOf+'T15:10:00+08:00';
  f.stock.bars[0].close=NaN;
  const r=run(f);assert.equal(r.status,'available');
  assert.equal(r.provenance.firstSession,f.options.tradingDates[5]);
});
test('cutoff must be explicit with timezone and at or after the session close',()=>{
  reject(f=>delete f.options.observedAt,'INVALID_SESSION_OR_CUTOFF');
  reject(f=>f.options.observedAt=f.options.asOf+'T15:10:00','INVALID_SESSION_OR_CUTOFF');
  reject(f=>f.options.observedAt=f.options.asOf+'T14:59:59+08:00','INVALID_SESSION_OR_CUTOFF');
  reject(f=>f.options.asOf='2026-02-30','INVALID_SESSION_OR_CUTOFF');
  const f=fixture(),expected=run(f);f.options.observedAt=Date.parse(f.options.observedAt);assert.deepEqual(run(f),expected);
});
test('publication and adjustment timestamps cannot be missing, premature or future',()=>{
  reject(f=>delete f.stock.bars[10].availableAt,'BAR_NOT_AVAILABLE_AT_CUTOFF');
  reject(f=>f.stock.bars[20].availableAt=f.options.asOf+'T15:11:00+08:00','BAR_NOT_AVAILABLE_AT_CUTOFF');
  reject(f=>f.stock.bars[10].availableAt=f.stock.bars[10].date+'T14:00:00+08:00','BAR_NOT_AVAILABLE_AT_CUTOFF');
  reject(f=>f.stock.factorMetadata.adjustmentAsOf=f.options.asOf+'T15:11:00+08:00','ADJUSTMENT_VINTAGE_UNAVAILABLE');
});
test('calendar gaps, duplicate sessions, unsorted bars and missing warmup fail closed',()=>{
  reject(f=>delete f.options.tradingDates,'INVALID_TRADING_CALENDAR');
  reject(f=>f.options.tradingDates[3]=f.options.tradingDates[2],'INVALID_TRADING_CALENDAR');
  reject(f=>f.stock.bars.splice(9,1),'MISSING_TRADING_SESSION');
  reject(f=>f.stock.bars[3].date=f.stock.bars[2].date,'INVALID_BAR_ORDER');
  reject(f=>[f.stock.bars[4],f.stock.bars[5]]=[f.stock.bars[5],f.stock.bars[4]],'INVALID_BAR_ORDER');
  reject(f=>f.stock.bars=f.stock.bars.slice(0,20),'INSUFFICIENT_BAR_HISTORY');
});
test('no forwardfill for suspended, zero-volume, incomplete or malformed used bars',()=>{
  reject(f=>f.stock.bars[4].suspended=true,'SUSPENDED_OR_ZERO_VOLUME');
  reject(f=>f.stock.bars[0].volume=0,'SUSPENDED_OR_ZERO_VOLUME');
  reject(f=>f.stock.bars[20].tradable=false,'SUSPENDED_OR_ZERO_VOLUME');
  reject(f=>delete f.stock.bars[2].complete,'INCOMPLETE_BAR');
  reject(f=>f.stock.bars[3].volume='1000','INVALID_OHLCV');
  reject(f=>f.stock.bars[3].low=f.stock.bars[3].high+1,'INVALID_OHLCV');
});
test('source, price adjustment and share-volume units are explicit and consistent',()=>{
  reject(f=>delete f.stock.factorMetadata.source,'SOURCE_METADATA_REQUIRED');
  reject(f=>f.stock.factorMetadata.priceAdjustment='raw','ADJUSTMENT_OR_VOLUME_UNIT_UNVERIFIED');
  reject(f=>f.stock.factorMetadata.volumeUnit='lots','ADJUSTMENT_OR_VOLUME_UNIT_UNVERIFIED');
  reject(f=>f.stock.bars[2].volumeUnit='lots','MIXED_BAR_METADATA');
  reject(f=>f.stock.bars[2].source='different-feed','MIXED_BAR_METADATA');
  reject(f=>f.stock.bars[2].adjustmentAsOf=f.options.asOf+'T15:11:00+08:00','MIXED_BAR_METADATA');
});
test('constant inputs produce per-factor missing reasons, never invented neutral values',()=>{
  const f=fixture();for(const b of f.stock.bars)b.volume=1000;
  const r=run(f);assert.equal(r.values.qlib_cord20,null);assert.equal(r.values.qlib_vsumd20,null);
  assert.ok(r.reasons.includes('NO_VOLUME_CHANGE'));assert.ok(r.values.qlib_wvma20>0);
  for(const b of f.stock.bars){b.close=100;b.open=100;b.high=101;b.low=99;}
  const flat=run(f);assert.equal(flat.values.qlib_wvma20,null);
  assert.equal(flat.values.amihud_illiq20_rmb,0); // A valid zero absolute return is not missing.
});
test('Amihud requires actual CNY amount and rejects approximations/units without disabling other features',()=>{
  for(const change of [
    f=>delete f.stock.factorMetadata.amountUnit,
    f=>f.stock.factorMetadata.amountUnit='CNY-10000',
    f=>f.stock.factorMetadata.amountBasis='close-times-volume',
    f=>delete f.stock.bars[4].amount,
    f=>f.stock.bars[4].amount=0,
    f=>f.stock.bars[4].amount='120000',
    f=>f.stock.bars[4].amountUnit='USD'
  ]){
    const f=fixture();change(f);const r=run(f);
    assert.equal(r.status,'partial');assert.equal(r.values.amihud_illiq20_rmb,null);
    assert.ok(names.slice(0,3).every(n=>Number.isFinite(r.values[n])));
  }
  const f=fixture(),original=run(f).values.amihud_illiq20_rmb;
  for(const b of f.stock.bars)b.amount*=2;
  approx(run(f).values.amihud_illiq20_rmb,original/2);
});
test('explicit metadata override works and causal lineage changes only with used evidence',()=>{
  const f=fixture(),first=run(f);
  f.options.metadata=f.stock.factorMetadata;delete f.stock.factorMetadata;assert.deepEqual(run(f),first);
  f.stock.bars[10].amount+=1;assert.notEqual(run(f).provenance.inputSha256,first.provenance.inputSha256);
  const g=fixture();g.stock.bars[10].amountUnit='USD';
  assert.notEqual(run(g).provenance.inputSha256,first.provenance.inputSha256);
});
test('extreme finite inputs do not turn numeric overflow into a bounded score',()=>{
  reject(f=>{for(let i=0;i<21;i++)f.stock.bars[i].volume=i%2?1e308:1;},'NONFINITE_CALCULATION');
});

test('invalid numeric timestamp magnitudes cannot certify a causal cutoff',()=>{
 const observed=featureObservation({}, {asOf:'2026-01-01',observedAt:1e308,tradingDates:[]});
 assert.equal(observed.status,'unavailable');assert.equal(observed.reasons[0],'INVALID_SESSION_OR_CUTOFF');
});
