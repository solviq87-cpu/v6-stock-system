'use strict';
const {spawn}=require('node:child_process');
const crypto=require('node:crypto');
const http=require('node:http'),net=require('node:net'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
// SSE 是长连接：只读取首个响应块，不等待连接结束。
const streamProbe=(port,token='')=>new Promise((resolve,reject)=>{
 const suffix=token?'?token='+encodeURIComponent(token):'';
 const req=http.get({hostname:'127.0.0.1',port,path:'/api/stream'+suffix,timeout:3000},res=>{
  const status=res.statusCode,contentType=res.headers['content-type']||'';
  res.once('data',chunk=>{resolve({status,contentType,chunk:String(chunk)});res.destroy();});
  res.once('end',()=>resolve({status,contentType,chunk:''}));
  res.once('error',reject);
 });
 req.once('error',reject);req.once('timeout',()=>req.destroy(Error('SSE probe timeout')));
});

const port=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const request=(port,url,method='GET',obj=null,token='')=>new Promise((resolve,reject)=>{
 const body=obj===null?'':JSON.stringify(obj);
 const req=http.request({hostname:'127.0.0.1',port,path:url,method,timeout:3000,headers:{...(body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{}),...(token?{'Authorization':'Bearer '+token}:{})}},res=>{
  let data='';res.on('data',d=>data+=d);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(data)});}catch{resolve({status:res.statusCode,raw:data});}});
 });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('request timeout')));req.end(body);
});
(async()=>{
 const p=await port(),source=path.resolve(__dirname,'..');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'v6-http-'));
 // No user accounts, cache, passwords or holdings copied: isolated temp deployment.
 const copy=(rel)=>{const src=path.join(source,rel),dst=path.join(tmp,rel);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.cpSync(src,dst,{recursive:true});};
 for(const rel of ['server.js','src','strategies','public','package.json'])if(fs.existsSync(path.join(source,rel)))copy(rel);
 for(const f of fs.readdirSync(source))if(f.endsWith('.js')&&f!=='server.js')copy(f);
 const salt=crypto.randomBytes(16).toString('hex');
 fs.writeFileSync(path.join(tmp,'access.json'),JSON.stringify({salt,hash:crypto.scryptSync('isolated-test-password',salt,32).toString('hex'),devices:{}}));
 const child=spawn(process.execPath,['server.js'],{cwd:tmp,env:{...process.env,PORT:String(p),HOST:'127.0.0.1',QD_CLOUD:'1',V6_ISOLATED_BOOT_SMOKE:'1',V6_RESEARCH_CACHE_DIR:path.join(tmp,'empty-cache')},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 try{
  let ready=false;for(let i=0;i<80;i++){if(child.exitCode!==null)throw Error('server exited '+logs.slice(-1000));try{const r=await request(p,'/api/lock/status');if(r.status===200){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,'server not ready '+logs.slice(-1000));
  const anonymousStream=await streamProbe(p);assert.ok(!/text\/event-stream/.test(anonymousStream.contentType),'匿名请求不可进入 SSE');
  const invalidStream=await streamProbe(p,'invalid-token');assert.ok(!/text\/event-stream/.test(invalidStream.contentType),'无效令牌不可进入 SSE');
  const endpoints=['/api/lock/devices','/api/research/capabilities','/api/research/scan','/api/research/ledger','/api/research/cache-scan','/api/research/cache-ledger','/api/research/disk-save','/api/research/disk-scan','/api/research/disk-ledger'];
  let checks=0;
  for(const url of endpoints){const r=await request(p,url,url.endsWith('capabilities')?'GET':'POST',url.endsWith('capabilities')?null:{});assert.notEqual(r.body?.ok,true,'anonymous allowed '+url);checks++;}
  const login=await request(p,'/api/lock/unlock','POST',{password:'isolated-test-password',role:'edit',fp:'isolated-http-test'});assert.equal(login.body?.ok,true,JSON.stringify(login.body));checks++;
  const token=login.body.token;assert.ok(token);checks++;
  const editorStream=await streamProbe(p,token);assert.equal(editorStream.status,200,'开发者 SSE 可连接');assert.match(editorStream.contentType,/text\/event-stream/);
  const devices=await request(p,'/api/lock/devices','GET',null,token);assert.equal(devices.body?.ok,true,'Bearer developer should list devices: '+JSON.stringify(devices.body));checks++;
  const cap=await request(p,'/api/research/capabilities','GET',null,token);assert.equal(cap.body?.ok,true,JSON.stringify(cap.body));checks++;
  const bars=Array.from({length:46},(_,i)=>{const close=10+i*.04;return {open:close,high:close+.1,low:close-.1,close,volume:1e6};});
  const payload={stocks:[{symbol:'000001',market:'main',feed:{source:'imported',timestamp:Date.now()},bars}],start:27,end:39};
  for(const url of ['/api/research/scan','/api/research/ledger']){
   const r=await request(p,url,'POST',payload,token);assert.equal(r.body?.ok,true,url+': '+JSON.stringify(r.body).slice(0,500));checks++;
   assert.equal(r.body.verifiedLive,false);checks++;
  }
  const viewSetup=await request(p,'/api/lock/change','POST',{role:'view',newPassword:'isolated-view-password',token},token);
  assert.equal(viewSetup.body?.ok,true,'view password setup '+JSON.stringify(viewSetup.body));checks++;
  const viewLogin=await request(p,'/api/lock/unlock','POST',{role:'view',password:'isolated-view-password',fp:'viewer-test-device',name:'isolated viewer'});
  assert.equal(viewLogin.body?.pending,true,'view must await approval: '+JSON.stringify(viewLogin.body));checks++;
  const requestId=viewLogin.body.req;assert.ok(requestId);checks++;
  const before=await request(p,'/api/lock/pending-status?req='+encodeURIComponent(requestId));assert.equal(before.body?.state,'pending');checks++;
  const pending=await request(p,'/api/lock/pending-list','POST',{},token);assert.equal(pending.body?.ok,true);checks++;
  const approve=await request(p,'/api/lock/pending-approve','POST',{req:requestId,allow:true},token);assert.equal(approve.body?.state,'allowed',JSON.stringify(approve.body));checks++;
  const poll=await request(p,'/api/lock/pending-status?req='+encodeURIComponent(requestId));assert.equal(poll.body?.state,'allowed');checks++;
  const viewToken=poll.body.token;assert.ok(viewToken);checks++;
  const viewerStream=await streamProbe(p,viewToken);assert.equal(viewerStream.status,200,'已批准只读设备可连接 SSE');
  const once=await request(p,'/api/lock/pending-status?req='+encodeURIComponent(requestId));assert.notEqual(once.body?.ok,true);checks++;
  const denied=await request(p,'/api/research/scan','POST',payload,viewToken);assert.notEqual(denied.body?.ok,true,'viewer cannot scan');checks++;
  const deniedDevices=await request(p,'/api/lock/devices','GET',null,viewToken);assert.notEqual(deniedDevices.body?.ok,true,'viewer cannot list devices');checks++;
  const listing=await request(p,'/api/lock/devices','GET',null,token);assert.equal(listing.body?.ok,true);checks++;
  const viewDevice=listing.body.items.find(x=>x.role==='view');assert.ok(viewDevice,'view device missing');checks++;
  const heldStream=await new Promise((resolve,reject)=>{
    const r=http.get({host:'127.0.0.1',port:p,path:'/api/stream?token='+encodeURIComponent(viewToken)},response=>{
      if(response.statusCode!==200){response.resume();reject(new Error('held SSE status '+response.statusCode));return;}
      response.on('data',()=>{});
      let settled=false;
      const closed=new Promise(done=>{response.on('end',()=>{settled=true;done(true)});response.on('close',()=>{if(!settled)done(true)});});
      resolve({closed,request:r});
    });
    r.on('error',reject);
  });
  const revoked=await request(p,'/api/lock/revoke','POST',{id:viewDevice.id},token);assert.equal(revoked.body?.revoked,1,JSON.stringify(revoked.body));checks++;
  const heldClosed=await Promise.race([heldStream.closed,delay(29000).then(()=>false)]);
  assert.equal(heldClosed,true,'已建立的 SSE 应在撤权后 25 秒心跳周期内关闭');checks++;

  const revokedStream=await streamProbe(p,viewToken);assert.ok(!/text\/event-stream/.test(revokedStream.contentType),'已撤销设备不可新建 SSE');
  const afterRevoke=await request(p,'/api/research/scan','POST',payload,viewToken);assert.notEqual(afterRevoke.body?.ok,true,'revoked viewer should be blocked');checks++;
  const refreshDenied=await request(p,'/api/research/history-refresh','POST',{codes:['000001']});assert.notEqual(refreshDenied.body?.ok,true,'historical refresh requires developer');checks++;
  const refreshInvalid=await request(p,'/api/research/history-refresh','POST',{codes:['bad-code']},token);assert.equal(refreshInvalid.body?.ok,false,'historical refresh rejects bad codes');checks++;
  const spoof=await request(p,'/api/research/scan','POST',{stocks:[{...payload.stocks[0],feed:{source:'eastmoney',timestamp:Date.now()}}]},token);
  assert.equal(spoof.body?.ok,false);checks++;
  const huge=await request(p,'/api/research/scan','POST',{stocks:[],padding:'x'.repeat(2*1024*1024)},token);
  assert.equal(huge.body?.ok,false);checks++;
  const disk=await request(p,'/api/research/disk-scan','POST',{},token);assert.equal(disk.body?.ok,false);checks++;
  console.log('PASS '+checks+' real HTTP checks in isolated QD_CLOUD mode');
 }finally{child.kill('SIGTERM');await delay(300);if(child.exitCode===null)child.kill('SIGKILL');fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
