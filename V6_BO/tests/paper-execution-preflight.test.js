'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { preflightPaperExecution } = require('../src/core/paper-execution-preflight');
const fp = 'a'.repeat(64);
function fixture(overrides={}) { return { plan:{mode:'paper-order-intent-plan',canTrade:false,executed:false,datasetFingerprint:fp,intents:[{system:'fourteen',symbol:'600000',executionDate:'2026-11-05',side:'buy',status:'proposal-only',referencePrice:10,quantity:100}]}, snapshot:{datasetFingerprint:fp,asOf:'2026-11-05',symbols:[{symbol:'600000',price:10,complete:true,stale:false,tradable:true}]}, account:{cash:100000,positions:{}}, ...overrides }; }
test('valid intent passes read-only preflight without mutating account',()=>{const f=fixture(), before=JSON.stringify(f.account);const r=preflightPaperExecution(f.plan,f.snapshot,f.account);assert.equal(r.passCount,1);assert.equal(r.executed,false);assert.equal(r.accountMutated,false);assert.equal(JSON.stringify(f.account),before);});
test('dataset fingerprint mismatch is rejected',()=>{const f=fixture();f.snapshot.datasetFingerprint='b'.repeat(64);assert.throws(()=>preflightPaperExecution(f.plan,f.snapshot,f.account),/指纹不一致/);});
test('suspended and upper-limit symbols are blocked',()=>{for(const patch of [{suspended:true},{atUpperLimit:true}]){const f=fixture();Object.assign(f.snapshot.symbols[0],patch);const r=preflightPaperExecution(f.plan,f.snapshot,f.account);assert.equal(r.blockedCount,1);}});
test('cash shortage and stale price are blocked',()=>{let f=fixture();f.account.cash=1;assert.equal(preflightPaperExecution(f.plan,f.snapshot,f.account).blockedCount,1);f=fixture();f.snapshot.symbols[0].price=11;assert.equal(preflightPaperExecution(f.plan,f.snapshot,f.account).blockedCount,1);});
