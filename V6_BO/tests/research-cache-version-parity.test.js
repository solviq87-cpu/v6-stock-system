'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const version=s=>{
 const m=s.match(/const APP_VER = '([0-9]{8}[a-z]{2})'/);
 assert.ok(m,'APP_VER declaration missing');
 return m[1];
};
test('official desktop and phone native entry, service and worker use a single release cache version',()=>{
 const server=version(read('server.js'));
 const sw=version(read('public/sw.js'));
 const native=read('public/nova/index.html').match(/<meta name="application-version" content="([0-9]{8}[a-z]{2})"/);
 assert.ok(native,'official native entry release metadata is required');
 assert.equal(server,native[1]);
 assert.equal(server,sw);
 assert.equal(server,'20261126ab');
 for(const resource of ['/nova/app.js','/nova/fayo.css']){
  assert.ok(read('public/nova/index.html').includes(resource+'?v='+server),'native '+resource+' cache query matches this release');
  assert.ok(read('public/sw.js').includes(resource+'?v='+server),'worker precaches this release of '+resource);
 }
});
test('legacy recovery desktop and phone retain their historical version and exact approved bytes',()=>{
 const legacyVersion='20261115dc';
 assert.equal(version(read('public/mobile.html')),legacyVersion);
 assert.equal(version(read('public/assets/app.js')),legacyVersion);
 assert.ok(read('public/index.html').includes('/assets/app.js?v='+legacyVersion));
 assert.ok(read('public/index.html').includes('/assets/stock-provider-links.js?v='+legacyVersion));
 const approved=require('./fixtures/ui-homepage-approved-baseline-20261115.json');
 for(const name of ['index.html','mobile.html']){
  const bytes=fs.readFileSync(path.join(root,'public',name));
  const blob=crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex');
  assert.equal(blob,approved.homepages[name],name+' recovery evidence bytes remain frozen');
 }
 assert.equal(crypto.createHash('sha256').update(read('public/assets/app.js')).digest('hex'),'f4efdbb54b15325747e8924aa3ce4f37dd17aa642ca756d51c8c1c57e7fc5097','legacy controller bytes remain frozen');
});
test('research UI script URL is bumped after explanation and episode changes',()=>{
 const html=read('public/research.html');
 assert.ok(html.includes('/assets/complete-workbench.js?v=20261109yellowfour1'));
 assert.ok(!html.includes('complete-workbench.js?v=20261109daily1'));
 assert.ok(!html.includes('complete-workbench.js?v=20261109qualityaudit4'));
 const js=read('public/assets/complete-workbench.js');
 assert.ok(js.includes('temporalOverlapDiagnostics'));
 assert.ok(js.includes('sectorCohortRps'));
});
