'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),
 crypto=require('node:crypto');
const {scan,compare,main}=require('../scripts/factor-shadow-archive-audit');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function dirs(t){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'v6-shadow-archive-audit-'));
 t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const reference=path.join(home,'reference'),backup=path.join(home,'backup');
 fs.mkdirSync(reference);fs.mkdirSync(backup);
 return {home,reference,backup};
}
function archive(dir,{kind='shadow',status='shadow-retained',
 trainingEnd='2026-07-10',lastObservationDay='2026-07-31',extra={}}={}){
 const payload=kind==='shadow'?{
  mode:'v6-factor-shadow-evolution-v1',status,trainingEnd,lastObservationDay,
  packFingerprint:'a'.repeat(64),previousFingerprint:null,
  canTrade:false,productionWeightsChanged:false,...extra
 }:{
  mode:'v6-shadow-candidate-prereg-v1',schemaVersion:1,
  registeredAt:1770000000000,latestFrozenSignalDay:'2026-07-10',
  canTrade:false,productionWeightsChanged:false,...extra
 };
 const fingerprint=hash(payload),file=kind==='shadow'?
  'shadow-'+trainingEnd+'-'+fingerprint.slice(0,12)+'.json':
  'prereg-'+fingerprint.slice(0,12)+'.json';
 fs.writeFileSync(path.join(dir,file),JSON.stringify({...payload,fingerprint}));
 return file;
}
function copy(src,dest,name){
 fs.copyFileSync(path.join(src,name),path.join(dest,name));
}
test('guarded seed registrations are preserved byte-for-byte without rewriting prior archive records',t=>{
 const {reference,backup}=dirs(t),{preregisterSeedCandidate,SEED_POLICY}=require('../src/core/factor-candidate-prereg');
 const seed=preregisterSeedCandidate({registeredAt:Date.now(),seedConfig:{schemaVersion:1,mode:'v6-fixed-shadow-seed-config-v1',
  researchOnly:true,canTrade:false,seedPolicy:SEED_POLICY,factorIds:['sector_heat','leader_strength']}});
 const seedFile='prereg-'+seed.fingerprint.slice(0,12)+'.json';
 fs.writeFileSync(path.join(reference,seedFile),JSON.stringify(seed)+'\n',{mode:0o600});
 const oldFile=archive(reference,{kind:'prereg'}),before=fs.readFileSync(path.join(reference,oldFile));
 for(const file of [seedFile,oldFile])copy(reference,backup,file);
 const result=compare(reference,backup);assert.equal(result.ok,true);assert.equal(result.preregisteredCandidates,2);
 assert.deepEqual(fs.readFileSync(path.join(backup,seedFile)),fs.readFileSync(path.join(reference,seedFile)));
 assert.deepEqual(fs.readFileSync(path.join(reference,oldFile)),before);
 const changed={...seed,candidateWeights:{...seed.candidateWeights,sector_heat:999}}, {fingerprint,...payload}=changed;
 const resealed={...payload,fingerprint:hash(payload)},changedFile='prereg-'+resealed.fingerprint.slice(0,12)+'.json';
 fs.unlinkSync(path.join(backup,seedFile));fs.writeFileSync(path.join(backup,changedFile),JSON.stringify(resealed),{mode:0o600});
 assert.throws(()=>scan(backup),/固定种子/,'even a self-consistent hash must not bypass seed metadata policy');
});
test('read-only archive comparison includes rejected trials, accepted model and all preregistration receipts',t=>{
 const {reference,backup}=dirs(t);
 const records=[
  archive(reference,{status:'shadow-updated',trainingEnd:'2026-06-10',
   lastObservationDay:'2026-06-30'}),
  archive(reference,{status:'shadow-retained',trainingEnd:'2026-07-10',
   lastObservationDay:'2026-07-31',extra:{trialAudit:{schemaVersion:1,status:'consumed'}}}),
  archive(reference,{kind:'prereg'})
 ];
 records.forEach(name=>copy(reference,backup,name));
 const before=fs.readdirSync(backup);
 const result=main(['compare',reference,backup]);
 assert.equal(result.ok,true);
 assert.equal(result.referenceFiles,3);
 assert.equal(result.candidateFiles,3);
 assert.equal(result.additionalFiles,0);
 assert.equal(result.preregisteredCandidates,1);
 assert.equal(result.shadowReports,2);
 assert.equal(result.referenceDigest,result.candidateDigest);
 assert.equal(result.canTrade,false);
 assert.equal(result.productionWeightsChanged,false);
 assert.equal(result.readonly,true);
 assert.deepEqual(fs.readdirSync(backup),before);
});
test('older restore snapshot missing a rejected trial or preregistration fails closed',t=>{
 const {reference,backup}=dirs(t);
 const kept=archive(reference,{status:'shadow-updated',trainingEnd:'2026-06-10'}),
  lost=archive(reference,{status:'shadow-retained',trainingEnd:'2026-07-10'}),
  prereg=archive(reference,{kind:'prereg'});
 copy(reference,backup,kept);
 assert.throws(()=>compare(reference,backup),/备份不完整.*缺失2项/);
 copy(reference,backup,lost);
 assert.throws(()=>compare(reference,backup),/备份不完整.*缺失1项/);
 copy(reference,backup,prereg);
 assert.equal(compare(reference,backup).ok,true);
});
test('an archive re-serialized with different bytes is not a faithful restorable copy',t=>{
 const {reference,backup}=dirs(t),name=archive(reference);
 const record=JSON.parse(fs.readFileSync(path.join(reference,name),'utf8'));
 fs.writeFileSync(path.join(backup,name),JSON.stringify(record,null,2)+'\n');
 // Both have valid semantic fingerprints, but the independent copy must
 // preserve exact immutable bytes, not silently reformat or rewrite them.
 assert.equal(scan(backup).files.length,1);
 assert.throws(()=>compare(reference,backup),/备份不完整.*变更1项/);
});
test('a resealed replacement that changes filename cannot mask a missing old trial',t=>{
 const {reference,backup}=dirs(t);
 const original=archive(reference,{status:'shadow-retained'});
 archive(backup,{status:'shadow-retained',extra:{notes:'attacker-resealed'}});
 assert.ok(!fs.existsSync(path.join(backup,original)));
 assert.throws(()=>compare(reference,backup),/备份不完整.*缺失1项/);
});
test('internal hash tampering, unknown files and symlink archive files fail closed',t=>{
 const {home,reference,backup}=dirs(t),name=archive(reference);
 copy(reference,backup,name);
 assert.equal(compare(reference,backup).ok,true);
 fs.writeFileSync(path.join(backup,name),fs.readFileSync(path.join(backup,name),'utf8')
  .replace('"shadow-retained"','"shadow-updated"'));
 assert.throws(()=>scan(backup),/内部 SHA256 指纹不匹配/);
 fs.copyFileSync(path.join(reference,name),path.join(backup,name));
 fs.writeFileSync(path.join(backup,'shadow.tmp'),'untrusted');
 assert.throws(()=>scan(backup),/未识别/);
 fs.unlinkSync(path.join(backup,'shadow.tmp'));
 fs.symlinkSync(path.join(reference,name),path.join(backup,'prereg-000000000000.json'));
 assert.throws(()=>scan(backup),/未识别|符号链接/);
 fs.rmSync(path.join(backup,'prereg-000000000000.json'));
 const linkedDir=path.join(home,'linked-backup');
 fs.symlinkSync(backup,linkedDir);
 assert.throws(()=>scan(linkedDir),/符号链接/);
});
test('unfinished writer locks, empty directories, and same reference/target refuse backup certification',t=>{
 const {reference,backup}=dirs(t);
 archive(reference);
 assert.throws(()=>scan(backup),/为空/);
 assert.throws(()=>compare(reference,reference),/不得是同一目录/);
 archive(backup);
 fs.writeFileSync(path.join(backup,'.shadow-worker.lock'),'active-or-stale');
 assert.throws(()=>compare(reference,backup),/独占锁/);
 fs.unlinkSync(path.join(backup,'.shadow-worker.lock'));
 assert.equal(compare(reference,backup).ok,true);
});
test('valid additional sealed newer research history is allowed without erasing baseline',t=>{
 const {reference,backup}=dirs(t);
 const initial=archive(reference,{status:'shadow-updated',trainingEnd:'2026-06-10'});
 copy(reference,backup,initial);
 archive(backup,{status:'paused-shadow-cooldown',trainingEnd:'2026-07-10',
  lastObservationDay:'2026-07-31',
  extra:{trialAudit:{schemaVersion:1,status:'not-evaluated'}}});
 const r=compare(reference,backup);
 assert.equal(r.additionalFiles,1);
 assert.equal(r.shadowReports,2);
 assert.equal(r.referenceFiles,1);
});

