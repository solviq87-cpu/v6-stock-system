#!/usr/bin/env node
'use strict';
// Explicitly read-only CAS ledger audit. Never initialize, bootstrap, restore,
// publish, or transmit account contents. External anchors must come from an
// independently retained trusted source; this tool cannot establish provenance.
const fs=require('node:fs');
const path=require('node:path');
const {createCloudRecordsCasStore,digest}=require('../src/core/cloud-records-cas-store');
const HASH=/^[a-f0-9]{64}$/;
const EVENT=/^[0-9]{6}\.json$/;
const STAGE=/^\.stage-[a-f0-9]{24}$/;
const REPO_ROOT=path.resolve(__dirname,'../..');
const fault=code=>Object.assign(new Error(code),{code});
function privateRoot(root){
 if(typeof root!=='string'||!path.isAbsolute(root)||root.includes('\0'))
  throw fault('PRIVATE_ABSOLUTE_ROOT_REQUIRED');
 const full=path.resolve(root);
 if(full===REPO_ROOT||full.startsWith(REPO_ROOT+path.sep))
  throw fault('LEDGER_MUST_BE_OUTSIDE_REPOSITORY');
 return full;
}
function parseRevision(input){
 if(input===undefined)return undefined;
 if(typeof input==='number' && Number.isSafeInteger(input) && input>=1)return input;
 if(typeof input==='string' && /^[1-9][0-9]*$/.test(input)){
  const n=Number(input);
  if(Number.isSafeInteger(n))return n;
 }
 throw fault('EXPECTED_REVISION_INVALID');
}
function listing(root){
 const names=fs.readdirSync(root).sort();
 if(names.some(name=>STAGE.test(name)))
  throw fault('UNRESOLVED_STAGING_ARTIFACT');
 return names;
}
function audit({root,expectedRevision,expectedProofSha256,expectedSnapshotSha256}={}){
 const full=privateRoot(root);
 const revision=parseRevision(expectedRevision);
 if((revision===undefined)!==(expectedProofSha256===undefined))
  throw fault('EXTERNAL_ANCHOR_PAIR_REQUIRED');
 if(expectedProofSha256!==undefined && (!HASH.test(expectedProofSha256)))
  throw fault('EXPECTED_PROOF_SHA256_INVALID');
 if(expectedSnapshotSha256!==undefined && (!HASH.test(expectedSnapshotSha256)))
  throw fault('EXPECTED_SNAPSHOT_SHA256_INVALID');
 // No implicit initialization, no write locks, no network: purely reads.
 const store=createCloudRecordsCasStore(full);
 const before=fs.existsSync(full)?listing(full):[];
 const state=store.read();
 if(state.status!=='ready')throw fault('AUTHORITATIVE_LEDGER_UNAVAILABLE');
 const after=listing(full);
 if(before.length!==after.length || before.some((name,i)=>name!==after[i]))
  throw fault('LEDGER_CHANGED_DURING_AUDIT');
 const observedEvents=after.filter(name=>EVENT.test(name));
 if(observedEvents.length!==state.revision ||
    observedEvents.at(-1)!==String(state.revision).padStart(6,'0')+'.json')
  throw fault('EVENT_SET_INCONSISTENT');
 const snapshotHash=digest({records:state.records});
 if(revision!==undefined && (revision!==state.revision||expectedProofSha256!==state.proof))
  throw fault('HEAD_ANCHOR_MISMATCH');
 if(expectedSnapshotSha256!==undefined && expectedSnapshotSha256!==snapshotHash)
  throw fault('SNAPSHOT_HASH_MISMATCH');
 return Object.freeze({
  schemaVersion:1,
  status:revision===undefined?'verified-chain-unanchored':'head-anchor-matched-only',
  eventCount:state.events,
  revision:state.revision,
  recordCount:state.records.length,
  chainHeadSha256:state.proof,
  snapshotSha256:snapshotHash,
  externalHeadAnchorMatched:revision===undefined?null:true,
  expectedSnapshotMatched:expectedSnapshotSha256===undefined?null:true,
  // Anchors supplied by the caller are not proof of their own trustworthiness.
  externalAnchorProvenanceVerified:false,
  accountHistoryReconciled:false,
  backupAuthorityVerified:false,
  accountRecoveryVerified:false,
  endToEndRollbackProtectionVerified:false,
  restorePerformed:false,productionDataModified:false,
  readOnly:true,pointInTimeOnly:true,productionDeployed:false
 });
}
function main(){
 try{
  const report=audit({
   root:process.env.V6_CLOUD_LEDGER_AUDIT_ROOT,
   expectedRevision:process.env.V6_CLOUD_LEDGER_EXPECTED_REVISION||undefined,
   expectedProofSha256:process.env.V6_CLOUD_LEDGER_EXPECTED_PROOF_SHA256||undefined,
   expectedSnapshotSha256:process.env.V6_CLOUD_LEDGER_EXPECTED_SNAPSHOT_SHA256||undefined
  });
  process.stdout.write(JSON.stringify(report)+'\n');
 }catch(e){
  const allowed=new Set(['PRIVATE_ABSOLUTE_ROOT_REQUIRED',
   'LEDGER_MUST_BE_OUTSIDE_REPOSITORY','EXPECTED_REVISION_INVALID',
   'EXTERNAL_ANCHOR_PAIR_REQUIRED','EXPECTED_PROOF_SHA256_INVALID',
   'EXPECTED_SNAPSHOT_SHA256_INVALID','AUTHORITATIVE_LEDGER_UNAVAILABLE',
   'LEDGER_CHANGED_DURING_AUDIT','EVENT_SET_INCONSISTENT',
   'HEAD_ANCHOR_MISMATCH','SNAPSHOT_HASH_MISMATCH','UNRESOLVED_STAGING_ARTIFACT']);
  process.stdout.write(JSON.stringify({schemaVersion:1,status:'blocked',
   code:allowed.has(e.code)?e.code:'LEDGER_VERIFICATION_FAILED',
   readOnly:true,restorePerformed:false,productionDataModified:false,
   accountRecoveryVerified:false,productionDeployed:false})+'\n');
  process.exitCode=2;
 }
}
if(require.main===module)main();
module.exports={audit};
