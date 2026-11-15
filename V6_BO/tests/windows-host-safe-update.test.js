'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const net=require('node:net');
const updater=require('../deploy/windows-host/safe-updater.js');
const runtime=require('../deploy/windows-host/host-runtime.js');
const OLD='a'.repeat(40),NEW='b'.repeat(40),OTHER='c'.repeat(40);
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value)+'\n',{mode:0o600});};
const json=file=>JSON.parse(fs.readFileSync(file));
const error=code=>Object.assign(Error(code),{code});
function fixture(t,{running=true,mutableSeed=false}={}){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'v6-safe-update-'));fs.chmodSync(base,0o700);
 const root=path.join(base,'installation');fs.mkdirSync(root,{mode:0o700});fs.mkdirSync(path.join(root,'run'),{mode:0o700});
 const source={'server.js':'// original server\n','public/index.html':'<!doctype html><title>天枢智策</title>','public/mobile.html':'<!doctype html><title>天枢智策 手机</title>','public/assets/app.css':':root{color:blue}',...(mutableSeed?{'themeMap.json':'{"seed":true}\n'}:{})};
 for(const [file,value]of Object.entries(source))write(path.join(root,'app',file),value);
 const manifest={schemaVersion:1,sourceSha:OLD,files:Object.entries(source).map(([file,value])=>({path:file,sha256:digest(value)}))};
 write(path.join(root,'source-manifest.json'),manifest);write(path.join(root,'source-sha'),OLD+'\n');
 write(path.join(root,'installation.json'),{schemaVersion:1,ready:true,sourceSha:OLD,manifestHash:digest(JSON.stringify(manifest)+'\n')});
 write(path.join(root,'app/config.json'),{pushRole:'replica',syncUpstream:{enabled:false},feishuWebhook:'',feishuSecret:'',feishuSecWebhook:'',feishuSecSecret:'',qqMail:{user:'',authCode:'',to:''}});
 write(path.join(root,'app/paper.json'),{pool:{enabled:false},pre:{enabled:false},balance:123456});
 write(path.join(root,'app/access.json'),{privatePasswordHash:'fixture-only-never-a-real-user'});
 write(path.join(root,'app/data/ledger.json'),{events:[{id:'original',cash:123456}]});
 if(mutableSeed)write(path.join(root,'app/themeMap.json'),{custom:'user sector mappings'});
 const calls=[];
 const host={
  checkHost:async({root:r})=>({code:running?'running':'stopped',mode:'normal',health:running,sourceSha:json(path.join(r,'installation.json')).sourceSha}),
  stop:async()=>{calls.push('stop');running=false;return{code:'stopped'};},
  start:async({root:r,smoke})=>{const sha=json(path.join(r,'installation.json')).sourceSha;calls.push('start:'+sha+':'+smoke);running=true;return{code:'started',health:true};}
 };
 const candidate={sha:NEW,changed:true,files:['V6_BO/public/assets/app.css'],ciUrls:['https://github.com/solviq87-cpu/v6-stock-system/actions/runs/1','https://github.com/solviq87-cpu/v6-stock-system/actions/runs/2']};
 const deps={runtime:host,validateInstalled:runtime.safeStartup,discover:async()=>candidate,prepare:async(c,work)=>{
   const bundle=path.join(work,'bundle');const next={...source,'public/assets/app.css':':root{color:cyan}'};
   for(const[file,value]of Object.entries(next))write(path.join(bundle,'payload',file),value);
   const files=Object.entries(next).map(([file,value])=>({path:file,sha256:digest(value)}));
   return{bundle,manifest:{schemaVersion:1,sourceSha:c.sha,files},packageHash:'f'.repeat(64),tests:17,skipped:0};
  },verifyInstalled:async()=>4};
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 return{base,root,deps,calls,candidate,get running(){return running;}};
}
function ciEvidence(sha=NEW){
 return[{name:'V6 CI',head_sha:sha,head_branch:'dev',event:'push',status:'completed',conclusion:'success',html_url:'https://github.com/solviq87-cpu/v6-stock-system/actions/runs/12',jobs:[{name:'verify',status:'completed',conclusion:'success'},{name:'verify-web',status:'completed',conclusion:'success'}]},
 {name:'V6 UI Browser Geometry',head_sha:sha,head_branch:'dev',event:'push',status:'completed',conclusion:'success',html_url:'https://github.com/solviq87-cpu/v6-stock-system/actions/runs/13',jobs:[{name:'visual-geometry',status:'completed',conclusion:'success'}]},
 {context:'v6/per-commit-smoke',sha,state:'success',target_url:'https://github.com/solviq87-cpu/v6-stock-system/actions/runs/14/attempts/1'}];
}
test('default CLI is a fixed-source dry-run and rejects arbitrary repository/unsafe paths',()=>{
 assert.equal(updater.parseArgs([]).action,'check');
 assert.throws(()=>updater.parseArgs(['check','--repo','https://other.example']),e=>e.code==='update-usage');
 assert.throws(()=>updater.parseArgs(['check','--home','/mnt/c/runtime']),e=>e.code==='unsafe-update-path');
 assert.throws(()=>updater.parseArgs(['apply','--approve-sensitive','dev']),e=>e.code==='update-usage');
});
test('exact SHA, V6 CI jobs, applicable browser CI and per-commit smoke must all succeed',()=>{
 assert.equal(updater.ciGate(NEW,ciEvidence(),true).length,3);
 for(const change of [e=>e[0].head_sha=OLD,e=>e[0].event='pull_request',e=>e[0].conclusion='failure',e=>e[0].status='in_progress',e=>e[0].jobs[0].conclusion='skipped',e=>e[0].jobs.shift(),e=>e[1].conclusion='failure',e=>e[2].sha=OLD,e=>e[2].state='pending',e=>e[0].html_url='https://other.example/1']){
  const evidence=ciEvidence();change(evidence);assert.throws(()=>updater.ciGate(NEW,evidence,true));
 }
});
test('discovery checks every introduced commit smoke and rejects stale successful reruns',async()=>{
 const evidence=ciEvidence();
 const fetchImpl=async url=>{
  const p=new URL(url).pathname;
  let value;
  if(p.endsWith('/branches/dev'))value={commit:{sha:NEW}};
  else if(p.includes('/compare/'))value={status:'ahead',merge_base_commit:{sha:OLD},commits:[{sha:OTHER},{sha:NEW}],ahead_by:2,files:[{filename:'V6_BO/public/index.html'}]};
  else if(p.includes('/workflows/')){const run=p.includes('v6-ui-browser')?evidence[1]:evidence[0];value={total_count:1,workflow_runs:[{...run,id:p.includes('v6-ui-browser')?13:12,run_attempt:1,run_number:1}]};}
  else if(p.includes('/attempts/'))value={total_count:p.includes('/13/')?1:2,jobs:p.includes('/13/')?evidence[1].jobs:evidence[0].jobs};
  else if(p.includes('/commits/'))value=[{...evidence[2],state:p.includes(OTHER)?'failure':'success'}];
  else throw Error(p);
  return new Response(JSON.stringify(value),{status:200});
 };
 await assert.rejects(updater.discover(OLD,{fetchImpl}),e=>e.code==='candidate-smoke-not-green');
});
test('no network leaves the original service, accounts and executable untouched',async t=>{
 const f=fixture(t),before=updater.treeManifest(f.root);
 f.deps.discover=async()=>{throw error('update-network-unavailable');};
 const result=await updater.update({root:f.root,action:'apply'},f.deps);
 assert.equal(result.code,'update-network-unavailable');assert.deepEqual(updater.treeManifest(f.root),before);assert.equal(f.running,true);assert.deepEqual(f.calls,[]);
 assert.equal(json(path.join(f.root+'.updater','last-check.json')).code,result.code);
});
test('unchanged candidate does not build or restart',async t=>{
 const f=fixture(t);f.deps.discover=async()=>({sha:OLD,changed:false});f.deps.prepare=async()=>assert.fail('must not build');
 assert.equal((await updater.update({root:f.root,action:'apply'},f.deps)).code,'no-update');assert.deepEqual(f.calls,[]);
});
test('dry-run reports candidate and CI without touching live state',async t=>{
 const f=fixture(t),before=updater.treeManifest(f.root);f.deps.prepare=async()=>assert.fail('dry run must not build');
 const result=await updater.update({root:f.root,action:'check'},f.deps);
 assert.equal(result.code,'update-available');assert.equal(result.dryRun,true);assert.deepEqual(updater.treeManifest(f.root),before);assert.deepEqual(f.calls,[]);
});
test('ledger/schema/server/controller changes require approval bound to this exact candidate',async t=>{
 const f=fixture(t);f.candidate.files=['V6_BO/src/core/paper-account-ledger.js'];
 assert.equal((await updater.update({root:f.root,action:'apply'},f.deps)).code,'sensitive-update-approval-required');
 assert.equal((await updater.update({root:f.root,action:'apply',approveSensitive:OLD},f.deps)).code,'sensitive-update-approval-required');
 assert.deepEqual(f.calls,[]);
 assert.equal(updater.sensitiveChange(['V6_BO/src/core/storage-schema.js']),true);
 assert.equal(updater.sensitiveChange(['V6_BO/config/records.schema.json']),true);
});
test('candidate changing during staging cannot stop the installed writer',async t=>{
 const f=fixture(t);let count=0;f.deps.discover=async()=>({...f.candidate,sha:++count===1?NEW:OTHER});
 assert.equal((await updater.update({root:f.root,action:'apply'},f.deps)).code,'candidate-changed-during-validation');assert.deepEqual(f.calls,[]);
});
test('candidate CI failure and migration preparation failure occur before downtime',async t=>{
 for(const code of ['candidate-ci-not-green','candidate-tests-failed','candidate-package-wrong-sha','migration-failed']){
  const f=fixture(t);f.deps.prepare=async()=>{throw error(code);};
  assert.equal((await updater.update({root:f.root,action:'apply'},f.deps)).code,code);assert.equal(f.running,true);assert.deepEqual(f.calls,[]);
 }
});
test('successful atomic update preserves accounts, credentials, archive, old executable and cold restore evidence',async t=>{
 const f=fixture(t);const account=fs.readFileSync(path.join(f.root,'app/paper.json'));
 const result=await updater.update({root:f.root,action:'apply'},f.deps);
 assert.equal(result.code,'local-update-installed');assert.equal(result.backupVerified,true);assert.equal(result.restoreRehearsed,true);assert.equal(result.phoneHttpsVerified,false);assert.equal(result.windowsVerified,false);assert.equal(result.productionDeployed,false);
 assert.deepEqual(fs.readFileSync(path.join(f.root,'app/paper.json')),account);assert.equal(json(path.join(f.root,'installation.json')).sourceSha,NEW);assert.equal(json(path.join(f.root,'installation.json')).ready,true);
 assert.equal(fs.readFileSync(path.join(f.root,'app/public/assets/app.css'),'utf8'),':root{color:cyan}');
 const state=f.root+'.updater',previous=fs.readdirSync(state).find(name=>name.startsWith('previous-'));
 assert.equal(json(path.join(state,previous,'installation.json')).sourceSha,OLD);assert.equal(json(path.join(state,'transaction.json')).phase,'completed');
 assert.equal(f.running,true);assert.equal(f.calls.filter(value=>value==='start:'+NEW+':false').length,1);
});
test('mutable source seeds are retained as private user state across the release',async t=>{
 const f=fixture(t,{mutableSeed:true});const seed=fs.readFileSync(path.join(f.root,'app/themeMap.json'));
 const result=await updater.update({root:f.root,action:'apply'},f.deps);
 assert.equal(result.code,'local-update-installed');assert.deepEqual(fs.readFileSync(path.join(f.root,'app/themeMap.json')),seed);
});
test('a deliberately stopped installation stays stopped after verification',async t=>{
 const f=fixture(t,{running:false});assert.equal((await updater.update({root:f.root,action:'apply'},f.deps)).code,'local-update-installed');assert.equal(f.running,false);
 assert.equal(f.calls.filter(value=>value==='start:'+NEW+':false').length,0);
});
for(const point of ['stopped','backup-verified','before-switch','old-root-moved','new-version-verified','before-complete'])test('failure at '+point+' restores the previous executable and private state',async t=>{
 const f=fixture(t);const state=updater.privateStateManifest(f.root);f.deps.step=async phase=>{if(phase===point)throw error('injected-update-failure');};
 const result=await updater.update({root:f.root,action:'apply'},f.deps);
 assert.equal(result.code,'injected-update-failure');assert.equal(result.rollback,'restored-previous-executable');assert.equal(json(path.join(f.root,'installation.json')).sourceSha,OLD);assert.equal(json(path.join(f.root,'installation.json')).ready,true);assert.deepEqual(updater.privateStateManifest(f.root),state);assert.equal(f.running,true);
});
for(const [point,folder,expected]of [['backup-copied','backup-','backup-integrity-failed'],['restore-copied','restore-rehearsal-','backup-restore-rehearsal-failed']])test('corrupt '+folder+' fails before cutover and retains live account',async t=>{
 const f=fixture(t);f.deps.step=async phase=>{if(phase===point){const state=f.root+'.updater';const dir=fs.readdirSync(state).find(name=>name.startsWith(folder));write(path.join(state,dir,'app/paper.json'),{corrupt:true});}};
 const result=await updater.update({root:f.root,action:'apply'},f.deps);assert.equal(result.code,expected);assert.equal(result.rollback,'restored-previous-executable');assert.equal(json(path.join(f.root,'app/paper.json')).balance,123456);assert.equal(f.running,true);
});
test('a terminal journal with non-ready metadata is reported as interrupted rather than healthy',async t=>{
 const f=fixture(t),state=f.root+'.updater';fs.mkdirSync(state,{mode:0o700});
 write(path.join(state,'transaction.json'),{schemaVersion:1,phase:'completed',candidateSha:NEW,token:'private-test-token'});
 write(path.join(f.root,'installation.json'),{...json(path.join(f.root,'installation.json')),ready:false});
 assert.equal((await updater.update({root:f.root,action:'status'},f.deps)).code,'interrupted-update-needs-recovery');
});
test('bad package hash fails before any new executable starts and retains account bytes',async t=>{
 const f=fixture(t),prepare=f.deps.prepare;f.deps.prepare=async(...args)=>{const p=await prepare(...args);write(path.join(p.bundle,'payload/public/assets/app.css'),'CORRUPTED');return p;};
 const result=await updater.update({root:f.root,action:'apply'},f.deps);assert.equal(result.code,'candidate-package-hash-mismatch');assert.equal(result.rollback,'restored-previous-executable');assert.equal(json(path.join(f.root,'installation.json')).sourceSha,OLD);
 assert.equal(f.calls.some(value=>value.startsWith('start:'+NEW)),false);
});
test('candidate startup failure restores the prior executable, rather than only restoring data',async t=>{
 const f=fixture(t),start=f.deps.runtime.start;f.deps.runtime.start=async options=>{if(json(path.join(options.root,'installation.json')).sourceSha===NEW)throw error('candidate-start-failed');return start(options);};
 const result=await updater.update({root:f.root,action:'apply'},f.deps);
 assert.equal(result.code,'candidate-start-failed');assert.equal(result.rollback,'restored-previous-executable');assert.equal(json(path.join(f.root,'installation.json')).sourceSha,OLD);assert.equal(f.running,true);
});
test('new private events prohibit destructive data rollback and block old launchers through ready=false',async t=>{
 const f=fixture(t);f.deps.verifyInstalled=async root=>{write(path.join(root,'app/data/ledger.json'),{events:[{id:'new-legally-committed-event'}]});return 4;};
 const result=await updater.update({root:f.root,action:'apply'},f.deps);
 assert.equal(result.code,'update-recovery-required');assert.equal(result.rollback,'rollback-private-transactions-detected');assert.equal(result.newStartsBlocked,true);
 assert.equal(json(path.join(f.root,'app/data/ledger.json')).events[0].id,'new-legally-committed-event');assert.equal(json(path.join(f.root,'installation.json')).ready,false);
});
test('rollback startup failure retains private backups and a recovery journal',async t=>{
 const f=fixture(t);f.deps.runtime.start=async()=>{throw error('start-failed');};
 const result=await updater.update({root:f.root,action:'apply'},f.deps);
 assert.equal(result.code,'update-recovery-required');assert.equal(json(path.join(f.root+'.updater','transaction.json')).phase,'recovery-required');assert.equal(json(path.join(f.root,'installation.json')).sourceSha,OLD);assert.equal(json(path.join(f.root,'installation.json')).ready,false);
});
test('cold backup rejects symlinks instead of leaking files or following private paths',async t=>{
 const f=fixture(t);fs.symlinkSync('/etc/passwd',path.join(f.root,'app/data/escape'));
 const result=await updater.update({root:f.root,action:'apply'},f.deps);
 assert.equal(result.code,'unsafe-backup-entry');assert.equal(result.rollback,'restored-previous-executable');assert.equal(json(path.join(f.root,'installation.json')).sourceSha,OLD);
});
test('flock prevents a second updater and nested reentry',async t=>{
 const f=fixture(t);f.deps.step=async phase=>{if(phase==='stopped')await assert.rejects(updater.update({root:f.root,action:'check'},f.deps),e=>e.code==='updater-busy');};
 assert.equal((await updater.update({root:f.root,action:'apply'},f.deps)).code,'local-update-installed');
});
test('pause survives process restart and resume is explicit',async t=>{
 const f=fixture(t);assert.equal((await updater.update({root:f.root,action:'pause'},f.deps)).code,'updates-paused');
 assert.equal((await updater.update({root:f.root,action:'check'},f.deps)).code,'updates-paused');assert.equal((await updater.update({root:f.root,action:'status'},f.deps)).paused,true);
 assert.equal((await updater.update({root:f.root,action:'resume'},f.deps)).code,'updates-resumed');assert.equal((await updater.update({root:f.root,action:'check'},f.deps)).code,'update-available');
});
test('an interrupted transaction after Windows reboot is never silently treated as a completed upgrade',async t=>{
 const f=fixture(t);const state=f.root+'.updater';fs.mkdirSync(state,{mode:0o700});
 write(path.join(state,'transaction.json'),{schemaVersion:1,phase:'switching',candidateSha:NEW,token:'private-test-token'});
 const result=await updater.update({root:f.root,action:'apply'},f.deps);
 assert.equal(result.code,'interrupted-update-needs-recovery');assert.equal(result.newStartsBlocked,true);assert.deepEqual(f.calls,[]);
 const cli=spawnSync(process.execPath,[require.resolve('../deploy/windows-host/safe-updater.js'),'check','--home',f.root],{encoding:'utf8'});
 assert.equal(cli.status,2);assert.equal(JSON.parse(cli.stdout).code,result.code);assert.equal(cli.stdout.includes('private-test-token'),false);
});
test('private audit output does not expose passwords, account contents or transaction token',async t=>{
 const f=fixture(t);await updater.update({root:f.root,action:'apply'},f.deps);
 const output=JSON.stringify(await updater.update({root:f.root,action:'status'},f.deps));
 assert.equal(output.includes('fixture-only-never-a-real-user'),false);assert.equal(output.includes('privatePasswordHash'),false);assert.equal(output.includes('"token"'),false);
});
async function realHttpFixture(t){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'v6-updater-real-http-'));fs.chmodSync(base,0o700);
 const root=path.join(base,'host'),baseBundle=path.join(base,'base-bundle');
 const server=`'use strict';const http=require('node:http'),fs=require('node:fs'),path=require('node:path');http.createServer((q,r)=>{if(q.url==='/api/lock/status'){r.setHeader('Content-Type','application/json');r.end(JSON.stringify({hasPassword:false}));return;}const url=new URL(q.url,'http://localhost').pathname;const name=url==='/'?'index.html':url==='/m'?'mobile.html':url.replace(/^\\//,'');try{r.end(fs.readFileSync(path.join(__dirname,'public',name)));}catch{r.statusCode=404;r.end();}}).listen(Number(process.env.PORT),process.env.HOST);`;
 const source={'server.js':server,'public/index.html':'<!doctype html><title>天枢智策</title><link href="/assets/app.css" rel="stylesheet">','public/mobile.html':'<!doctype html><title>天枢智策 手机</title><link href="/assets/app.css" rel="stylesheet">','public/assets/app.css':'body{color:blue}'};
 function manifest(sha,files){return{schemaVersion:1,sourceSha:sha,files:Object.entries(files).map(([file,value])=>({path:file,sha256:digest(value)}))};}
 for(const[file,value]of Object.entries(source))write(path.join(baseBundle,'payload',file),value);
 write(path.join(baseBundle,'manifest.json'),manifest(OLD,source));
 await runtime.initialize({root,bundle:baseBundle});
 write(path.join(root,'app/private-ledger-fixture.json'),{events:[{id:'synthetic-preserved-event',balance:10000}]});
 const port=await new Promise(resolve=>{const probe=net.createServer();probe.listen(0,'127.0.0.1',()=>{const p=probe.address().port;probe.close(()=>resolve(p));});});
 const host={...runtime,start:(options,control)=>runtime.start(options,{...control,port})};
 const candidate={sha:NEW,changed:true,files:['V6_BO/public/assets/app.css'],ciUrls:['https://github.com/solviq87-cpu/v6-stock-system/actions/runs/1','https://github.com/solviq87-cpu/v6-stock-system/actions/runs/2']};
 const deps={runtime:host,discover:async()=>candidate,prepare:async(c,work)=>{const bundle=path.join(work,'candidate-bundle'),files={...source,'public/assets/app.css':'body{color:cyan}'};for(const[file,value]of Object.entries(files))write(path.join(bundle,'payload',file),value);return{bundle,manifest:manifest(c.sha,files),packageHash:'f'.repeat(64),tests:1,skipped:0};}};
 t.after(async()=>{const txFile=path.join(root+'.updater','transaction.json');const token=fs.existsSync(txFile)?json(txFile).token:undefined;try{await runtime.stop({root},{updateToken:token});}finally{fs.rmSync(base,{recursive:true,force:true});}});
 await host.start({root,smoke:true});
 return{root,port,deps};
}
test('real Linux runtime performs cold stop, HTTP-verified source switch, preserved state and restart',async t=>{
 const f=await realHttpFixture(t);const ledger=fs.readFileSync(path.join(f.root,'app/private-ledger-fixture.json'));
 const result=await updater.update({root:f.root,action:'apply'},f.deps);
 assert.equal(result.code,'local-update-installed',JSON.stringify(result));assert.equal(result.verifiedAssets,2);
 assert.equal((await runtime.checkHost({root:f.root})).sourceSha,NEW);
 assert.equal(await (await fetch('http://127.0.0.1:'+f.port+'/assets/app.css')).text(),'body{color:cyan}');
 assert.deepEqual(fs.readFileSync(path.join(f.root,'app/private-ledger-fixture.json')),ledger);
});
test('real Linux runtime restores the old executable and HTTP resources after post-start rejection',async t=>{
 const f=await realHttpFixture(t);f.deps.verifyInstalled=async()=>{throw error('candidate-served-resource-mismatch');};
 const result=await updater.update({root:f.root,action:'apply'},f.deps);
 assert.equal(result.rollback,'restored-previous-executable',JSON.stringify(result));
 assert.equal((await runtime.checkHost({root:f.root})).sourceSha,OLD);
 assert.equal(await (await fetch('http://127.0.0.1:'+f.port+'/assets/app.css')).text(),'body{color:blue}');
 assert.equal(json(path.join(f.root,'app/private-ledger-fixture.json')).events[0].id,'synthetic-preserved-event');
});
