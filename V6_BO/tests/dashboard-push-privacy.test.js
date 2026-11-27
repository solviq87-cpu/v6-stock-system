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
function request(port,url,token=''){
 return new Promise((resolve,reject)=>{
  const req=http.get({hostname:'127.0.0.1',port,path:url,timeout:3000,headers:token?{Authorization:'Bearer '+token}:{}},res=>{
   let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>{
    try{resolve({status:res.statusCode,body:JSON.parse(body)});}catch(error){reject(error);}
   });
  });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('HTTP fixture timeout')));
 });
}

test('real state and mobile routes hide private push history from viewers and preserve it for editors',{timeout:20000},async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'v6-dashboard-privacy-'));
 let child,logs='';
 try{
  // Copy executable assets only: never read or copy live configuration or accounts.
  const copy=relative=>fs.cpSync(path.join(source,relative),path.join(tmp,relative),{recursive:true});
  for(const relative of ['src','strategies','public','package.json'])copy(relative);
  fs.mkdirSync(path.join(tmp,'config'));copy('config/data-source-catalog.json');copy('config/six-photo-sources.json');
  for(const relative of fs.readdirSync(source))if(relative.endsWith('.js'))copy(relative);
  // This exercises restoration in a closed session. The same fixture must
  // remain valid when CI runs during trading hours, weekends or holidays.
  const fixtureNow=Date.parse('2026-11-22T10:00:00+08:00');
  const editor=crypto.randomBytes(32).toString('hex'),viewer=crypto.randomBytes(32).toString('hex');
  const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
  const account=()=>{const salt=crypto.randomBytes(16).toString('hex');return {salt,hash:crypto.scryptSync('fixture-password-only',salt,32).toString('hex'),devices:{}};};
  const access=account();access.view=account();
  access.devices[digest(editor)]={role:'edit',name:'fixture editor',ts:fixtureNow};
  access.view.devices[digest(viewer)]={role:'view',name:'fixture viewer',ts:fixtureNow};
  fs.writeFileSync(path.join(tmp,'access.json'),JSON.stringify(access));
  const privateCode='600987',privateTitle='PRIVATE_HISTORY_FIXTURE_TITLE',privateNote='PRIVATE_HISTORY_FIXTURE_NOTE';
  fs.writeFileSync(path.join(tmp,'pushlog.json'),JSON.stringify([{ts:fixtureNow-1000,status:'✅ 已送达(私密)',title:privateTitle,note:privateNote,channel:'飞书·私密',extra:{codes:[privateCode]}}]));
  // A previous process retained public market cards. Exercise both real routes
  // without loading a stock universe or allowing an external network request.
  const snapshotAt=Date.parse('2026-11-20T14:55:00+08:00');
  const snapshotDay=new Date(snapshotAt+8*3600000).toISOString().slice(0,10).replaceAll('-','');
  fs.mkdirSync(path.join(tmp,'data'),{recursive:true});
  fs.writeFileSync(path.join(tmp,'data','market-display-snapshot.json'),JSON.stringify({schemaVersion:1,day:snapshotDay,capturedAt:snapshotAt,
    fields:{stocksAt:snapshotAt,idxRt:{at:snapshotAt,items:[{code:'1.000001',price:3200,quoteAt:snapshotAt}]},
      candidatePool:[{code:'600001',name:'public-snapshot-fixture',price:10,score:60,quoteAt:snapshotAt,quoteSource:'fixture'}],
      sectors:[{name:'public-sector-fixture',pct:1}],trendPool:[{code:'600001',price:10,quoteAt:snapshotAt}]},mood:{upN:10,downN:5}}));
  // Boot mode skips collectors; this additional fixture guard rejects all egress.
  fs.writeFileSync(path.join(tmp,'deny-network.cjs'),"require('node:test').mock.timers.enable({apis:['Date'],now:"+fixtureNow+"});\nfor(const name of ['node:http','node:https']){const m=require(name);m.request=m.get=()=>{throw Error('fixture forbids outbound requests');};}global.fetch=()=>Promise.reject(Error('fixture forbids fetch'));\n");
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
  assert.notEqual((await request(port,'/api/push-log',viewer)).body.ok,true,'fixture viewer must not receive editor rights through localhost');
  assert.equal((await request(port,'/api/push-log',editor)).body.ok,true);
  for(const route of ['/api/state','/api/mobile-digest']){
   const anonymous=await request(port,route);assert.equal(anonymous.body.locked,true,route+' must require authentication');
   const allowed=await request(port,route,editor);assert.equal(allowed.status,200,route+': '+JSON.stringify(allowed.body)+' '+logs.slice(-2000));
   const item=allowed.body.dashboard.pushes.items.find(item=>item.code===privateCode);
   assert.ok(item,route+' must preserve the editor history-only stock');
   assert.equal(item.stage,'history');assert.equal(item.pushHistory[0].title,privateTitle);assert.equal(item.pushHistory[0].note,privateNote);
   const restricted=await request(port,route,viewer);assert.equal(restricted.status,200);
   assert.ok(restricted.body.dashboard,'viewer retains the market dashboard');
   assert.equal(restricted.body.dashboard.rows[0].code,'600001',route+' restores public pool after restart');
   assert.equal(restricted.body.dashboard.indices[0].price,3200);
   assert.equal(restricted.body.dashboard.snapshotDay,snapshotDay);
   assert.equal(restricted.body.dashboard.rows[0].quoteAt,snapshotAt);
   assert.equal(restricted.body.dashboard.isSnapshot,true);
   const serialized=JSON.stringify(restricted.body);
   for(const privateValue of [privateCode,privateTitle,privateNote])assert.ok(!serialized.includes(privateValue),route+' leaked '+privateValue);
   assert.equal(restricted.body.dashboard.pushes.channels.lastDispatch,null);
   assert.ok(restricted.body.dashboard.pushes.items.every(item=>!item.pushHistory.length));
  }
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await stopped;}
  fs.rmSync(tmp,{recursive:true,force:true});
 }
});

