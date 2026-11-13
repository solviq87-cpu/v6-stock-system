'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const http=require('node:http'),net=require('node:net'),{spawn}=require('node:child_process');
const project=path.resolve(__dirname,'..'),at=Date.parse('2026-11-13T09:25:20+08:00'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
function request(port,url,token='',body){return new Promise((resolve,reject)=>{
 const data=body===undefined?'':JSON.stringify(body),req=http.request({hostname:'127.0.0.1',port,path:url,method:body===undefined?'GET':'POST',timeout:5000,
  headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},res=>{
  let text='';res.on('data',part=>text+=part);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch(error){reject(Error(text.slice(0,300)));}});
 });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('HTTP timeout')));req.end(data);
});}
test('real authenticated auction preview keeps same-row review through capture and rejects old or zero-activity rows',{timeout:25000},async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'v6-review-http-'));let child,logs='';
 try{
  const copy=relative=>fs.cpSync(path.join(project,relative),path.join(tmp,relative),{recursive:true});
  for(const relative of ['src','strategies','public','package.json'])copy(relative);
  fs.mkdirSync(path.join(tmp,'config'));for(const relative of ['config/data-source-catalog.json','config/six-photo-sources.json'])copy(relative);
  for(const relative of fs.readdirSync(project))if(relative.endsWith('.js'))copy(relative);
  const editor=crypto.randomBytes(32).toString('hex'),viewer=crypto.randomBytes(32).toString('hex'),digest=value=>crypto.createHash('sha256').update(value).digest('hex');
  const account=()=>{const salt=crypto.randomBytes(16).toString('hex');return {salt,hash:crypto.scryptSync('fixture-only',salt,32).toString('hex'),devices:{}};};
  const access=account();access.view=account();access.devices[digest(editor)]={role:'edit',ts:at};access.view.devices[digest(viewer)]={role:'view',ts:at};
  fs.writeFileSync(path.join(tmp,'access.json'),JSON.stringify(access));
  const rows=Array.from({length:501},(_,i)=>({code:String(600000+i),name:'正常股票'+i,price:10.2,open:10.2,preClose:10,pct:2,
   amount:2e8,volume:1e6,turnover:5,floatCap:1e10,mainPct:2,mainInflow:1e8,listedDate:'2000-01-01',sector:'半导体',
   quoteAt:at-1000,receivedAt:at,quoteSource:'vendor-original',quoteMode:'public-live-unverified',canNotify:true}));
  const rowsFile=path.join(tmp,'source-rows.json');fs.writeFileSync(rowsFile,JSON.stringify(rows));
  const preload=`const fs=require('node:fs'),NativeDate=Date;global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[${at}]));}static now(){return ${at};}};
const em=require('./em.js');em.fetchAllStocks=async()=>JSON.parse(fs.readFileSync('./source-rows.json','utf8'));em.fetchAuctionTicks=async()=>[];
for(const name of ['node:http','node:https']){const m=require(name);m.request=m.get=()=>{throw Error('fixture forbids egress');};}global.fetch=()=>Promise.reject(Error('fixture forbids fetch'));
`;
  fs.writeFileSync(path.join(tmp,'controlled.cjs'),preload);
  const port=await freePort();child=spawn(process.execPath,['--require',path.join(tmp,'controlled.cjs'),'server.js'],{cwd:tmp,env:{...process.env,TZ:'Asia/Shanghai',PORT:String(port),HOST:'127.0.0.1',QD_CLOUD:'1',V6_ISOLATED_BOOT_SMOKE:'1'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',part=>logs+=part);child.stderr.on('data',part=>logs+=part);
  for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error(logs.slice(-1200));try{if((await request(port,'/api/lock/status')).status===200)break;}catch{}await delay(50);}
  for(const token of ['',viewer]){const denied=await request(port,'/api/auction-strong',token,{dry:true});assert.notEqual(denied.body.ok,true);}
  const valid=await request(port,'/api/auction-strong',editor,{dry:true,top:2});assert.equal(valid.body.ok,true,JSON.stringify(valid.body)+'\n'+logs.slice(-1200));assert.equal(valid.body.sent,false);assert.match(valid.body.preview,/竞价强势票/);
  fs.writeFileSync(rowsFile,JSON.stringify(rows.map(row=>({...row,quoteAt:at-60000}))));
  const old=await request(port,'/api/auction-strong',editor,{dry:true,top:2});assert.equal(old.body.ok,false,JSON.stringify(old.body));assert.notEqual(old.body.sent,true);
  fs.writeFileSync(rowsFile,JSON.stringify(rows.map(row=>({...row,amount:0,volume:0}))));
  const zero=await request(port,'/api/auction-strong',editor,{dry:true,top:2});assert.equal(zero.body.ok,false);assert.notEqual(zero.body.sent,true);
  assert.doesNotMatch(logs,/\[priv\] 私密机器人拒收|\[signal-evidence\]/,'preview must not dispatch or create learning signals');
 }finally{if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;}fs.rmSync(tmp,{recursive:true,force:true});}
});
