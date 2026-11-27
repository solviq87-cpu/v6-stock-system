'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {classifyObservedMarket}=require('../src/core/observed-market-regime');
const {researchInstant}=require('../src/core/observed-market-timing');
const day='2026-11-05',at=Date.parse(day+'T10:00:00+08:00');
const scores={indexTrendScore:65,marketVolumeScore:60,riskScore:20,volatilityScore:30,sentimentScore:70};
const snapshot={date:day,source:'fixture-market',universeSize:2,stocks:[{code:'000001',pctChange:3},{code:'000002',pctChange:-1}]};
const opts={asOf:at+60000,scoreSource:'fixture-index',scoreDate:day,scores};
const run=(m={},s={},o={})=>classifyObservedMarket({...snapshot,...m},{...opts,scores:{...scores,...s},...o});
const blocked=r=>{assert.equal(r.usable,false);assert.equal(r.regime,null);assert.equal(r.weights,null);};
test('legacy date-only inputs remain research compatible but never claim aligned time',()=>{
 const r=run();assert.equal(r.usable,true);assert.equal(r.timingEvidence.status,'unknown');assert.equal(r.timingEvidence.certified,false);
});
test('strict instant accepts UTC, explicit China offset and epoch milliseconds',()=>{
 for(const x of [at,new Date(at),new Date(at).toISOString(),day+'T10:00:00+08:00'])assert.equal(researchInstant(x),at);
 for(const x of [null,false,0,at/1000,String(at),day,day+'T10:00:00','2026-02-30T10:00:00+08:00','2026-11-05T24:00:00+08:00','2026-11-05T10:00:00+08:99'])assert.equal(researchInstant(x),null);
});
test('explicit invalid decision clock fails closed',()=>{
 for(const x of [null,NaN,day,'bad',at/1000])blocked(run({}, {}, {asOf:x}));
});
test('same-day future closing score or late knownAt cannot enter morning classification',()=>{
 for(const key of ['asOf','observedAt','receivedAt','knownAt'])blocked(run({}, {[key]:at+6*3600000}));
});
test('snapshot retrieved in future or malformed explicit timestamp is blocked',()=>{
 for(const x of [at+60001,day,'not-a-time',at/1000])blocked(run({retrievedAt:x}));
});
test('different market data cutoff and independent scoring cutoff are rejected in both directions',()=>{
 for(const x of [at-1000,at+1000])blocked(run({asOf:at},{asOf:x}));
});
test('market sample interval admits an in-window score but rejects outside window',()=>{
 const m={startedAt:at-1000,retrievedAt:at+1000};
 assert.equal(run(m,{asOf:at}).usable,true);
 for(const x of [at-1001,at+1001])blocked(run(m,{asOf:x}));
});
test('same-day inverted collection and overlong paging fail',()=>{
 blocked(run({startedAt:at+1,retrievedAt:at}));blocked(run({startedAt:at-120001,retrievedAt:at}));
 assert.equal(run({startedAt:at-120000,retrievedAt:at}).usable,true);
});
test('missing intermediate time does not hide a reversed available pair',()=>{
 blocked(run({}, {asOf:at,knownAt:at-1}));blocked(run({retrievedAt:at,knownAt:at-1}));
 blocked(run({asOf:at,observedAt:at-1}));blocked(run({}, {observedAt:at,receivedAt:at-1}));
});
test('declared trade date and China timezone checked independently',()=>{
 blocked(run({}, {tradeDate:'2026-11-04'}));blocked(run({asOf:at-86400000}));
 blocked(run({}, {asOf:Date.parse('2026-11-04T15:59:59Z')}));
 assert.equal(run({asOf:'2026-11-04T16:00:00Z'}).usable,true);
});
test('explicit old, future or malformed provider quote cannot be counted as same-day breadth regime',()=>{
 for(const vendorQuoteAt of [at-86400000,at+60001,'invalid',at/1000,new Date(at).toISOString()])blocked(run({stocks:[{...snapshot.stocks[0],vendorQuoteAt},snapshot.stocks[1]]}));
 blocked(run({asOf:at,stocks:[{...snapshot.stocks[0],vendorQuoteAt:at+1},snapshot.stocks[1]]}));
});
test('row timestamps cannot outrun the declared snapshot retrieval or availability',()=>{
 for(const field of ['observedAt','receivedAt','knownAt'])blocked(run({retrievedAt:at,stocks:[{...snapshot.stocks[0],[field]:at+1},snapshot.stocks[1]]}));
 blocked(run({stocks:[{...snapshot.stocks[0],vendorQuoteAt:at,knownAt:at-1},snapshot.stocks[1]]}));
});
test('one missing vendor timestamp remains unknown coverage, not synthesized from retrieval',()=>{
 const r=run({retrievedAt:at,stocks:[{...snapshot.stocks[0],vendorQuoteAt:at-1000},{...snapshot.stocks[1],vendorQuoteAt:null}]});
 assert.equal(r.usable,true);assert.equal(r.timingEvidence.providerTimeCount,1);assert.equal(r.timingEvidence.providerTimeCoverage,.5);assert.equal(r.timingEvidence.status,'unknown');
});
test('complete declared aligned evidence still does not certify provider or trading',()=>{
 const r=run({asOf:at,observedAt:at+1,retrievedAt:at+2,knownAt:at+2}, {asOf:at,observedAt:at+3,knownAt:at+4});
 assert.equal(r.usable,true);assert.equal(r.timingEvidence.status,'declared-aligned');assert.equal(r.timingEvidence.certified,false);assert.equal(r.timingEvidence.canTrade,false);
});
test('historical retrieval can be later than data date only if known by replay cutoff',()=>{
 const later=at+86400000;blocked(run({asOf:at,retrievedAt:later}));
 const r=run({asOf:at,retrievedAt:later},{asOf:at},{asOf:later});assert.equal(r.usable,true);assert.equal(r.timingEvidence.status,'unknown');
});
test('claimed sampling span cannot contradict the actual start/end timestamps',()=>{
 const m={startedAt:at-1000,retrievedAt:at};
 for(const duration of [-1,0,1001,120001,'1000'])blocked(run({...m,samplingDurationMs:duration}));
 assert.equal(run({...m,samplingDurationMs:1000}).usable,true);
});
test('an explicit observation bounds the source even when market data cutoff is absent',()=>{
 blocked(run({observedAt:at,retrievedAt:at+2,stocks:[{...snapshot.stocks[0],vendorQuoteAt:at+1},snapshot.stocks[1]]}));
 blocked(run({observedAt:at,retrievedAt:at+2},{asOf:at+1}));
});
