#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),http=require('node:http'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const HASH=/^[a-f0-9]{64}$/,SHA=/^[a-f0-9]{40}$/;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const safeConfig={pushRole:'replica',feishuWebhook:'',feishuSecret:'',feishuSecWebhook:'',feishuSecSecret:'',qqMail:{user:'',authCode:'',to:''},syncUpstream:{enabled:false}};
function fail(code){const e=new Error(code);e.code=code;throw e;}
function requireThat(ok,code){if(!ok)fail(code);}
function rootPath(value,{allowMounted=false}={}){requireThat(typeof value==='string'&&path.isAbsolute(value)&&value===path.resolve(value)&&value!==path.parse(value).root&&(allowMounted||!value.startsWith('/mnt/')),'unsafe-private-path');
 let current=path.parse(value).root;for(const part of value.split('/').filter(Boolean)){requireThat(!['public','www','htdocs'].includes(part.toLowerCase()),'unsafe-private-path');current=path.join(current,part);try{requireThat(!fs.lstatSync(current).isSymbolicLink(),'unsafe-private-path');}catch(e){if(e.code!=='ENOENT')throw e;}}return value;}
function privateDir(dir){rootPath(dir);const st=fs.lstatSync(dir);requireThat(st.isDirectory()&&st.uid===process.getuid()&&!(st.mode&0o077),'unsafe-private-permissions');}
function read(file,limit=8*1024*1024,privateFile=false){
 let fd;
 try{
  // O_NONBLOCK lets fstat reject a FIFO before waiting for another process.
  fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  const st=fs.fstatSync(fd);
  requireThat(st.isFile()&&st.nlink===1&&st.size<=limit,'unsafe-file');
  if(privateFile)requireThat(st.uid===process.getuid()&&!(st.mode&0o077),'unsafe-private-permissions');
  const chunks=[];let total=0;
  // Bound the actual read too: a file can grow after the initial stat.
  while(total<=limit){const buffer=Buffer.alloc(Math.min(65536,limit+1-total)),n=fs.readSync(fd,buffer,0,buffer.length,null);if(!n)break;total+=n;requireThat(total<=limit,'unsafe-file');chunks.push(buffer.subarray(0,n));}
  const after=fs.fstatSync(fd);
  requireThat(['dev','ino','nlink','mode','uid','size','mtimeMs','ctimeMs'].every(k=>after[k]===st[k]),'unsafe-file');
  return Buffer.concat(chunks,total);
 }finally{if(fd!==undefined)fs.closeSync(fd);}
}
function json(file,limit,secret){try{return JSON.parse(read(file,limit,secret));}catch(e){if(e.code&&e.code!=='ENOENT')throw e;fail('invalid-state');}}
function writeNew(file,value){const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function replace(file,value){const temporary=file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';writeNew(temporary,value);fs.renameSync(temporary,file);}
function dependencies(env=process.env){const major=+process.versions.node.split('.')[0],minor=+process.versions.node.split('.')[1];const result={node:{ok:major>22||major===22&&minor>=6,version:process.versions.node}};
 for(const [name,args]of [['python3',['--version']],['curl',['--version']],['flock',['--version']]]){const r=spawnSync(name,args,{encoding:'utf8',timeout:2500,maxBuffer:4096,env:{PATH:env.PATH||'/usr/bin:/bin',LANG:'C.UTF-8'}});const match=(r.stdout||r.stderr||'').match(/\d+\.\d+(?:\.\d+)?/);result[name]={ok:!r.error&&r.status===0,version:match?match[0]:null};}return result;}
function dependencyGate(env){const report=dependencies(env);requireThat(Object.values(report).every(item=>item.ok),'dependencies-not-ready');return report;}
function walk(dir,prefix=''){const result=[];for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const name=prefix?prefix+'/'+entry.name:entry.name,full=path.join(dir,entry.name);requireThat(!entry.isSymbolicLink(),'bundle-symlink');if(entry.isDirectory())result.push(...walk(full,name));else{requireThat(entry.isFile(),'bundle-special-file');result.push(name);}}return result.sort();}
const privatePayload=p=>/^(?:data|durable|node_modules|\.git|\.kline_cache|\.workbuddy)(?:\/|$)/.test(p)||/^(?:config|access|holdings|paper|pushlog|news|stats|learnall|ztpre)\.json$/.test(p)||/(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/.test(p);
function verifyBundle(bundle){rootPath(bundle,{allowMounted:true});const manifest=json(path.join(bundle,'manifest.json'),8*1024*1024),payload=path.join(bundle,'payload');
 requireThat(manifest&&manifest.schemaVersion===1&&SHA.test(manifest.sourceSha)&&Array.isArray(manifest.files)&&manifest.files.length>0&&manifest.files.length<=20000,'invalid-manifest');
 requireThat(fs.lstatSync(payload).isDirectory()&&!fs.lstatSync(payload).isSymbolicLink(),'invalid-payload');const names=new Set();
 for(const f of manifest.files){requireThat(f&&typeof f.path==='string'&&f.path.length<=500&&!f.path.includes('\\')&&!f.path.startsWith('/')&&f.path.split('/').every(p=>p&&p!=='.'&&p!=='..')&&HASH.test(f.sha256)&&!names.has(f.path)&&!privatePayload(f.path),'invalid-manifest');names.add(f.path);}
 requireThat(names.has('server.js'),'server-missing');requireThat(JSON.stringify([...names].sort())===JSON.stringify(walk(payload)),'manifest-file-set-mismatch');
 for(const f of manifest.files)requireThat(digest(read(path.join(payload,f.path),64*1024*1024))===f.sha256,'manifest-hash-mismatch');return {manifest,payload};}
function childEnvironment(env,port,smoke){return {PATH:env.PATH||'/usr/bin:/bin',HOME:os.homedir(),LANG:'C.UTF-8',NODE_ENV:'production',TZ:'Asia/Shanghai',
 HOST:'127.0.0.1',PORT:String(port),QD_CLOUD:'1',QD_PUBLIC_URL:'http://127.0.0.1:'+port,QD_PUSH_FORCE:'0',V6_ENABLE_OFFLINE_ORDER_API:'0',V6_AUTO_STOCK_OBSERVATIONS:'0',
 ...(smoke?{V6_ISOLATED_BOOT_SMOKE:'1'}:{})};}
function smokeGuard(root){return `'use strict';
const fs=require('node:fs');const log=${JSON.stringify(path.join(root,'run/smoke-violations.log'))};
function blocked(code){try{fs.appendFileSync(log,code+'\\n',{mode:0o600});}catch{}const e=new Error(code);e.code=code;throw e;}
function network(){return blocked('SMOKE_NETWORK_BLOCKED');}function child(){return blocked('SMOKE_CHILD_BLOCKED');}
const net=require('node:net');net.connect=network;net.createConnection=network;net.Socket.prototype.connect=network;
for(const name of ['node:http','node:https']){const api=require(name);api.request=network;api.get=network;}
require('node:tls').connect=network;require('node:http2').connect=network;
const dns=require('node:dns'),lookup=dns.lookup;dns.lookup=function(name,...args){if(name==='127.0.0.1'||name==='::1')return lookup.call(this,name,...args);return network();};
for(const name of ['lookupService','resolve','resolve4','resolve6','resolveAny','resolveCaa','resolveCname','resolveMx','resolveNaptr','resolveNs','resolvePtr','resolveSoa','resolveSrv','resolveTxt','reverse'])if(typeof dns[name]==='function')dns[name]=network;
for(const api of [dns.Resolver?.prototype,dns.promises.Resolver?.prototype])if(api)for(const name of Object.getOwnPropertyNames(api))if(/^resolve|^reverse$/.test(name))api[name]=network;
for(const name of Object.keys(dns.promises))if(typeof dns.promises[name]==='function')dns.promises[name]=network;
const dgram=require('node:dgram');dgram.createSocket=network;dgram.Socket.prototype.send=network;dgram.Socket.prototype.connect=network;
globalThis.fetch=network;if(typeof globalThis.WebSocket==='function')globalThis.WebSocket=network;
const cp=require('node:child_process');for(const name of ['spawn','spawnSync','execFile','execFileSync']){const original=cp[name];cp[name]=function(command,args,...rest){
const option=rest[0],fd=option?.stdio?.[3];if((command==='flock'||command==='/usr/bin/flock')&&Array.isArray(args)&&args.length===2&&args[0]==='-n'&&args[1]==='3'&&Number.isInteger(fd)){
 try{if(fs.fstatSync(fd).isFile())return original.call(this,'/usr/bin/flock',args,...rest);}catch{}}
return child();};}cp.exec=child;cp.execSync=child;cp.fork=child;require('node:worker_threads').Worker=child;
`;}
function metadata(root){privateDir(root);const meta=json(path.join(root,'installation.json'),16384,true);requireThat(meta&&meta.schemaVersion===1&&meta.ready===true&&SHA.test(meta.sourceSha)&&HASH.test(meta.manifestHash),'invalid-installation');privateDir(path.join(root,'app'));privateDir(path.join(root,'run'));return meta;}
function safeStartup(root){const config=json(path.join(root,'app/config.json'),16384,true),paper=json(path.join(root,'app/paper.json'),4*1024*1024,true);
 requireThat(config.pushRole==='replica'&&config.syncUpstream?.enabled===false&&['feishuWebhook','feishuSecret','feishuSecWebhook','feishuSecSecret'].every(k=>config[k]==='')&&config.qqMail&&['user','authCode','to'].every(k=>config.qqMail[k]===''),'external-delivery-not-disabled');
 requireThat(paper.pool?.enabled===false&&paper.pre?.enabled===false,'paper-not-disabled');
 const manifestBytes=read(path.join(root,'source-manifest.json'),8*1024*1024,true),meta=metadata(root);requireThat(digest(manifestBytes)===meta.manifestHash,'installed-manifest-changed');const manifest=JSON.parse(manifestBytes);
 // Top-level JSON seeds may be maintained by the server; executable source remains fixed.
 const mutableSeeds=new Set(['themeMap.json','external_data.json','pushgov.json','changes_state.json']);
 for(const f of manifest.files)if(!mutableSeeds.has(f.path))requireThat(digest(read(path.join(root,'app',f.path),64*1024*1024))===f.sha256,'installed-code-changed');return meta;}
function lock(root){privateDir(root);const file=path.join(root,'run/control.lock');let fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_RDWR|fs.constants.O_NOFOLLOW,0o600);const st=fs.fstatSync(fd);if(!st.isFile()||st.uid!==process.getuid()||st.mode&0o077){fs.closeSync(fd);fail('unsafe-lock');}
 const r=spawnSync('flock',['-n','3'],{stdio:['ignore','ignore','ignore',fd],timeout:2000});if(r.error||r.status!==0){fs.closeSync(fd);fail('host-busy');}return ()=>fs.closeSync(fd);}
function processIdentity(pid){if(!Number.isSafeInteger(pid)||pid<=1)return null;try{const dir='/proc/'+pid,stat=read(dir+'/stat',8192).toString(),tail=stat.slice(stat.lastIndexOf(')')+2).split(' '),cmd=read(dir+'/cmdline',16384).toString().split('\0').filter(Boolean);
  if(tail[0]==='Z'||!cmd.length)return null;return {pid,startTime:tail[19],bootId:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),uid:fs.statSync(dir).uid,exe:fs.realpathSync(dir+'/exe'),cwd:fs.realpathSync(dir+'/cwd'),cmd};}catch{return null;}}
