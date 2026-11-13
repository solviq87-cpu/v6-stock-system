'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const http=require('node:http'),net=require('node:net'),{spawn}=require('node:child_process');
const source=process.env.V6_RISK_TEST_ROOT||path.resolve(__dirname,'..');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
function request(port,url,token='',method='GET'){
 return new Promise((resolve,reject)=>{const req=http.request({method,hostname:'127.0.0.1',port,path:url,timeout:3000,headers:token?{Authorization:'Bearer '+token}:{}},res=>{
  let raw='';res.on('data',x=>raw+=x);res.on('end',()=>{try{resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(raw)});}catch{reject(Error('fixture received non-JSON response'));}});
 });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('fixture request timeout')));req.end();});
}
test('risk center real HTTP is editor-only, GET-only, read-only, and makes no outbound requests',{timeout:30000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-risk-http-'));let child,logs='';
 const stop=async()=>{if(child&&child.exitCode===null&&child.signalCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await done;}};
 try{
  const copy=relative=>fs.cpSync(path.join(source,relative),path.join(dir,relative),{recursive:true});
  for(const relative of ['src','scripts','strategies','public','package.json'])copy(relative);
  fs.mkdirSync(path.join(dir,'config'));copy('config/data-source-catalog.json');copy('config/six-photo-sources.json');
  for(const relative of fs.readdirSync(source))if(relative.endsWith('.js'))copy(relative);
  const editor=crypto.randomBytes(32).toString('hex'),viewer=crypto.randomBytes(32).toString('hex');
  const account=()=>{const salt=crypto.randomBytes(16).toString('hex');return {salt,hash:crypto.scryptSync('fixture-password-only',salt,32).toString('hex'),devices:{}};};
  const digest=v=>crypto.createHash('sha256').update(v).digest('hex'),access=account();access.view=account();
  access.devices[digest(editor)]={role:'edit',name:'fixture editor',ts:Date.now()};access.view.devices[digest(viewer)]={role:'view',name:'fixture viewer',ts:Date.now()};
  fs.writeFileSync(path.join(dir,'access.json'),JSON.stringify(access));
  const privateDir=path.join(dir,'private-risk-inputs');fs.mkdirSync(privateDir,{mode:0o700});
  const primary=path.join(privateDir,'primary.json'),legacy=path.join(privateDir,'legacy.json'),newsRoot=path.join(privateDir,'news');
  const watch=symbol=>({schemaVersion:1,mode:'manual-holding-watch',positions:[{symbol,cost:100,shares:100,weightPct:60}],quotes:[{symbol,price:80,quoteSource:'provider-one',quoteAt:Date.now()}]});
  fs.writeFileSync(primary,JSON.stringify(watch('600001')));fs.writeFileSync(legacy,JSON.stringify(watch('600002')));
  const newsModule=path.join(source,'src/core/news-evidence-journal.js');
  if(fs.existsSync(newsModule))require(newsModule).appendBatch(newsRoot,[{schemaVersion:1,source:'fixture-source',eventId:'news-one',sourceRevisionId:'v1',kind:'original',supersedes:null,
   url:'https://example.com/fixture',title:'HTTP_NEWS_TITLE',body:'unverified fixture body',securities:['600001'],publishedAt:Date.now()-1000,receivedAt:Date.now(),revisedAt:null}]);
  const guard=path.join(dir,'guard-active'),mutations=path.join(dir,'unexpected-write.log'),egress=path.join(dir,'unexpected-egress.log');
  const preload=path.join(dir,'deny-side-effects.cjs');
  fs.writeFileSync(preload,`const fs=require('node:fs'),exists=fs.existsSync.bind(fs),append=fs.appendFileSync.bind(fs);
const guard=${JSON.stringify(guard)},mutations=${JSON.stringify(mutations)},egress=${JSON.stringify(egress)};
const deny=name=>{append(egress,name+'\\n');throw Error('fixture forbids outbound requests');};
for(const name of ['node:http','node:https']){const m=require(name);m.request=m.get=()=>deny(name);}
const net=require('node:net');net.connect=net.createConnection=net.Socket.prototype.connect=()=>deny('socket');
require('node:tls').connect=()=>deny('tls');global.fetch=()=>Promise.reject(deny('fetch'));
const blocked=name=>{append(mutations,name+'\\n');throw Error('fixture forbids writes during risk reads');};
for(const name of ['writeFileSync','appendFileSync','renameSync','unlinkSync','mkdirSync','rmdirSync','rmSync','linkSync','symlinkSync','truncateSync','chmodSync','writeSync']){const old=fs[name];fs[name]=function(...args){if(exists(guard))blocked(name);return old.apply(this,args);};}
const open=fs.openSync;fs.openSync=function(file,flags,...args){if(exists(guard)&&(typeof flags==='number'?(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND)):!/^rs?$/.test(flags)))blocked('open-write');return open.call(this,file,flags,...args);};
`);
  const boot=async primaryValue=>{
   const port=await freePort();child=spawn(process.execPath,['--require',preload,'server.js'],{cwd:dir,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',QD_CLOUD:'1',V6_ISOLATED_BOOT_SMOKE:'1',
    V6_MANUAL_HOLDING_WATCH_FILE:primaryValue,V6_HOLDING_WATCH_FILE:legacy,V6_FACTOR_AGENT_DIR:path.join(privateDir,'not-configured-agent'),V6_NEWS_EVIDENCE_DIR:newsRoot,V6_OPTIONAL_RESEARCH_FILE:path.join(privateDir,'not-configured-optional')},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
   for(let i=0;i<120;i++){if(child.exitCode!==null)throw Error('fixture boot exited: '+logs.slice(-1200));try{if((await request(port,'/api/lock/status')).status===200)return port;}catch{}await delay(50);}
   throw Error('fixture boot timeout: '+logs.slice(-1200));
  };
  let port=await boot(primary);const beforePrimary=fs.readFileSync(primary),beforeLegacy=fs.readFileSync(legacy);
  fs.writeFileSync(guard,'readonly requests');
  for(const token of ['',viewer]){const denied=await request(port,'/api/research/risk-center',token);assert.notEqual(denied.body.ok,true);assert.equal(denied.body.result,undefined);}
  const observed=await request(port,'/api/research/risk-center',editor);
  assert.equal(observed.status,200);assert.match(observed.headers['cache-control'],/no-store/);
  const r=observed.body.result;assert.equal(r.mode,'research-risk-center-readonly');assert.equal(r.riskScore,null);
  assert.equal(r.manualHoldings.positions[0].symbol,'600001');assert.ok(r.supports.some(x=>x.code==='loss-critical'));
  assert.equal(r.canTrade,false);assert.equal(r.canNotify,false);assert.equal(r.writesAccount,false);assert.equal(r.strategyDecay.status,'unknown');
  assert.ok(!JSON.stringify(observed.body).includes(privateDir));
  if(fs.existsSync(newsModule)){assert.equal(r.news.summary.currentEvents,1);assert.equal(r.news.rows[0].title,'HTTP_NEWS_TITLE');}
  else assert.equal(r.news.status,'unavailable');
  assert.equal((await request(port,'/api/research/risk-center',editor,'POST')).status,405);
  assert.equal((await request(port,'/api/research/risk-center?outputRoot=/etc',editor)).status,200);
  assert.deepEqual(fs.readFileSync(primary),beforePrimary);assert.deepEqual(fs.readFileSync(legacy),beforeLegacy);
  assert.equal(fs.existsSync(path.join(privateDir,'not-configured-agent')),false);assert.equal(fs.existsSync(mutations),false);
  await stop();fs.unlinkSync(guard);port=await boot('');fs.writeFileSync(guard,'readonly alias request');
  const alias=await request(port,'/api/research/risk-center',editor);assert.equal(alias.body.result.manualHoldings.positions[0].symbol,'600002');
  assert.equal(fs.existsSync(mutations),false);assert.equal(fs.existsSync(egress),false);
 }finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}
});
