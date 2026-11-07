'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runAdaptiveJob}=require('../src/server/adaptive-research-job');
const {fixture}=require('./helpers/adaptive-fixture');
test('adaptive worker returns only bounded research output and refuses concurrent jobs',async()=>{const first=runAdaptiveJob(fixture(65));const second=await runAdaptiveJob(fixture(65));assert.equal(second.ok,false);assert.match(second.error,/正在运行/);const result=await first;assert.equal(result.ok,true);assert.equal(result.result.canTrade,false);assert.equal(result.result.learning.liveRulesChanged,false);});
test('worker validation failure and timeout release admission for subsequent requests',async()=>{assert.equal((await runAdaptiveJob({})).ok,false);assert.equal((await runAdaptiveJob(fixture(65),{timeoutMs:1})).ok,false);assert.equal((await runAdaptiveJob(fixture(65))).ok,true);});
