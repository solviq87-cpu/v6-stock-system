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
  // The public intake's bounded curl subprocess is mocked too: this test never dials a vendor.
  const bin=path.join(tmp,'fixture-bin');fs.mkdirSync(bin);
  const historyRaw={rc:0,data:{code:'600000',market:1,name:'capture-fixture',klines:['2025-01-01,10,10.1,10.2,9.9,100,100000,3,1,.1,1','2025-01-02,10.1,10.2,10.3,10,200,200000,3,1,.1,1','2025-01-03,10.2,10.3,10.4,10.1,300,300000,3,1,.1,1']}};
  fs.writeFileSync(path.join(bin,'curl'),'#!'+process.execPath+'\nconst args=process.argv.slice(2),target=args.at(-1);if(!target.startsWith("https://push2his.eastmoney.com/api/qt/stock/kline/get?"))process.exit(2);const body=args[args.indexOf("--output")+1];if(!body||args.indexOf("--output")<0)process.exit(3);require("node:fs").writeFileSync(body,'+JSON.stringify(JSON.stringify(historyRaw))+');process.stdout.write("HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\n\\r\\n");\n',{mode:0o700});
  const port=await freePort();
  child=spawn(process.execPath,['--require',path.join(tmp,'deny-network.cjs'),'server.js'],{
   cwd:tmp,env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,PORT:String(port),HOST:'127.0.0.1',QD_CLOUD:'1',V6_ISOLATED_BOOT_SMOKE:'1'},stdio:['ignore','pipe','pipe']
  });
  child.stdout.on('data',chunk=>logs+=chunk);child.stderr.on('data',chunk=>logs+=chunk);
  let ready=false;
  for(let i=0;i<100;i++){
   if(child.exitCode!==null)throw Error('fixture server exited: '+logs.slice(-1500));
   try{if((await request(port,'/api/lock/status')).status===200){ready=true;break;}}catch{}
   await delay(50);
  }
  assert.ok(ready,'fixture server did not start: '+logs.slice(-1500));
  for(const route of ['/api/research/agent-status','/api/research/public-factors','/api/research/linked-intelligence','/api/research/stock-memory?symbol=600001','/api/research/public-context','/api/research/observe-stock','/api/research/stock-observations?symbol=600000&provider=eastmoney','/api/research/stock-observation-status','/api/research/public-sectors']){
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
  assert.equal((await request(port,'/api/research/linked-intelligence',editor)).status,405);
  assert.equal((await request(port,'/api/research/public-context',editor,{symbol:'not-a-stock'})).status,422);
  assert.equal((await request(port,'/api/research/stock-memory?symbol=../config',editor)).status,400);
  const asOf=Date.parse('2025-01-03T16:00:00+08:00');
  const history={schemaVersion:1,asOf,persist:true,tradeDates:['2025-01-01','2025-01-02','2025-01-03','2025-01-06'],
    stocks:[{symbol:'600001',name:'history-fixture',source:'http-fixture',priceBasis:'unadjusted',observedAt:asOf,
      bars:['2025-01-01','2025-01-02','2025-01-03'].map(date=>({date,open:10,high:11,low:9,close:10,volume:1000}))}]};
  const linked=await request(port,'/api/research/linked-intelligence',editor,history);
  assert.equal(linked.status,200);assert.equal(linked.body.result.canTrade,false);
  assert.equal(linked.body.result.stocks[0].forecast.direction.probability,null);
  assert.equal(linked.body.result.stocks[0].memory.status,'saved');
  const memory=await request(port,'/api/research/stock-memory?symbol=600001',editor);
  assert.equal(memory.status,200);assert.equal(memory.body.result.totalRevisions,1);
  assert.equal(memory.body.result.revisions[0].stock.bars.length,3);
  assert.equal(memory.body.result.forwardValidation.direction.evaluated,0);
  assert.ok(!JSON.stringify(memory.body).includes(tmp));
  assert.equal((await request(port,'/api/research/observe-stock',editor)).status,405);
  assert.equal((await request(port,'/api/research/observe-stock',editor,{symbol:'bad'})).status,422);
  assert.equal((await request(port,'/api/research/stock-observations?symbol=600000&provider=auto',editor)).status,400);
  const observed=await request(port,'/api/research/observe-stock',editor,{symbol:'600000',provider:'eastmoney',historyDays:3});
  assert.equal(observed.status,200);assert.equal(observed.body.result.status,'captured',JSON.stringify(observed.body.result.history?.errors));assert.equal(observed.body.result.stock.bars.length,3);
  assert.equal(observed.body.result.stock.bars[0].volume,10000);assert.equal(observed.body.result.stock.bars[0].suspended,undefined);
  assert.equal(observed.body.result.canTrade,false);assert.ok(!JSON.stringify(observed.body).includes(tmp));
  const stored=await request(port,'/api/research/stock-observations?symbol=600000&provider=eastmoney',editor);
  assert.equal(stored.status,200);assert.equal(stored.body.result.observation.revision,1);assert.equal(stored.body.result.stock.bars.at(-1).close,10.3);
  const observerStatus=await request(port,'/api/research/stock-observation-status',editor);
  assert.equal(observerStatus.status,200);assert.equal(observerStatus.body.enabled,false);assert.equal(observerStatus.body.canTrade,false);
  assert.equal(observerStatus.body.researchFollowups.counts.total,0);assert.equal(observerStatus.body.dailyResearch.counts.watches,1);
  assert.ok(!JSON.stringify(observerStatus.body).includes(tmp));
  const sectors=await request(port,'/api/research/public-sectors',editor);
  assert.equal(sectors.status,200);assert.equal(sectors.body.result.selectionRequired,true);
  assert.equal((await request(port,'/api/research/public-sectors',editor,{boards:[{category:'industry',code:'https://evil'}]})).status,422);
  assert.equal((await request(port,'/api/research/public-sectors',editor,{boards:[]})).status,422);
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await stopped;}
  fs.rmSync(tmp,{recursive:true,force:true});
 }
});