test('real public push callbacks retain QQ outcomes with exact signal identity without external sends',async()=>{
 const src=fs.readFileSync(path.join(source,'server.js'),'utf8');
 const start=src.indexOf('function pushAll('),end=src.indexOf('\n}\n',start)+2;
 const deliveryStart=src.indexOf('function prepareRecommendationDelivery('),deliveryEnd=src.indexOf('\n}\n',deliveryStart)+2;
 assert.ok(start>=0&&end>start);
 assert.ok(deliveryStart>=0&&deliveryEnd>deliveryStart);
 const reference={code:'000001',type:'趋势票',ts:Date.now()-1000};
 for(const mailSucceeds of [true,false]){
  const logs=[];
  const context={S:{config:{qqMail:{}}},redactSecrets:value=>value,extractStockCodes:()=>['000001'],inManualPush:()=>false,isReplica:()=>false,
   msgGate:()=>({ok:true}),inQuietHours:()=>false,sseSend(){},mailReady:()=>true,feishuReady:()=>true,
   feishuSend:(_text,callback)=>callback(false,'explicit rejection'),sendResultUnknown:()=>false,
   sendQQMail:()=>mailSucceeds?Promise.resolve():Promise.reject(Error('explicit mail rejection')),
   pushLog:(status,title,extra)=>logs.push({status,title,...extra}),_pushLast:null,console:{log(){},error(){}}};
  vm.createContext(context);vm.runInContext(src.slice(deliveryStart,deliveryEnd)+'\n'+src.slice(start,end),context);
  context.pushAll('000001 fixture market signal',false,{public:true,signalRefs:[reference]});
  await delay(0);
  const mail=logs.find(log=>log.channel==='邮箱');assert.ok(mail,'QQ callback must persist its own outcome');
  assert.equal(mail.status.startsWith('✅'),mailSucceeds);
  assert.deepEqual(JSON.parse(JSON.stringify(mail.extra.signalRefs)),[reference]);
  assert.equal(context._pushLast.sent,mailSucceeds);
 }
});
