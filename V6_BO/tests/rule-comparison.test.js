'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {coverage,packComparison,compareRuleSystems}=require('../src/strategy/rule-comparison');
const {evaluateCandidate,rankCandidates}=require('../src/strategy/strategy-service');
test('rule coverage separates unknown from failure and computes known pass rate',()=>{
 assert.deepEqual(coverage([{status:'pass'},{status:'unknown'},{status:'fail'}]),
 {total:3,known:2,passed:1,failed:1,unknown:1,coverageRate:0.6667,knownPassRate:0.5});
});
test('GPT pack preserves five independent strategies, weights and original thresholds',()=>{
 const rows=packComparison({trendScore:60,relativeStrengthScore:59});
 assert.equal(rows.length,5);assert.equal(rows[0].weight,1.25);
 assert.equal(rows[0].minScore,55);assert.deepEqual(rows[0].rules.map(r=>r.status),['pass','fail','unknown']);
 assert.equal(rows[0].coverage.coverageRate,0.6667);
});
test('missing Python provenance and absent native contexts are explicitly unavailable',()=>{
 const r=compareRuleSystems({pythonResult:{score:90}});
 assert.equal(r.systems.python.available,false);
 assert.equal(r.systems.fourteen.available,false);
 assert.equal(r.systems.bazi.available,false);
 assert.equal(r.rankingModified,false);
});
test('bazi keeps four insufficient dimensions and neutral baseline distinct from evidence',()=>{
 const r=compareRuleSystems({baziInput:{rows:[]}}).systems.bazi;
 assert.equal(r.coverage.known,0);assert.equal(r.coverage.unknown,4);
 assert.ok(r.dimensions.every(x=>x.status==='unknown'&&x.score===null));
});
test('optional comparison does not change existing candidate ranking or pass result',()=>{
 const stock={code:'000001',price:10};
 const a=evaluateCandidate({stock}),b=evaluateCandidate({stock,factorOptions:{includeRuleComparison:true}});
 assert.equal(a.finalScore,b.finalScore);assert.equal(a.pass,b.pass);
 assert.equal(b.ruleComparison.mode,'independent-research');
 const ranked=rankCandidates({stocks:[stock],factorOptions:{includeRuleComparison:true,ruleScores:{trendScore:99}}});
 assert.equal(ranked[0].ruleComparison.systems.gpt[0].coverage.known,0);
});
