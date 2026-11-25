'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const {createConditionalAuthorizer} = require('../src/core/paper-conditional-authorization');
const planId = 'plan-00000000-0000-4000-8000-000000000001', otherPlan = 'plan-00000000-0000-4000-8000-000000000002';
const principal = 'a'.repeat(64), at = Date.parse('2026-11-25T10:00:00+08:00');
function fixture() {
  const state = {access:{gen:3,devices:{[principal]:{role:'edit'}},revoked:{}}, key:'fixture-only-machine-key-for-signed-intents', cloud:true, session:true};
  return {state, auth:createConditionalAuthorizer({getAccess:()=>state.access,getMachineKey:()=>state.key,
    isCloud:()=>state.cloud,clock:()=>at,liveSession:()=>state.session})};
}
test('durable intent is bound to its original plan, device, password generation and instance', () => {
  const {state,auth} = fixture(), issued = auth.issue({planId,editor:true,deviceDigest:principal});
  assert.equal(auth.verify(issued,planId),true);
  assert.equal(auth.verify(issued,otherPlan),false);
  assert.equal(auth.verify({...issued,planId:otherPlan},otherPlan),false);
  assert.equal(auth.verify({...issued,principal:'b'.repeat(64)},planId),false);
  assert.equal(auth.verify({...issued,issuedAt:at+1},planId),false);
  assert.equal(auth.verify({...issued,extra:true},planId),false);
  state.access.gen++; assert.equal(auth.verify(issued,planId),false);
  state.access.gen--; state.key+='-other-instance'; assert.equal(auth.verify(issued,planId),false);
});
test('revocation and device removal stop queued execution without changing access state', () => {
  const {state,auth} = fixture(), issued = auth.issue({planId,editor:true,deviceDigest:principal});
  state.access.revoked[principal]={at,reason:'user-revoked'};
  const before=JSON.stringify(state.access);assert.equal(auth.verify(issued,planId),false);assert.equal(JSON.stringify(state.access),before);
  state.access.revoked[principal]={graceUntil:at+1000};assert.equal(auth.verify(issued,planId),true);
  assert.equal(auth.verify(issued,planId,at+1000),false);
  delete state.access.revoked[principal];delete state.access.devices[principal];assert.equal(auth.verify(issued,planId),false);
  state.access.devices[principal]={role:'view'};assert.equal(auth.verify(issued,planId),false);
  assert.throws(()=>auth.issue({planId,editor:true,deviceDigest:principal}),/授权/);
  assert.throws(()=>auth.issue({planId,editor:false,deviceDigest:principal}),/编辑者/);
});
test('password-only sessions never persist credentials and cannot resume after the original process loses them', () => {
  const {state,auth} = fixture(), sessionToken = 'fixture-secret-token-that-must-never-be-stored';
  const issued=auth.issue({planId,editor:true,sessionToken,sessionExpiresAt:at+3600000});
  assert.equal(JSON.stringify(issued).includes(sessionToken),false);
  assert.equal(issued.principal,crypto.createHash('sha256').update(sessionToken).digest('hex'));
  assert.equal(auth.verify(issued,planId),true);
  state.session=false;assert.equal(auth.verify(issued,planId),false);
  state.session=true;assert.equal(auth.verify(issued,planId,at+3600000),false);
});
test('local intent stays within the original local exemption and never becomes a cloud authorization', () => {
  const {state,auth}=fixture();state.cloud=false;
  const issued=auth.issue({planId,editor:true,local:true});assert.equal(auth.verify(issued,planId),true);
  state.cloud=true;assert.equal(auth.verify(issued,planId),false);
  assert.throws(()=>auth.issue({planId,editor:true,local:true}),/授权设备/);
  state.cloud=false;state.access.gen++;assert.equal(auth.verify(issued,planId),false);
});
