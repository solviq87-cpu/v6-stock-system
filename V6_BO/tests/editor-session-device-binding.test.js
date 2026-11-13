'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const between=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
function fixture(){
 let now=1794480000000;
 const ctx={Date:{now:()=>now},crypto,Map,Set,Number,Error,
  _tokens:new Map(),_editSessionDevices:new Map(),_passwordOnlyEditSessions:new Map(),
  _vtokens:new Map(),_viewSessionDevices:new Map(),accessSecret:{gen:3,devices:{}},
  devDigest:t=>crypto.createHash('sha256').update(t).digest('hex'),verifyDeviceToken:()=>null};
 vm.createContext(ctx);
 vm.runInContext(between('function issueToken(', '// 长期设备令牌：')+'\n'+
  between('function roleOf(t, ip)', 'function checkToken(')+'\n'+
  between('function revokeEditSessionsForDevices(', 'function revokeViewSessionsForDevices(')+
  ';this.issue=issueToken;this.role=roleOf;this.revoke=revokeEditSessionsForDevices;',ctx);
 return {...ctx,advance:ms=>now+=ms,bound:device=>{
  ctx.accessSecret.devices[ctx.devDigest(device)]={role:'edit'};return ctx.issue('edit',device);
 }};
}
test('normal editor sessions require explicit device binding and reject orphaned legacy sessions',()=>{
 const f=fixture();assert.throws(()=>f.issue('edit'),/必须绑定/);
 f._tokens.set('legacy-session',1794480000000+3600000);
 assert.equal(f.role('legacy-session'),null);assert.equal(f._tokens.has('legacy-session'),false);
 const token=f.bound('device-a');assert.equal(f.role(token),'edit');
 delete f.accessSecret.devices[f.devDigest('device-a')];
 assert.equal(f.role(token),null);assert.equal(f._editSessionDevices.has(token),false);
});
test('bound editor token expires and a view ledger record cannot grant editor privilege',()=>{
 const f=fixture(),token=f.bound('device-a');f.advance(3600001);
 assert.equal(f.role(token),null);assert.equal(f._tokens.has(token),false);
 const other=f.bound('device-b');f.accessSecret.devices[f.devDigest('device-b')].role='view';
 assert.equal(f.role(other),null);
});
test('password-only exception is limited to one hour and current password generation',()=>{
 const f=fixture(),token=f.issue('edit',null,{passwordOnly:true});
 assert.equal(f.role(token),'edit');f.advance(3600001);assert.equal(f.role(token),null);
 const another=f.issue('edit',null,{passwordOnly:true});f.accessSecret.gen++;
 assert.equal(f.role(another),null);assert.equal(f._passwordOnlyEditSessions.has(another),false);
});
test('targeted editor revocation removes only its bound sessions and all unbound exceptions',()=>{
 const f=fixture(),a=f.bound('device-a'),b=f.bound('device-b'),passwordOnly=f.issue('edit',null,{passwordOnly:true});
 f._tokens.set('legacy-session',1794480000000+3600000);f._vtokens.set('viewer-session',1794480000000+3600000);
 f.revoke([f.devDigest('device-a')]);
 assert.equal(f._tokens.has(a),false);assert.equal(f._tokens.has(passwordOnly),false);assert.equal(f._tokens.has('legacy-session'),false);
 assert.equal(f.role(b),'edit');assert.equal(f._vtokens.has('viewer-session'),true);
 assert.equal(f._editSessionDevices.has(a),false);assert.equal(f._passwordOnlyEditSessions.has(passwordOnly),false);
});
