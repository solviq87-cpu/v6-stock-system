'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {sameOriginOk,initialSetupAuthorized}=require('../src/server/request-security');
const req=(headers={})=>({headers:{host:'localhost:8787',...headers},socket:{encrypted:false}});
const secret='isolated-bootstrap-secret-32-characters',env={RENDER:'true',QD_SETUP_TOKEN:secret};
test('Origin must identify one HTTP origin, never a normalized path, fragment or malformed header',()=>{
 for(const origin of ['http://localhost:8787/path','http://localhost:8787/','http://localhost:8787?x=1','http://localhost:8787#x',' http://localhost:8787','http://local\nhost:8787','http://localhost:8787\\path','http://localhost:8787,http://other.test'])
  assert.equal(sameOriginOk(req({origin}),{}),false,origin);
});
test('malformed direct host cannot be normalized into a permitted source',()=>{
 for(const host of ['localhost:8787\\path','local\nhost:8787','localhost:8787/','localhost:8787?x'])
  assert.equal(sameOriginOk(req({host,origin:'http://localhost:8787'}),{}),false,host);
});
test('bootstrap capability must be unambiguous across supplied header and body',()=>{
 for(const [header,body] of [[secret,'wrong'],['',secret],[null,secret],[secret,null],[secret,['wrong']],[['wrong'],secret]])
  assert.equal(initialSetupAuthorized(req({'x-v6-setup-token':header}),{setupToken:body},env),false);
 assert.equal(initialSetupAuthorized(req({'x-v6-setup-token':secret}),{setupToken:secret},env),true);
});
test('valid same-origin browser, proxy, native and one-channel setup contracts remain',()=>{
 assert.equal(sameOriginOk(req({origin:'http://localhost:8787',referer:'http://localhost:8787/panel?q=1'}),{}),true);
 assert.equal(sameOriginOk(req({origin:'https://host.fixture.ts.net',referer:'https://host.fixture.ts.net/panel'}),{QD_PUBLIC_URL:'https://host.fixture.ts.net/panel'}),true);
 assert.equal(sameOriginOk(req({origin:'http://[::1]:8787',host:'[::1]:8787'}),{}),true);
 assert.equal(sameOriginOk(req(),{}),true);
 assert.equal(sameOriginOk(req({'sec-fetch-site':'cross-site'}),{}),false);
 assert.equal(initialSetupAuthorized(req(),{setupToken:secret},env),true);
 assert.equal(initialSetupAuthorized(req({'x-v6-setup-token':secret}),{},env),true);
 assert.equal(initialSetupAuthorized(req(),{},{}),true);
});
