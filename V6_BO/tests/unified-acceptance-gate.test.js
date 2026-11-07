const test=require('node:test');const assert=require('node:assert/strict');const {runGate}=require('../scripts/unified-acceptance-gate');
test('unified ledger contains 24 main and 52 unique feature items',()=>{const r=runGate();assert.equal(r.inventory.mainTaskCount,24);assert.equal(r.inventory.featureTaskCount,52);assert.equal(r.checks.featureIdsUnique,true);assert.equal(r.checks.mainIdsUnique,true)});
test('gate checks essential project entrypoints',()=>{const r=runGate();assert.equal(r.checks.requiredFilesPresent,true);assert.deepEqual(r.missingFiles,[])});
test('passing structural gate never implies production acceptance',()=>{const r=runGate();assert.equal(r.structurePassed,true);assert.equal(r.releaseReady,false);assert.ok(r.externalBlockers.length>=4)});
test('strict mode fails closed without external acceptance',()=>{const r=runGate({strict:true});assert.equal(r.exitCode,2)});
