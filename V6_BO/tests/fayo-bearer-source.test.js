'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createFixture}=require('./helpers/v6-studio-fixture');
test('new native client keeps Bearer identity across status, holdings, native source and password operations',async()=>{
 const server=await createFixture({count:2});
 try{
  assert.equal((await server.request('/api/lock/status')).body.role,'edit','remote Bearer is the same identity as the existing session');
  const holdings=await server.request('/api/holdings');assert.equal(holdings.body.ok,true);assert.ok(Array.isArray(holdings.body.items));
  const file='public/nova/client.js',source=await server.request('/api/source?file='+encodeURIComponent(file));
  assert.equal(source.body.ok,true);assert.match(source.body.content,/export function createClient/);
  const saved=await server.request('/api/source','POST',{file,content:source.body.content+'\n// isolated ESM source save\n'});
  assert.equal(saved.body.ok,true,'the new native module can be saved through the existing protected source workflow');
  const target=path.join(server.tmp,file),before=fs.readFileSync(target,'utf8');
  const invalid=await server.request('/api/source','POST',{file,content:'export const = invalid;'});
  assert.equal(invalid.body.ok,false);assert.match(invalid.body.error,/语法/);assert.equal(fs.readFileSync(target,'utf8'),before,'invalid ESM never replaces the running source');
  const exported=await server.request('/api/source-all');assert.equal(exported.body.ok,true);assert.match(exported.body.source,/source: public\/nova\/app\.js/);assert.match(exported.body.source,/source: public\/nova\/market-evidence\.js/);
  const setView=await server.request('/api/lock/change','POST',{role:'view',newPassword:'fayo-isolated-view-password'});assert.equal(setView.body.ok,true,'Bearer editor can configure viewer access');
  const login=(await server.request('/api/lock/unlock','POST',{role:'view',password:'fayo-isolated-view-password',fp:'fayo-source-viewer',name:'source-viewer'},'')).body;
  assert.equal(login.pending,true);assert.equal((await server.request('/api/lock/pending-approve','POST',{req:login.req,allow:true})).body.ok,true);
  const token=(await server.request('/api/lock/pending-status?req='+login.req,'GET',null,'')).body.token;assert.ok(token);
  assert.equal((await server.request('/api/lock/status','GET',null,token)).body.role,'view');
  for(const endpoint of ['/api/source?file=public%2Fnova%2Fapp.js','/api/holdings']){const denied=await server.request(endpoint,'GET',null,token);assert.notEqual(denied.body.ok,true,endpoint+' remains private');assert.equal(denied.body.content,undefined);assert.equal(denied.body.items,undefined);}
  const changed=await server.request('/api/lock/change','POST',{password:server.password,newPassword:'fayo-isolated-new-editor-password'});assert.equal(changed.body.ok,true,'valid current password plus Bearer can change developer password');
  assert.ok(changed.body.token,'server issues a replacement session');
  assert.equal((await server.request('/api/lock/status')).body.role,null,'old session is invalid after password change');
 }finally{await server.close();}
});
