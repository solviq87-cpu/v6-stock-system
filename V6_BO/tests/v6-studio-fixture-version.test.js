'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createFixture,adaptLegacyFrontendSource}=require('./helpers/v6-studio-fixture');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const version=source=>source.match(/^const APP_VER = '([0-9]{8}[a-z]{2})';/m)?.[1];
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
const service=read('server.js'),controller=read('public/assets/app.js');

test('legacy fixture version and route adaptation requires exactly one declaration and mapping',()=>{
 const adapted=adaptLegacyFrontendSource(service,controller);
 assert.equal(version(adapted),version(controller));
 assert.equal((adapted.match(/^const APP_VER = /gm)||[]).length,1);
 assert.doesNotMatch(adapted,/if \(fayoEntries\.has\(p\)\) p = '\/nova\/index\.html'/);
 assert.match(service,/if \(fayoEntries\.has\(p\)\) p = '\/nova\/index\.html'/,'input source is untouched');
 for(const invalid of [service.replace(/^const APP_VER = '[^']+';/m,''),service+"\nconst APP_VER = '20260101aa';\n"])
  assert.throws(()=>adaptLegacyFrontendSource(invalid,controller),/service version declaration missing or ambiguous/);
 for(const invalid of ['',controller+"\nconst APP_VER = '20260101aa';\n"])
  assert.throws(()=>adaptLegacyFrontendSource(service,invalid),/controller version declaration missing or ambiguous/);
 assert.throws(()=>adaptLegacyFrontendSource(service.replace('  const fayoEntries = new Set','  const removedEntries = new Set'),controller),/native entry anchor missing or ambiguous/);
});

test('actual fixture status matches its selected frontend without writing original product files',async()=>{
 const files=['server.js','public/nova/index.html','public/sw.js','public/index.html','public/mobile.html','public/assets/app.js'];
 const before=files.map(digest);
 for(const legacyFrontend of [false,true]){
  const fixture=await createFixture({count:1,legacyFrontend});
  try{
   const status=await fixture.request('/api/lock/status');
   assert.equal(status.status,200);
   const expected=version(legacyFrontend?controller:service);
   assert.equal(status.body.appVer,expected,'status describes the frontend actually served by this fixture');
   assert.equal(version(fs.readFileSync(path.join(fixture.tmp,'server.js'),'utf8')),expected);
   for(const entry of ['/','/m']){
    const response=await fixture.request(entry,'GET',null,'');
    assert.equal(response.status,200);
    if(legacyFrontend){assert.doesNotMatch(response.raw,/\/nova\/app\.js/);if(entry==='/m')assert.equal(version(response.raw),expected);}
    else assert.equal(response.raw.match(/name="application-version" content="([^"]+)"/)?.[1],expected);
   }
   assert.deepEqual(files.map(digest),before,'only the disposable server copy may change');
  }finally{await fixture.close();}
 }
 assert.deepEqual(files.map(digest),before,'fixture shutdown also leaves all product source bytes unchanged');
});
