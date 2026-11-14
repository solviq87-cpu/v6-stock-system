'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const start=src.indexOf('function roleOf(t, ip) {');
const end=src.indexOf('function checkToken(',start);
assert.ok(start>=0 && end>start);
function run({bound=true,record=true,expired=false,sessionExpired=false,developer=false}={}) {
 const now=Date.now(),token='session',digest='device-a';
 const vt=new Map([[token,sessionExpired?now-1:now+3600000]]);
 const boundMap=new Map(bound?[[token,digest]]:[]);
 const devices=record?{[digest]:{ts:expired?now-86400001:now-1000}}:{};
 const ctx={Date,_tokens:developer?new Map([[token,now+3600000]]):new Map(),
 _vtokens:vt,_viewSessionDevices:boundMap,
 viewStore:()=>({devices}),viewIdleKeys:(d,t,ms)=>Object.keys(d).filter(k=>t-d[k].ts>=ms),
 viewIdleMs:()=>86400000,verifyDeviceToken:()=>null,
 accessSecret:{devices:{},view:{devices:{}}},devDigest:()=>digest};
 vm.createContext(ctx);vm.runInContext(src.slice(start,end)+';globalThis.testRole=roleOf;',ctx);
 return {role:ctx.testRole(token,'127.0.0.1'),sessionExists:vt.has(token),boundExists:boundMap.has(token)};
}
assert.deepEqual(run(),{role:'view',sessionExists:true,boundExists:true});
assert.deepEqual(run({bound:false}),{role:null,sessionExists:false,boundExists:false});
assert.deepEqual(run({record:false}),{role:null,sessionExists:false,boundExists:false});
assert.deepEqual(run({expired:true}),{role:null,sessionExists:false,boundExists:false});
assert.deepEqual(run({sessionExpired:true}),{role:null,sessionExists:false,boundExists:false});
assert.deepEqual(run({developer:true}),{role:'edit',sessionExists:true,boundExists:true});
console.log('PASS 6: 有效绑定、旧无绑定、撤销、离线24小时、会话过期、开发者不受影响');
