'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),http=require('node:http'),net=require('node:net'),{spawn}=require('node:child_process');
const source=path.resolve(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
function request(port,token='',body,method=body?'POST':'GET',suffix=''){
 return new Promise((resolve,reject)=>{const raw=body===undefined?'':JSON.stringify(body),req=http.request({hostname:'127.0.0.1',port,path:'/api/learn-status'+suffix,method,timeout:10000,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(raw?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(raw)}:{})}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>{try{resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(text)});}catch{reject(Error('Non-JSON learning fixture response'));}});});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('Learning fixture timeout')));req.end(raw);});
}
test('real learning HTTP preserves raw outcomes, enforces auth and single flight, and reports actual maturation/failure',{timeout:60000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-learning-http-'));let child,logs='';
 const hold=path.join(dir,'hold'),fail=path.join(dir,'fail'),calls=path.join(dir,'calls'),egress=path.join(dir,'egress');
 const stats=()=>({schema:3,signals:[
  {type:'trend',code:'600000',name:'合成旧结果',date:'20261109',price:10,prob:70,ts:Date.parse('2026-11-09T10:00:00+08:00'),resolved:{date:'20261109',mode:'当日',nextPct:1,maxGain:2,hit:false,limitUp:false},nd:{date:'20261112',mode:'次日',nextPct:9,maxGain:9,closeGain:8,openGap:0,hit:true}},
  {type:'trend',code:'600001',name:'合成待验',date:'20261109',price:10,prob:70,ts:Date.parse('2026-11-09T10:00:00+08:00')},
  {type:'trend',code:'600003',name:'合成回测',date:'20261109',price:10,prob:70,resolved:{date:'20261110',mode:'历史回测',nextPct:9,maxGain:9,hit:true,limitUp:false}},
  {type:'zt',code:'600004',name:'合成事后',date:'20261109',price:10,prob:70},
  {type:'auczt',code:'600005',name:'合成坏当日',date:'20261109',price:10,prob:70,resolved:{}}
 ],buckets:{},samples:999,hits:999});
 const stop=async()=>{if(child&&child.exitCode===null&&child.signalCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await done;}};
 try{
  for(const p of ['src','scripts','strategies','public','config','package.json'])fs.cpSync(path.join(source,p),path.join(dir,p),{recursive:true});
  for(const p of fs.readdirSync(source))if(p.endsWith('.js'))fs.copyFileSync(path.join(source,p),path.join(dir,p));
  const hash=x=>crypto.createHash('sha256').update(x).digest('hex'),editor=crypto.randomBytes(32).toString('hex'),viewer=crypto.randomBytes(32).toString('hex');
  const account=()=>{const salt=crypto.randomBytes(16).toString('hex');return {salt,hash:crypto.scryptSync('fixture-only-password',salt,32).toString('hex'),devices:{}};};
  const access=account();access.view=account();access.devices[hash(editor)]={role:'edit',ts:Date.now()};access.view.devices[hash(viewer)]={role:'view',ts:Date.now()};fs.writeFileSync(path.join(dir,'access.json'),JSON.stringify(access));
  const preload=path.join(dir,'offline.cjs');fs.writeFileSync(preload,`const fs=require('node:fs'),M=require('node:module'),load=M._load;
const deny=()=>{fs.appendFileSync(${JSON.stringify(egress)},'egress\\n');throw Error('network disabled');};
for(const n of ['node:http','node:https']){const m=require(n);m.get=m.request=deny;}global.fetch=deny;
M._load=function(name,parent,isMain){const result=load.apply(this,arguments);if(parent?.filename===${JSON.stringify(path.join(dir,'server.js'))}&&name==='./em'){
result.fetchKline=async function(code){fs.appendFileSync(${JSON.stringify(calls)},code+'\\n');while(fs.existsSync(${JSON.stringify(hold)}))await new Promise(r=>setTimeout(r,10));if(fs.existsSync(${JSON.stringify(fail)}))throw Error('private-url-must-not-leak');return {src:'synthetic-learning-http',adjust:'qfq',receivedAt:Date.parse('2026-11-10T16:00:00+08:00'),rows:[{date:'2026-11-09',open:10,high:10.2,low:9.9,close:10,volume:100,pct:0},{date:'2026-11-10',open:10.1,high:10.8,low:10,close:10.5,volume:100,pct:5}]};};
result.pool=async function(codes,fn){await Promise.all(codes.map(fn));};}return result;};`);
  const boot=async()=>{fs.writeFileSync(path.join(dir,'stats.json'),JSON.stringify(stats()));const port=await freePort();child=spawn(process.execPath,['--require',preload,'server.js'],{cwd:dir,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',QD_CLOUD:'1',V6_ISOLATED_BOOT_SMOKE:'1'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
   for(let i=0;i<160;i++){if(child.exitCode!==null)throw Error('Isolated learning server exited: '+logs.slice(-600));try{if((await request(port,editor)).body.ok)return port;}catch{}await pause(25);}throw Error('Isolated learning server did not start');};
  let port=await boot();for(const token of ['',viewer])assert.notEqual((await request(port,token)).body.ok,true);
  let r=await request(port,editor);assert.equal(r.body.ok,true);assert.match(r.headers['cache-control'],/no-store/);assert.equal(r.body.status.counts.matured,0);assert.equal(r.body.status.counts.invalid,2);assert.equal(r.body.status.counts.backtest,1);assert.equal(r.body.status.counts.posthoc,1);assert.equal(fs.existsSync(calls),false);
  assert.equal((await request(port,editor,undefined,'GET','?force=1')).body.ok,false);
  for(const body of [{force:true,limit:61},{force:true,limit:0},{force:true,arbitrary:'x'},{force:true,seed:true}])assert.equal((await request(port,editor,body)).body.ok,false);
  fs.writeFileSync(hold,'hold local fixture');const first=request(port,editor,{force:true,limit:2});
  for(let i=0;i<100;i++){r=await request(port,editor);if(r.body.status.operation.state==='running')break;await pause(10);}assert.equal(r.body.status.operation.state,'running');
  r=await request(port,editor,{force:true,limit:2});assert.equal(r.body.ok,false);assert.match(r.body.error,/正在运行/);fs.unlinkSync(hold);
  r=await first;assert.equal(r.body.ok,true);assert.equal(r.body.status.operation.state,'success');assert.equal(r.body.status.operation.attempted,2);assert.equal(r.body.status.operation.fetched,2);assert.equal(r.body.status.operation.newOutcomes,2);assert.equal(r.body.status.counts.matured,2);
  const saved=JSON.parse(fs.readFileSync(path.join(dir,'stats.json'),'utf8')),repaired=saved.signals.find(s=>s.code==='600000');assert.equal(repaired.nd.date,'20261110');assert.equal(repaired.ndLegacy.date,'20261112');assert.equal(fs.readFileSync(calls,'utf8').trim().split('\n').length,2);assert.equal(fs.existsSync(egress),false);
  await stop();fs.writeFileSync(fail,'unavailable source');port=await boot();r=await request(port,editor,{force:true,limit:1});assert.equal(r.body.ok,false);assert.equal(r.body.status.operation.state,'failed');assert.ok(!JSON.stringify(r.body).includes('private-url-must-not-leak'));assert.equal(fs.existsSync(egress),false);
 }finally{if(fs.existsSync(hold))fs.unlinkSync(hold);await stop();fs.rmSync(dir,{recursive:true,force:true});}
});
