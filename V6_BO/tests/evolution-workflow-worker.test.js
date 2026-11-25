'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {runWorkspaceJob}=require('../src/server/research-workspace-job');
const store=require('../src/core/research-workspace-store');
function storage(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'evolution-worker-'));fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
const command=(workspaceRoot,id)=>({action:'evolution-preferences',workspaceRoot,replica:false,input:{action:'preferences',requestId:id,expectedRevision:0,value:{selectedCode:'600001'}}});

test('real queued preference worker rechecks revoked authority before starting',{timeout:15000},async t=>{
 const root=storage(t),workspaceRoot=path.join(root,'workspace');let allowed=true,calls=0;
 const read=runWorkspaceJob({action:'shortline',root:path.join(root,'archive'),book:'main',replica:false});
 const pending=runWorkspaceJob(command(workspaceRoot,'queued-preference-0001'),{authorize:()=>{calls++;return allowed;}});
 allowed=false;
 assert.equal((await read).ok,true);const result=await pending;
 assert.equal(result.httpStatus,403);assert.equal(calls,1);assert.deepEqual(store.readEvents(workspaceRoot),[]);assert.equal(fs.existsSync(workspaceRoot),false);
});

test('real worker refuses a revocation at the locked final commit checkpoint',{timeout:15000},async t=>{
 const root=storage(t),workspaceRoot=path.join(root,'workspace');let calls=0;
 const result=await runWorkspaceJob(command(workspaceRoot,'commit-preference-0001'),{authorize:()=>++calls<3});
 assert.equal(result.httpStatus,403);assert.equal(calls,3);assert.deepEqual(store.readEvents(workspaceRoot),[]);
 assert.equal(fs.readdirSync(workspaceRoot).some(n=>n.endsWith('.json')||n.startsWith('.stage-')),false);
 const saved=await runWorkspaceJob(command(workspaceRoot,'commit-preference-0002'),{authorize:()=>true});
 assert.equal(saved.ok,true);assert.equal(saved.result.revision,1);assert.equal(store.readEvents(workspaceRoot).length,1);
});

const diagnosticCommand=(root,workspaceRoot,id='private-diagnostic-0001')=>({action:'evolution-diagnostics',root,workspaceRoot,replica:false,
 now:Date.now(),query:{code:'600001',asOf:Date.now()},input:{action:'diagnostics',requestId:id,symbol:'600001'}});

test('real diagnosis worker hides private filesystem paths when the original archive is a symlink',{timeout:15000},async t=>{
 const base=storage(t),root=path.join(base,'private-archive'),workspaceRoot=path.join(base,'workspace'),target=path.join(base,'private-target.json');
 fs.mkdirSync(root,{mode:0o700});fs.writeFileSync(target,'private-file-content-must-not-return',{mode:0o600});fs.symlinkSync(target,path.join(root,'research.json'));
 const result=await runWorkspaceJob(diagnosticCommand(root,workspaceRoot),{authorize:()=>true});
 assert.equal(result.ok,false);assert.equal(result.httpStatus,422);assert.equal(result.error,'研究诊断输入或私有档案校验失败，原记录保留');
 assert.equal(JSON.stringify(result).includes(base),false);assert.doesNotMatch(JSON.stringify(result),/ELOOP|private-target|private-file-content/);
 assert.equal(fs.existsSync(workspaceRoot),false);assert.equal(fs.readlinkSync(path.join(root,'research.json')),target);
 assert.equal(fs.readFileSync(target,'utf8'),'private-file-content-must-not-return');
});

test('real diagnosis worker hides malformed private JSON while retaining safe corruption guidance',{timeout:15000},async t=>{
 const base=storage(t),root=path.join(base,'archive'),workspaceRoot=path.join(base,'workspace'),marker='private-json-marker-never-return';
 fs.mkdirSync(workspaceRoot,{mode:0o700});const eventFile=path.join(workspaceRoot,'000001.json');fs.writeFileSync(eventFile,marker,{mode:0o600});
 const brokenJournal=await runWorkspaceJob(diagnosticCommand(root,workspaceRoot),{authorize:()=>true});
 assert.equal(brokenJournal.httpStatus,422);assert.equal(brokenJournal.error,'研究诊断输入或私有档案校验失败，原记录保留');
 assert.equal(JSON.stringify(brokenJournal).includes(marker),false);assert.equal(JSON.stringify(brokenJournal).includes(base),false);
 assert.equal(fs.readFileSync(eventFile,'utf8'),marker);
 const cleanWorkspace=path.join(base,'clean-workspace');fs.mkdirSync(root,{mode:0o700});const archiveFile=path.join(root,'research.json');fs.writeFileSync(archiveFile,marker,{mode:0o600});
 const brokenArchive=await runWorkspaceJob(diagnosticCommand(root,cleanWorkspace),{authorize:()=>true});
 assert.equal(brokenArchive.httpStatus,422);assert.equal(brokenArchive.error,'私有研究档案校验失败，请检查受控备份');
 assert.equal(JSON.stringify(brokenArchive).includes(marker),false);assert.equal(JSON.stringify(brokenArchive).includes(base),false);
 assert.equal(fs.readFileSync(archiveFile,'utf8'),marker);assert.equal(fs.existsSync(cleanWorkspace),false);
});

test('real diagnosis worker preserves request conflicts and final authorization revocation without rewriting receipts',{timeout:15000},async t=>{
 const base=storage(t),root=path.join(base,'archive'),workspaceRoot=path.join(base,'workspace'),requestId='existing-diagnostic-0001';
 const commandFingerprint=require('node:crypto').createHash('sha256').update(JSON.stringify({symbol:'600001',asOf:null,horizon:'5'})).digest('hex');
 store.appendEvent(workspaceRoot,'diagnostic',{protocol:'evolution-diagnostics-v1',commandFingerprint,result:{status:'not-evaluated'}},{requestId,now:Date.now()});
 const before=fs.readFileSync(path.join(workspaceRoot,'000001.json'),'utf8'),conflict=diagnosticCommand(root,workspaceRoot,requestId);conflict.input.symbol='600002';
 const invalid=await runWorkspaceJob(conflict,{authorize:()=>true});assert.equal(invalid.httpStatus,422);assert.equal(invalid.error,'同请求ID内容冲突');
 let calls=0;const revoked=await runWorkspaceJob(diagnosticCommand(root,workspaceRoot,requestId),{authorize:()=>++calls<3});
 assert.equal(revoked.httpStatus,403);assert.equal(calls,3);assert.match(revoked.error,/授权.*未保存诊断/);
 assert.equal(fs.readFileSync(path.join(workspaceRoot,'000001.json'),'utf8'),before);assert.equal(store.readEvents(workspaceRoot).length,1);
 assert.equal(fs.existsSync(root),false);
});
