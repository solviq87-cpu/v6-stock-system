"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const start=source.indexOf('function expireIdleViewDevices(now, opts) {');
const end=source.indexOf('function issueToken(role)',start);
assert.ok(start>=0&&end>start);
function run(devices,now){
 const sessions=new Map([['active',now+3600000]]);let saved=0;
 const ctx={Date,_vtokens:sessions,viewStore:()=>({devices}),viewIdleMs:()=>86400000,
  viewIdleKeys:(bag,t,ms)=>Object.keys(bag).filter(k=>t-bag[k].ts>=ms),
  _revokedBag:()=>({}),saveAccess:()=>{saved++;return true;}};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end)+';globalThis.expire=expireIdleViewDevices;',ctx);
 const result=ctx.expire(now);return {removed:result.removed,sessions:sessions.size,saved};
}
const now=Date.now();
assert.deepEqual(run({a:{ts:now-86400000}},now),{removed:1,sessions:0,saved:1});
assert.deepEqual(run({a:{ts:now-1000}},now),{removed:0,sessions:1,saved:0});
assert.deepEqual(run({},now),{removed:0,sessions:1,saved:0});
const revokeStart=source.indexOf("if (p === '/api/lock/revoke' && req.method === 'POST')");
const revokeEnd=source.indexOf("if (p === '/api/lock/devices' && req.method === 'POST')",revokeStart);
const revoke=source.slice(revokeStart,revokeEnd);
assert.match(revoke,/if \(revokedView\) _vtokens\.clear\(\)/);
assert.match(revoke,/if \(index === 1\) revokedView = true/);
assert.ok(revoke.indexOf('if (!saveAccess())')<revoke.indexOf('if (revokedView) _vtokens.clear()'));
console.log('PASS: 3 expiry behavior cases + 3 revoke path invariants');
