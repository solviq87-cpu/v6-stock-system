'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto'),net=require('node:net');
const host=require('../deploy/windows-host/host-runtime');
const runtime=require.resolve('../deploy/windows-host/host-runtime');
const source=fs.readFileSync(runtime,'utf8');
const error=code=>Object.assign(Error('private fixture detail'),{code});
function injectedRuntime(overrides){
 const module={exports:{}};
 const localRequire=name=>name==='node:fs'?{...fs,...overrides}:require(name);
 vm.runInNewContext(source,{require:localRequire,module,process,Buffer,setTimeout,clearTimeout},{filename:runtime});
 return module.exports;
}
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
async function fixture(t,{starter=host,observedPid=()=>null}={}){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'v6-process-inspection-')),bundle=path.join(base,'bundle'),root=path.join(base,'private');
 let original;
 const server="require('node:http').createServer((q,r)=>r.end(JSON.stringify({hasPassword:false}))).listen(+process.env.PORT,process.env.HOST);";
 fs.mkdirSync(path.join(bundle,'payload'),{recursive:true});fs.writeFileSync(path.join(bundle,'payload/server.js'),server);
 fs.writeFileSync(path.join(bundle,'manifest.json'),JSON.stringify({schemaVersion:1,sourceSha:'a'.repeat(40),files:[{path:'server.js',sha256:crypto.createHash('sha256').update(server).digest('hex')}]}));
 t.after(async()=>{
  await host.main(['stop','--home',root]);
  // A failing baseline can archive the PID record while the fixture is alive.
  original ||= host.processIdentity(observedPid());
  if(original&&host.ownedProcess(root,original))process.kill(original.pid,'SIGTERM');
  for(let n=0;original&&host.ownedProcess(root,original)&&n<100;n++)await new Promise(r=>setTimeout(r,10));
  fs.rmSync(base,{recursive:true,force:true});
 });
 assert.equal((await host.main(['init','--home',root,'--bundle',bundle])).code,'initialized');
 const port=await freePort();assert.equal((await starter.main(['start','--home',root,'--smoke'],{port})).code,'started');
 const file=path.join(root,'run/process.json'),bytes=fs.readFileSync(file),state=JSON.parse(bytes);
 original=state;
 return {root,port,file,bytes,state};
}
for(const action of ['check','start','stop'])test(`${action} preserves a live daemon and its record when process inspection is denied`,async t=>{
 const f=await fixture(t),target='/proc/'+f.state.pid+'/cmdline';
 const denied=injectedRuntime({openSync:(file,...args)=>{if(file===target)throw error('EACCES');return fs.openSync(file,...args);}});
 const result=await denied.main([action,'--home',f.root,...(action==='start'?['--smoke']:[])],{port:f.port});
 assert.equal(result.code,'process-inspection-failed');assert.doesNotMatch(JSON.stringify(result),/private fixture|EACCES|\/proc/);
 assert.deepEqual(fs.readFileSync(f.file),f.bytes);assert.equal(process.kill(f.state.pid,0),true);
 assert.equal(fs.readdirSync(path.join(f.root,'run')).some(n=>n.startsWith('process.stopped.')),false);
 // The failed controller releases its lock; a healthy controller still owns the same daemon.
 assert.equal((await host.main(['start','--home',f.root,'--smoke'],{port:f.port})).code,'already-running');
 assert.equal((await host.main(['stop','--home',f.root])).code,'stopped');
});
test('I/O failure reading process stat is unknown, not a stopped process',()=>{
 const target='/proc/'+process.pid+'/stat';
 const faulty=injectedRuntime({openSync:(file,...args)=>{if(file===target)throw error('EIO');return fs.openSync(file,...args);}});
 assert.throws(()=>faulty.processIdentity(process.pid),e=>e.code==='process-inspection-failed');
});
test('missing executable link for a still-live process does not certify its exit',()=>{
 const target='/proc/'+process.pid+'/exe';
 const faulty=injectedRuntime({realpathSync:(file,...args)=>{if(file===target)throw error('ENOENT');return fs.realpathSync(file,...args);}});
 assert.throws(()=>faulty.processIdentity(process.pid),e=>e.code==='process-inspection-failed');
});
test('a process that disappears during inspection remains a confirmed exit',()=>{
 const dir='/proc/'+process.pid;let disappeared=false;
 const exited=injectedRuntime({openSync:(file,...args)=>{
  if(file===dir+'/cmdline'){disappeared=true;throw error('ENOENT');}
  if(file===dir+'/stat'&&disappeared)throw error('ENOENT');
  return fs.openSync(file,...args);
 }});
 assert.equal(exited.processIdentity(process.pid),null);
});
test('a confirmed absent process remains stopped',()=>{
 const target='/proc/'+process.pid+'/stat';
 const absent=injectedRuntime({openSync:(file,...args)=>{if(file===target)throw error('ENOENT');return fs.openSync(file,...args);}});
 assert.equal(absent.processIdentity(process.pid),null);
});
function procFixture(t,{stat,cmd}){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'v6-proc-fixture-'));
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const replacements=new Map();
 for(const [name,value]of [['stat',stat],['cmdline',cmd]])if(value!==undefined){
  const file=path.join(base,name);fs.writeFileSync(file,value);replacements.set('/proc/'+process.pid+'/'+name,file);
 }
 return injectedRuntime({openSync:(file,...args)=>fs.openSync(replacements.get(file)||file,...args)});
}
test('malformed stat is not usable as proof of ownership or exit',t=>{
 const faulty=procFixture(t,{stat:process.pid+' (node) R 0 0\n'});
 assert.throws(()=>faulty.processIdentity(process.pid),e=>e.code==='process-inspection-failed');
});
test('an empty command line with a live stat is unknown',t=>{
 const faulty=procFixture(t,{cmd:''});
 assert.throws(()=>faulty.processIdentity(process.pid),e=>e.code==='process-inspection-failed');
});
test('a confirmed zombie remains stopped without reading its vanished executable',t=>{
 const actual=fs.readFileSync('/proc/'+process.pid+'/stat','utf8'),end=actual.lastIndexOf(')')+2;
 const exited=procFixture(t,{stat:actual.slice(0,end)+'Z'+actual.slice(end+1),cmd:''});
 assert.equal(exited.processIdentity(process.pid),null);
});
test('initial child identity acquisition retries a transient unreadable command line',async t=>{
 let pid=null,attempts=0;
 const starter=injectedRuntime({openSync:(file,...args)=>{
  const match=String(file).match(/^\/proc\/(\d+)\/cmdline$/);
  if(match){pid=Number(match[1]);if(++attempts===1)throw error('EACCES');}
  return fs.openSync(file,...args);
 }});
 const f=await fixture(t,{starter,observedPid:()=>pid});
 assert.ok(attempts>=2);assert.equal((await host.main(['check','--home',f.root])).health,true);
});
