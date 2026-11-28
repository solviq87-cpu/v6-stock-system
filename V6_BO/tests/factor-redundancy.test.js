'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assessFactorRedundancy,spearman}=require('../src/core/factor-redundancy');
const id=['a','b','c'];
function days(count,values=(day,j)=>({a:10+j*13,b:10+j*13,c:[20,80,40,70,10,90][j]})){
 return Array.from({length:count},(_,i)=>({
  day:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),
  rows:Array.from({length:6},(_,j)=>({values:values(i,j)}))
 }));
}
const reliability={
 a:{reliable:true,meanIC:.33},
 b:{reliable:true,meanIC:.21},
 c:{reliable:true,meanIC:.08}
};
test('fifteen independent training days identify near identical positive factors and suppress weaker uplift',()=>{
 const r=assessFactorRedundancy(days(25),id,reliability);
 assert.equal(r.status,'screened');
 const p=r.pairs.find(x=>x.factorA==='a'&&x.factorB==='b');
 assert.equal(p.relationship,'strong-positive');
 assert.equal(p.eligibleForSuppression,true);
 assert.equal(p.comparableDays,25);
 assert.equal(p.requiredDays,19);
 assert.equal(p.medianRankCorrelation,1);
 assert.equal(p.earlyMeanRankCorrelation,1);
 assert.equal(p.recentMeanRankCorrelation,1);
 assert.equal(p.positiveStrongDayPct,100);
 assert.deepEqual(r.suppressedFactorIds,['b']);
 assert.deepEqual(r.suppressedFactors,[{
  factorId:'b',duplicateOf:'a',maxShadowAdjustment:-.02
 }]);
 assert.equal(r.conservativeShadowPenalty,-.02);
 assert.equal(r.canTrade,false);
 assert.equal(r.productionWeightsChanged,false);
});
test('strong inverse relationship is reported but never automatically pruned',()=>{
 const r=assessFactorRedundancy(days(25,(_i,j)=>({
  a:10+j*13,b:90-j*13,c:[20,80,40,70,10,90][j]
 })),id,reliability);
 const p=r.pairs.find(x=>x.factorA==='a'&&x.factorB==='b');
 assert.equal(p.relationship,'strong-inverse');
 assert.equal(p.medianRankCorrelation,-1);
 assert.equal(p.eligibleForSuppression,false);
 assert.deepEqual(r.suppressedFactorIds,[]);
});
test('opposing predictive IC signs prevent automatic suppression even for identical scores',()=>{
 const r=assessFactorRedundancy(days(25),id,{
  ...reliability,b:{reliable:true,meanIC:-.25}
 });
 const p=r.pairs.find(x=>x.factorA==='a'&&x.factorB==='b');
 assert.equal(p.relationship,'strong-positive');
 assert.equal(p.eligibleForSuppression,false);
 assert.deepEqual(r.suppressedFactorIds,[]);
});
test('correlation spike in a single week cannot pass the whole training-period gate',()=>{
 const rows=days(25,(i,j)=>({
  a:10+j*13,b:i<5?10+j*13:[20,80,40,70,10,90][j],
  c:[20,80,40,70,10,90][j]
 }));
 const r=assessFactorRedundancy(rows,id,reliability);
 assert.equal(r.pairs[0].eligibleForSuppression,false);
 assert.deepEqual(r.suppressedFactorIds,[]);
});
test('too few days or flat scores cannot be called independent correlation evidence',()=>{
 const few=assessFactorRedundancy(days(10),id,reliability);
 assert.equal(few.status,'insufficient-training-days');
 assert.deepEqual(few.suppressedFactorIds,[]);
 const flat=assessFactorRedundancy(days(25,(_i,j)=>({
  a:50,b:50,c:[20,80,40,70,10,90][j]
 })),id,reliability);
 assert.equal(flat.pairs[0].comparableDays,0);
 assert.equal(flat.pairs[0].relationship,'not-established');
 assert.deepEqual(flat.suppressedFactorIds,[]);
 assert.equal(spearman([1,1,1,1,1],[1,2,3,4,5]),null);
});
test('missing frozen scores and duplicate training days fail closed',()=>{
 const bad=days(25);delete bad[1].rows[0].values.b;
 assert.throws(()=>assessFactorRedundancy(bad,id,reliability),/不可补造/);
 const duplicates=days(25);duplicates[2].day=duplicates[1].day;
 assert.throws(()=>assessFactorRedundancy(duplicates,id,reliability),/重复/);
});
test('same redundant cluster chooses strongest reliable member deterministically across id order',()=>{
 const rel={a:{reliable:true,meanIC:.18},b:{reliable:true,meanIC:.32},
  c:{reliable:true,meanIC:.23}};
 const r=assessFactorRedundancy(days(25,(_i,j)=>({
  a:10+j*13,b:10+j*13,c:10+j*13
 })),['c','a','b'],rel);
 assert.deepEqual(r.suppressedFactorIds,['c','a']);
 assert.ok(r.suppressedFactors.every(x=>x.duplicateOf==='b'));
});

