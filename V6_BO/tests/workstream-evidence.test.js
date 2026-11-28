const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {STREAMS,REQUIRED,sha256,inspectEvidence}=require('../scripts/workstream-evidence');
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-evidence-'));return {dir,close:()=>fs.rmSync(dir,{recursive:true,force:true})}}
function entry(dir,overrides={}){const content='independent external verification';fs.writeFileSync(path.join(dir,'proof.txt'),content);return {workstream:'MARKET',requirement:'provider-authorization',file:'proof.txt',sha256:sha256(content),verifiedAt:'2026-11-05T00:00:00Z',verdict:'pass',...overrides}}
test('eleven workstreams have distinct ids and explicit acceptance requirements',()=>{assert.equal(STREAMS.length,11);assert.equal(new Set(STREAMS.map(x=>x[0])).size,11);for(const [id] of STREAMS)assert.ok(REQUIRED[id].length)});
test('empty evidence never passes production gate',()=>{const r=inspectEvidence({entries:[]});assert.equal(r.acceptedWorkstreams,0);assert.equal(r.releaseReady,false)});
test('valid independently hashed proof is credited only to its own requirement',()=>{const f=fixture();try{const r=inspectEvidence({entries:[entry(f.dir)]},{evidenceDir:f.dir});assert.equal(r.verifiedEvidenceCount,1);assert.equal(r.acceptedWorkstreams,0);assert.equal(r.releaseReady,false)}finally{f.close()}});
test('tampered proof is rejected',()=>{const f=fixture();try{const e=entry(f.dir);fs.writeFileSync(path.join(f.dir,'proof.txt'),'tampered');const r=inspectEvidence({entries:[e]},{evidenceDir:f.dir});assert.match(r.errors.join(' '),/hash mismatch/)}finally{f.close()}});
test('path traversal is rejected',()=>{const f=fixture();try{const r=inspectEvidence({entries:[entry(f.dir,{file:'../outside.txt'})]},{evidenceDir:f.dir});assert.match(r.errors.join(' '),/unsafe evidence path/)}finally{f.close()}});
test('duplicate and unknown requirements are rejected',()=>{const f=fixture();try{const e=entry(f.dir);const r=inspectEvidence({entries:[e,e,{...e,requirement:'made-up'}]},{evidenceDir:f.dir});assert.match(r.errors.join(' '),/duplicate evidence/);assert.match(r.errors.join(' '),/unknown evidence/)}finally{f.close()}});
test('failed verdict cannot pass even with valid hash',()=>{const f=fixture();try{const r=inspectEvidence({entries:[entry(f.dir,{verdict:'fail'})]},{evidenceDir:f.dir});assert.equal(r.verifiedEvidenceCount,0)}finally{f.close()}});
test('symlink outside evidence directory cannot be used',()=>{const f=fixture(),outside=fixture();try{fs.writeFileSync(path.join(outside.dir,'outside.txt'),'proof');fs.symlinkSync(path.join(outside.dir,'outside.txt'),path.join(f.dir,'link.txt'));const r=inspectEvidence({entries:[entry(f.dir,{file:'link.txt',sha256:sha256('proof')})]},{evidenceDir:f.dir});assert.match(r.errors.join(' '),/symlink escapes/)}finally{f.close();outside.close()}});

test('complete checksummed manifest cannot independently sign off production',()=>{
 const f=fixture();try{
  const entries=Object.entries(REQUIRED).flatMap(([workstream,requirements])=>requirements.map(requirement=>{
   const file=workstream+'-'+requirement+'.txt',content='operator-declared evidence for '+requirement;
   fs.writeFileSync(path.join(f.dir,file),content);
   return {workstream,requirement,file,sha256:sha256(content),verifiedAt:'2026-11-05T00:00:00Z',verdict:'pass'};
  }));
  const r=inspectEvidence({entries},{evidenceDir:f.dir});
  assert.equal(r.releaseReady,false);assert.equal(r.manifestComplete,true);
  assert.equal(r.verifiedEvidenceCount,entries.length);assert.equal(r.acceptedWorkstreams,11);
  assert.ok(r.workstreams.every(x=>x.productionAccepted===false));
  assert.equal(r.independentAcceptanceVerified,false);
  const manifest=path.join(f.dir,'manifest.json');fs.writeFileSync(manifest,JSON.stringify({entries}));
  const cli=require('node:child_process').spawnSync(process.execPath,[require.resolve('../scripts/workstream-evidence'),'--manifest',manifest,'--evidence-dir',f.dir,'--strict'],{encoding:'utf8'});
  assert.equal(cli.status,2,cli.stderr);assert.equal(JSON.parse(cli.stdout).releaseReady,false);
 }finally{f.close()}
});
test('future-dated external proof is not credited at the current audit clock',()=>{
 const f=fixture();try{
  const r=inspectEvidence({entries:[entry(f.dir,{verifiedAt:'2099-01-01T00:00:00Z'})]},{evidenceDir:f.dir});
  assert.equal(r.verifiedEvidenceCount,0);assert.match(r.errors.join(' '),/invalid verifiedAt/);
 }finally{f.close()}
});
test('malformed manifest cannot be treated as an ordinary empty evidence inventory',()=>{
 for(const manifest of [{entries:'not an array'},[],{entries:null}]){
  const r=inspectEvidence(manifest);assert.equal(r.releaseReady,false);assert.match(r.errors.join(' '),/invalid evidence manifest/);
 }
});
