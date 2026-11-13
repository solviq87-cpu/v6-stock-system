'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {parseArgs,loadConfig,immutableArtifact,runCommand}=require('../scripts/repository-auto-update');
const {TARGET}=require('../src/core/workbuddy-static-publisher');
const A='a'.repeat(40),B='b'.repeat(40),H='c'.repeat(64);
const html=label=>`<!doctype html><html><head><title>${label}</title></head><body><h1>${label}</h1></body></html>`;
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-auto-cli-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const config={schemaVersion:1,repository:'solviq87-cpu/v6-stock-system',branch:'dev',targetOrigin:TARGET,workflowPath:'.github/workflows/v6-ci.yml',requiredJobs:['verify','verify-web'],stateDir:path.join(root,'state'),intervalMs:60000};
 const file=path.join(root,'config.json'),write=()=>fs.writeFileSync(file,JSON.stringify(config),{mode:0o600});write();return {root,config,file,write};}
const source=(sha=A,status='passed')=>({detect:async()=>({sha,ci:{sha,status}})});
test('CLI requires explicit apply and exact bootstrap digest without accepting remote paths or injected flags',()=>{
 assert.equal(parseArgs(['check','/private/config.json']).apply,false);
 assert.equal(parseArgs(['once','/private/config.json']).apply,false);
 assert.equal(parseArgs(['watch','/private/config.json','--apply']).apply,true);
 assert.equal(parseArgs(['bootstrap','/private/config.json','--apply','--expected-legacy-hash',H]).expectedLegacyHash,H);
 assert.equal(parseArgs(['restore-legacy','/private/config.json','--apply','--expected-current-hash',H,'--legacy-snapshot-hash',H]).legacySnapshotHash,H);
 for(const args of [['watch','/p.json'],['check','/p.json','--apply'],['bootstrap','/p.json','--apply'],['restore-legacy','/p.json','--expected-current-hash',H,'--legacy-snapshot-hash',H],['once','relative.json'],['once','/p.json','--token','secret']])assert.throws(()=>parseArgs(args));
});
test('configuration fixes repository branch target and required CI while protecting private files',t=>{
 const f=setup(t);assert.equal(loadConfig(f.file).sourcePath,'V6_WEB/workbuddy/index.html');
 for(const patch of [{targetOrigin:'https://example.com'},{branch:'main'},{requiredJobs:['verify']},{shareCode:'fixture-secret'},{sourcePath:'../holdings.json'},{intervalMs:1000}]){
  const copy={...f.config,...patch};fs.writeFileSync(f.file,JSON.stringify(copy));assert.throws(()=>loadConfig(f.file));
 }
 f.write();fs.chmodSync(f.file,0o644);assert.throws(()=>loadConfig(f.file));fs.chmodSync(f.file,0o600);
 const alias=path.join(f.root,'alias.json');fs.symlinkSync(f.file,alias);assert.throws(()=>loadConfig(alias));
});
test('immutable source comes from the selected commit even when the working tree is edited',async t=>{
 const f=setup(t),repo=path.join(f.root,'repo');fs.mkdirSync(repo);const git=args=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
 git(['init']);git(['config','user.email','fixture@example.invalid']);git(['config','user.name','fixture']);
 const file=path.join(repo,'V6_WEB','workbuddy','index.html');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,html('committed'));
 git(['add','.']);git(['commit','-m','fixture']);const sha=git(['rev-parse','HEAD']);fs.writeFileSync(file,html('uncommitted'));
 const artifact=await immutableArtifact({...f.config,repositoryRoot:repo,sourcePath:'V6_WEB/workbuddy/index.html'},sha,{fetchFile:()=>assert.fail('must not fetch')});
 assert.equal(artifact.sha,sha);assert.match(artifact.html,/committed/);assert.doesNotMatch(artifact.html,/uncommitted/);assert.match(fs.readFileSync(file,'utf8'),/uncommitted/);
});
test('missing local objects fetch immutable SHA content and staging is removed after success or failure',async t=>{
 const f=setup(t),config={...f.config,sourcePath:'V6_WEB/workbuddy/index.html'};let called=0;
 const deps={readGit:async()=>{throw Error('missing');},fetchFile:async(sha,p)=>{called++;assert.equal(sha,A);assert.equal(p,config.sourcePath);return html('approved');}};
 assert.equal((await immutableArtifact(config,A,deps)).sha,A);assert.equal(called,1);
 assert.deepEqual(fs.readdirSync(path.join(config.stateDir,'artifacts')),[]);
 await assert.rejects(()=>immutableArtifact(config,A,{...deps,build:()=>{throw Error('invalid HTML');}}));
 assert.deepEqual(fs.readdirSync(path.join(config.stateDir,'artifacts')),[]);
 await assert.rejects(()=>immutableArtifact(config,'dev',deps));assert.equal(called,2);
});
test('missing deployment credential detects CI but never creates a provider or writes target state',async t=>{
 const f=setup(t);const r=await runCommand(parseArgs(['once',f.file,'--apply']),{env:{},sourceFactory:()=>source(),providerFactory:()=>assert.fail('no credentials')});
 assert.equal(r.code,'credential-required');assert.equal(r.candidateSha,A);assert.equal(fs.existsSync(f.config.stateDir),false);
});
test('check mode records an available update without publishing and apply mode verifies exact deployed identity',async t=>{
 const identity=sha=>({sha,releaseId:'r-'+sha,artifactHash:sha+sha.slice(0,24),targetOrigin:TARGET});
 const f=setup(t);let current=B,writes=0;const provider={expectation:async args=>identity(args.sha),inspect:async()=>identity(current),
  health:async()=>({...identity(current),healthy:true}),apply:async args=>{writes++;current=args.sha;return {...identity(current),receiptId:'receipt'};},rollback:()=>assert.fail('healthy target')};
 const deps={env:{V6_WORKBUDDY_SHARECODE:'fixture-private'},sourceFactory:()=>source(),providerFactory:()=>provider};
 assert.equal((await runCommand(parseArgs(['check',f.file]),deps)).code,'update-available');assert.equal(writes,0);
 assert.equal((await runCommand(parseArgs(['once',f.file,'--apply']),deps)).code,'applied');assert.equal(writes,1);
 assert.equal((await runCommand(parseArgs(['once',f.file,'--apply']),deps)).code,'up-to-date');assert.equal(writes,1);
});
test('bootstrap waits for CI and requires a receipt for the same target and approved commit',async t=>{
 const f=setup(t),options=parseArgs(['bootstrap',f.file,'--apply','--expected-legacy-hash',H]);let calls=0;
 const deps={env:{V6_WORKBUDDY_SHARECODE:'fixture-private'},sourceFactory:()=>source(A,'pending'),providerFactory:()=>({bootstrap:async()=>{calls++;return {sha:A,receiptId:'live-receipt',targetOrigin:TARGET};}})};
 assert.equal((await runCommand(options,deps)).code,'ci-blocked');assert.equal(calls,0);
 deps.sourceFactory=()=>source();assert.equal((await runCommand(options,deps)).code,'bootstrapped');assert.equal(calls,1);
 deps.providerFactory=()=>({bootstrap:async()=>({sha:B,receiptId:'wrong-receipt',targetOrigin:TARGET})});await assert.rejects(()=>runCommand(options,deps));
});
test('continuous deployment is a separate read-only workflow and never runs PR code with the site secret',()=>{
 const root=path.resolve(__dirname,'../..'),workflow=fs.readFileSync(path.join(root,'.github/workflows/workbuddy-auto-update.yml'),'utf8');
 assert.match(workflow,/workflow_run:/);assert.match(workflow,/types: \[completed\]/);assert.match(workflow,/branches: \[dev\]/);
 assert.match(workflow,/workflow_run\.event == 'push'/);assert.match(workflow,/head_repository\.full_name == github\.repository/);
 assert.match(workflow,/cancel-in-progress: false/);assert.match(workflow,/persist-credentials: false/);
 assert.match(workflow,/ref: \$\{\{ steps\.gate\.outputs\.sha \}\}/);
 assert.ok(workflow.indexOf('Independently select a CI-approved publisher revision')<workflow.indexOf('actions/checkout@v4'));
 assert.match(workflow,/V6_WORKBUDDY_SHARECODE: \$\{\{ secrets\.V6_WORKBUDDY_SHARECODE \}\}/);
 assert.doesNotMatch(workflow,/pull_request_target|permissions:\s*write-all|[?&]sharecode=/);
 assert.doesNotMatch(workflow,/cache\/\w+@v4[^]*?path:[^]*?\/artifacts/);
});
test('explicit legacy recovery requires both observed hashes and never needs a GitHub source call',async t=>{
 const f=setup(t),options=parseArgs(['restore-legacy',f.file,'--apply','--expected-current-hash',H,'--legacy-snapshot-hash',H]);
 let calls=0;const deps={env:{V6_WORKBUDDY_SHARECODE:'fixture-private'},sourceFactory:()=>assert.fail('recovery is source-independent'),providerFactory:()=>({
  restoreLegacy:async args=>{calls++;assert.equal(args.expectedCurrentArtifactHash,H);assert.equal(args.legacySnapshotHash,H);return {artifactHash:H,receiptId:'legacy-receipt',targetOrigin:TARGET};}
 })};
 const r=await runCommand(options,deps);assert.equal(r.code,'legacy-restored');assert.equal(calls,1);assert.equal(r.deployedSha,undefined);
 deps.providerFactory=()=>({restoreLegacy:async()=>({artifactHash:'d'.repeat(64),receiptId:'wrong',targetOrigin:TARGET})});await assert.rejects(()=>runCommand(options,deps));
});
