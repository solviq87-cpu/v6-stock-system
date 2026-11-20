'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {sessionHeaderToken}=require('../src/server/session-header-token');
test('session headers retain Bearer precedence and accept the same bounded application credential',()=>{
 assert.equal(sessionHeaderToken({headers:{authorization:'Bearer bearer-session', 'x-qd-token':'application-session'}}),'bearer-session');
 assert.equal(sessionHeaderToken({headers:{authorization:'Basic fixture-gateway', 'x-qd-token':'application-session'}}),'application-session');
 assert.equal(sessionHeaderToken({headers:{'x-qd-token':'application-session'}}),'application-session');
 assert.equal(sessionHeaderToken({headers:{authorization:'bearer '+'.'.repeat(8)}}),'.'.repeat(8));
 assert.equal(sessionHeaderToken({headers:{'x-qd-token':'A'.repeat(256)}}),'A'.repeat(256));
});
test('header parsing never accepts malformed, multi-valued, URL or body credentials',()=>{
 for(const invalid of ['short','x'.repeat(257),'has whitespace','Bearer application-session','token,other',[],['fixture-token'],{}]){
  assert.equal(sessionHeaderToken({headers:{'x-qd-token':invalid}}),'');
 }
 assert.equal(sessionHeaderToken({headers:{authorization:['Bearer fixture-token']}}),'');
 assert.equal(sessionHeaderToken({headers:{},url:'/?token=fixture-token',body:{token:'fixture-token'}}),'');
 assert.equal(sessionHeaderToken(null),'');
});
