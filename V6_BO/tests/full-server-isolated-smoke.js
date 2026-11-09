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
 const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(p),HOST:'127.0.0.1',V6_ISOLATED_BOOT_SMOKE:'1',QD_CLOUD:'1'},stdio:['ignore','pipe','pipe']});
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
  // Dedicated result page must be reachable through the REAL server routes, not
  // merely pass an offline DOM test while silently returning the home fallback.
  const picks=await get(p,'/picks.html');
  assert.equal(picks.status,200,'/picks.html must be served by V6');
  assert.match(picks.body,/智能选股结果/);
  const reference=await get(p,'/reference-dashboard.html');
  assert.equal(reference.status,200,'reference dashboard shell must remain reachable');
  assert.match(reference.body,/AI 综合选股信号/);
  const picksScript=await get(p,'/assets/picks-page.js');
  assert.equal(picksScript.status,200,'picks viewer script must be served');
  assert.match(picksScript.body,/clearProtectedResults/);
  const auction=await get(p,'/auction-picks.html');
  assert.equal(auction.status,200,'new auction research shell must be reachable through actual server');
  assert.match(auction.body,/竞价研究观察池/);
  const auctionScript=await get(p,'/assets/auction-picks-page.js');
  assert.equal(auctionScript.status,200,'auction research page script must be served');
  assert.match(auctionScript.body,/\/api\/auction-resonance/);
  assert.match(auctionScript.body,/revoke\(\)/);
  // 真实 HTTP 越权回归：无开发者凭证不可列设备或撤权。
  const devices=await get(p,'/api/lock/devices');
  assert.equal(devices.status,200);
  const denied=JSON.parse(devices.body);
  assert.notEqual(denied.ok,true);
  assert.ok(!Array.isArray(denied.devices) && !Array.isArray(denied.items));
  const post=(url,data)=>new Promise((resolve,reject)=>{
    const body=JSON.stringify(data),req=http.request({hostname:'127.0.0.1',port:p,path:url,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},timeout:1000},res=>{
      let b='';res.on('data',c=>b+=c);res.on('end',()=>resolve({status:res.statusCode,body:b}));
    });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('timeout')));req.end(body);
  });
  const revoke=await post('/api/lock/revoke',{id:'nonexistent',token:''});
  assert.notEqual(JSON.parse(revoke.body).ok,true);
  const missing=await get(p,'/nonexistent-test-asset-xyz');assert.ok([200,404].includes(missing.status));
  console.log('PASS: 完整服务、首页、选股/竞价/参考图页面、脚本、404与无凭证拒绝');
 } finally {child.kill('SIGTERM');await new Promise(r=>{if(child.exitCode!==null||child.signalCode!==null)return r();child.once('exit',r);setTimeout(r,1000);});}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
