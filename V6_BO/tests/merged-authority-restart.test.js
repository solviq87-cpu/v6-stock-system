'use strict';
const {spawn}=require('node:child_process');
const crypto=require('node:crypto');
const http=require('node:http'),net=require('node:net'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
// SSE 是长连接：只读取首个响应块，不等待连接结束。
const streamProbe=(port,token='')=>new Promise((resolve,reject)=>{
 const suffix=token?'?token='+encodeURIComponent(token):'';
 const req=http.get({hostname:'127.0.0.1',port,path:'/api/stream'+suffix,timeout:3000},res=>{
  const status=res.statusCode,contentType=res.headers['content-type']||'';
  res.once('data',chunk=>{resolve({status,contentType,chunk:String(chunk)});res.destroy();});
  res.once('end',()=>resolve({status,contentType,chunk:''}));
  res.once('error',reject);
 });
 req.once('error',reject);req.once('timeout',()=>req.destroy(Error('SSE probe timeout')));
});

const port=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const request=(port,url,method='GET',obj=null,token='',extraHeaders={})=>new Promise((resolve,reject)=>{
 const body=obj===null?'':JSON.stringify(obj);
 const req=http.request({hostname:'127.0.0.1',port,path:url,method,timeout:3000,headers:{...(body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{}),...(token?{'Authorization':'Bearer '+token}:{}),...extraHeaders}},res=>{
  let data='';res.on('data',d=>data+=d);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(data)});}catch{resolve({status:res.statusCode,raw:data});}});
 });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('request timeout')));req.end(body);
});

const test=require('node:test');
test('main HTTP process killed after partial fill recovers one authority, cancellation and idempotency', {timeout:30000}, async()=>{
 const p=await port(),source=path.resolve(__dirname,'..');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'v6-http-'));
 // No user accounts, cache, passwords or holdings copied: isolated temp deployment.
 const copy=(rel)=>{const src=path.join(source,rel),dst=path.join(tmp,rel);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.cpSync(src,dst,{recursive:true});};
 for(const rel of ['server.js','src','strategies','public','package.json'])if(fs.existsSync(path.join(source,rel)))copy(rel);
 for(const f of fs.readdirSync(source))if(f.endsWith('.js')&&f!=='server.js')copy(f);
 const salt=crypto.randomBytes(16).toString('hex');
 fs.writeFileSync(path.join(tmp,'access.json'),JSON.stringify({salt,hash:crypto.scryptSync('isolated-test-password',salt,32).toString('hex'),devices:{}}));
 const calendarDate=new Date(Date.now()+8*3600000).toISOString().slice(0,10);fs.writeFileSync(path.join(tmp,'test-calendar.json'),JSON.stringify({schemaVersion:1,exchange:'SSE',source:'test-only-not-official',from:calendarDate,to:calendarDate,sessions:[{date:calendarDate,open:true}]}));

 let child,logs='';
 const start=async()=>{
  child=spawn(process.execPath,['server.js'],{cwd:tmp,env:{...process.env,PORT:String(p),HOST:'127.0.0.1',QD_CLOUD:'1',V6_ISOLATED_BOOT_SMOKE:'1',V6_TRADING_CALENDAR_FILE:path.join(tmp,'test-calendar.json')},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
  for(let i=0;i<100;i++){
   if(child.exitCode!==null)throw Error('server exited '+logs.slice(-1500));
   try{if((await request(p,'/api/lock/status')).status===200)return;}catch{}
   await delay(50);
  }
  throw Error('server not ready '+logs.slice(-1500));
 };
 const stop=async()=>{if(!child||child.exitCode!==null||child.signalCode!==null)return;const closed=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await closed;};
 const login=async()=>{const r=await request(p,'/api/lock/unlock','POST',{password:'isolated-test-password',role:'edit',fp:'restart-test'});assert.equal(r.body.ok,true,JSON.stringify(r.body));return r.body.token;};
 try{
  await start();let token=await login();
  const command=async b=>{const r=await request(p,'/api/research/order-account','POST',{accountId:'pool',...b},token);assert.equal(r.body.ok,true,JSON.stringify(r.body));return r.body.result;};
  await command({action:'submit',order:{orderId:'restart300',symbol:'600000',side:'buy',quantity:300,limitPrice:10,tradeDate:calendarDate}});
  const quote={symbol:'600000',source:'simulated',tradeDate:calendarDate,timestamp:Date.now(),volumeUnit:'shares',volume:10000,price:10,upperLimit:11,lowerLimit:9,suspended:false,tradable:true};
  const fill={action:'fill',orderId:'restart300',eventId:'restart100',quote};
  const partial=await command(fill);assert.equal(partial.orders.restart300.state.status,'partial');assert.equal(partial.account.cash,98995);assert.equal(partial.account.positions['600000'].quantity,100);
  await stop();await start();token=await login();
  assert.deepEqual(await command({action:'read'}),partial);
  assert.deepEqual(await command(fill),partial);
  const conflict=await request(p,'/api/research/order-account','POST',{accountId:'pool',...fill,quote:{...quote,price:10.01}},token);assert.equal(conflict.body.ok,false);assert.deepEqual(await command({action:'read'}),partial);
  const cancelled=await command({action:'cancel',orderId:'restart300',eventId:'restart-cancel'});assert.equal(cancelled.orders.restart300.state.status,'canceled');
  const legacy=await request(p,'/api/paper','GET',null,token);assert.equal(legacy.body.paper.pool.cash,98995);assert.equal(legacy.body.paper.pool.positions[0].shares,100);
  const view=await request(p,'/api/paper/ledger','GET',null,token);assert.equal(view.body.ok,true,JSON.stringify(view.body));assert.equal(view.body.paper.pool.accounting.cash,98995);assert.equal(view.body.paper.pool.events[0].eventId,'restart100');
  // This quantity is affordable only once the cancelled 200-share reservation is released.
  await command({action:'submit',order:{orderId:'released-cash',symbol:'600001',side:'buy',quantity:9800,limitPrice:10,tradeDate:calendarDate}});
  const final=await command({action:'read'});await stop();
  // A stale compatibility file must never reset the authority on boot.
  fs.writeFileSync(path.join(tmp,'paper.json'),JSON.stringify({pool:{cash:1,positions:{},trades:[]}}));
  await start();token=await login();assert.deepEqual(await command({action:'read'}),final);
  const restored=await request(p,'/api/paper','GET',null,token);assert.equal(restored.body.paper.pool.cash,98995);assert.equal(restored.body.paper.pool.positions[0].shares,100);
 }finally{await stop();fs.rmSync(tmp,{recursive:true,force:true});}
});
