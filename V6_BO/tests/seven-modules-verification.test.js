'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {groups}=require('../scripts/verify-seven-modules');
test('七大模块都有独立可执行的离线验证入口',()=>{
 assert.deepEqual(Object.keys(groups),['market','strategies','backtest','paper','risk','accounts','interfaces']);
 for(const files of Object.values(groups)){
  assert.ok(files.length>=2);
  for(const name of files){assert.match(name,/^[a-z0-9-]+\.test\.js$/);assert.ok(fs.statSync(path.join(__dirname,name)).isFile());}
 }
});
test('离线联动报告明确禁止以本地测试代替生产验收',()=>{
 const src=fs.readFileSync(require.resolve('../scripts/verify-seven-modules'),'utf8');
 assert.match(src,/productionAccepted:false/);assert.match(src,/verifiedLive:false/);assert.match(src,/canTrade:false/);
 assert.match(src,/externalBlockers/);
});
