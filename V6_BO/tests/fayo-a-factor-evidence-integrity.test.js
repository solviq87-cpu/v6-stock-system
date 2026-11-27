'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assessFactorRedundancy,spearman}=require('../src/core/factor-redundancy');
const ids=['a','b'];
const reliability={a:{reliable:true,meanIC:.3},b:{reliable:true,meanIC:.2}};
const make=(count=20,identity=true)=>Array.from({length:count},(_,i)=>({
 day:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),
 rows:Array.from({length:6},(_,j)=>({...(identity?{symbol:String(600000+j)}:{}),values:{a:10+j*10,b:10+j*10}}))
}));
const run=(days=make(),rel=reliability)=>assessFactorRedundancy(days,ids,rel);
test('T1 rejects impossible or noncanonical training calendar dates',()=>{
 for(const day of ['2026-02-30','2026-01-1','unknown','2026-13-01']){const rows=make();rows[0].day=day;assert.throws(()=>run(rows),/日期/);}
});
test('T1 rejects reordered dates without silently selecting a different recent half',()=>{
 const rows=make();[rows[0],rows[1]]=[rows[1],rows[0]];assert.throws(()=>run(rows),/日期/);
});
test('T2 rejects repeated securities in a declared cross-section',()=>{
 const rows=make();rows[0].rows[1].symbol=rows[0].rows[0].symbol;assert.throws(()=>run(rows),/证券身份/);
});
test('T2 rejects mixed or malformed explicitly declared security identities',()=>{
 for(const bad of [null,'',600000,' 600000','600000\n']){const rows=make();rows[0].rows[0].symbol=bad;assert.throws(()=>run(rows),/证券身份/);}
 const rows=make();delete rows[1].rows[0].symbol;assert.throws(()=>run(rows),/证券身份/);
});
test('T2 keeps explicitly anonymous legacy diagnostics and valid named cross-sections equivalent',()=>{
 assert.deepEqual(run(make(20,false)),run(make()));assert.deepEqual(run().suppressedFactorIds,['b']);
});
test('T3 malformed and out-of-range IC cannot certify a factor for suppression',()=>{
 for(const meanIC of ['0.8',Infinity,2,-2,NaN,null]){const r=run(make(),{...reliability,b:{reliable:true,meanIC}});assert.equal(r.pairs[0].eligibleForSuppression,false);assert.deepEqual(r.suppressedFactorIds,[]);}
});
test('T3 inherited reliability evidence cannot approve shadow suppression',()=>{
 const rel=Object.assign(Object.create({b:reliability.b}),{a:reliability.a});assert.deepEqual(run(make(),rel).suppressedFactorIds,[]);
 const inherited=Object.create({reliable:true,meanIC:.2});assert.deepEqual(run(make(),{a:reliability.a,b:inherited}).suppressedFactorIds,[]);
});
test('T4 direct rank correlation refuses nonfinite, string, sparse and non-array inputs',()=>{
 const y=[1,2,3,4,5];for(const x of [[1,2,3,4,NaN],[1,2,3,4,Infinity],[1,2,3,4,'5'],[1,2,3,4,null],Array(5),null,{length:5}])assert.equal(spearman(x,y),null);
});
test('T4 inherited factor scores cannot fill a missing frozen score',()=>{
 const rows=make();const original=rows[0].rows[0].values;rows[0].rows[0].values=Object.assign(Object.create({b:original.b}),{a:original.a});assert.throws(()=>run(rows),/不可补造/);
});
test('T4 finite tied and inverse ranks keep original behavior',()=>{
 assert.equal(spearman([1,2,3,4,5],[5,4,3,2,1]),-1);assert.equal(spearman([1,1,2,3,4],[1,1,2,3,4]),1);assert.equal(spearman([1,1,1,1,1],[1,2,3,4,5]),null);
});
test('T5 absent correlations in the early half do not get replaced by late evidence',()=>{
 const rows=make();for(const day of rows.slice(0,5))for(const row of day.rows)row.values.b=50;
 const r=run(rows);assert.equal(r.pairs[0].comparableDays,15);assert.equal(r.pairs[0].eligibleForSuppression,false);assert.deepEqual(r.suppressedFactorIds,[]);
});
test('T5 missing days are partitioned by actual training dates in both directions',()=>{
 const rows=make();for(const day of rows.slice(-5))for(const row of day.rows)row.values.b=50;
 assert.equal(run(rows).pairs[0].eligibleForSuppression,false);
 const balanced=make();for(const day of [balanced[0],balanced[1],balanced[10],balanced[11]])for(const row of day.rows)row.values.b=50;
 assert.equal(run(balanced).pairs[0].eligibleForSuppression,true);
});