function ownedProcess(root,state){const actual=processIdentity(state.pid);return !!actual&&actual.startTime===state.startTime&&actual.bootId===state.bootId&&actual.uid===process.getuid()&&actual.exe===state.exe&&actual.cwd===path.join(root,'app')&&actual.cmd.length===2&&actual.cmd[0]===state.exe&&actual.cmd[1]===path.join(root,'app/server.js');}
function processState(root){try{const value=json(path.join(root,'run/process.json'),16384,true);requireThat(value&&Number.isSafeInteger(value.pid)&&/^\d+$/.test(value.startTime)&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.bootId)&&typeof value.exe==='string'&&path.isAbsolute(value.exe)&&Number.isInteger(value.port)&&value.port>0&&value.port<65536,'invalid-process-record');return value;}catch(e){if(!fs.existsSync(path.join(root,'run/process.json')))return null;throw e;}}
function archiveStoppedRecord(root,state){const actual=processIdentity(state.pid),boot=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();if(actual&&state.bootId===boot)return false;
 fs.renameSync(path.join(root,'run/process.json'),path.join(root,'run','process.stopped.'+crypto.randomBytes(8).toString('hex')+'.json'));return true;}
function health(port){return new Promise(resolve=>{let settled=false;const done=ok=>{if(!settled){settled=true;resolve(ok);}};const req=http.get({host:'127.0.0.1',port,path:'/api/lock/status',timeout:1000},res=>{let size=0;const chunks=[];res.on('data',b=>{size+=b.length;if(size>65536){req.destroy();done(false);}else chunks.push(b);});res.on('end',()=>{try{const value=JSON.parse(Buffer.concat(chunks));done(res.statusCode===200&&typeof value.hasPassword==='boolean');}catch{done(false);}});});req.on('error',()=>done(false));req.on('timeout',()=>{req.destroy();done(false);});});}
function portFree(port){return new Promise(resolve=>{const server=net.createServer();server.on('error',()=>resolve(false));server.listen(port,'127.0.0.1',()=>server.close(()=>resolve(true)));});}
async function initialize({root,bundle},deps={}){rootPath(root);const report=dependencyGate(deps.env||process.env);const {manifest,payload}=verifyBundle(bundle);
 try{fs.lstatSync(root);fail('installation-already-exists');}catch(e){if(e.code!=='ENOENT')throw e;}
 fs.mkdirSync(root,{mode:0o700});fs.mkdirSync(path.join(root,'app'),{mode:0o700});fs.mkdirSync(path.join(root,'run'),{mode:0o700});
 for(const f of manifest.files){const bytes=read(path.join(payload,f.path),64*1024*1024);requireThat(digest(bytes)===f.sha256,'manifest-hash-mismatch');const destination=path.join(root,'app',f.path);fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});writeNew(destination,bytes);}
 writeNew(path.join(root,'app/config.json'),safeConfig);writeNew(path.join(root,'app/paper.json'),{pool:{enabled:false},pre:{enabled:false}});
 writeNew(path.join(root,'run/smoke-guard.cjs'),smokeGuard(root));writeNew(path.join(root,'run/smoke-violations.log'),'');
 const serialized=JSON.stringify(manifest)+'\n';writeNew(path.join(root,'source-manifest.json'),serialized);writeNew(path.join(root,'source-sha'),manifest.sourceSha+'\n');
 writeNew(path.join(root,'installation.json'),{schemaVersion:1,ready:true,sourceSha:manifest.sourceSha,manifestHash:digest(serialized)});
 return {code:'initialized',sourceSha:manifest.sourceSha,dependencies:report,phoneConnected:false};}
