'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const http=require('node:http'),net=require('node:net');
const {spawn}=require('node:child_process');
const Evidence=require('../src/core/signal-evidence-chain'),Journal=require('../src/core/production-signal-journal');
const project=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
function request(port,url,token='',method='GET'){
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port,path:url,method,timeout:3000,headers:token?{Authorization:'Bearer '+token}:{}},res=>{
   let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>{try{resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(body)});}catch(error){reject(error);}});
  });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('HTTP fixture timeout')));req.end();
 });
}
test('real authenticated HTTP replay survives a process restart, stays private and rejects tampered evidence',{timeout:20000},async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'v6-signal-replay-'));let child,logs='';
 const stop=async()=>{if(child&&child.exitCode===null&&child.signalCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await stopped;}};
 try{
  // Only executable assets and synthetic access records enter this isolated server.
  const copy=relative=>fs.cpSync(path.join(project,relative),path.join(tmp,relative),{recursive:true});
  for(const relative of ['src','strategies','public','package.json'])copy(relative);
  fs.mkdirSync(path.join(tmp,'config'));copy('config/data-source-catalog.json');copy('config/six-photo-sources.json');
  for(const relative of fs.readdirSync(project))if(relative.endsWith('.js'))copy(relative);
  const editor=crypto.randomBytes(32).toString('hex'),viewer=crypto.randomBytes(32).toString('hex'),digest=value=>crypto.createHash('sha256').update(value).digest('hex');
  const account=()=>{const salt=crypto.randomBytes(16).toString('hex');return {salt,hash:crypto.scryptSync('fixture-only',salt,32).toString('hex'),devices:{}};};
  const access=account();access.view=account();access.devices[digest(editor)]={role:'edit',ts:Date.now()};access.view.devices[digest(viewer)]={role:'view',ts:Date.now()};
  fs.writeFileSync(path.join(tmp,'access.json'),JSON.stringify(access));
  const triggerAt=Date.parse('2026-11-12T10:00:00+08:00'),root=path.join(tmp,'private-proof');
  const evidence=Evidence.createProductionSignalEvidence({code:'000001',type:'PRIVATE_SIGNAL_FIXTURE',triggerAt,strategyVersion:'fixture-v1',recordKind:'trigger',quote:{price:10},inputs:{},risk:{}});
  Journal.appendEvidence(root,evidence,{clock:()=>triggerAt});
  fs.writeFileSync(path.join(tmp,'deny-network.cjs'),"for(const name of ['node:http','node:https']){const m=require(name);m.request=m.get=()=>{throw Error('fixture forbids egress');};}global.fetch=()=>Promise.reject(Error('fixture forbids fetch'));\n");
  const port=await freePort();
  const boot=async()=>{
   child=spawn(process.execPath,['--require',path.join(tmp,'deny-network.cjs'),'server.js'],{cwd:tmp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',QD_CLOUD:'1',V6_ISOLATED_BOOT_SMOKE:'1',V6_SIGNAL_EVIDENCE_DIR:root},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',chunk=>logs+=chunk);child.stderr.on('data',chunk=>logs+=chunk);
   for(let i=0;i<100;i++){
    if(child.exitCode!==null)throw Error('fixture server exited: '+logs.slice(-1500));
    try{if((await request(port,'/api/lock/status')).status===200)return;}catch{}
    await delay(50);
   }
   throw Error('fixture server not ready: '+logs.slice(-1500));
  };
  const url='/api/signals/evidence?date=2026-11-12&code=000001&id='+evidence.signalId;
  await boot();
  for(const token of ['',viewer]){
   const denied=await request(port,url,token);assert.notEqual(denied.body.ok,true);assert.ok(!JSON.stringify(denied.body).includes('PRIVATE_SIGNAL_FIXTURE'));
  }
  const before=await request(port,url,editor);assert.equal(before.status,200);assert.equal(before.headers['cache-control'],'no-store');assert.equal(before.body.canTrade,false);
  assert.equal(before.body.records[0].evidence.signalId,evidence.signalId);assert.equal(before.body.records[0].evidence.quote.quoteAt,null);
  assert.equal((await request(port,url,editor,'POST')).status,405);
  assert.equal((await request(port,'/api/signals/evidence?date=2026-11-12&code=000001&id=../../private',editor)).status,422);
  const ignoredPath=await request(port,url+'&root=/etc&file=/etc/passwd',editor);assert.deepEqual(ignoredPath.body,before.body);
  await stop();await boot();
  const after=await request(port,url,editor);assert.deepEqual(after.body,before.body,'restart must replay the exact persisted record');
  const file=path.join(root,'2026-11-12','000001',evidence.signalId+'.json'),event=JSON.parse(fs.readFileSync(file));event.evidence.quote.price=999;fs.writeFileSync(file,JSON.stringify(event));
  const tampered=await request(port,url,editor);assert.equal(tampered.status,422);assert.equal(tampered.body.ok,false);assert.ok(!JSON.stringify(tampered.body).includes(tmp));
 }finally{await stop();fs.rmSync(tmp,{recursive:true,force:true});}
});
