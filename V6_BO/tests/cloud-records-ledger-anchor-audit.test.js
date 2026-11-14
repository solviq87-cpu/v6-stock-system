'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {audit}=require('../scripts/cloud-records-ledger-anchor-audit');
const {createCloudRecordsCasStore,digest}=require('../src/core/cloud-records-cas-store');
const SCRIPT=path.resolve(__dirname,'../scripts/cloud-records-ledger-anchor-audit.js');
const fault=(fn,expected)=>assert.throws(fn,e=>e&&e.code===expected,expected);
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-cloud-ledger-anchor-'));
 fs.chmodSync(root,0o700);
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const records=[
  {name:'v6.app.state',title:'合成账户',content:JSON.stringify({
   revision:7,cash:758901.12,positions:[],orders:[],risk:{},
   note:'PRIVATE_ACCOUNT_NOTE_NOT_FOR_REPORT'
  })},
  {name:'v6.news.pool',content:JSON.stringify({items:['SENSITIVE_NEWS_CONTENT']})}
 ];
 const store=createCloudRecordsCasStore(root);
 store.bootstrap({records,expectedSourceHash:digest({records}),operatorApproved:true,
  requestId:'backup_anchor_fixture_01'});
 const state=store.read();
 return {root,store,records,state};
}
function envFor(f,extra={}){
 return {PATH:process.env.PATH||'/usr/bin:/bin',
  V6_CLOUD_LEDGER_AUDIT_ROOT:f.root,...extra};
}
test('read-only unanchored audit verifies entire chain but never asserts account recovery',t=>{
 const f=fixture(t);
 const before=fs.readdirSync(f.root).sort();
 const report=audit({root:f.root});
 assert.equal(report.status,'verified-chain-unanchored');
 assert.equal(report.eventCount,1);
 assert.equal(report.revision,1);
 assert.equal(report.recordCount,2);
 assert.equal(report.chainHeadSha256,f.state.proof);
 assert.equal(report.snapshotSha256,digest({records:f.state.records}));
 assert.equal(report.externalHeadAnchorMatched,null);
 for(const name of ['externalAnchorProvenanceVerified','accountHistoryReconciled',
  'backupAuthorityVerified','accountRecoveryVerified','endToEndRollbackProtectionVerified',
  'restorePerformed','productionDataModified','productionDeployed'])
  assert.equal(report[name],false,name);
 assert.equal(report.readOnly,true);
 assert.deepEqual(fs.readdirSync(f.root).sort(),before);
 const output=JSON.stringify(report);
 for(const secret of ['758901.12','PRIVATE_ACCOUNT_NOTE_NOT_FOR_REPORT',
  'SENSITIVE_NEWS_CONTENT',f.root,'positions'])assert.ok(!output.includes(secret),secret);
});
test('external head revision and SHA plus snapshot hash match without granting import approval',t=>{
 const f=fixture(t);
 const report=audit({root:f.root,expectedRevision:f.state.revision,
  expectedProofSha256:f.state.proof,
  expectedSnapshotSha256:digest({records:f.state.records})});
 assert.equal(report.status,'head-anchor-matched-only');
 assert.equal(report.externalHeadAnchorMatched,true);
 assert.equal(report.expectedSnapshotMatched,true);
 assert.equal(report.externalAnchorProvenanceVerified,false);
 assert.equal(report.accountHistoryReconciled,false);
});
test('a shorter but internally valid ledger is caught by an external head anchor',t=>{
 const f=fixture(t);
 f.store.upsert({expectedRevision:1,requestId:'device_01_revision',
  record:{name:'v6.app.state',content:JSON.stringify({
   revision:8,cash:12500,positions:[],orders:[]})}});
 const later=f.store.read();
 assert.equal(later.revision,2);
 fs.unlinkSync(path.join(f.root,'000002.json'));
 // A truncated chain can be internally consistent: head anchoring is essential.
 assert.equal(f.store.read().status,'ready');
 assert.equal(audit({root:f.root}).status,'verified-chain-unanchored');
 fault(()=>audit({root:f.root,expectedRevision:later.revision,
  expectedProofSha256:later.proof}),'HEAD_ANCHOR_MISMATCH');
});
test('a later valid event is a head mismatch, not silently accepted as a matching backup',t=>{
 const f=fixture(t),before=f.store.read();
 f.store.upsert({expectedRevision:1,requestId:'new_news_rev02',record:{
  name:'v6.news.pool',content:'{"items":[{"id":1}]}' }});
 fault(()=>audit({root:f.root,expectedRevision:before.revision,
  expectedProofSha256:before.proof}),'HEAD_ANCHOR_MISMATCH');
});
test('account snapshot hash mismatch and malformed external anchors fail closed',t=>{
 const f=fixture(t);
 fault(()=>audit({root:f.root,expectedRevision:1}),'EXTERNAL_ANCHOR_PAIR_REQUIRED');
 fault(()=>audit({root:f.root,expectedProofSha256:f.state.proof}),'EXTERNAL_ANCHOR_PAIR_REQUIRED');
 fault(()=>audit({root:f.root,expectedRevision:'01',
  expectedProofSha256:f.state.proof}),'EXPECTED_REVISION_INVALID');
 fault(()=>audit({root:f.root,expectedRevision:1,expectedProofSha256:'x'.repeat(64)}),
  'EXPECTED_PROOF_SHA256_INVALID');
 fault(()=>audit({root:f.root,expectedSnapshotSha256:'xyz'}),
  'EXPECTED_SNAPSHOT_SHA256_INVALID');
 fault(()=>audit({root:f.root,expectedRevision:1,
  expectedProofSha256:'f'.repeat(64)}),'HEAD_ANCHOR_MISMATCH');
 fault(()=>audit({root:f.root,expectedSnapshotSha256:'f'.repeat(64)}),
  'SNAPSHOT_HASH_MISMATCH');
});
test('an altered event or unresolved staging file blocks recovery evidence',t=>{
 const f=fixture(t),file=path.join(f.root,'000001.json');
 const original=fs.readFileSync(file,'utf8');
 fs.writeFileSync(file,original.replace('758901.12','111111.11'));
 fault(()=>audit({root:f.root}),'EVENT_HASH_MISMATCH');
 fs.writeFileSync(file,original);
 const stage=path.join(f.root,'.stage-'+('a'.repeat(24)));
 fs.writeFileSync(stage,'not a real commit',{mode:0o600});
 fault(()=>audit({root:f.root}),'UNRESOLVED_STAGING_ARTIFACT');
 fs.unlinkSync(stage);
 assert.equal(audit({root:f.root}).eventCount,1);
});
test('missing, symlinked and repository-root ledger paths refuse to audit',t=>{
 const f=fixture(t);
 fault(()=>audit({root:'relative/private'}),'PRIVATE_ABSOLUTE_ROOT_REQUIRED');
 fault(()=>audit({root:path.resolve(__dirname,'../..')}),'LEDGER_MUST_BE_OUTSIDE_REPOSITORY');
 fault(()=>audit({root:path.join(f.root,'missing')}),'AUTHORITATIVE_LEDGER_UNAVAILABLE');
 const link=path.join(f.root,'linked-root');
 fs.symlinkSync(f.root,link);
 fault(()=>audit({root:link}),'UNSAFE_DIRECTORY');
});
test('a valid write and process restart are hash-identical across independent CAS clients',t=>{
 const f=fixture(t);
 f.store.upsert({expectedRevision:1,requestId:'mobile_device_001',record:{
  name:'v6.app.state',content:JSON.stringify({
   revision:8,cash:60000,positions:[{symbol:'000001',qty:200}],orders:[]})}});
 fault(()=>f.store.upsert({expectedRevision:1,requestId:'desktop_device_001',record:{
  name:'v6.app.state',content:JSON.stringify({revision:8,cash:55000,
   positions:[],orders:[]})}}),'REVISION_CONFLICT');
 const recovered=createCloudRecordsCasStore(f.root).read();
 assert.equal(recovered.revision,2);
 const expectedSnapshot=digest({records:recovered.records});
 const proof=audit({root:f.root,expectedRevision:2,
  expectedProofSha256:recovered.proof,expectedSnapshotSha256:expectedSnapshot});
 assert.equal(proof.externalHeadAnchorMatched,true);
 assert.equal(proof.expectedSnapshotMatched,true);
 assert.equal(proof.restorePerformed,false);
});
test('CLI emits redacted JSON, never creates data, and rejects wrong anchor with exit 2',t=>{
 const f=fixture(t),original=fs.readFileSync(path.join(f.root,'000001.json'));
 const good=spawnSync(process.execPath,[SCRIPT],{encoding:'utf8',timeout:7000,env:envFor(f,{
  V6_CLOUD_LEDGER_EXPECTED_REVISION:'1',
  V6_CLOUD_LEDGER_EXPECTED_PROOF_SHA256:f.state.proof,
  V6_CLOUD_LEDGER_EXPECTED_SNAPSHOT_SHA256:digest({records:f.state.records})
 })});
 assert.equal(good.status,0,good.stderr);
 const report=JSON.parse(good.stdout);
 assert.equal(report.status,'head-anchor-matched-only');
 assert.equal(report.productionDeployed,false);
 for(const secret of ['758901.12','SENSITIVE_NEWS_CONTENT','PRIVATE_ACCOUNT_NOTE_NOT_FOR_REPORT',f.root])
  assert.ok(!good.stdout.includes(secret),secret);
 const wrong=spawnSync(process.execPath,[SCRIPT],{encoding:'utf8',timeout:7000,
  env:envFor(f,{V6_CLOUD_LEDGER_EXPECTED_REVISION:'2',
   V6_CLOUD_LEDGER_EXPECTED_PROOF_SHA256:f.state.proof})});
 assert.equal(wrong.status,2);
 const blocked=JSON.parse(wrong.stdout);
 assert.equal(blocked.status,'blocked');
 assert.equal(blocked.code,'HEAD_ANCHOR_MISMATCH');
 assert.equal(blocked.readOnly,true);
 assert.ok(!wrong.stdout.includes(f.root));
 assert.deepEqual(fs.readFileSync(path.join(f.root,'000001.json')),original);
});
test('CLI without a private root never invents an account or reports success',()=>{
 const fail=spawnSync(process.execPath,[SCRIPT],{encoding:'utf8',timeout:7000,
  env:{PATH:process.env.PATH||'/usr/bin:/bin'}});
 assert.equal(fail.status,2);
 assert.equal(JSON.parse(fail.stdout).code,'PRIVATE_ABSOLUTE_ROOT_REQUIRED');
 assert.ok(!fail.stdout.includes('Error:'));
});