function watchHeartbeat(dir,{observedAt=1770000000000,pid=1234}={}){
 const payload={schemaVersion:1,mode:'v6-shadow-watch-heartbeat-v1',
  observedAt,intervalMs:60000,outcome:'tick-success',
  lastStatus:'skipped-no-new-training',pid,
  canTrade:false,productionWeightsChanged:false};
 const file=path.join(dir,'.shadow-worker-heartbeat.json');
 fs.writeFileSync(file,JSON.stringify({...payload,integrity:hash(payload)}));
 return file;
}
test('future WATCH heartbeat can coexist with immutable shadow and prereg archives',t=>{
 const {reference,backup}=dirs(t);
 const shadow=archive(reference,{status:'shadow-updated'}),
  registered=archive(reference,{kind:'prereg'});
 copy(reference,backup,shadow);copy(reference,backup,registered);
 watchHeartbeat(reference,{pid:101,observedAt:1770000000000});
 watchHeartbeat(backup,{pid:202,observedAt:1770000060000});
 const r=compare(reference,backup);
 assert.equal(r.ok,true);
 assert.equal(r.referenceFiles,2);
 assert.equal(r.candidateFiles,2);
 assert.equal(r.shadowReports,1);
 assert.equal(r.preregisteredCandidates,1);
 assert.equal(r.additionalFiles,0);
 assert.equal(r.referenceDigest,r.candidateDigest);
 assert.ok(fs.existsSync(path.join(backup,'.shadow-worker-heartbeat.json')));
});
test('heartbeat cannot conceal empty archive or bypass the unknown-file gate',t=>{
 const {reference,backup}=dirs(t);
 const pulse=watchHeartbeat(reference);
 assert.throws(()=>scan(reference),/仅有运行状态/);
 archive(reference);
 archive(backup);
 watchHeartbeat(backup);
 assert.equal(scan(reference).files.length,1);
 assert.equal(compare(reference,backup).ok,true);
 const tampered=JSON.parse(fs.readFileSync(pulse,'utf8'));
 tampered.observedAt+=1;
 fs.writeFileSync(pulse,JSON.stringify(tampered));
 assert.throws(()=>scan(reference),/心跳完整性/);
 fs.unlinkSync(pulse);
 fs.symlinkSync(path.join(backup,'.shadow-worker-heartbeat.json'),pulse);
 assert.throws(()=>scan(reference),/心跳不是可信普通文件|符号链接/);
 fs.unlinkSync(pulse);
 fs.writeFileSync(path.join(reference,'.shadow-worker-heartbeat.tmp'),'partial');
 assert.throws(()=>scan(reference),/未识别/);
});
