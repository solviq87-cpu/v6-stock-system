'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {buildSession,saveSession,loadSession,recoverSession}=require('../src/core/paper-session');
function dataset(n){return {source:'fixture',asOf:'2026-04-30',stocks:[{code:'000001',name:'测试',market:'main',bars:Array.from({length:n},(_,i)=>({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),open:10,high:11,low:9,close:10,volume:1000}))}]};}
function temp(fn){const d=fs.mkdtempSync(path.join(os.tmpdir(),'v6-recovery-'));try{return fn(path.join(d,'account.json'));}finally{fs.rmSync(d,{recursive:true,force:true});}}
test('每次版本更新前保留可校验备份，损坏后需要显式恢复',()=>temp(f=>{
 const first=buildSession(dataset(40)).session;saveSession(f,first);
 const second=buildSession(dataset(41),{},loadSession(f)).session;saveSession(f,second);
 assert.equal(loadSession(f+'.bak').revision,1);
 assert.throws(()=>recoverSession(f),/当前账户有效/);
 fs.writeFileSync(f,'{broken');
 assert.equal(recoverSession(f).restored,false);
 assert.throws(()=>loadSession(f));
 assert.equal(recoverSession(f,{dryRun:false}).restored,true);
 assert.equal(loadSession(f).revision,1);
}));
test('拒绝用损坏账户覆盖备份、拒绝跳版本及符号链接目标',()=>temp(f=>{
 const first=buildSession(dataset(40)).session;saveSession(f,first);
 const second=buildSession(dataset(41),{},first).session;
 const skip={...second,revision:3};assert.throws(()=>saveSession(f,skip),/不连续/);
 fs.writeFileSync(f,'corrupted');assert.throws(()=>saveSession(f,second),/Unexpected token|JSON|完整性/);
}));
test('账户备份路径不允许符号链接',()=>temp(f=>{
 const first=buildSession(dataset(40)).session;saveSession(f,first);
 const second=buildSession(dataset(41),{},first).session;
 fs.symlinkSync(f,f+'.bak');assert.throws(()=>saveSession(f,second),/符号链接/);
}));
