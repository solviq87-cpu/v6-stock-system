'use strict';
// Actual V6 server.js + existing scrypt/login token/real CAS store.
// Synthetic credentials, a separate temporary private ledger, no real network/publish.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto'),http=require('node:http'),net=require('node:net');
const {spawn}=require('node:child_process');
const {createCloudRecordsCasStore,digest}=require('../src/core/cloud-records-cas-store');
const SOURCE=path.resolve(__dirname,'..');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise((resolve,reject)=>{
 const s=net.createServer();s.once('error',reject);
 s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});
});
function request(port,route,{method='GET',body,token,origin,contentType='application/json'}={}){
 return new Promise((resolve,reject)=>{
  const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
  const headers={
   ...(token?{Authorization:'Bearer '+token}:{}),
   ...(origin?{Origin:origin}:{}),
   ...(bytes?{'Content-Type':contentType,'Content-Length':bytes.length}:{})
  };
  const req=http.request({hostname:'127.0.0.1',port,path:route,method,headers,timeout:3500},res=>{
   let text='';res.on('data',part=>{text+=part;if(text.length>1024*1024)req.destroy(Error('oversize fixture response'));});
   res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text),headers:res.headers});}
    catch{reject(Error('expected JSON, got HTTP '+res.statusCode));}});
  });
  req.on('error',reject);req.on('timeout',()=>req.destroy(Error('fixture timeout')));req.end(bytes);
 });
}
function isolate(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-server-records-integration-'));
 fs.chmodSync(root,0o700);
 const app=path.join(root,'app'),ledgerRoot=path.join(root,'private-ledger');
 fs.mkdirSync(app,{mode:0o700});fs.mkdirSync(ledgerRoot,{mode:0o700});
 fs.mkdirSync(path.join(root,'tmp'),{mode:0o700});
 for(const name of ['server.js','src','scripts','strategies','public','package.json']){
  fs.cpSync(path.join(SOURCE,name),path.join(app,name),{recursive:true});
 }
 for(const name of fs.readdirSync(SOURCE))
  if(name.endsWith('.js') && name!=='server.js')fs.copyFileSync(path.join(SOURCE,name),path.join(app,name));
 fs.mkdirSync(path.join(app,'config'));
 for(const name of ['data-source-catalog.json','six-photo-sources.json'])
  fs.copyFileSync(path.join(SOURCE,'config',name),path.join(app,'config',name));
 const password='fixture-only-editor-password';
 const salt=crypto.randomBytes(16).toString('hex');
 fs.writeFileSync(path.join(app,'access.json'),JSON.stringify({
  salt,hash:crypto.scryptSync(password,salt,32).toString('hex'),devices:{}
 }),{mode:0o600});
 const rows=[{name:'v6.app.state',content:JSON.stringify({
  revision:0,cash:100000,positions:[],orders:[],risk:{},picks:{}
 })}];
 const store=createCloudRecordsCasStore(ledgerRoot);
 store.bootstrap({records:rows,expectedSourceHash:digest({records:rows}),
  operatorApproved:true,requestId:'bootstrap_fixture_01'});
 // Prevent network access from any child code, not just the intended app route.
 const guard=path.join(root,'no-external.cjs');
 fs.writeFileSync(guard,[
  "'use strict';",
  "for(const proto of ['node:http','node:https']){",
  " const m=require(proto);for(const method of ['request','get']){",
  " const old=m[method];m[method]=function(...args){",
  " const x=args[0],host=typeof x==='string'?new URL(x).hostname:x?.hostname||x?.host||'localhost';",
  " if(!['localhost','127.0.0.1','::1'].includes(host))throw Error('egress forbidden');",
  " return old.apply(this,args);",
  " };}}",
  "global.fetch=()=>{throw Error('outbound fetch forbidden');};"
 ].join('\n'),{mode:0o600});
 let child;
 t.after(async()=>{
  if(child && child.exitCode===null && child.signalCode===null){
   const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');
   await Promise.race([exited,sleep(1000)]);
   if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
  }
  fs.rmSync(root,{recursive:true,force:true});
 });
 return {root,app,ledgerRoot,password,guard,store,attach:c=>{child=c;}};
}
test('real legacy V6 login gates the opt-in private CAS route and preserves history', {timeout:30000},async t=>{
 const f=isolate(t),port=await freePort();
 const child=spawn(process.execPath,['--require',f.guard,'server.js'],{
  cwd:f.app,env:{PATH:process.env.PATH||'/usr/bin:/bin',TZ:'UTC',LANG:'C.UTF-8',
   TMPDIR:path.join(f.root,'tmp'),PORT:String(port),HOST:'127.0.0.1',
   QD_CLOUD:'1',V6_ISOLATED_BOOT_SMOKE:'1',
   V6_ENABLE_CLOUD_RECORDS_HTTP:'1',V6_CLOUD_RECORDS_ROOT:f.ledgerRoot},
  stdio:['ignore','pipe','pipe']});
 f.attach(child);
 let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 let ready=false;
 for(let n=0;n<80;n++){
  if(child.exitCode!==null)throw Error('server failed to start: '+logs.slice(-900));
  try{if((await request(port,'/api/lock/status')).status===200){ready=true;break;}}catch{}
  await sleep(100);
 }
 assert.equal(ready,true,'real server never started: '+logs.slice(-900));
 const without=await request(port,'/api/records');
 assert.equal(without.status,401);
 assert.equal(without.body.code,'LOGIN_REQUIRED');
 assert.equal(JSON.stringify(without.body).includes('cash'),false);
 assert.equal((await request(port,'/api/records?sharecode=fixture-share')).status,400);
 const login=await request(port,'/api/lock/unlock',{
  method:'POST',body:{password:f.password,role:'edit',fp:'ledger-fixture',name:'Test Device'}
 });
 assert.equal(login.body.ok,true,'real V6 login failed: '+JSON.stringify(login.body));
 const token=login.body.token;
 assert.match(token,/^[A-Za-z0-9._~-]{8,256}$/);
 const unauthorized=await request(port,'/api/records',{token:'invalid-fixture-token'});
 assert.equal(unauthorized.status,401);
 const cross=await request(port,'/api/records',{token,origin:'https://evil.fixture'});
 assert.equal(cross.status,403);
 const before=await request(port,'/api/records',{token});
 assert.equal(before.status,200);
 assert.equal(before.body.revision,1);
 assert.equal(before.body.records.length,1);
 assert.equal(before.body.accountRecoveryVerified,false);
 assert.equal(before.headers['cache-control'],'no-store');
 const update={name:'v6.app.state',expectedRevision:1,requestId:'mobile_device_01',
  content:JSON.stringify({revision:1,cash:90000,positions:[],orders:[],risk:{},picks:{}})};
 const saved=await request(port,'/api/records',{method:'POST',token,body:update});
 assert.equal(saved.status,200,'first CAS commit failed: '+JSON.stringify(saved.body));
 assert.equal(saved.body.revision,2);
 const receiptPath='/api/records/receipts/mobile_device_01';
 const noTokenReceipt=await request(port,receiptPath);
 assert.equal(noTokenReceipt.status,401,'receipt cannot bypass original V6 login');
 const maliciousReceipt=await request(port,receiptPath,{token,origin:'https://evil.fixture'});
 assert.equal(maliciousReceipt.status,403);
 const sourceReceipt=await request(port,receiptPath,{token});
 assert.equal(sourceReceipt.status,200);
 assert.equal(sourceReceipt.body.receipt.status,'committed');
 assert.equal(sourceReceipt.body.receipt.appliedRevision,2);
 assert.equal(sourceReceipt.body.receipt.readOnly,true);
 assert.equal(sourceReceipt.body.accountRecoveryVerified,false);
 assert.ok(!JSON.stringify(sourceReceipt.body).includes('90000'));
 const absentReceipt=await request(port,'/api/records/receipts/never_sent_001',{token});
 assert.equal(absentReceipt.status,200);
 assert.equal(absentReceipt.body.receipt.found,false,'missing receipt is not a committed event');
 assert.equal((await request(port,receiptPath,{method:'POST',token,body:{}})).status,405);
 const stale=await request(port,'/api/records',{method:'POST',token,body:{
  ...update,requestId:'desktop_device_01',content:JSON.stringify({revision:1,cash:80000,positions:[],orders:[]})
 }});
 assert.equal(stale.status,409);
 assert.equal(stale.body.code,'REVISION_CONFLICT');
 const retried=await request(port,'/api/records',{method:'POST',token,body:update});
 assert.equal(retried.status,200);assert.equal(retried.body.reused,true);
 const wrongType=await request(port,'/api/records',{method:'POST',token,body:{
  ...update,requestId:'wrong_type_0001'
 },contentType:'text/plain'});
 assert.equal(wrongType.status,415);
 assert.equal(f.store.read().revision,2);
 assert.equal(JSON.parse(f.store.read().records[0].content).cash,90000);
 const after=await request(port,'/api/records',{token});
 assert.equal(after.body.revision,2);
 assert.equal(JSON.parse(after.body.records[0].content).cash,90000);
});
