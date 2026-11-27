'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assessFactorReliability:reliability,pairedStability:stability,assessShadowDecay:decay,assessShadowRecovery:recovery}=require('../src/core/factor-learning-reliability');
const day=i=>new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10);
const rows=()=>Array.from({length:10},(_,i)=>({day:day(i),rows:[{values:{a:.1,b:.2},returnPct:.1}],base:.1,shadow:.25}));
const ids=['a','b'],base={a:1,b:1},shadow={a:2,b:1};
const score=(d,_ids,w)=>({days:1,meanIC:w.a===1?d[0].base:d[0].shadow});
const all=(d,s=score,f=ids,a=base,b=shadow)=>[stability,decay,recovery].map(fn=>()=>fn(d,f,a,b,s));
const assertAll=(f,pattern)=>{for(const run of f)assert.throws(run,pattern);};
const icRows=values=>values.map((ic,i)=>({day:day(i),ic,regime:'unknown'}));
test('inherited daily evidence is not a confirmed observation',()=>{
 const d=icRows(Array(30).fill(.3));d[0]=Object.create(d[0]);assert.throws(()=>reliability(d),/证据无效/);
});
test('daily IC getter is rejected without being invoked',()=>{
 let reads=0;const d=icRows(Array(30).fill(.3));Object.defineProperty(d[0],'ic',{get(){reads++;return .3;}});assert.throws(()=>reliability(d),/证据无效/);assert.equal(reads,0);
});
test('daily regime accessor cannot create a known market context',()=>{
 let reads=0;const d=icRows(Array(30).fill(.3));Object.defineProperty(d[0],'regime',{get(){reads++;return 'systemic-selloff';}});assert.throws(()=>reliability(d),/证据无效/);assert.equal(reads,0);
});
test('sparse observations reject before any scoring across all paired diagnostics',()=>{
 const d=rows();delete d[0];let calls=0;assertAll(all(d,()=>{calls++;return {days:1,meanIC:.2};}),/日期/);assert.equal(calls,0);
});
test('inherited dates cannot masquerade as explicit dated evidence',()=>{
 const d=rows();d[0]=Object.create(d[0]);let calls=0;assertAll(all(d,(...args)=>{calls++;return score(...args);}),/证据无效/);assert.equal(calls,0);
});
test('factor identities must be unique and nonempty',()=>{
 for(const f of [['a','a'],['a',''],['a','__proto__']])assertAll(all(rows(),score,f),/因子与权重证据无效/);
});
test('weight evidence rejects nonpositive, nonfinite and foreign factors',()=>{
 for(const w of [{a:NaN,b:1},{a:0,b:1},{a:-1,b:1},{a:1,b:Infinity},{a:1,b:1,z:2}])assertAll(all(rows(),score,ids,w,shadow),/因子与权重证据无效/);
});
test('weight accessor is rejected before reading or scoring',()=>{
 let reads=0;const a={b:1};Object.defineProperty(a,'a',{enumerable:true,get(){reads++;return 1;}});assertAll(all(rows(),score,ids,a,shadow),/因子与权重证据无效/);assert.equal(reads,0);
});
test('different supplied factor coverage does not compare as identical evidence',()=>assertAll(all(rows(),score,ids,{a:1},shadow),/因子与权重证据无效/));
test('all comparison variants receive the same immutable evidence, not caller objects',()=>{
 for(const fn of [stability,decay,recovery]){const d=rows(),a={...base},b={...shadow},f=[...ids];const before=JSON.stringify([d,a,b,f]);let first;
  const result=fn(d,f,a,b,(sample,factors,w)=>{assert.notEqual(sample[0],d[0]);assert.ok(Object.isFrozen(sample));assert.ok(Object.isFrozen(sample[0]));assert.ok(Object.isFrozen(sample[0].rows[0].values));assert.ok(Object.isFrozen(factors));assert.ok(Object.isFrozen(w));assert.throws(()=>{sample[0].rows[0].values.a=99;},TypeError);if(!first)first=sample[0];return score(sample,factors,w);});
  assert.ok(result);assert.equal(JSON.stringify([d,a,b,f]),before);
 }
});
test('callback mutations of external originals cannot change later evaluated observations',()=>{
 for(const fn of [stability,decay,recovery]){const d=rows(),a={...base},b={...shadow},f=[...ids];let calls=0;const r=fn(d,f,a,b,(sample,factors,w)=>{if(++calls===1){d[9].shadow=-.9;b.a=1;f[0]='bad';}return score(sample,factors,w);});assert.equal(calls,20);if(fn===stability)assert.equal(r.recentDeltaIC,.15);else if(fn===decay)assert.equal(r.deltaIC,.15);else assert.equal(r.recovered,true);}
});
test('nested getters and sparse data are not accepted as immutable evidence',()=>{
 let reads=0;const d=rows();Object.defineProperty(d[0].rows[0].values,'a',{enumerable:true,get(){reads++;return .1;}});assertAll(all(d),/证据无效/);assert.equal(reads,0);const sparse=rows();delete sparse[0].rows[0];assertAll(all(sparse),/证据无效/);
});
test('a reused receipt object retains independently captured baseline and shadow IC',()=>{
 const shared={days:1,meanIC:0};const reused=(d,_ids,w)=>{shared.meanIC=w.a===1?d[0].base:d[0].shadow;return shared;};const [s,m,r]=all(rows(),reused).map(fn=>fn());assert.equal(s.earlyDeltaIC,.15);assert.equal(s.halfPeriodsConsistent,true);assert.equal(m.deltaIC,.15);assert.equal(r.firstBlock.deltaIC,.15);
});
test('reused receipt cannot hide baseline and shadow coverage mismatch',()=>{
 const shared={days:1,meanIC:0};const reused=(_d,_ids,w)=>{shared.days=w.a===1?0:1;shared.meanIC=shared.days===0?null:.2;return shared;};assertAll(all(rows(),reused),/覆盖不一致/);
});
test('receipt getters and inherited fields are rejected without execution of getters',()=>{
 let reads=0;const getter=()=>({days:1,get meanIC(){reads++;return .2;}});assertAll(all(rows(),getter),/IC证据无效/);assert.equal(reads,0);assertAll(all(rows(),()=>Object.create({days:1,meanIC:.2})),/IC证据无效/);
});
test('opposing absolute outlier must not conceal dependence on a supporting day',()=>{
 const values=[-.99,...Array(6).fill(.10),...Array(7).fill(.01),.8];const r=reliability(icRows(values));assert.ok(r.outlierRemovedMeanIC>.02);assert.ok(r.supportRemovedMeanIC<.02);assert.ok(r.reasons.includes('single-day-influence-dominates'));assert.equal(r.reliable,false);assert.equal(r.suggestedWeightMultiplier,0);
});
test('normal stable evidence, absent pairs, negative decay, and recovery preserve original contract',()=>{
 const r=reliability(icRows(Array(30).fill(.3)));assert.equal(r.reliable,true);assert.ok(r.suggestedWeightMultiplier>0);assert.equal(r.productionWeightsChanged,false);assert.equal(r.canTrade,false);
 const [s,m,x]=all(rows()).map(fn=>fn());assert.equal(s.halfPeriodsConsistent,true);assert.equal(m.status,'no-decay-detected');assert.equal(x.recovered,true);assert.equal(x.canTrade,false);
 const [e,n,c]=all(rows(),()=>({days:0,meanIC:null})).map(fn=>fn());assert.equal(e.halfPeriodsConsistent,false);assert.equal(n.status,'insufficient-fresh-evidence');assert.equal(c.recovered,false);
 const bad=rows().map(d=>({...d,shadow:-.2}));assert.equal(decay(bad,ids,base,shadow,score).alert,true);assert.equal(recovery(bad,ids,base,shadow,score).recovered,false);
});
test('valid negative directional information remains eligible and legacy same-subset scorer remains compatible',()=>{
 const r=reliability(icRows(Array(30).fill(-.3)));assert.equal(r.reliable,true);assert.ok(r.suggestedWeightMultiplier<0);assert.equal(stability(rows(),ids,{a:1},{a:2},score).halfPeriodsConsistent,true);
});
