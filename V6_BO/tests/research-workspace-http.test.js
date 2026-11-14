'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const http=require('node:http'),net=require('node:net'),{spawn}=require('node:child_process');
const source=path.resolve(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
function request(port,url,token='',body,method=body?'POST':'GET'){
 return new Promise((resolve,reject)=>{const raw=body?JSON.stringify(body):'',req=http.request({method,hostname:'127.0.0.1',port,path:url,timeout:10000,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(raw)}:{})}},res=>{
  let text='';res.on('data',v=>text+=v);res.on('end',()=>{try{resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(text)});}catch{reject(Error('non-JSON fixture response'));}});
 });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('HTTP fixture timeout')));req.end(raw);});
}
test('real workspace HTTP enforces editor access, private CAS writes, restart/replay, read-only GET/export and zero egress',{timeout:45000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-workspace-http-'));let child,logs='';
 const stop=async()=>{if(child&&child.exitCode===null&&child.signalCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await done;}};
 try{
  const copy=p=>fs.cpSync(path.join(source,p),path.join(dir,p),{recursive:true});for(const p of ['src','scripts','strategies','public','package.json'])copy(p);
  fs.mkdirSync(path.join(dir,'config'));for(const p of ['config/data-source-catalog.json','config/six-photo-sources.json','config/research-calendar-2026.json','config/public-model-comparison-20261114.json'])copy(p);
  for(const p of fs.readdirSync(source))if(p.endsWith('.js'))copy(p);
  const digest=x=>crypto.createHash('sha256').update(x).digest('hex'),editor=crypto.randomBytes(32).toString('hex'),viewer=crypto.randomBytes(32).toString('hex');
  const account=()=>{const salt=crypto.randomBytes(16).toString('hex');return {salt,hash:crypto.scryptSync('synthetic-http-password-only',salt,32).toString('hex'),devices:{}};};
  const access=account();access.view=account();access.devices[digest(editor)]={role:'edit',ts:Date.now()};access.view.devices[digest(viewer)]={role:'view',ts:Date.now()};fs.writeFileSync(path.join(dir,'access.json'),JSON.stringify(access));
  const root=path.join(dir,'private-workspace'),observations=path.join(dir,'private-observations'),guard=path.join(dir,'guard-readonly'),mutations=path.join(dir,'mutations'),egress=path.join(dir,'egress'),preload=path.join(dir,'deny.cjs'),slow=path.join(dir,'pause-workspace-worker');
  const jobFile=path.join(dir,'src/server/research-workspace-job.js'),jobCode=fs.readFileSync(jobFile,'utf8'),needle="if(p.action==='view'){";
  assert.ok(jobCode.includes(needle));fs.writeFileSync(jobFile,jobCode.replace(needle,needle+`if(require('node:fs').existsSync(${JSON.stringify(slow)})){process.stderr.write('WORKSPACE_WORKER_HELD\\n');while(require('node:fs').existsSync(${JSON.stringify(slow)}))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);}`));
  fs.writeFileSync(preload,`const fs=require('node:fs'),exists=fs.existsSync.bind(fs),append=fs.appendFileSync.bind(fs);const guard=${JSON.stringify(guard)},mutations=${JSON.stringify(mutations)},egress=${JSON.stringify(egress)};
const deny=name=>{append(egress,name+'\\n');throw Error('egress forbidden');};for(const name of ['node:http','node:https']){const m=require(name);m.request=m.get=()=>deny(name);}const net=require('node:net');net.connect=net.createConnection=net.Socket.prototype.connect=()=>deny('socket');require('node:tls').connect=()=>deny('tls');global.fetch=()=>Promise.reject(deny('fetch'));
for(const name of ['writeFileSync','appendFileSync','renameSync','unlinkSync','mkdirSync','rmdirSync','rmSync','linkSync','symlinkSync','truncateSync','chmodSync','writeSync']){const old=fs[name];fs[name]=function(...args){if(exists(guard)){append(mutations,name+'\\n');throw Error('GET attempted mutation');}return old.apply(this,args);};}
const open=fs.openSync;fs.openSync=function(file,flags,...args){if(exists(guard)&&(typeof flags==='number'?(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND)):!/^rs?$/.test(flags))){append(mutations,'open-write\\n');throw Error('GET attempted write-open');}return open.call(this,file,flags,...args);};`);
  const boot=async()=>{const port=await freePort();child=spawn(process.execPath,['--require',preload,'server.js'],{cwd:dir,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',QD_CLOUD:'1',V6_ISOLATED_BOOT_SMOKE:'1',V6_RESEARCH_WORKSPACE_DIR:root,V6_STOCK_OBSERVATIONS_DIR:observations},stdio:['ignore','pipe','pipe']});child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
   for(let i=0;i<140;i++){if(child.exitCode!==null)throw Error(logs.slice(-1000));try{if((await request(port,'/api/lock/status')).status===200)return port;}catch{}await pause(50);}throw Error('boot timeout '+logs.slice(-1000));};
  let port=await boot();fs.writeFileSync(guard,'GET only');
  for(const token of ['',viewer]){const r=await request(port,'/api/research/workspace',token);assert.notEqual(r.body.ok,true);assert.equal(r.body.result,undefined);}
  let r=await request(port,'/api/research/workspace',editor);assert.equal(r.body.ok,true);assert.equal(r.body.result.runs.total,0);assert.match(r.headers['cache-control'],/no-store/);assert.equal(fs.existsSync(root),false);
  for(const url of ['?root=/etc','?symbol=../../etc','?limit=101','?offset=-1','?asOf=NaN','?symbol=600000&symbol=600001','?export=9','?screenId='+'a'.repeat(64)])assert.equal((await request(port,'/api/research/workspace'+url,editor)).status,422);
  assert.equal((await request(port,'/api/research/workspace',editor,undefined,'DELETE')).status,405);assert.equal(fs.existsSync(mutations),false);fs.unlinkSync(guard);
  const settings={action:'preferences',requestId:'http_settings_001',expectedRevision:0,value:{objective:'跨重启保留研究约束',horizonDays:20,excludedSymbols:['600001'],unresolved:['补公司行动时点']}};
  assert.notEqual((await request(port,'/api/research/workspace',viewer,settings)).body.ok,true);
  r=await request(port,'/api/research/workspace',editor,settings);assert.equal(r.status,200);assert.equal(r.body.revision,1);assert.equal((await request(port,'/api/research/workspace',editor,settings)).body.reused,true);
  assert.equal((await request(port,'/api/research/workspace',editor,{...settings,requestId:'http_settings_002'})).status,409);
  assert.equal((await request(port,'/api/research/workspace',editor,{...settings,requestId:'http_settings_003',value:{apiKey:'never-save'}})).status,409);
  const {fixture}=require('./helpers/research-workspace-fixtures'),f=fixture();f.stock.bars=f.stock.bars.map(b=>Object.fromEntries(['date','open','high','low','close','volume','amount'].map(k=>[k,b[k]])));
  const scan=await request(port,'/api/research/scan',editor,{stocks:[{symbol:'600000',name:'合成HTTP扫描',feed:{source:'imported',timestamp:Date.now()},bars:f.stock.bars.slice(-30)}]});
  assert.equal(scan.body.ok,true);assert.equal(scan.body.result.workspace.status,'saved');
  require('../src/core/stock-observation-store').retainStockObservation(observations,{stock:f.stock,observedAt:f.asOf});
  const review={action:'review',symbol:'600000',provider:'tencent',requestId:'http_review_0001'};r=await request(port,'/api/research/workspace',editor,review);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.ok,true);const runId=r.body.runId;
  assert.equal((await request(port,'/api/research/workspace',editor,review)).body.reused,true);
  await stop();port=await boot();fs.writeFileSync(guard,'read/export/replay');
  r=await request(port,'/api/research/workspace?symbol=600000&runId='+runId,editor);assert.equal(r.body.result.runs.total,1);assert.equal(r.body.result.screening.inputTotal,1);assert.equal(r.body.result.screening.rows[0].symbol,'600000');assert.equal(r.body.result.preferences.value.objective,settings.value.objective);assert.equal(r.body.result.preferences.revision,1);assert.equal(r.body.result.diagnostics.at(-1).stages.at(-1).stage,'封存研究结果');
  const ex=await request(port,'/api/research/workspace?symbol=600000&export=1',editor);assert.equal(ex.body.result.run.id,runId);for(const text of [editor,viewer,root,observations,'"positions"'])assert.ok(!JSON.stringify(ex.body).includes(text));
  fs.writeFileSync(slow,'hold archive worker');let completed=false;const pending=request(port,'/api/research/workspace',editor).then(r=>{completed=true;return r;});
  try{for(let i=0;i<300&&!logs.includes('WORKSPACE_WORKER_HELD');i++)await pause(10);assert.ok(logs.includes('WORKSPACE_WORKER_HELD'),'archive query runs in bounded worker');
   assert.equal((await request(port,'/api/lock/status')).status,200);assert.equal(completed,false,'server health remains responsive while archive computation is held');
  }finally{fs.unlinkSync(slow);}assert.equal((await pending).body.ok,true);
  assert.equal(fs.existsSync(mutations),false);assert.equal(fs.existsSync(egress),false);
 }finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}
});
