 'use strict';
const {spawn}=require('node:child_process');
const http=require('node:http');
const assert=require('node:assert/strict');
const path=require('node:path');
const net=require('node:net');
const fs=require('node:fs');
async function port(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
function get(port,url){return new Promise((resolve,reject)=>{const req=http.get({hostname:'127.0.0.1',port,path:url,timeout:1000},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>resolve({status:res.statusCode,body:b,headers:res.headers}));});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('timeout')));});}
(async()=>{
 const p=await port();
 const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(p),HOST:'127.0.0.1',V6_ISOLATED_BOOT_SMOKE:'1'},stdio:['ignore','pipe','pipe']});
 let logs=''; child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
 try {
  let ready=false;
  for(let i=0;i<60;i++){
   if(child.exitCode!==null)throw Error('server exited: '+logs.slice(-1500));
   try{const r=await get(p,'/api/lock/status');if(r.status===200){ready=true;break;}}catch{}
   await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(ready,'完整 server.js 未在6秒内提供状态接口：'+logs.slice(-1000));
  const status=await get(p,'/api/lock/status');assert.equal(status.status,200);
  const parsed=JSON.parse(status.body);assert.ok(typeof parsed==='object');
  assert.ok(!Object.hasOwn(parsed,'devPwd')&&!Object.hasOwn(parsed,'viewPwd'));
  const index=await get(p,'/');assert.equal(index.status,200);assert.match(index.body,/<!doctype html|<html/i);
  const missing=await get(p,'/nonexistent-test-asset-xyz');assert.equal(missing.status,404);
  console.log('PASS: 完整 server.js 启动、状态 API 不回显密码、首页、404');
 } finally {child.kill('SIGTERM');await new Promise(r=>{if(child.exitCode!==null||child.signalCode!==null)return r();child.once('exit',r);setTimeout(r,1000);});}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
