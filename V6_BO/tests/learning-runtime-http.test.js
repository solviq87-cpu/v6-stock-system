'use strict';
// Native server/session checks and a real worker, with a loopback registry fixture.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const http=require('node:http'),net=require('node:net'),{spawn}=require('node:child_process');
const source=path.resolve(__dirname,'..'),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const port=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
function request(p,{route='/api/research/learning-runtime',token,method='GET',body}={}){
 return new Promise((resolve,reject)=>{
  const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
  const req=http.request({hostname:'127.0.0.1',port:p,path:route,method,timeout:10000,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(bytes?{'Content-Type':'application/json','Content-Length':bytes.length}:{})}},res=>{
   const parts=[];res.on('data',b=>parts.push(b));res.on('end',()=>{try{resolve({code:res.statusCode,headers:res.headers,body:JSON.parse(Buffer.concat(parts))});}catch{reject(Error('Expected JSON runtime response'));}});
  });req.once('error',reject);req.once('timeout',()=>req.destroy(Error('Runtime fixture timeout')));req.end(bytes);
 });
}
test('runtime API protects native identity, isolates reads, probes tags only and keeps the main server responsive',{timeout:60000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-runtime-http-')),app=path.join(root,'app');
 let child,logs='',registry,held,release,hold=false,registryCalls=0;const digest='b'.repeat(64);
 try{
  registry=http.createServer((req,res)=>{
   registryCalls++;assert.equal(req.url,'/api/tags');assert.equal(req.method,'GET');
   const reply=()=>res.end(JSON.stringify({models:[{name:'qwen-fixture:small',digest}]}));
   if(hold){hold=false;release=reply;held();}else reply();
  });await new Promise(resolve=>registry.listen(0,'127.0.0.1',resolve));
  fs.mkdirSync(app);
  for(const name of ['src','scripts','strategies','public','config','package.json'])fs.cpSync(path.join(source,name),path.join(app,name),{recursive:true});
  for(const name of fs.readdirSync(source))if(name.endsWith('.js'))fs.copyFileSync(path.join(source,name),path.join(app,name));
  const hash=x=>crypto.createHash('sha256').update(x).digest('hex'),editor=crypto.randomBytes(32).toString('hex'),viewer=crypto.randomBytes(32).toString('hex');
  const account=()=>{const salt=crypto.randomBytes(16).toString('hex');return {salt,hash:crypto.scryptSync('synthetic-runtime-password',salt,32).toString('hex'),devices:{}};};
  const access=account();access.view=account();access.devices[hash(editor)]={role:'edit',ts:Date.now()};access.view.devices[hash(viewer)]={role:'view',ts:Date.now()};
  fs.writeFileSync(path.join(app,'access.json'),JSON.stringify(access),{mode:0o600});
  const violations=path.join(root,'network-violations'),guard=path.join(root,'guard.cjs'),registryPort=registry.address().port;
  fs.writeFileSync(guard,`'use strict';
const fs=require('node:fs');
for(const proto of ['node:http','node:https']){const mod=require(proto);for(const name of ['request','get']){const old=mod[name];mod[name]=function(...args){
 const x=args[0],u=x instanceof URL?x:typeof x==='string'?new URL(x):null;
 const host=u?.hostname||x?.hostname||x?.host,port=+(u?.port||x?.port),pathname=u?.pathname||x?.path;
 if(proto!=='node:http'||host!=='127.0.0.1'||port!==${registryPort}||pathname!=='/api/tags'){fs.appendFileSync(${JSON.stringify(violations)},'denied-network\\n');throw Error('fixture egress denied');}
 return old.apply(this,args);};}}
global.fetch=()=>{throw Error('fixture fetch denied');};
`);
  const p=await port();child=spawn(process.execPath,['--require',guard,'server.js'],{cwd:app,env:{PATH:'/usr/bin:/bin',TZ:'UTC',LANG:'C.UTF-8',PORT:String(p),HOST:'127.0.0.1',QD_CLOUD:'1',V6_ISOLATED_BOOT_SMOKE:'1',V6_LOCAL_LEARNING_MODEL:'qwen-fixture:small',V6_LOCAL_LEARNING_DIGEST:digest,V6_LOCAL_LEARNING_ENDPOINT:'http://127.0.0.1:'+registryPort},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  let ready=false;for(let n=0;n<160;n++){if(child.exitCode!==null)throw Error('Runtime fixture exited: '+logs.slice(-500));try{if((await request(p,{token:editor})).body.ok){ready=true;break;}}catch{}await pause(25);}assert.equal(ready,true);
  // The legacy global login gate returns locked JSON with HTTP 200 before routing.
  const anonymous=await request(p);assert.equal(anonymous.body.locked,true);assert.equal(anonymous.body.result,undefined);assert.match(anonymous.headers['cache-control'],/no-store/);
  const viewOnly=await request(p,{token:viewer});assert.equal(viewOnly.code,403);assert.equal(viewOnly.body.locked,true);assert.match(viewOnly.headers['cache-control'],/no-store/);
  assert.equal((await request(p,{route:'/api/research/learning-runtime?token='+editor})).code,403);
  assert.equal((await request(p,{method:'POST',body:{token:editor,probeModel:true}})).code,403);
  let r=await request(p,{token:editor});assert.equal(r.code,200);assert.equal(r.body.result.configuration.status,'unconfigured');assert.equal(r.body.result.model.status,'not-probed');assert.equal(registryCalls,0);
  assert.equal((await request(p,{token:editor,route:'/api/research/learning-runtime?probeModel=true'})).code,400);
  assert.equal((await request(p,{token:editor,method:'DELETE'})).code,405);
  for(const body of [{},{probeModel:false},{probeModel:true,url:'http://private.invalid'},{probeModel:true,token:editor},[],null])assert.equal((await request(p,{token:editor,method:'POST',body})).code,400);
  assert.equal((await request(p,{token:editor,method:'POST',body:{probeModel:true,padding:'x'.repeat(256)}})).code,413);
  assert.equal(registryCalls,0);
  hold=true;const pending=new Promise(resolve=>held=resolve);const first=request(p,{token:editor,method:'POST',body:{probeModel:true}});await pending;
  r=await request(p,{token:editor});assert.equal(r.code,503);assert.equal(r.body.ok,false);
  const oldStatus=await request(p,{token:editor,route:'/api/research/agent-status'});assert.equal(oldStatus.body.ok,true);
  release();release=null;r=await first;assert.equal(r.code,200);assert.equal(r.body.result.overall,'unconfigured');assert.equal(r.body.result.model.status,'verified');assert.equal(r.body.result.model.inferenceVerified,false);assert.equal(r.body.result.readOnly,true);assert.equal(registryCalls,1);
  assert.match(r.headers['cache-control'],/no-store/);assert.equal(JSON.stringify(r.body).includes(root),false);assert.equal(JSON.stringify(r.body).includes('http://'),false);
  r=await request(p,{token:editor});assert.equal(r.body.result.model.status,'not-probed');assert.equal(registryCalls,1);assert.equal(fs.existsSync(violations),false);
 }finally{
  release?.();
  if(child&&child.exitCode===null&&child.signalCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await done;}
  if(registry){registry.closeAllConnections();await new Promise(resolve=>registry.close(resolve));}
  fs.rmSync(root,{recursive:true,force:true});
 }
});
