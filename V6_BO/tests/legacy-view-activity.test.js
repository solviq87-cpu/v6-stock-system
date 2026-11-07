'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const start=source.indexOf('function roleOf(t, ip) {');
const end=source.indexOf('function checkToken(t)',start);
assert.ok(start>=0&&end>start);
function run({ts=Date.now()-1000,exists=true,developer=false}={}){
  const digest='legacy-device',t='legacy-token';let touched=0,expired=0;
  const devices=exists?{[digest]:{ts}}:{};
  const ctx={Date,_tokens:new Map(),_vtokens:new Map(),_viewSessionDevices:new Map(),
    verifyDeviceToken:()=>null,devDigest:()=>digest,
    accessSecret:{devices:developer?{[digest]:{ts}}:{},view:{devices}},
    viewIdleMs:()=>86400000,viewIdleKeys:(bag,now,limit)=>Object.keys(bag).filter(k=>now-bag[k].ts>=limit),
    expireIdleViewDevices:()=>{expired++;},touchDevice:()=>{touched++;}};
  vm.createContext(ctx);vm.runInContext(source.slice(start,end)+';globalThis.role=roleOf;',ctx);
  return {role:ctx.role(t,'127.0.0.1'),touched,expired};
}
assert.deepEqual(run(),{role:'view',touched:1,expired:0});
assert.deepEqual(run({ts:Date.now()-86400001}),{role:null,touched:0,expired:1});
assert.deepEqual(run({exists:false}),{role:null,touched:0,expired:0});
assert.deepEqual(run({developer:true,exists:false}),{role:'edit',touched:0,expired:0});
console.log('PASS 4: 旧只读有效访问刷新、24小时到期拒绝、无授权拒绝、开发者不受影响');
