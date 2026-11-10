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
