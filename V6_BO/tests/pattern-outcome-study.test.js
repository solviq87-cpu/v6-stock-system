'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {studyPatternOutcomes}=require('../src/strategy/pattern-outcome-study');
function fixture(n=90){
 const tradeDates=Array.from({length:n+2},(_,i)=>new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10));
 let close=10;
 const bars=tradeDates.slice(0,n).map((date,i)=>{
  const previous=close,limit=+(previous*1.1).toFixed(2);close=i%7===0?limit:+(previous*1.01).toFixed(2);
  return {date,open:previous,close,high:Math.min(limit,close+.001),low:previous-.001,volume:10000,amount:200000000,
   knownAt:Date.parse(date+'T15:01:00+08:00'),statusKnownAt:date+'T09:00:00+08:00',suspended:false,tradable:true,isST:false,corporateAction:false,
   limitUpPrice:limit,limitReferencePrice:previous,limitKnownAt:date+'T09:00:00+08:00',noPriceLimit:false};
 });
 const asOf=Date.parse(tradeDates[n-1]+'T16:00:00+08:00');
 return {stock:{symbol:'600001',name:'形态研究样本',source:'imported-test',priceBasis:'unadjusted',observedAt:asOf,bars},asOf,tradeDates};
}
function run(f,extra={}){return studyPatternOutcomes(f.stock,{asOf:f.asOf,tradeDates:f.tradeDates,...extra});}
const pattern=(r,id='red_three_soldiers')=>r.patterns.find(p=>p.id===id);

test('confirmed patterns use observed next-session outcomes, empirical frequencies and Wilson intervals',()=>{
 const f=fixture(),result=run(f),p=pattern(result);
 assert.equal(result.status,'historical-association');assert.equal(p.currentlyMatched,true);
 assert.equal(p.direction.samples,87);assert.equal(p.direction.wins,87);assert.equal(p.direction.probability,1);
 assert.equal(p.direction.losses,0);assert.equal(p.direction.flat,0);assert.equal(p.direction.downProbability,0);
 const wins=f.stock.bars.slice(3).filter(b=>Math.round(b.close*100)===Math.round(b.limitUpPrice*100)).length;
 assert.equal(p.limitUp.samples,87);assert.equal(p.limitUp.wins,wins);assert.equal(p.limitUp.probability,wins/87);
 assert.ok(p.limitUp.confidenceInterval[0]<p.limitUp.probability&&p.limitUp.confidenceInterval[1]>p.limitUp.probability);
 assert.equal(p.direction.trainedThrough,f.stock.bars.at(-1).date);assert.equal(result.canTrade,false);assert.equal(result.canNotify,false);assert.equal(result.prospective,false);assert.equal(result.weightsChanged,false);
 assert.equal(Object.hasOwn(p,'score'),false);assert.equal(p.direction.method,'historical-conditional-frequency');
});

test('fewer than twenty matching labels retains counts without manufacturing a probability',()=>{
 const r=run(fixture(22)),p=pattern(r);assert.equal(p.direction.samples,19);assert.equal(p.direction.probability,null);assert.equal(p.direction.confidenceInterval,null);
 assert.equal(p.limitUp.probability,null);assert.equal(p.currentlyMatched,true);assert.equal(r.status,'insufficient-evidence');
 assert.throws(()=>run(fixture(),{minSamples:19}),/门槛/);
 const unmatched=pattern(run(fixture()),'three_black_crows');assert.equal(unmatched.direction.samples,0);assert.equal(unmatched.direction.probability,null);assert.equal(unmatched.currentlyMatched,false);
});

test('changing future bars cannot change historical pattern evidence or current availability',()=>{
 const prefix=fixture(70),full=fixture(110);full.stock.observedAt=prefix.asOf;
 for(let i=70;i<full.stock.bars.length;i++){
  const b=full.stock.bars[i];b.close*=2;b.high=Math.max(b.high,b.close);b.volume*=3;b.amount*=10;
 }
 assert.deepEqual(run(full,{asOf:prefix.asOf}).patterns,run(prefix).patterns);
 const intraday=fixture(70);intraday.asOf=Date.parse(intraday.stock.bars.at(-1).date+'T14:30:00+08:00');intraday.stock.observedAt=intraday.asOf;
 assert.equal(run(intraday).currentDate,intraday.stock.bars.at(-2).date);
 const missing=fixture();delete missing.stock.bars.at(-1).statusKnownAt;
 assert.equal(pattern(run(missing)).currentlyMatched,null,'an unavailable latest formation cannot reuse yesterday as current');
});

