'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {verifyTap}=require('../scripts/verify-tap-completeness');
test('complete TAP with nested test counts is accepted',()=>{assert.equal(verifyTap('# Subtest: a\n    # Subtest: child\n    ok 1 - child\nok 1 - a\n1..1\n# tests 2\n').complete,true);});
test('dangling subtest header is rejected even with a zero-failure summary',()=>{assert.throws(()=>verifyTap('# Subtest: a\nok 1 - a\n# Subtest: lost\n1..1\n# fail 0\n'),/未完整/);});
test('missing plan and discontinuous result sequences are rejected',()=>{assert.throws(()=>verifyTap('# Subtest: a\nok 1 - a\n'),/结束计划/);assert.throws(()=>verifyTap('# Subtest: a\nok 2 - a\n1..1\n'),/不连续/);});
test('failed test result is never accepted as a passing run',()=>{assert.throws(()=>verifyTap('# Subtest: a\nnot ok 1 - a\n1..1\n'),/失败/);});
test('Node plain-script file wrapper numbering is accepted without weakening ordinary case sequencing',()=>{assert.equal(verifyTap('# Subtest: a\nok 1 - a\n# Subtest: tests/plain.test.js\nok 7 - tests/plain.test.js\n# Subtest: b\nok 3 - b\n1..3\n').complete,true);});
test('zero-test and unsafe-sized plans are rejected as full runs',()=>{
 for(const plan of ['1..0','1..9007199254740992'])assert.throws(()=>verifyTap(plan+'\n'),/计划/);
});
test('a plan followed by top-level tests cannot be a final completion receipt',()=>{
 assert.throws(()=>verifyTap('1..1\n# Subtest: a\nok 1 - a\n'),/结束计划/);
 assert.throws(()=>verifyTap('# Subtest: a\n1..1\nok 1 - a\n'),/结束计划/);
});
test('terminal summaries and bailout must not contradict success',()=>{
 for(const tail of ['# fail 1\n','# cancelled 1\n','# fail 0\n# fail 1\n','Bail out! premature termination\n']){
  assert.throws(()=>verifyTap('# Subtest: a\nok 1 - a\n1..1\n'+tail),/失败|取消|中止|重复/);
 }
});
test('nonzero honest receipt accepts separate optional skip counts',()=>{
 assert.deepEqual(verifyTap('# Subtest: a\nok 1 - a # SKIP optional\n1..1\n# tests 1\n# fail 0\n# cancelled 0\n# skipped 1\n'),{topLevelTests:1,complete:true});
});
