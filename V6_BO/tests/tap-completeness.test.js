'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {verifyTap}=require('../scripts/verify-tap-completeness');
test('complete TAP with nested test counts is accepted',()=>{assert.equal(verifyTap('# Subtest: a\n    # Subtest: child\n    ok 1 - child\nok 1 - a\n1..1\n# tests 2\n').complete,true);});
test('dangling subtest header is rejected even with a zero-failure summary',()=>{assert.throws(()=>verifyTap('# Subtest: a\nok 1 - a\n# Subtest: lost\n1..1\n# fail 0\n'),/未完整/);});
test('missing plan and discontinuous result sequences are rejected',()=>{assert.throws(()=>verifyTap('# Subtest: a\nok 1 - a\n'),/结束计划/);assert.throws(()=>verifyTap('# Subtest: a\nok 2 - a\n1..1\n'),/不连续/);});
test('failed test result is never accepted as a passing run',()=>{assert.throws(()=>verifyTap('# Subtest: a\nnot ok 1 - a\n1..1\n'),/失败/);});
test('Node plain-script file wrapper numbering is accepted without weakening ordinary case sequencing',()=>{assert.equal(verifyTap('# Subtest: a\nok 1 - a\n# Subtest: tests/plain.test.js\nok 7 - tests/plain.test.js\n# Subtest: b\nok 3 - b\n1..3\n').complete,true);});