test('a formation cannot use a late-known candle, and missing sessions never join into a pattern',()=>{
 const late=fixture(),baseline=pattern(run(late)).direction.samples;
 late.stock.bars[30].knownAt=Date.parse(late.stock.bars[31].date+'T10:00:00+08:00');
 assert.equal(pattern(run(late)).direction.samples,baseline-1);
 const gap=fixture();gap.stock.bars=gap.stock.bars.filter((_,i)=>i%3!==0);
 assert.equal(run(gap).coverage.usableFormations,0);assert.deepEqual(run(gap).patterns,[]);
 for(const field of ['knownAt','statusKnownAt','suspended','tradable','isST','corporateAction']){
  const f=fixture();for(const b of f.stock.bars)delete b[field];const r=run(f);
  assert.equal(r.coverage.usableFormations,0,field);assert.ok(r.patterns.every(p=>p.direction.probability===null));
 }
 const noSource=fixture();delete noSource.stock.source;assert.equal(run(noSource).coverage.causalSourceAvailable,false);
});

test('limit-up labels require historical reference and pre-open price evidence, never a guessed ten percent',()=>{
 for(const patch of [{limitKnownAt:null},{limitReferencePrice:null},{noPriceLimit:true},{limitKnownAt:'2099-01-01T09:00:00+08:00'},{limitKnownAt:'1969-12-31T23:59:59Z'}]){
  const f=fixture();for(const b of f.stock.bars)Object.assign(b,patch);
  const p=pattern(run(f));assert.equal(p.direction.samples,87);assert.equal(p.limitUp.samples,0);assert.equal(p.limitUp.probability,null);
 }
 const adjusted=fixture();adjusted.stock.priceBasis='forward-adjusted';assert.equal(pattern(run(adjusted)).limitUp.probability,null);
 const changedReference=fixture();for(const b of changedReference.stock.bars)b.limitReferencePrice*=.9;
 assert.equal(pattern(run(changedReference)).limitUp.samples,0);
 const topLevel=fixture();Object.assign(topLevel.stock,{market:'main',limitPct:10,isST:false,noPriceLimit:false,ipoNoLimit:false});
 const board=pattern(run(topLevel),'limit_up_shakeout_main');assert.equal(board.currentlyMatched,null);assert.equal(board.direction.samples,0);
});

test('down and flat next-session closes are reported separately from upward frequency',()=>{
 const f=fixture();
 for(const i of [20,40]){
  const b=f.stock.bars[i],previous=f.stock.bars[i-1].close;b.close=i===20?previous*.99:previous;
  b.low=Math.min(b.low,b.close-.001);b.high=Math.max(b.high,b.open,b.close);
 }
 const p=pattern(run(f));assert.equal(p.direction.losses,1);assert.equal(p.direction.flat,1);
 assert.equal(p.direction.wins+p.direction.losses+p.direction.flat,p.direction.samples);
 assert.equal(p.direction.probability,p.direction.wins/p.direction.samples);assert.equal(p.direction.downProbability,1/p.direction.samples);
});

test('malformed OHLCV, duplicated calendar, mixed provenance and oversized input fail closed',()=>{
 const duplicate=fixture();duplicate.tradeDates[5]=duplicate.tradeDates[4];assert.throws(()=>run(duplicate),/日历/);
 const invalid=fixture();invalid.stock.bars[10].high=0;assert.throws(()=>run(invalid),/OHLCV/);
 const mixed=fixture();mixed.stock.bars[10].source='other';assert.throws(()=>run(mixed),/来源/);
 const mixedBasis=fixture();mixedBasis.stock.bars[10].priceBasis='adjusted';assert.throws(()=>run(mixedBasis),/口径/);
 assert.throws(()=>run(fixture(501)),/数量/);assert.throws(()=>run(fixture(),{asOf:Date.now()+10000}),/时点/);
});

test('amount is available only with its historical bar and all current pattern windows fit the bounded prefix',()=>{
 const f=fixture(80);for(const b of f.stock.bars)b.volume=10000;
 const last=f.stock.bars.at(-1);last.volume=50000;
 const r=run(f);assert.equal(pattern(r,'breakout20_liquid').currentlyMatched,true);
 for(const p of r.patterns)assert.ok(p.requiredBars<=r.coverage.maxPrefixBars);
 delete last.amount;assert.equal(pattern(run(f),'breakout20_liquid').currentlyMatched,null);
 last.amount=200000000;last.knownAt=f.asOf+1;
 assert.equal(run(f).currentDate,f.stock.bars.at(-2).date);
 assert.equal(pattern(run(f),'breakout20_liquid').currentlyMatched,false);
});
