'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {preview}=require('../scripts/cloud-records-backup-preflight');
const {createCloudRecordsCasStore}=require('../src/core/cloud-records-cas-store');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const state=(revision=7,cash=999000)=>({version:1,revision,cash,positions:[],orders:[],picks:{},risk:{}});
const record=(account=state())=>({name:'v6.app.state',title:'合成账户',id:'provider-metadata-001',
 content:JSON.stringify(account)});
const envelope=(rows=[record()])=>({ok:true,records:rows});
function setup(t,doc=envelope()){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-backup-preflight-'));fs.chmodSync(root,0o700);
 const file=path.join(root,'private-export.json');
 fs.writeFileSync(file,JSON.stringify(doc),{mode:0o600});
 t.after(()=>fs.rmSync(root,{force:true,recursive:true}));
 return {root,file,bytes:fs.readFileSync(file),records:doc.records};
}
const expect=(callback,code)=>assert.throws(callback,e=>e&&e.code===code,code);
test('valid legacy records export is structure-only, unchanged, and prints no private contents',t=>{
 const f=setup(t,envelope([record({...state(),privateNote:'DO_NOT_PRINT_THIS'}),{
  name:'v6.news.pool',content:'{"message":"secret-news-structure"}'
 }]));
 const before=fs.readdirSync(f.root),bytes=fs.readFileSync(f.file);
 const report=preview({file:f.file});
 assert.equal(report.status,'structure-only');
 assert.equal(report.sourceFileSha256,sha(bytes));
 assert.equal(report.expectedFileSha256Matched,null);
 assert.equal(report.ignoredPlatformMetadata,true);
 assert.equal(report.accountRevision,7);
 assert.equal(report.recordCount,2);
 for(const field of ['sourceProvenanceVerified','fullAccountReconciliationVerified',
   'accountHistoryReconciled','backupAuthorityVerified','importAuthorized','restorePerformed',
   'productionDataModified'])assert.equal(report[field],false);
 assert.deepEqual(fs.readdirSync(f.root),before);
 assert.deepEqual(fs.readFileSync(f.file),bytes);
 const output=JSON.stringify(report);
 for(const sensitive of ['DO_NOT_PRINT_THIS','secret-news-structure','999000','provider-metadata-001'])
  assert.ok(!output.includes(sensitive),sensitive);
});
test('out-of-band file SHA matches only a file, never grants authority or import permission',t=>{
 const f=setup(t);
 const expected=sha(f.bytes),r=preview({file:f.file,expectedFileSha256:expected});
 assert.equal(r.status,'file-hash-matched-structure-only');
 assert.equal(r.expectedFileSha256Matched,true);
 assert.equal(r.sourceFileSha256,expected);
 assert.equal(r.backupAuthorityVerified,false);
 expect(()=>preview({file:f.file,expectedFileSha256:'0'.repeat(64)}),'SOURCE_FILE_SHA256_MISMATCH');
 expect(()=>preview({file:f.file,expectedFileSha256:'oops'}),'EXPECTED_SHA256_INVALID');
});
test('preflight normalized snapshotHash is compatible with existing CAS bootstrap contract',t=>{
 const f=setup(t,envelope([record(),{name:'v6.news.pool',content:'{"items":[]}',id:'legacy-id'}]));
 const r=preview({file:f.file}),target=path.join(f.root,'isolated-test-target');
 const store=createCloudRecordsCasStore(target);
 const seeded=store.bootstrap({records:f.records,expectedSourceHash:r.snapshotHash,
   operatorApproved:true,requestId:'fixture_backup_001'});
 assert.equal(seeded.status,'ready');
 assert.equal(seeded.revision,1);
 assert.equal(seeded.records.length,2);
 assert.equal(JSON.parse(seeded.records[0].content).cash,999000);
 // The actual legacy file remains byte-for-byte identical after test-only bootstrap.
 assert.deepEqual(fs.readFileSync(f.file),f.bytes);
});
test('empty, duplicate and malformed historical account records cannot qualify for review',t=>{
 for(const [rows,code] of [
  [[], 'MISSING_AUTHORITATIVE_ACCOUNT'],
  [[record(),record(state(8,1234))],'DUPLICATE_RECORD_NAME'],
  [[{name:'v6.app.state',content:'{not json'}],'INVALID_ACCOUNT_JSON'],
  [[record({...state(),positions:null})],'INVALID_ACCOUNT_SHAPE'],
  [[{name:'v6.news.pool',content:'{"items":[]}'}],'MISSING_AUTHORITATIVE_ACCOUNT']
 ]){
  const f=setup(t,envelope(rows));
  expect(()=>preview({file:f.file}),code);
  assert.deepEqual(fs.readFileSync(f.file),f.bytes);
 }
});
test('wrong envelope or broken export JSON is rejected without creating an account',t=>{
 for(const x of [
  {records:[record()]},
  {ok:false,records:[record()]},
  {ok:true,records:null},
  [record()]
 ]){
  const f=setup(t,x);
  expect(()=>preview({file:f.file}),'WORKBUDDY_RECORDS_CONTRACT_INVALID');
 }
 const f=setup(t);fs.writeFileSync(f.file,'{"records":',{mode:0o600});
 expect(()=>preview({file:f.file}),'BACKUP_JSON_INVALID');
});
test('symlink, world-readable, hardlinked or public path cannot be preflighted',t=>{
 const f=setup(t);
 const symlink=path.join(f.root,'link.json');fs.symlinkSync(f.file,symlink);
 expect(()=>preview({file:symlink}),'SYMLINK_PATH_FORBIDDEN');
 fs.chmodSync(f.file,0o644);
 expect(()=>preview({file:f.file}),'BACKUP_NOT_PRIVATE_REGULAR_FILE');
 fs.chmodSync(f.file,0o600);
 const hardlink=path.join(f.root,'alias.json');fs.linkSync(f.file,hardlink);
 expect(()=>preview({file:f.file}),'BACKUP_NOT_PRIVATE_REGULAR_FILE');
 fs.unlinkSync(hardlink);
 const publicDir=path.join(f.root,'public');fs.mkdirSync(publicDir);
 const publicPath=path.join(publicDir,'export.json');fs.copyFileSync(f.file,publicPath);
 expect(()=>preview({file:publicPath}),'BACKUP_MUST_BE_OUTSIDE_PUBLIC_REPOSITORY');
 expect(()=>preview({file:'relative/export.json'}),'PRIVATE_ABSOLUTE_PATH_REQUIRED');
});
test('oversized or empty backup is rejected before JSON parsing',t=>{
 const f=setup(t);fs.truncateSync(f.file,32*1024*1024+1);
 expect(()=>preview({file:f.file}),'BACKUP_SIZE_UNSUPPORTED');
 fs.truncateSync(f.file,0);
 expect(()=>preview({file:f.file}),'BACKUP_SIZE_UNSUPPORTED');
});
test('CLI prints only sanitized metadata and never invokes network/production writes',t=>{
 const f=setup(t,envelope([record({...state(),personalData:'PRIVATE_CASH_LEDGER'} )]));
 const script=path.resolve(__dirname,'../scripts/cloud-records-backup-preflight.js');
 const invocation=spawnSync(process.execPath,[script],{encoding:'utf8',
  env:{PATH:process.env.PATH, V6_CLOUD_RECORDS_BACKUP_FILE:f.file,
    V6_CLOUD_RECORDS_BACKUP_SHA256:sha(f.bytes)},timeout:5000});
 assert.equal(invocation.status,0,invocation.stderr);
 const result=JSON.parse(invocation.stdout);
 assert.equal(result.readOnly,true);
 assert.equal(result.restorePerformed,false);
 assert.equal(result.backupAuthorityVerified,false);
 assert.ok(!invocation.stdout.includes('PRIVATE_CASH_LEDGER'));
 assert.ok(!invocation.stdout.includes(f.file));
 assert.deepEqual(fs.readFileSync(f.file),f.bytes);
});
test('CLI fails closed without credentials or with corrupt backup, never echoing source paths',t=>{
 const f=setup(t);
 const script=path.resolve(__dirname,'../scripts/cloud-records-backup-preflight.js');
 for(const envPatch of [{}, {V6_CLOUD_RECORDS_BACKUP_FILE:f.file,V6_CLOUD_RECORDS_BACKUP_SHA256:'a'.repeat(64)}]){
  const x=spawnSync(process.execPath,[script],{encoding:'utf8',
   env:{PATH:process.env.PATH,...envPatch},timeout:5000});
  assert.equal(x.status,2);
  const data=JSON.parse(x.stdout);
  assert.equal(data.status,'blocked');
  assert.equal(data.productionDataModified,false);
  assert.ok(!x.stdout.includes(f.file));
  assert.ok(!x.stdout.includes('999000'));
 }
});
