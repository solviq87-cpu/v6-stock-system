'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
function version(f){
 const m=read(f).match(/\bconst APP_VER\s*=\s*'([0-9]{8}[a-z]{2})'/);
 assert.ok(m,`缺少版本变量: ${f}`);return m[1];
}
test('server, official native desktop/phone entry and PWA cache use one deployment version',()=>{
 const versionMain=version('server.js');
 assert.equal(version('public/sw.js'),versionMain,'正式缓存版本不一致');
 const entry=read('public/nova/index.html');
 assert.equal(entry.match(/name="application-version" content="([^"]+)"/)?.[1],versionMain,'正式双端入口版本不一致');
 assert.ok(entry.includes('/nova/app.js?v='+versionMain));
 assert.ok(entry.includes('/nova/fayo.css?v='+versionMain));
});
test('legacy desktop JS and phone keep the retained recovery release version',()=>{
 assert.equal(version('public/assets/app.js'),'20261115dc');
 assert.equal(version('public/mobile.html'),'20261115dc');
 assert.ok(read('public/index.html').includes('/assets/app.js?v=20261115dc'));
});
