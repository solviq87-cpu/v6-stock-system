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
test('server, desktop JS, mobile and PWA cache all use one deployment version',()=>{
 const versionMain=version('server.js');
 for(const f of ['public/assets/app.js','public/mobile.html','public/sw.js']){
  assert.equal(version(f),versionMain,`版本不一致: ${f}`);
 }
 assert.ok(read('public/index.html').includes('/assets/app.js?v='+versionMain));
});
