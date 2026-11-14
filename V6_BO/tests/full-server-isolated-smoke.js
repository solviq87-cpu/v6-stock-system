'use strict';
const {spawn}=require('node:child_process');
const http=require('node:http');
const assert=require('node:assert/strict');
const path=require('node:path');
const net=require('node:net');
const fs=require('node:fs');
const os=require('node:os');
const crypto=require('node:crypto');
const source=path.resolve(__dirname,'..');
// Metadata only: never read the source checkout's private configuration/accounts.
function sourceDataInventory(){
 const rows=[];
 function walk(full,relative){
  if(!fs.existsSync(full))return;
  const s=fs.lstatSync(full);rows.push([relative,s.mode,s.size,s.mtimeMs,s.isSymbolicLink()]);
  if(s.isDirectory()&&!s.isSymbolicLink())for(const name of fs.readdirSync(full).sort())walk(path.join(full,name),relative+'/'+name);
 }
 walk(path.join(source,'data'),'data');
 for(const name of fs.readdirSync(source).sort())if(name.endsWith('.json')&&name!=='package.json'&&name!=='package-lock.json')walk(path.join(source,name),name);
 return rows;
}
function isolatedFixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-full-server-smoke-'));
 try{
  // Copy executable/static assets and the two public source catalogs only.
  for(const name of ['src','scripts','strategies','public','package.json'])fs.cpSync(path.join(source,name),path.join(root,name),{recursive:true});
  for(const name of fs.readdirSync(source))if(name.endsWith('.js'))fs.copyFileSync(path.join(source,name),path.join(root,name));
  fs.mkdirSync(path.join(root,'config'));fs.mkdirSync(path.join(root,'tmp'));
  for(const name of ['data-source-catalog.json','six-photo-sources.json'])fs.copyFileSync(path.join(source,'config',name),path.join(root,'config',name));
  const account=()=>{const salt=crypto.randomBytes(16).toString('hex');return {salt,hash:crypto.scryptSync(crypto.randomBytes(32),salt,32).toString('hex'),devices:{}};};
  const access=account();access.view=account();fs.writeFileSync(path.join(root,'access.json'),JSON.stringify(access),{mode:0o600});
  const guard=path.join(root,'smoke-isolation.cjs'),violations=path.join(root,'isolation-violations.log');
  fs.writeFileSync(guard,`'use strict';
const fs=require('node:fs'),path=require('node:path'),{fileURLToPath}=require('node:url');
const root=${JSON.stringify(root)},source=${JSON.stringify(source)},log=${JSON.stringify(violations)},append=fs.appendFileSync.bind(fs);
const deny=kind=>{append(log,kind+'\\n');throw Error('isolated smoke denied '+kind);};
const full=v=>typeof v==='string'?path.resolve(v):Buffer.isBuffer(v)?path.resolve(v.toString()):v instanceof URL?fileURLToPath(v):null;
const inside=(p,base)=>p===base||p.startsWith(base+path.sep);
const read=v=>{const p=full(v);if(p&&inside(p,source))deny('source-checkout-read');};
const write=v=>{const p=full(v);if(p&&!inside(p,root))deny('write-outside-fixture');};
for(const name of ['readFileSync','readFile','createReadStream']){const old=fs[name];fs[name]=function(file,...args){read(file);return old.call(this,file,...args);};}
for(const name of ['openSync','open']){const old=fs[name];fs[name]=function(file,flags,...args){read(file);if(typeof flags==='number'?(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND)):!/^rs?$/.test(flags))write(file);return old.call(this,file,flags,...args);};}
for(const name of ['writeFileSync','writeFile','appendFileSync','appendFile','createWriteStream','mkdirSync','mkdir','rmSync','rm','rmdirSync','rmdir','unlinkSync','unlink','truncateSync','truncate','chmodSync','chmod','chownSync','chown','utimesSync','utimes']){const old=fs[name];fs[name]=function(file,...args){write(file);return old.call(this,file,...args);};}
for(const name of ['renameSync','rename','linkSync','link','symlinkSync','symlink','copyFileSync','copyFile']){const old=fs[name];fs[name]=function(from,to,...args){write(from);write(to);return old.call(this,from,to,...args);};}
for(const name of ['node:http','node:https']){const m=require(name);m.request=m.get=()=>deny('outbound-'+name);}
const net=require('node:net');net.connect=net.createConnection=net.Socket.prototype.connect=()=>deny('outbound-socket');require('node:tls').connect=()=>deny('outbound-tls');
const dns=require('node:dns');for(const m of [dns,dns.promises])for(const name of Object.keys(m))if(/^(lookup|resolve|reverse)/.test(name)){
 const old=m[name];m[name]=function(...args){if(name==='lookup'&&['127.0.0.1','::1'].includes(args[0]))return old.apply(this,args);return deny('outbound-dns');};
}
global.fetch=()=>deny('outbound-fetch');const cp=require('node:child_process'),spawnSync=cp.spawnSync;
for(const name of ['spawn','exec','execSync','execFile','execFileSync','fork'])cp[name]=()=>deny('child-process');
// Existing account initialization needs the local kernel-lock helper, with a fixture-only descriptor.
cp.spawnSync=(command,args,options)=>{
 let file=null;try{file=fs.readlinkSync('/proc/self/fd/'+options?.stdio?.[3]);}catch{}
 if(command==='flock'&&JSON.stringify(args)==='["-n","3"]'&&file&&inside(file,root))return spawnSync('/usr/bin/flock',args,options);
 return deny('child-process');
};
`);
  return {root,guard,violations};
 }catch(error){fs.rmSync(root,{recursive:true,force:true});throw error;}
}
async function stop(child){
 if(!child||child.exitCode!==null||child.signalCode!==null)return;
 const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');
 let timer;await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(resolve,1000);})]);clearTimeout(timer);
 if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}
}
async function port(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
function get(port,url){return new Promise((resolve,reject)=>{const req=http.get({hostname:'127.0.0.1',port,path:url,timeout:1000},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>resolve({status:res.statusCode,body:b,headers:res.headers}));});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('timeout')));});}
(async()=>{
 const before=sourceDataInventory(),fixture=isolatedFixture();let child,logs='',startError;
 try {
  const p=await port();
  // Do not inherit credentials, NODE_OPTIONS or configured paths to real data.
  child=spawn(process.execPath,['--require',fixture.guard,'server.js'],{cwd:fixture.root,env:{PATH:'/usr/bin:/bin',TZ:'UTC',LANG:'C.UTF-8',TMPDIR:path.join(fixture.root,'tmp'),PORT:String(p),HOST:'127.0.0.1',V6_ISOLATED_BOOT_SMOKE:'1',QD_CLOUD:'1',V6_ORDER_ACCOUNTS_DIR:path.join(fixture.root,'data','order-accounts')},stdio:['ignore','pipe','pipe']});
  child.on('error',error=>{startError=error;});child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
  let ready=false;
  for(let i=0;i<60;i++){
   if(startError)throw startError;
   if(child.exitCode!==null)throw Error('server exited: '+logs.slice(-1500));
   try{const r=await get(p,'/api/lock/status');if(r.status===200){ready=true;break;}}catch{}
   await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(ready,'完整 server.js 未在6秒内提供状态接口：'+logs.slice(-1000));
  const status=await get(p,'/api/lock/status');assert.equal(status.status,200);
  const parsed=JSON.parse(status.body);assert.ok(typeof parsed==='object');
  assert.ok(!Object.hasOwn(parsed,'devPwd')&&!Object.hasOwn(parsed,'viewPwd'));
  const index=await get(p,'/');assert.equal(index.status,200);assert.match(index.body,/<!doctype html|<html/i);
  // Dedicated result page must be reachable through the REAL server routes, not
  // merely pass an offline DOM test while silently returning the home fallback.
  const workbookDenied=await get(p,'/api/research/import-workbook');
  assert.equal(JSON.parse(workbookDenied.body).locked,true,'Excel parser must require real authentication before spawning');
  const picks=await get(p,'/picks.html');
  assert.equal(picks.status,200,'/picks.html must be served by V6');
  assert.match(picks.body,/智能选股结果/);
  const reference=await get(p,'/reference-dashboard.html');
  assert.equal(reference.status,200,'reference dashboard shell must remain reachable');
  assert.match(reference.body,/AI 综合选股信号/);
  const picksScript=await get(p,'/assets/picks-page.js');
  assert.equal(picksScript.status,200,'picks viewer script must be served');
  assert.match(picksScript.body,/clearProtectedResults/);
  // A fixture-only UI can hide a deployment 404 of newly introduced chart assets.
  // Verify the REAL server exposes the existing periods, period controller and CSS.
  for(const [url,expected] of [
    ['/assets/picks-periods.js','aggregate'],
    ['/assets/picks-three-k.js','loadOlder'],
    ['/assets/picks-three-k.css','.period-chart'],
  ]){
    const asset=await get(p,url);
    assert.equal(asset.status,200,'V6 service must serve '+url);
    assert.ok(asset.body.includes(expected),'Kline asset has unexpected or missing content '+url);
  }
  const auction=await get(p,'/auction-picks.html');
  assert.equal(auction.status,200,'new auction research shell must be reachable through actual server');
  assert.match(auction.body,/竞价研究观察池/);
  const auctionScript=await get(p,'/assets/auction-picks-page.js');
  assert.equal(auctionScript.status,200,'auction research page script must be served');
  assert.match(auctionScript.body,/\/api\/auction-resonance/);
  assert.match(auctionScript.body,/revoke\(\)/);
  // 真实 HTTP 越权回归：无开发者凭证不可列设备或撤权。
  const devices=await get(p,'/api/lock/devices');
  assert.equal(devices.status,200);
  const denied=JSON.parse(devices.body);
  assert.notEqual(denied.ok,true);
  assert.ok(!Array.isArray(denied.devices) && !Array.isArray(denied.items));
  const post=(url,data)=>new Promise((resolve,reject)=>{
    const body=JSON.stringify(data),req=http.request({hostname:'127.0.0.1',port:p,path:url,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},timeout:1000},res=>{
      let b='';res.on('data',c=>b+=c);res.on('end',()=>resolve({status:res.statusCode,body:b}));
    });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('timeout')));req.end(body);
  });
  const revoke=await post('/api/lock/revoke',{id:'nonexistent',token:''});
  assert.notEqual(JSON.parse(revoke.body).ok,true);
  const missing=await get(p,'/nonexistent-test-asset-xyz');assert.ok([200,404].includes(missing.status));
  console.log('PASS: 完整服务、首页、选股/竞价/参考图页面、脚本、404与无凭证拒绝');
 } finally {
  await stop(child);
  const violations=fs.existsSync(fixture.violations)?fs.readFileSync(fixture.violations,'utf8'):'';
  fs.rmSync(fixture.root,{recursive:true,force:true});
  assert.equal(fs.existsSync(fixture.root),false,'temporary runtime directory must be removed');
  assert.deepEqual(sourceDataInventory(),before,'smoke must not create or modify source data/configuration files');
  assert.equal(violations,'','smoke attempted to read source private data, write outside temp, start a process or use egress: '+violations);
 }
 console.log('PASS: 临时副本启动、合成权限配置、无源码数据变化/私有配置读取/出站，进程与临时运行数据已清理');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
