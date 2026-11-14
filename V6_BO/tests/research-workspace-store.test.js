'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const S=require('../src/core/research-workspace-store'),W=require('../src/core/research-workspace');
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-workspace-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,root:path.join(dir,'private')};}
test('workspace GET never creates storage; invalid or public/symlink paths fail closed',t=>{
 const {dir,root}=setup(t);assert.deepEqual(S.readEvents(root),[]);assert.equal(fs.existsSync(root),false);
 assert.throws(()=>S.readEvents(path.join(dir,'public','private')),/公开/);assert.throws(()=>S.readEvents('relative'),/绝对/);
 fs.mkdirSync(root,{mode:0o700});fs.symlinkSync(root,path.join(dir,'alias'));assert.throws(()=>S.readEvents(path.join(dir,'alias')),/符号链接/);
 fs.chmodSync(root,0o755);assert.throws(()=>S.readEvents(root),/0700/);
});
test('immutable hashed events survive process restart, preserve 0/null, and have private permissions',t=>{
 const {root}=setup(t),now=Date.now()-1000;
 const e=S.appendEvent(root,'diagnostic',{asOf:now,zero:0,missing:null},{requestId:'test_record_0001',now});
 assert.equal(e.previousHash,null);assert.equal(S.readEvents(root)[0].data.zero,0);assert.equal(S.readEvents(root)[0].data.missing,null);
 assert.equal(fs.statSync(root).mode&0o777,0o700);assert.equal(fs.statSync(path.join(root,'000001.json')).mode&0o777,0o600);
 const reused=S.appendEvent(root,'diagnostic',{missing:null,zero:0,asOf:now},{requestId:'test_record_0001',now});assert.equal(reused.hash,e.hash);assert.equal(reused.reused,true);
 assert.equal(S.readEvents(root,{asOf:now-1}).length,0);
 assert.throws(()=>S.appendEvent(root,'diagnostic',{asOf:now,zero:1},{requestId:'test_record_0001',now}),/冲突/);
 assert.throws(()=>S.appendEvent(root,'diagnostic',{bad:NaN},{requestId:'test_record_0002'}),/有限JSON/);
 assert.throws(()=>S.appendEvent(root,'diagnostic',{asOf:Date.now()+10000},{requestId:'test_record_0002'}),/未来/);
});
test('backward append time is rejected before publishing a corrupt history link',t=>{
 const {root}=setup(t),now=Date.now()-1000;S.appendEvent(root,'diagnostic',{stage:'first'},{requestId:'clock_test_001',now});
 assert.throws(()=>S.appendEvent(root,'diagnostic',{stage:'older'},{requestId:'clock_test_002',now:now-1}),/时钟回退/);assert.equal(S.readEvents(root).length,1);
});
for(const defect of ['content','gap','symlink','permission','unknown-file'])test('tampered workspace rejects '+defect+' without repairing history',t=>{
 const {root,dir}=setup(t);S.appendEvent(root,'diagnostic',{stage:'saved'},{requestId:'tamper_test_001'});const file=path.join(root,'000001.json');
 if(defect==='content'){const e=JSON.parse(fs.readFileSync(file));e.data.stage='changed';fs.writeFileSync(file,JSON.stringify(e));}
 if(defect==='gap')fs.renameSync(file,path.join(root,'000002.json'));
 if(defect==='symlink'){fs.renameSync(file,path.join(dir,'outside.json'));fs.symlinkSync(path.join(dir,'outside.json'),file);}
 if(defect==='permission')fs.chmodSync(file,0o644);
 if(defect==='unknown-file')fs.writeFileSync(path.join(root,'injected.json'),'{}');
 const names=fs.readdirSync(root);assert.throws(()=>S.readEvents(root));assert.deepEqual(fs.readdirSync(root),names);
});
test('preferences use compare-and-swap, durable history, idempotency, and append-only restore',t=>{
 const {root}=setup(t),value={objective:'不丢未完成事项',horizonDays:20,excludedSymbols:['600000'],unresolved:['补财报发布时间']};
 const a=W.saveSettings(root,{action:'preferences',value,expectedRevision:0,requestId:'settings_test_001'});
 assert.equal(a.revision,1);assert.equal(W.saveSettings(root,{action:'preferences',value,expectedRevision:0,requestId:'settings_test_001'}).reused,true);
 assert.throws(()=>W.saveSettings(root,{action:'preferences',value:{objective:'旧设备覆盖'},expectedRevision:0,requestId:'settings_test_002'}),/冲突/);
 W.saveSettings(root,{action:'preferences',value:{objective:'第二版'},expectedRevision:1,requestId:'settings_test_002'});
 W.saveSettings(root,{action:'restore-preferences',revision:1,expectedRevision:2,requestId:'settings_test_003'});
 const v=W.workspaceView(root);assert.equal(v.preferences.revision,3);assert.equal(v.preferences.history.length,3);assert.deepEqual(v.preferences.value.excludedSymbols,['600000']);assert.equal(v.preferences.value.horizonDays,20);
 for(const input of [{apiKey:'secret'},{objective:'https://example.org/?token=secret'},{maxPositionPct:0},{excludedSymbols:['../etc']},{horizonDays:6}])assert.throws(()=>S.preferenceInput(input));
});
test('presets are versioned independently, restore old contents as a new revision',t=>{
 const {root}=setup(t),value={name:'观察模板',status:'unknown',minScore:20,horizon:5};
 W.saveSettings(root,{action:'preset',value,requestId:'preset_test_001',expectedRevision:0});
 W.saveSettings(root,{action:'preset',value:{...value,minScore:40},requestId:'preset_test_002',expectedRevision:1});
 W.saveSettings(root,{action:'restore-preset',name:value.name,revision:1,requestId:'preset_test_003',expectedRevision:2});
 const p=W.workspaceView(root).presets[0];assert.equal(p.revision,3);assert.equal(p.minScore,20);assert.equal(p.history.length,3);
});
test('separate writers cannot both consume the same preferences revision',{timeout:15000},async t=>{
 const {root}=setup(t),modulePath=require.resolve('../src/core/research-workspace');
 const run=id=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,['-e',`try{require(process.argv[1]).saveSettings(process.argv[2],{action:'preferences',value:{objective:process.argv[3]},requestId:process.argv[3],expectedRevision:0});process.exit(0)}catch{process.exit(3)}`,modulePath,root,id],{stdio:'ignore'});p.on('error',reject);p.on('exit',resolve);});
 const exits=await Promise.all([run('parallel_request_1'),run('parallel_request_2')]);assert.deepEqual(exits.sort(),[0,3]);assert.equal(S.readEvents(root).length,1);
});
