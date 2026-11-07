'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
test('offline privacy gate enforces current fail-closed private-notification policy',()=>{
 const audit=path.join(__dirname,'..','_test_priv_no_leak.js');
 const result=spawnSync(process.execPath,[audit],{encoding:'utf8',timeout:10000});
 assert.equal(result.error,undefined,String(result.error));
 assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
 assert.match(result.stdout,/私密不外泄静态审计：21通过 \/ 0失败/);
});