test('redundancy uses valid strictly chronological training days before computing correlation',()=>{
 for(const change of [d=>d.reverse(),d=>d[0].day='2026-02-30',d=>d[0].day='unknown',d=>d[1].day=d[0].day]){
  const d=days(25);change(d);
  assert.throws(()=>assessFactorRedundancy(d,id,reliability),/日期|重复/);
 }
});
test('declared cross-section security identity must be complete and unique, with market separation',()=>{
 const input=days(25);
 for(const d of input)d.rows.forEach((row,j)=>row.symbol='60000'+j);
 const before=JSON.stringify(input);
 assert.deepEqual(assessFactorRedundancy(input,id,reliability).suppressedFactorIds,['b']);
 assert.equal(JSON.stringify(input),before);
 for(const change of [d=>d[0].rows[1].symbol=d[0].rows[0].symbol,
  d=>delete d[0].rows[1].symbol,d=>d[0].rows[0].code='600999',d=>d[0].rows[0].symbol='']){
  const bad=JSON.parse(before);change(bad);assert.throws(()=>assessFactorRedundancy(bad,id,reliability),/证券/);
 }
 const mixed=JSON.parse(before);mixed[0].rows[0].market='CN';mixed[0].rows[1].market='HK';
 mixed[0].rows[1].symbol=mixed[0].rows[0].symbol;
 assert.deepEqual(assessFactorRedundancy(mixed,id,reliability).suppressedFactorIds,['b']);
});
test('correlation rejects nonfinite inputs and suppression never coerces malformed IC',()=>{
 assert.equal(spearman([1,2,3,4,NaN],[1,2,3,4,5]),null);
 assert.equal(spearman([1,2,3,4,Infinity],[1,2,3,4,5]),null);
 assert.equal(spearman([1,2,3,4,'5'],[1,2,3,4,5]),null);
 for(const meanIC of ['0.21',Infinity,2,NaN,null]){
  const r=assessFactorRedundancy(days(25),id,{...reliability,b:{reliable:true,meanIC}});
  assert.equal(r.pairs[0].relationship,'strong-positive');assert.equal(r.pairs[0].eligibleForSuppression,false);
  assert.deepEqual(r.suppressedFactorIds,[]);
 }
});

test('F47.4 exact frozen duplicate values are retained apart from rank correlation and do not add a suppression rule',()=>{
 const a=assessFactorRedundancy(days(25),id,reliability);assert.equal(a.exactValueDuplicatePairs.length,1);const p=a.exactValueDuplicatePairs[0];assert.equal(p.comparedRows,150);assert.equal(p.exactEqualRows,150);assert.equal(p.exactEqualDays,25);assert.equal(p.definitionEquivalent,null);assert.equal(p.changesOriginalSuppression,false);
 const scaled=assessFactorRedundancy(days(25,(_i,j)=>({a:10+j*10,b:20+j*10,c:[20,80,40,70,10,90][j]})),id,reliability);assert.equal(scaled.pairs[0].relationship,'strong-positive');assert.equal(scaled.exactValueDuplicatePairs.length,0);
});
test('F47.4 flat equal values remain recorded without fabricating rank correlation, short history unknown',()=>{
 const flat=assessFactorRedundancy(days(25,(_i,j)=>({a:50,b:50,c:[20,80,40,70,10,90][j]})),id,reliability);assert.equal(flat.exactValueDuplicatePairs.length,1);assert.equal(flat.pairs[0].medianRankCorrelation,null);assert.deepEqual(flat.suppressedFactorIds,[]);
 const few=assessFactorRedundancy(days(10),id,reliability);assert.equal(few.exactValueDuplicatePairs.length,0);assert.equal(few.pairs[0].exactValueEvidence.status,'insufficient-training-days');
});
