'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const start = source.indexOf('function _write(set, evt, data) {');
const end = source.indexOf('function sseSend(evt, data)', start);
assert.ok(start >= 0 && end > start);
const writeFn = source.slice(start, end);
test('撤权后广播前复验并主动断流，合法用户仍收消息', () => {
  const SSE=new Set(),SSE_EDIT=new Set(),SSE_CLIENTS=new Map();
  const received=[],valid=new Set(['valid']);
  function client(token,role) {
    const res={ended:false,write(data){received.push([token,data]);},end(){this.ended=true;}};
    SSE.add(res);if(role==='edit')SSE_EDIT.add(res);
    SSE_CLIENTS.set(res,{authToken:token,authIp:'127.0.0.2',role,local:false});return res;
  }
  const a=client('revoked','view'),b=client('valid','view');
  const ctx={SSE,SSE_EDIT,SSE_CLIENTS,roleOf:t=>valid.has(t)?'view':null};
  vm.createContext(ctx);vm.runInContext(writeFn+'\nthis.send = _write;',ctx);
  ctx.send(SSE,'event',{ok:true});
  assert.equal(a.ended,true);assert.equal(SSE.has(a),false);
  assert.equal(SSE_CLIENTS.has(a),false);assert.equal(b.ended,false);
  assert.equal(received.length,1);assert.match(received[0][1],/event: event/);
});
test('开发者角色降级时立即断开私密推送',()=>{
  const SSE=new Set(),SSE_EDIT=new Set(),SSE_CLIENTS=new Map();
  const res={ended:false,write(){throw Error('must not send')},end(){this.ended=true}};
  SSE.add(res);SSE_EDIT.add(res);
  SSE_CLIENTS.set(res,{authToken:'downgraded',authIp:'127.0.0.2',role:'edit',local:false});
  const ctx={SSE,SSE_EDIT,SSE_CLIENTS,roleOf:()=> 'view'};
  vm.createContext(ctx);vm.runInContext(writeFn+'\nthis.send = _write;',ctx);
  ctx.send(SSE_EDIT,'private',{holdings:1});
  assert.equal(res.ended,true);assert.equal(SSE_EDIT.size,0);assert.equal(SSE.size,0);
});

test('私密推送集合误混入只读会话时仍禁止泄露',()=>{
  const SSE=new Set(),SSE_EDIT=new Set(),SSE_CLIENTS=new Map();
  let sent=0;const res={ended:false,write(){sent++},end(){this.ended=true}};
  SSE.add(res);SSE_EDIT.add(res);
  SSE_CLIENTS.set(res,{authToken:'viewer',authIp:'127.0.0.2',role:'view',local:false});
  const ctx={SSE,SSE_EDIT,SSE_CLIENTS,roleOf:()=> 'view'};
  vm.createContext(ctx);vm.runInContext(writeFn+'\nthis.send = _write;',ctx);
  ctx.send(SSE_EDIT,'holding',{private:true});
  assert.equal(sent,0);assert.equal(res.ended,true);assert.equal(SSE_EDIT.size,0);
});
test('本地只读会话混入私密集合也必须拒绝',()=>{
  const SSE=new Set(),SSE_EDIT=new Set(),SSE_CLIENTS=new Map();
  let sent=0;const res={ended:false,write(){sent++},end(){this.ended=true}};
  SSE.add(res);SSE_EDIT.add(res);
  SSE_CLIENTS.set(res,{role:'view',local:true});
  const ctx={SSE,SSE_EDIT,SSE_CLIENTS,roleOf:()=>null};
  vm.createContext(ctx);vm.runInContext(writeFn+'\nthis.send = _write;',ctx);
  ctx.send(SSE_EDIT,'holding',{private:true});
  assert.equal(sent,0);assert.equal(res.ended,true);
});