async function start({root,smoke=false},deps={}){const env=deps.env||process.env;dependencyGate(env);metadata(root);const release=lock(root);try{const meta=safeStartup(root),old=processState(root);
 if(old){if(ownedProcess(root,old))return {code:'already-running',sourceSha:meta.sourceSha,mode:old.mode,health:await health(old.port),phoneConnected:false};requireThat(archiveStoppedRecord(root,old),'stale-process-record');}
 const port=deps.port||8787;requireThat(await portFree(port),'port-in-use');let child;
 const childEnv=childEnvironment(env,port,smoke);
 if(smoke){const guard=path.join(root,'run/smoke-guard.cjs');requireThat(read(guard,65536,true).toString()===smokeGuard(root),'smoke-guard-changed');childEnv.NODE_OPTIONS='--require '+JSON.stringify(guard);}
 const out=fs.openSync(path.join(root,'run/server.log'),fs.constants.O_CREAT|fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK,0o600);
 try{const stat=fs.fstatSync(out);requireThat(stat.isFile()&&stat.nlink===1&&stat.uid===process.getuid()&&!(stat.mode&0o077),'unsafe-log');
 child=spawn(fs.realpathSync(process.execPath),[path.join(root,'app/server.js')],{cwd:path.join(root,'app'),env:childEnv,detached:true,stdio:['ignore',out,out]});}finally{fs.closeSync(out);}
 let spawnError=false;child.on('error',()=>{spawnError=true;});child.unref();let identity;for(let i=0;i<40&&!spawnError;i++){identity=processIdentity(child.pid);if(identity)break;await sleep(25);}requireThat(identity&&!spawnError,'server-start-failed');
 const state={...identity,port,mode:smoke?'smoke':'normal',sourceSha:meta.sourceSha};delete state.cmd;delete state.cwd;delete state.uid;writeNew(path.join(root,'run/process.json'),state);
 const until=Date.now()+(deps.startupTimeoutMs||10000);while(Date.now()<until){if(!ownedProcess(root,state))fail('server-exited');if(await health(port))return {code:'started',sourceSha:meta.sourceSha,mode:state.mode,health:true,url:'http://127.0.0.1:'+port,phoneConnected:false};await sleep(100);}
 fail('health-not-ready');}finally{release();}}
