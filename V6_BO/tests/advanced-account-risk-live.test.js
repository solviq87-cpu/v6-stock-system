'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const http=require('node:http'),net=require('node:net'),{spawn}=require('node:child_process');
const source=process.env.V6_RISK_TEST_ROOT||path.resolve(__dirname,'..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
function request(port,url,token='',method='GET',value){
 return new Promise((resolve,reject)=>{
  const body=value===undefined?'':JSON.stringify(value);
  const req=http.request({method,hostname:'127.0.0.1',port,path:url,timeout:12000,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{})}},res=>{
   let raw='';res.on('data',data=>{raw+=data;});res.on('end',()=>{try{resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(raw)});}catch{reject(Error('fixture response is not JSON'));}});
  });req.once('error',reject);req.once('timeout',()=>req.destroy(Error('fixture HTTP timeout')));req.end(body);
 });
}
test('advanced risk runs a real HTTP server and worker with original accounts, editor permission and no writes or egress',{timeout:40000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-advanced-risk-live-'));let child,logs='';
 const stop=async()=>{if(child&&child.exitCode===null&&child.signalCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;}};
 try{
  const copy=relative=>fs.cpSync(path.join(source,relative),path.join(dir,relative),{recursive:true});
  for(const relative of ['src','scripts','strategies','public','package.json'])copy(relative);
  fs.mkdirSync(path.join(dir,'config'));copy('config/data-source-catalog.json');copy('config/six-photo-sources.json');copy('config/intelligence-center.json');
  for(const relative of fs.readdirSync(source))if(relative.endsWith('.js'))copy(relative);
  const editor=crypto.randomBytes(32).toString('hex'),viewer=crypto.randomBytes(32).toString('hex');
  const account=()=>{const salt=crypto.randomBytes(16).toString('hex');return {salt,hash:crypto.scryptSync('http-fixture-only',salt,32).toString('hex'),devices:{}};};
  const digest=value=>crypto.createHash('sha256').update(value).digest('hex'),access=account();access.view=account();
  access.devices[digest(editor)]={role:'edit',name:'fixture editor',ts:Date.now()};access.view.devices[digest(viewer)]={role:'view',name:'fixture viewer',ts:Date.now()};
  fs.writeFileSync(path.join(dir,'access.json'),JSON.stringify(access));
  const privateDir=path.join(dir,'private-original-files'),accounts=path.join(privateDir,'accounts'),history=path.join(privateDir,'absent-center-history');
  fs.mkdirSync(accounts,{recursive:true,mode:0o700});
  const {createPaperApplicationService}=require(path.join(source,'src/core/paper-application-service'));
  for(const [id,cash] of [['pool',12345],['pre',54321]])createPaperApplicationService({file:path.join(accounts,id+'.json')}).adoptLegacy({initial:cash,cash,realized:0,enabled:true,positions:{},trades:[]});
  const before=Object.fromEntries(['pool','pre'].map(id=>[id,fs.readFileSync(path.join(accounts,id+'.json'))]));
  const guard=path.join(dir,'read-guard'),mutations=path.join(dir,'unexpected-write.log'),egress=path.join(dir,'unexpected-egress.log'),preload=path.join(dir,'read-guard.cjs');
  fs.writeFileSync(preload,`const fs=require('node:fs'),exists=fs.existsSync.bind(fs),openOriginal=fs.openSync.bind(fs),writeOriginal=fs.writeSync.bind(fs),closeOriginal=fs.closeSync.bind(fs);
const guard=${JSON.stringify(guard)},mutations=${JSON.stringify(mutations)},egress=${JSON.stringify(egress)};
const log=(file,name)=>{const fd=openOriginal(file,'a',0o600);try{writeOriginal(fd,name+'\\n');}finally{closeOriginal(fd);}};
const deny=name=>{log(egress,name);throw Error('fixture forbids outbound requests');};
for(const name of ['node:http','node:https']){const m=require(name);m.request=m.get=()=>deny(name);}
const net=require('node:net');net.connect=net.createConnection=net.Socket.prototype.connect=()=>deny('socket');require('node:tls').connect=()=>deny('tls');global.fetch=()=>Promise.reject(deny('fetch'));
const blocked=name=>{log(mutations,name);throw Error('fixture forbids writes during reads');};
for(const name of ['writeFileSync','appendFileSync','renameSync','unlinkSync','mkdirSync','rmdirSync','rmSync','linkSync','symlinkSync','truncateSync','chmodSync','writeSync']){const old=fs[name];fs[name]=function(...args){if(exists(guard))blocked(name);return old.apply(this,args);};}
const open=fs.openSync;fs.openSync=function(file,flags,...args){if(exists(guard)&&(typeof flags==='number'?(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND)):!/^rs?$/.test(flags)))blocked('open-write');return open.call(this,file,flags,...args);};
`);
  const boot=async()=>{
   const port=await freePort();child=spawn(process.execPath,['--require',preload,'server.js'],{cwd:dir,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',QD_CLOUD:'1',QD_MACHINE_KEY:'isolated-live-http-fixture-machine-key',V6_ISOLATED_BOOT_SMOKE:'1',QD_PUSH_FORCE:'0',
    V6_ORDER_ACCOUNTS_DIR:accounts,V6_CENTER_HISTORY_DIR:history,V6_SHORTLINE_DIR:path.join(privateDir,'absent-shortline'),V6_MANUAL_HOLDING_WATCH_FILE:path.join(privateDir,'absent-manual'),V6_HOLDING_WATCH_FILE:'',V6_FACTOR_AGENT_DIR:path.join(privateDir,'absent-agent'),V6_NEWS_EVIDENCE_DIR:path.join(privateDir,'absent-news')},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',data=>{logs+=data;});child.stderr.on('data',data=>{logs+=data;});
   for(let i=0;i<120;i++){
    if(child.exitCode!==null)throw Error('isolated server exited: '+logs.slice(-1200));
    try{if((await request(port,'/api/lock/status')).status===200){
     // The existing auth layer records a viewer device's first activity. Finish
     // that normal login bookkeeping before guarding account/evidence reads.
     assert.equal((await request(port,'/api/lock/status',editor)).body.role,'edit');
     assert.equal((await request(port,'/api/lock/status',viewer)).body.role,'view');
     return port;
    }}catch{}await pause(50);
   }
   throw Error('isolated server startup timeout: '+logs.slice(-1200));
  };
  let port=await boot();fs.writeFileSync(guard,'advanced risk read');
  for(const token of ['',viewer]){
   const denied=await request(port,'/api/research/risk-center?advanced=1',token);assert.notEqual(denied.body.ok,true);assert.equal(denied.body.result,undefined);
   const accountDenied=await request(port,'/api/research/order-account',token,'POST',{action:'reconcile',accountId:'pool'});assert.notEqual(accountDenied.body.ok,true);
  }
  assert.equal((await request(port,'/api/research/risk-center?advanced=1',editor,'POST')).status,405);
  const read=await request(port,'/api/research/risk-center?advanced=1&root=/tmp/forged&historyRoot=/tmp/forged&portfolioContext=forged',editor);
  assert.equal(read.status,200,JSON.stringify(read.body));assert.match(read.headers['cache-control'],/no-store/);
  const result=read.body.result.advancedAccounts;assert.equal(result.status,'observed');assert.equal(result.accounts.length,2);
  assert.equal(result.accounts.find(x=>x.account==='pool').cash,12345);assert.equal(result.accounts.find(x=>x.account==='pre').cash,54321);
  assert.equal(result.telemetry.sampleCount,1);assert.equal(result.canTrade,false);assert.equal(result.writesAccount,false);
  assert.doesNotMatch(JSON.stringify(read.body),new RegExp(privateDir.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  const reconciled=await request(port,'/api/research/order-account',editor,'POST',{action:'reconcile',accountId:'pool'});
  assert.equal(reconciled.status,200);assert.equal(reconciled.body.result.internallyConsistent,true);assert.match(reconciled.headers['cache-control'],/no-store/);
  const missing=await request(port,'/api/research/order-account',editor,'POST',{action:'read',accountId:'does-not-exist'});assert.equal(missing.status,400);
  assert.equal(fs.existsSync(path.join(accounts,'does-not-exist.json')),false);assert.equal(fs.existsSync(history),false);
  assert.equal(fs.existsSync(mutations),false,fs.existsSync(mutations)?fs.readFileSync(mutations,'utf8'):'');assert.equal(fs.existsSync(egress),false);
  for(const id of ['pool','pre'])assert.deepEqual(fs.readFileSync(path.join(accounts,id+'.json')),before[id]);
  await stop();fs.unlinkSync(guard);fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({pushRole:'replica'}));
  port=await boot();fs.writeFileSync(guard,'replica risk read');
  const replica=await request(port,'/api/research/risk-center?advanced=1',editor);
  assert.equal(replica.status,200);assert.equal(replica.body.result.advancedAccounts.status,'replica');assert.deepEqual(replica.body.result.advancedAccounts.accounts,[]);
  assert.equal(replica.body.result.advancedAccounts.telemetry.sampleCount,0);
  const forbidden=await request(port,'/api/research/order-account',editor,'POST',{action:'set-defense',accountId:'pool',expectedRevision:1,state:'restricted',reason:'fixture'});
  assert.equal(forbidden.status,400);assert.match(forbidden.body.error,/副本/);
  assert.equal(fs.existsSync(mutations),false);assert.equal(fs.existsSync(egress),false);
  for(const id of ['pool','pre'])assert.deepEqual(fs.readFileSync(path.join(accounts,id+'.json')),before[id]);
 }finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}
});
