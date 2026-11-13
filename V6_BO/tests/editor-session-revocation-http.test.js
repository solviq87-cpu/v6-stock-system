'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const {createFixture}=require('./helpers/v6-studio-fixture');
const digest=t=>crypto.createHash('sha256').update(t).digest('hex');
test('actual editor login short and long tokens lose access together when their device is revoked',async t=>{
 const server=await createFixture({count:1,serverSource:process.env.V6_AUTH_BASELINE_SOURCE?fs.readFileSync(process.env.V6_AUTH_BASELINE_SOURCE,'utf8'):undefined});
 t.after(()=>server.close());
 const login=async(fp)=>{
  const d=(await server.request('/api/lock/unlock','POST',{password:server.password,role:'edit',fp,name:fp},'')).body;
  assert.equal(d.ok,true);assert.ok(d.token);assert.ok(d.deviceToken);return d;
 };
 const a=await login('editor-device-a'),b=await login('editor-device-b');
 const privateRead=tok=>server.request('/api/paper','GET',null,tok);
 for(const token of [a.token,a.deviceToken,b.token,b.deviceToken])assert.equal((await privateRead(token)).body.ok,true);
 const revoked=await server.request('/api/lock/revoke','POST',{id:digest(a.deviceToken)});
 assert.equal(revoked.body.ok,true);assert.equal(revoked.body.revoked,1);
 for(const [kind,token] of [['short',a.token],['long',a.deviceToken]]){
  const denied=(await privateRead(token)).body;
  assert.equal(denied.locked,true,kind+' session must not survive actual corresponding device revocation');
  assert.notEqual(denied.ok,true);assert.equal(denied.paper,undefined);
 }
 for(const token of [b.token,b.deviceToken,server.token])assert.equal((await privateRead(token)).body.ok,true,'another physical device must remain authorized');
 const relogged=await login('editor-device-a');assert.equal((await privateRead(relogged.token)).body.ok,true);
 assert.equal((await privateRead(a.token)).body.locked,true,'new login must not resurrect a revoked short session');
});

test('password-change-only short login remains usable and loses access on subsequent editor device revocation',async t=>{
 const server=await createFixture({count:1});t.after(()=>server.close());
 const changed=(await server.request('/api/lock/change','POST',{password:server.password,newPassword:'studio-new-password-only',role:'edit',token:server.token})).body;
 assert.equal(changed.ok,true);assert.ok(changed.token);assert.equal(changed.deviceToken,undefined,'password operation does not silently grant a long-lived device');
 assert.equal((await server.request('/api/paper','GET',null,changed.token)).body.ok,true);
 const login=(await server.request('/api/lock/unlock','POST',{password:'studio-new-password-only',role:'edit',fp:'new-editor-device'},'')).body;
 assert.equal(login.ok,true);
 const revoked=await server.request('/api/lock/revoke','POST',{id:digest(login.deviceToken)},changed.token);
 assert.equal(revoked.body.revoked,1);
 assert.equal((await server.request('/api/paper','GET',null,changed.token)).body.locked,true,'password-only exception is explicitly invalidated by editor device revocation');
});
