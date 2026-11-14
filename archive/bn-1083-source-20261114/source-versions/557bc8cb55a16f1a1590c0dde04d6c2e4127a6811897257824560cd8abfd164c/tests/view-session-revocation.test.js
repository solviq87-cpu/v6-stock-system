'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const start=source.indexOf('function expireIdleViewDevices(now, opts) {');
const end=source.indexOf('function issueToken(role, deviceToken)',start);
assert.ok(start>=0&&end>start,'cannot locate expiry/revocation implementations');
let n=0;const ok=(x,msg)=>{assert.ok(x,msg);n++;};
function run(devices,now){
 const sessions=new Map([['deviceA',now+3600000],['deviceB',now+3600000],['legacy',now+3600000]]);
 const binds=new Map([['deviceA','a'],['deviceB','b']]);
 const revoked={};let saved=0;
 const ctx={Date,Set,_vtokens:sessions,_viewSessionDevices:binds,
  viewStore:()=>({devices}),viewIdleMs:()=>86400000,
  viewIdleKeys:(bag,t,ms)=>Object.keys(bag).filter(k=>t-bag[k].ts>=ms),
  _revokedBag:()=>revoked,saveAccess:()=>{saved++;return true;},closeRevokedSseConnections:()=>0};
 vm.createContext(ctx);
 vm.runInContext(source.slice(start,end)+';globalThis.expire=expireIdleViewDevices;',ctx);
 const result=ctx.expire(now);
 return {removed:result.removed,sessions:[...sessions.keys()].sort(),saved,revoked:Object.keys(revoked)};
}
const now=Date.now();
const expired=run({a:{ts:now-86400000},b:{ts:now-1000}},now);
ok(expired.removed===1);ok(expired.sessions.join(',')==='deviceB');ok(expired.saved===1);ok(expired.revoked.join(',')==='a');
const fresh=run({a:{ts:now-1000},b:{ts:now-1000}},now);
ok(fresh.removed===0);ok(fresh.sessions.length===3);ok(fresh.saved===0);
const none=run({},now);ok(none.removed===0);ok(none.saved===0);
const revokeStart=source.indexOf("if (p === '/api/lock/revoke' && req.method === 'POST')");
const revokeEnd=source.indexOf("if (p === '/api/lock/devices' && req.method === 'POST')",revokeStart);
ok(revokeStart>=0&&revokeEnd>revokeStart);
const revoke=source.slice(revokeStart,revokeEnd);
ok(revoke.includes('revokeViewSessionsForDevices(revokedViewDigests)'));
ok(revoke.includes('if (!id) return json(res'));
ok(revoke.indexOf('if (!saveAccess())')<revoke.indexOf('revokeViewSessionsForDevices(revokedViewDigests)'));
ok(source.includes("issueToken('view', dtV2)"));
console.log('PASS '+n+' view session expiry/revocation assertions');
