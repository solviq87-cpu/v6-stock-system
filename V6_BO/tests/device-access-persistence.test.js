'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const start=source.indexOf('function saveAccessOrRestore(previousAccess) {');
const end=source.indexOf('// ── 双密码体系',start);
assert.ok(start!==-1&&end>start,'must contain persist rollback helper');
function harness(initial,save){
  const ctx={accessSecret:structuredClone(initial),saveAccess:save};
  vm.createContext(ctx);
  vm.runInContext(source.slice(start,end)+'\nthis.commit=saveAccessOrRestore;',ctx);
  return ctx;
}
test('access state is reverted exactly if atomic save fails',()=>{
  const original={devices:{edit:{ts:1}},view:{devices:{viewer:{ts:2}}},revoked:{old:3}};
  const ctx=harness(original,()=>false);
  ctx.accessSecret.devices={};ctx.accessSecret.view.devices={};ctx.accessSecret.revoked.new=4;
  assert.equal(ctx.commit(structuredClone(original)),false);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.accessSecret)),original);
});
test('successful device commit retains changed state',()=>{
  const ctx=harness({devices:{one:{}}},()=>true);
  const original=structuredClone(ctx.accessSecret);
  delete ctx.accessSecret.devices.one;
  assert.equal(ctx.commit(original),true);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.accessSecret.devices)),{});
});
test('manual revoke and prune use durable commit before SSE/session invalidation',()=>{
  const revoke=source.slice(source.indexOf("if (p === '/api/lock/revoke'"),source.indexOf("if (p === '/api/lock/devices' && req.method === 'POST')"));
  const prune=source.slice(source.indexOf("if (p === '/api/lock/devices' && req.method === 'POST')"),source.indexOf("if (p === '/api/auth/code'"));
  for(const block of [revoke,prune]){
    assert.ok(block.indexOf('saveAccessOrRestore(')>=0);
    assert.ok(block.indexOf('saveAccessOrRestore(')<block.indexOf('closeRevokedSseConnections()'));
  }
  assert.match(prune,/revokeViewSessionsForDevices\(prunedViewDigests\)/);
  assert.match(prune,/if \(removed\) closeRevokedSseConnections\(\)/);
});
