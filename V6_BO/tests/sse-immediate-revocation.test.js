'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const start = src.indexOf('function closeRevokedSseConnections() {');
const end = src.indexOf('function sseSend(evt, data)', start);
assert.ok(start >= 0 && end > start);
const fn = src.slice(start,end);
test('撤权即时关闭失效 SSE，不影响有效或本机连接', () => {
  const SSE = new Set(), SSE_EDIT = new Set(), SSE_CLIENTS = new Map();
  const responses = Array.from({length:4},()=>({ended:0,end(){this.ended++}}));
  const metas = [
    {role:'view',authToken:'revoked',authIp:'ip',local:false},
    {role:'view',authToken:'valid',authIp:'ip',local:false},
    {role:'edit',authToken:'expired-editor',authIp:'ip',local:false},
    {role:'edit',local:true}
  ];
  responses.forEach((r,i)=>{SSE.add(r);if(metas[i].role==='edit')SSE_EDIT.add(r);SSE_CLIENTS.set(r,metas[i]);});
  const ctx={SSE,SSE_EDIT,SSE_CLIENTS,roleOf:t=>t==='valid'?'view':null};
  vm.createContext(ctx);vm.runInContext(fn+'\nthis.close = closeRevokedSseConnections;',ctx);
  assert.equal(ctx.close(),2);
  assert.deepEqual(responses.map(r=>r.ended),[1,0,1,0]);
  assert.equal(SSE.size,2);assert.equal(SSE_EDIT.size,1);assert.equal(SSE_CLIENTS.size,2);
  assert.equal(ctx.close(),0);
});
test('撤权操作和离线回收均触发即时断流',()=>{
  assert.match(src,/if \(keys\.length\) \{ revokeViewSessionsForDevices\(keys\); saveAccess\(\); closeRevokedSseConnections\(\); \}/);
  assert.match(src,/if \(hit\) closeRevokedSseConnections\(\);/);
});
