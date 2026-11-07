'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateCandidate,rankCandidates}=require('../src/strategy/strategy-service');
const factors=require('../strategies/extended-factor-pack.json').factors;
const now=Date.parse('2026-11-04T10:00:00Z');
const stock={code:'000001'};
for(const f of factors)stock[f.field]=80;
const evidence=Object.fromEntries(factors.map(f=>[f.field,{source:'verified-test-fixture',timestamp:now}]));
test('默认评分保持原行为，严格开关不影响默认值',()=>{
 const old=evaluateCandidate({stock});const explicit=evaluateCandidate({stock,factorOptions:{requireEvidence:false}});
 assert.equal(old.finalScore,explicit.finalScore);assert.equal(old.extendedFactors.available,15);
});
test('实际候选股评分入口严格拒绝缺失证据',()=>{
 const r=evaluateCandidate({stock,factorOptions:{requireEvidence:true,asOf:now}});
 assert.equal(r.extendedFactors.available,0);assert.equal(r.factorFusion.applied,false);assert.equal(r.finalScore,r.legacyScore);
});
test('实际候选股评分入口接受可追溯且未过期证据',()=>{
 const r=evaluateCandidate({stock,factorOptions:{requireEvidence:true,asOf:now,evidence}});
 assert.equal(r.extendedFactors.available,15);assert.equal(r.extendedFactors.coverage,1);assert.equal(r.factorFusion.applied,true);
});
test('批量排名透传严格模式，不使用缺证据扩展因子',()=>{
 const rs=rankCandidates({stocks:[stock,{...stock,code:'000002'}],factorOptions:{requireEvidence:true,asOf:now}});
 assert.equal(rs.length,2);for(const r of rs){assert.equal(r.extendedFactors.available,0);assert.equal(r.finalScore,r.legacyScore)}
});
test('严格模式允许股票自身携带因子证据',()=>{
 const r=evaluateCandidate({stock:{...stock,factorEvidence:evidence},factorOptions:{requireEvidence:true,asOf:now}});
 assert.equal(r.extendedFactors.available,15);
});
