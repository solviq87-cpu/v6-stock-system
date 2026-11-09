'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const version=s=>{
 const m=s.match(/const APP_VER = '([^']+)'/);
 assert.ok(m,'APP_VER declaration missing');
 return m[1];
};
test('service, phone and service worker use a single release cache version',()=>{
 const server=version(read('server.js'));
 const mobile=version(read('public/mobile.html'));
 const sw=version(read('public/sw.js'));
 assert.equal(server,mobile);
 assert.equal(server,sw);
 assert.equal(server,'20261109cr');
 assert.ok(read('public/index.html').includes('/assets/app.js?v='+server));
 assert.ok(read('public/index.html').includes('/assets/stock-provider-links.js?v='+server));
});
test('research UI script URL is bumped after explanation and episode changes',()=>{
 const html=read('public/research.html');
 assert.ok(html.includes('/assets/complete-workbench.js?v=20261109rps1'));
 assert.ok(!html.includes('complete-workbench.js?v=20261109qualityaudit4'));
 const js=read('public/assets/complete-workbench.js');
 assert.ok(js.includes('temporalOverlapDiagnostics'));
 assert.ok(js.includes('sectorCohortRps'));
});
