'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const http=require('node:http'),net=require('node:net'),vm=require('node:vm');
const {spawn}=require('node:child_process');
const source=path.resolve(__dirname,'..');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise((resolve,reject)=>{
 const server=net.createServer();server.once('error',reject);
 server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});
});
function request(port,url,token='',payload){
 return new Promise((resolve,reject)=>{
  const req=http.request({method:payload?'POST':'GET',hostname:'127.0.0.1',port,path:url,timeout:3000,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})}},res=>{
   let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>{
    try{resolve({status:res.statusCode,body:JSON.parse(body)});}catch(error){reject(error);}
   });
  });if(payload)req.write(JSON.stringify(payload));req.end();req.on('error',reject);req.on('timeout',()=>req.destroy(Error('HTTP fixture timeout')));
 });
}

test('research agent status and public factor computation require editor rights on real HTTP routes',{timeout:20000},async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'v6-dashboard-privacy-'));
 let child,logs='';
 try{
  // Copy executable assets only: never read or copy live configuration or accounts.
  const copy=relative=>fs.cpSync(path.join(source,relative),path.join(tmp,relative),{recursive:true});
  for(const relative of ['src','scripts','strategies','public','package.json'])copy(relative);
  fs.mkdirSync(path.join(tmp,'config'));copy('config/data-source-catalog.json');copy('config/six-photo-sources.json');
  for(const relative of fs.readdirSync(source))if(relative.endsWith('.js'))copy(relative);
  const editor=crypto.randomBytes(32).toString('hex'),viewer=crypto.randomBytes(32).toString('hex');
  const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
  const account=()=>{const salt=crypto.randomBytes(16).toString('hex');return {salt,hash:crypto.scryptSync('fixture-password-only',salt,32).toString('hex'),devices:{}};};
  const access=account();access.view=account();
  access.devices[digest(editor)]={role:'edit',name:'fixture editor',ts:Date.now()};
  access.view.devices[digest(viewer)]={role:'view',name:'fixture viewer',ts:Date.now()};
  fs.writeFileSync(path.join(tmp,'access.json'),JSON.stringify(access));
  const privateCode='600987',privateTitle='PRIVATE_HISTORY_FIXTURE_TITLE',privateNote='PRIVATE_HISTORY_FIXTURE_NOTE';
  fs.writeFileSync(path.join(tmp,'pushlog.json'),JSON.stringify([{ts:Date.now()-1000,status:'✅ 已送达(私密)',title:privateTitle,note:privateNote,channel:'飞书·私密',extra:{codes:[privateCode]}}]));
  // Boot mode skips collectors; this additional fixture guard rejects all egress.
  fs.writeFileSync(path.join(tmp,'deny-network.cjs'),"for(const name of ['node:http','node:https']){const m=require(name);m.request=m.get=()=>{throw Error('fixture forbids outbound requests');};}global.fetch=()=>Promise.reject(Error('fixture forbids fetch'));\n");
  const port=await freePort();
  child=spawn(process.execPath,['--require',path.join(tmp,'deny-network.cjs'),'server.js'],{
   cwd:tmp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',QD_CLOUD:'1',V6_ISOLATED_BOOT_SMOKE:'1'},stdio:['ignore','pipe','pipe']
  });
  child.stdout.on('data',chunk=>logs+=chunk);child.stderr.on('data',chunk=>logs+=chunk);
  let ready=false;
  for(let i=0;i<100;i++){
   if(child.exitCode!==null)throw Error('fixture server exited: '+logs.slice(-1500));
   try{if((await request(port,'/api/lock/status')).status===200){ready=true;break;}}catch{}
   await delay(50);
  }
  assert.ok(ready,'fixture server did not start: '+logs.slice(-1500));
  for(const route of ['/api/research/agent-status','/api/research/public-factors']){
   assert.notEqual((await request(port,route)).body.ok,true);
   assert.notEqual((await request(port,route,viewer)).body.ok,true);
  }
  const status=await request(port,'/api/research/agent-status',editor);
  assert.equal(status.status,200);assert.equal(status.body.agent.status,'unconfigured');assert.equal(status.body.catalog.length,4);
  assert.equal(status.body.agent.canTrade,false);assert.ok(!JSON.stringify(status.body).includes(tmp));
  assert.equal((await request(port,'/api/research/agent-status',editor,{x:1})).status,405);
  assert.equal((await request(port,'/api/research/public-factors',editor)).status,405);
  assert.equal((await request(port,'/api/research/public-factors',editor,{stocks:[]})).status,422);
  const unknown=await request(port,'/api/research/public-factors',editor,{schemaVersion:1,stocks:[{symbol:'000001'}]});
  assert.equal(unknown.status,200);assert.equal(unknown.body.result.observations[0].status,'unavailable');
  assert.ok(Object.values(unknown.body.result.observations[0].values).every(x=>x===null));
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await stopped;}
  fs.rmSync(tmp,{recursive:true,force:true});
 }
});

