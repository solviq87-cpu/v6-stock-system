'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateCandidate,rankCandidates}=require('../src/strategy/strategy-service');
const factors=require('../strategies/extended-factor-pack.json').factors;
const now=Date.parse('2026-11-04T10:00:00Z');
const evidence=Object.fromEntries(factors.map(f=>[f.field,{source:'fixture',timestamp:now,code:'000001'}]));
const mk=code=>({code,...Object.fromEntries(factors.map(f=>[f.field,80]))});
test('single-stock evidence remains supported',()=>{
 assert.equal(evaluateCandidate({stock:mk('000001'),factorOptions:{requireEvidence:true,evidence,asOf:now}}).extendedFactors.available,15);
});
test('batch shared evidence cannot leak across candidates',()=>{
 const rs=rankCandidates({stocks:[mk('000001'),mk('000002')],factorOptions:{requireEvidence:true,evidence,asOf:now}});
 assert.ok(rs.every(r=>r.extendedFactors.available===0));
});
test('batch per-stock evidence remains independent',()=>{
 const rs=rankCandidates({stocks:[{...mk('000001'),factorEvidence:evidence},mk('000002')],factorOptions:{requireEvidence:true,asOf:now}});
 assert.equal(rs.find(r=>r.snapshot.code==='000001').extendedFactors.available,15);
 assert.equal(rs.find(r=>r.snapshot.code==='000002').extendedFactors.available,0);
});
test('strict feed rejects evidence tagged with another stock',()=>{
 const bars=Array.from({length:35},(_,i)=>({date:`2026-09-${String(i+1).padStart(2,'0')}`,open:10,high:11,low:9,close:10,volume:100000+i*1000}));
 const stock={...mk('000002'),close:10,bars,feed:{source:'eastmoney',timestamp:now},factorEvidence:Object.fromEntries(factors.map(f=>[f.field,{source:'eastmoney',timestamp:now,code:'000001'}]))};
 const r=evaluateCandidate({stock,factorOptions:{requireFeedValidation:true,asOf:now}});
 assert.equal(r.extendedFactors.available,0);
});