async function checkHost({root},deps={}){const report=dependencies(deps.env||process.env);try{const meta=metadata(root),state=processState(root),running=state&&ownedProcess(root,state);return {code:running?'running':'stopped',sourceSha:meta.sourceSha,dependencies:report,mode:state?.mode||null,health:running?await health(state.port):false,phoneConnected:false};}catch(e){if(!fs.existsSync(root))return {code:'not-initialized',dependencies:report,health:false,phoneConnected:false};throw e;}}
async function stop({root}){const meta=metadata(root),release=lock(root);try{const state=processState(root);if(!state)return {code:'already-stopped',sourceSha:meta.sourceSha};if(!ownedProcess(root,state)){requireThat(archiveStoppedRecord(root,state),'stale-process-record');return {code:'already-stopped',sourceSha:meta.sourceSha};}process.kill(state.pid,'SIGTERM');const until=Date.now()+5000;while(Date.now()<until&&ownedProcess(root,state))await sleep(50);requireThat(!ownedProcess(root,state),'stop-timeout');fs.unlinkSync(path.join(root,'run/process.json'));return {code:'stopped',sourceSha:meta.sourceSha};}finally{release();}}
function parseArgs(args){const [action,...rest]=args;requireThat(['init','start','check','stop'].includes(action),'usage');let root=path.join(os.homedir(),'.tian-shu-local'),bundle,smoke=false;const seen=new Set();for(let i=0;i<rest.length;i++){const flag=rest[i];requireThat(!seen.has(flag),'usage');seen.add(flag);if(flag==='--home')root=rest[++i];else if(flag==='--bundle'&&action==='init')bundle=rest[++i];else if(flag==='--smoke'&&action==='start')smoke=true;else fail('usage');}rootPath(root);requireThat(action!=='init'||typeof bundle==='string','usage');return {action,root,bundle,smoke};}
const CODES=new Set(['usage','unsafe-private-path','unsafe-private-permissions','unsafe-file','unsafe-lock','unsafe-log','invalid-state','invalid-installation','invalid-process-record','dependencies-not-ready','invalid-manifest','invalid-payload','bundle-symlink','bundle-special-file','server-missing','manifest-file-set-mismatch','manifest-hash-mismatch','installation-already-exists','installed-manifest-changed','installed-code-changed','smoke-guard-changed','external-delivery-not-disabled','paper-not-disabled','host-busy','stale-process-record','port-in-use','server-start-failed','server-exited','health-not-ready','stop-timeout']);
async function main(args,deps={}){try{process.umask(0o077);const options=parseArgs(args);return await ({init:initialize,start,check:checkHost,stop}[options.action])(options,deps);}catch(e){return {code:CODES.has(e?.code)?e.code:'host-operation-failed',phoneConnected:false};}}
if(require.main===module)main(process.argv.slice(2)).then(result=>{process.stdout.write(JSON.stringify(result)+'\n');if(!['initialized','started','already-running','running','stopped','already-stopped'].includes(result.code))process.exitCode=2;});
module.exports={main,parseArgs,verifyBundle,dependencies,childEnvironment,initialize,start,checkHost,stop,processIdentity,ownedProcess};
