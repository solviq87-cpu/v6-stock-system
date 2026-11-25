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

test('real worker refuses revocation before creating the archive, under its original lock, and after fsync',{timeout:15000},async t=>{
 const root=storage(t);
 // Parent queue admission, worker admission, pre-directory authorization,
 // locked pre-stage authorization, and final authorization after fsync.
 for(const deniedAt of [3,4,5]){
  const workspaceRoot=path.join(root,'workspace-'+deniedAt);let calls=0;
  const result=await runWorkspaceJob(command(workspaceRoot,'commit-preference-000'+deniedAt),{authorize:()=>++calls<deniedAt});
  assert.equal(result.httpStatus,403);assert.equal(calls,deniedAt);assert.deepEqual(store.readEvents(workspaceRoot),[]);
  if(deniedAt===3)assert.equal(fs.existsSync(workspaceRoot),false);
  else assert.deepEqual(fs.readdirSync(workspaceRoot),['workspace.guard'],'original lock remains; no event or staged data survives revocation');
  const saved=await runWorkspaceJob(command(workspaceRoot,'approved-preference-000'+deniedAt),{authorize:()=>true});
  assert.equal(saved.ok,true);assert.equal(saved.result.revision,1);assert.equal(store.readEvents(workspaceRoot).length,1);
 }
});
