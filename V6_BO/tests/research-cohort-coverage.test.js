'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {researchCohortCoverage:run}=require('../src/core/research-cohort-coverage');
const rows=[{id:'a',market:'CN',code:'600000',day:'2026-11-10',values:{A:0,B:1}},{id:'b',market:'CN',code:'600001',day:'2026-11-10',values:{A:null,B:2}},{id:'c',market:'CN',code:'600000',day:'2026-11-10',values:{A:1}}];
const a={samples:[{...rows[0],returnPct:0,canTrade:false}],rejected:[{...rows[1],reason:'unmatured-label'},{...rows[2],reason:'duplicate-symbol-day-check'}]};
test('F10.1/F11.5/F11.6 original attempt denominator retains excluded duplicate checks and actual zero',()=>{
 const r=run(rows,a,['A','B','C']);assert.equal(r.attempts,3);assert.equal(r.aligned,1);assert.equal(r.excluded,2);assert.equal(r.duplicateChecks,1);assert.equal(r.coverage,1/3);assert.equal(r.reasons['unmatured-label'],1);assert.deepEqual(r.factors.find(x=>x.factorId==='A'),{factorId:'A',attempts:3,observed:2,unknown:1,observedZero:1,aligned:1,notAlignedOrUnknown:2,coverage:1/3});assert.equal(r.factors.find(x=>x.factorId==='C').unknown,3);assert.equal(r.canApprove,false);
});
test('missing, substituted, repeated or permission-granting alignment rows return unknown instead of a fabricated coverage',()=>{
 for(const x of [{...a,rejected:a.rejected.slice(0,1)},{...a,samples:[{...a.samples[0],id:'foreign'}]},{...a,samples:[{...a.samples[0],values:{A:100,B:1}}]},{...a,samples:[{...a.samples[0],canTrade:true}]},{samples:[a.samples[0],{...rows[2],returnPct:1,canTrade:false}],rejected:[a.rejected[0]]}]){const r=run(rows,x,['A']);assert.equal(r.status,'unknown');assert.equal(r.coverage,null);}
 assert.equal(run([],{samples:[],rejected:[]},['A']).coverage,null);
});
