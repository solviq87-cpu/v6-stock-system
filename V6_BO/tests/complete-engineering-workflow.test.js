'use strict';
// Run the actual privileged workflow script with isolated bytes and fake API
// methods. Rejected artifacts must never reach a repository mutation.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const workflow=fs.readFileSync(path.resolve(__dirname,'../../.github/workflows/v6-complete-engineering-bundle.yml'),'utf8');
const body=workflow.split('      - name: Create a source-SHA-named immutable archive branch\n')[1]?.split('          script: |\n')[1];
assert.ok(body,'immutable archive writer script missing');
const script=body.split('\n').map(line=>line.startsWith('            ')?line.slice(12):line).join('\n');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const SHA='a'.repeat(40),FILENAME='V6_FULL_'+SHA.slice(0,12)+'.zip';
const MIB=1024*1024;
async function execute({size=32,receiptPatch={}}={}){
 const archive=Buffer.alloc(size),calls=[];
 const receipt={sourceSha:SHA,filename:FILENAME,zipSha256:crypto.createHash('sha256').update(archive).digest('hex'),
  zipBytes:size,gitTrackedFiles:3387,productionDeployed:false,...receiptPatch};
 // Buffer hashing and length are real; the test API needs no 120-MiB JSON copy.
 archive.toString=encoding=>{assert.equal(encoding,'base64');return 'isolated-base64-fixture';};
 const requireFixture=name=>{
  if(name==='fs')return {readFileSync:file=>file.endsWith('VERIFICATION.json')?JSON.stringify(receipt):archive};
  if(name==='path')return path;
  if(name==='crypto')return crypto;
  throw Error('unexpected workflow dependency');
 };
 const github={rest:{git:{}}};
 for(const method of ['createBlob','createTree','createCommit','createRef'])github.rest.git[method]=async args=>{
  calls.push({method,args});return {data:{sha:'b'.repeat(40)}};
 };
 const run=()=>new AsyncFunction('require','process','context','github','core',script)(requireFixture,
  {env:{SOURCE_SHA:SHA,ZIP_FILENAME:FILENAME,BUNDLE_DIR:'/isolated-bundle'}},
  {repo:{owner:'solviq87-cpu',repo:'v6-stock-system'}},github,
  {summary:{addRaw:()=>({write:async()=>{}})}});
 return {run,calls};
}

test('verified current ZIP above the historical 85-MiB cap and exact 90-MiB boundary can be archived',async()=>{
 for(const size of [89262884,90*MIB]){
  const fixture=await execute({size});await fixture.run();
  assert.deepEqual(fixture.calls.map(call=>call.method),['createBlob','createTree','createCommit','createRef']);
  assert.equal(fixture.calls[0].args.encoding,'base64');
  assert.equal(fixture.calls.at(-1).args.ref,'refs/heads/archive/v6-full-'+SHA.slice(0,12));
 }
});

test('cap plus one byte and the absolute 100-MB boundary are rejected before any GitHub write',async()=>{
 for(const size of [90*MIB+1,100000000]){
  const fixture=await execute({size});
  await assert.rejects(fixture.run,/unverified-or-oversized-archive/);
  assert.deepEqual(fixture.calls,[]);
 }
});

test('hash mismatch and invalid source, filename, byte receipt or deployment claim reject every API mutation',async()=>{
 for(const receiptPatch of [{zipSha256:'c'.repeat(64)},{sourceSha:'b'.repeat(40)},
  {filename:'other.zip'},{zipBytes:31},{productionDeployed:true},{productionDeployed:undefined}]){
  const fixture=await execute({receiptPatch});
  await assert.rejects(fixture.run,/unverified-or-oversized-archive/);
  assert.deepEqual(fixture.calls,[]);
 }
});
