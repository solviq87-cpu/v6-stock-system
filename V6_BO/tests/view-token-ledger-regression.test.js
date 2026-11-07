'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const start=source.indexOf('function roleOf(t, ip) {');
const end=source.indexOf('function checkToken(t)',start);
assert.ok(start>=0&&end>start);
const fn=source.slice(start,end);
function check({record,grace=false,expired=false,revoked=false,role='view'}){
  const digest='digest', token='signed';
  const vs={devices:record?{[digest]:{ts:expired?1:Date.now(),name:'测试设备'}}:{}};
  let touched=0,cleaned=0;
  const ctx={
    _tokens:new Map(),_vtokens:new Map(),Date,verifyDeviceToken:()=>role,
    isRevoked:()=>revoked,viewStore:()=>vs,devDigest:()=>digest,
    inDeviceGrace:()=>grace,
    viewIdleKeys:(devices,now,ms)=>Object.entries(devices).filter(([k,v])=>now-v.ts>=ms).map(([k])=>k),
    viewIdleMs:()=>24*3600000,expireIdleViewDevices:()=>{cleaned++;},
    touchDevice:()=>{touched++;},accessSecret:{devices:{}}
  };
  vm.createContext(ctx);vm.runInContext(fn+';globalThis.callRole=roleOf;',ctx);
  return {result:ctx.callRole(token,'127.0.0.1'),touched,cleaned};
}
assert.deepEqual(check({record:false}),{result:null,touched:0,cleaned:0});
assert.deepEqual(check({record:true}),{result:'view',touched:1,cleaned:0});
assert.deepEqual(check({record:true,expired:true}),{result:null,touched:0,cleaned:1});
assert.deepEqual(check({record:false,grace:true}),{result:'view',touched:1,cleaned:0});
assert.deepEqual(check({record:true,revoked:true}),{result:null,touched:0,cleaned:0});
assert.deepEqual(check({record:false,role:'edit'}),{result:'edit',touched:1,cleaned:0});
console.log('PASS 6 cases: missing view ledger rejected, valid/expired/grace/revoked, developer unchanged');
