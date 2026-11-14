'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPaperAuthorityStore}=require('../src/core/paper-authority-store');
function setup(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-authority-'));const file=path.join(dir,'paper.json');return {dir,file,open:()=>createPaperAuthorityStore(file)}}
const acc=(cash=1000,shares=0)=>({pool:{cash,positions:shares?{'600000':{shares}}:{},trades:[]},pre:{cash:500,positions:{},trades:[]}});
test('单文件同时提交账户状态和事件并可重启恢复',()=>{const f=setup();const a=f.open();a.commit(acc(),{type:'initialize'});a.commit(acc(900,100),{type:'auto-buy',detail:{code:'600000'}});const b=f.open().read();assert.equal(b.pool.cash,900);assert.equal(b.pool.positions['600000'].shares,100);assert.equal(b.__authority.events.length,2);assert.equal(b.__authority.events[1].type,'auto-buy');});
test('非法交易不得修改内存或文件',()=>{const f=setup();const a=f.open();a.commit(acc());const original=fs.readFileSync(f.file,'utf8');assert.throws(()=>a.commit(acc(-1)),/不合法/);assert.equal(fs.readFileSync(f.file,'utf8'),original);assert.equal(a.read().pool.cash,1000)});
test('权威文件损坏不得静默重置',()=>{const f=setup();f.open().commit(acc());const doc=JSON.parse(fs.readFileSync(f.file));doc.pool.cash=999999;fs.writeFileSync(f.file,JSON.stringify(doc));assert.throws(()=>f.open(),/校验失败/)});
test('旧文件原位迁移，不创建第二账户文件',()=>{const f=setup();fs.writeFileSync(f.file,JSON.stringify(acc(700,100)));const a=f.open();assert.equal(a.read().pool.cash,700);a.commit(acc(650,100),{type:'legacy-commit'});assert.equal(fs.readdirSync(f.dir).length,1);assert.equal(f.open().read().pool.cash,650)});
