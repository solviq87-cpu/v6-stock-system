'use strict';
const {spawn}=require('node:child_process');
const crypto=require('node:crypto');
const http=require('node:http'),net=require('node:net'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
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
  const endpoints=['/api/research/capabilities','/api/research/scan','/api/research/ledger','/api/research/cache-scan','/api/research/cache-ledger','/api/research/disk-save','/api/research/disk-scan','/api/research/disk-ledger'];
  let checks=0;
  for(const url of endpoints){const r=await request(p,url,url.endsWith('capabilities')?'GET':'POST',url.endsWith('capabilities')?null:{});assert.notEqual(r.body?.ok,true,'anonymous allowed '+url);checks++;}
  const login=await request(p,'/api/lock/unlock','POST',{password:'isolated-test-password',role:'edit',fp:'isolated-http-test'});assert.equal(login.body?.ok,true,JSON.stringify(login.body));checks++;
  const token=login.body.token;assert.ok(token);checks++;
  const cap=await request(p,'/api/research/capabilities','GET',null,token);assert.equal(cap.body?.ok,true,JSON.stringify(cap.body));checks++;
  const bars=Array.from({length:46},(_,i)=>{const close=10+i*.04;return {open:close,high:close+.1,low:close-.1,close,volume:1e6};});
  const payload={stocks:[{symbol:'000001',market:'main',feed:{source:'imported',timestamp:Date.now()},bars}],start:27,end:39};
  for(const url of ['/api/research/scan','/api/research/ledger']){
   const r=await request(p,url,'POST',payload,token);assert.equal(r.body?.ok,true,url+': '+JSON.stringify(r.body).slice(0,500));checks++;
   assert.equal(r.body.verifiedLive,false);checks++;
  }
  const spoof=await request(p,'/api/research/scan','POST',{stocks:[{...payload.stocks[0],feed:{source:'eastmoney',timestamp:Date.now()}}]},token);
  assert.equal(spoof.body?.ok,false);checks++;
  const huge=await request(p,'/api/research/scan','POST',{stocks:[],padding:'x'.repeat(2*1024*1024)},token);
  assert.equal(huge.body?.ok,false);checks++;
  const disk=await request(p,'/api/research/disk-scan','POST',{},token);assert.equal(disk.body?.ok,false);checks++;
  console.log('PASS '+checks+' real HTTP checks in isolated QD_CLOUD mode');
 }finally{child.kill('SIGTERM');await delay(300);if(child.exitCode===null)child.kill('SIGKILL');fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
