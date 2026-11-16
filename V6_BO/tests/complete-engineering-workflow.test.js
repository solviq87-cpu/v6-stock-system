'use strict';
// Execute the actual privileged writer with isolated bytes and fake Git APIs.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const workflow=fs.readFileSync(path.resolve(__dirname,'../../.github/workflows/v6-complete-engineering-bundle.yml'),'utf8');
const body=workflow.split('      - name: Create a source-SHA-named immutable archive branch\n')[1]?.split('          script: |\n')[1];
assert.ok(body,'immutable archive writer script missing');
const script=body.split('\n').map(line=>line.startsWith('            ')?line.slice(12):line).join('\n');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const SHA='a'.repeat(40),FILENAME='V6_FULL_'+SHA.slice(0,12)+'.zip',MIB=1024*1024;
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const blobSha=bytes=>crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
async function execute({size=32,receiptPatch={},captureParts=false,failMethod=null,wrongBlob=false}={}){
 const archive=Buffer.alloc(size),calls=[],blobs=new Map();
 for(let n=0;n<size;n+=32*MIB)archive[n]=n/(32*MIB)+1;
 const receipt={sourceSha:SHA,filename:FILENAME,zipSha256:sha256(archive),zipBytes:size,gitTrackedFiles:3387,productionDeployed:false,...receiptPatch};
 const requireFixture=name=>{
  if(name==='fs')return {readFileSync:file=>file.endsWith('VERIFICATION.json')?JSON.stringify(receipt):archive};
  if(name==='path')return path;
  if(name==='crypto')return crypto;
  throw Error('unexpected workflow dependency');
 };
 const github={rest:{git:{}}};
 for(const method of ['createBlob','createTree','createCommit','createRef'])github.rest.git[method]=async args=>{
  if(method==='createBlob'){
   const bytes=Buffer.from(args.content,'base64'),sha=blobSha(bytes);
   calls.push({method,args:{encoding:args.encoding},encodedBytes:args.content.length,bytes:bytes.length});
   if(captureParts)blobs.set(sha,bytes);
   if(failMethod===method)throw Object.assign(Error('PRIVATE-PROXY-TOKEN encoded-ZIP-body'),{status:422,request:{body:args.content}});
   return {data:{sha:wrongBlob?'b'.repeat(40):sha}};
  }
  calls.push({method,args});
  if(failMethod===method)throw Object.assign(Error('PRIVATE-PROXY-TOKEN encoded-ZIP-body'),{status:403,request:{body:'ENCODED-BODY'}});
  return {data:{sha:'b'.repeat(40)}};
 };
 const run=()=>new AsyncFunction('require','process','context','github','core','Buffer',script)(requireFixture,
  {env:{SOURCE_SHA:SHA,ZIP_FILENAME:FILENAME,BUNDLE_DIR:'/isolated-bundle'}},
  {repo:{owner:'solviq87-cpu',repo:'v6-stock-system'}},github,
  {summary:{addRaw:()=>({write:async()=>{}})}},Buffer);
 return {run,calls,blobs,archive};
}

test('small archives including the 32-MiB boundary remain a single compatible ZIP',async()=>{
 for(const size of [32,32*MIB]){
  const fixture=await execute({size});await fixture.run();
  assert.deepEqual(fixture.calls.map(call=>call.method),['createBlob','createTree','createCommit','createRef']);
  const tree=fixture.calls.find(call=>call.method==='createTree').args.tree;
  assert.ok(tree.some(entry=>entry.path===FILENAME));
  assert.ok(!tree.some(entry=>entry.path==='ARCHIVE_PARTS.json'));
 }
});

test('current 89-MB ZIP and 90-MiB boundary use bounded parts and preserve complete original byte counts',async()=>{
 for(const size of [89262884,90*MIB]){
  const fixture=await execute({size});await fixture.run();
  const uploads=fixture.calls.filter(call=>call.method==='createBlob');
  assert.equal(uploads.length,3);
  assert.equal(uploads.reduce((sum,call)=>sum+call.bytes,0),size);
  assert.ok(uploads.every(call=>call.bytes<=32*MIB&&call.encodedBytes<=4*Math.ceil(32*MIB/3)));
  const tree=fixture.calls.find(call=>call.method==='createTree').args.tree;
  const manifest=JSON.parse(tree.find(entry=>entry.path==='ARCHIVE_PARTS.json').content);
  assert.equal(manifest.sourceSha,SHA);assert.equal(manifest.zipBytes,size);assert.equal(manifest.zipSha256,sha256(fixture.archive));
  assert.deepEqual(manifest.parts.map(part=>part.path),[1,2,3].map(n=>FILENAME+'.part00'+n));
  assert.equal(manifest.parts.reduce((sum,part)=>sum+part.bytes,0),size);
  assert.ok(tree.some(entry=>entry.path==='RESTORE_ARCHIVE.py'));
  assert.equal(fixture.calls.at(-1).args.ref,'refs/heads/archive/v6-full-'+SHA.slice(0,12));
 }
});

test('cap plus one and 100-MB archives fail before any API mutation',async()=>{
 for(const size of [90*MIB+1,100000000]){
  const fixture=await execute({size});await assert.rejects(fixture.run,/unverified-or-oversized-archive/);assert.deepEqual(fixture.calls,[]);
 }
});

test('invalid receipt or returned blob identity cannot create an archive ref',async()=>{
 for(const receiptPatch of [{zipSha256:'c'.repeat(64)},{sourceSha:'b'.repeat(40)},
  {filename:'other.zip'},{zipBytes:31},{productionDeployed:true},{productionDeployed:undefined}]){
  const fixture=await execute({receiptPatch});await assert.rejects(fixture.run,/unverified-or-oversized-archive/);assert.deepEqual(fixture.calls,[]);
 }
 const wrong=await execute({wrongBlob:true});await assert.rejects(wrong.run,/archive-part-blob-disagreement/);
 assert.deepEqual(wrong.calls.map(call=>call.method),['createBlob']);
});

test('API failures expose only step and status, never encoded payload or original request errors',async()=>{
 for(const failMethod of ['createBlob','createTree','createCommit','createRef']){
  const fixture=await execute({failMethod});
  await assert.rejects(fixture.run,error=>{
   assert.match(error.message,new RegExp('^archive-api-'+failMethod+'-failed-status-(?:422|403)$'));
   assert.doesNotMatch(error.stack,/PRIVATE-PROXY-TOKEN|encoded-ZIP-body|ENCODED-BODY/);
   assert.equal(error.request,undefined);return true;
  });
  assert.equal(fixture.calls.at(-1).method,failMethod);
 }
});

test('generated standard-library recovery preserves bytes and rejects corruption, missing parts, symlinks and overwrite',async t=>{
 const fixture=await execute({size:32*MIB+17,captureParts:true});await fixture.run();
 const tree=fixture.calls.find(call=>call.method==='createTree').args.tree;
 const manifest=JSON.parse(tree.find(entry=>entry.path==='ARCHIVE_PARTS.json').content);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-archive-parts-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const entry of tree){
  if(entry.content!==undefined)fs.writeFileSync(path.join(dir,entry.path),entry.content);
  else fs.writeFileSync(path.join(dir,entry.path),fixture.blobs.get(entry.sha));
 }
 const run=()=>execFileSync('python3',[path.join(dir,'RESTORE_ARCHIVE.py')],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const output=path.join(dir,FILENAME),manifestPath=path.join(dir,'ARCHIVE_PARTS.json');
 assert.match(run(),/verified/);assert.equal(sha256(fs.readFileSync(output)),sha256(fixture.archive));
 assert.throws(run,/output-already-exists/);assert.equal(sha256(fs.readFileSync(output)),manifest.zipSha256);fs.unlinkSync(output);
 const first=path.join(dir,manifest.parts[0].path),original=fs.readFileSync(first);
 fs.writeFileSync(first,Buffer.alloc(original.length,7));assert.throws(run,/part-hash-mismatch/);fs.writeFileSync(first,original);
 fs.renameSync(first,first+'.hidden');assert.throws(run,/No such file/);fs.symlinkSync(first+'.hidden',first);assert.throws(run,/invalid-part-file/);fs.unlinkSync(first);fs.renameSync(first+'.hidden',first);
 for(const patch of [m=>m.parts.reverse(),m=>m.parts[0].path='../outside',m=>m.zipSha256='c'.repeat(64)]){
  const changed=JSON.parse(JSON.stringify(manifest));patch(changed);fs.writeFileSync(manifestPath,JSON.stringify(changed));assert.throws(run,/invalid-part-entry|archive-hash-mismatch/);
 }
 fs.writeFileSync(manifestPath,JSON.stringify(manifest));assert.match(run(),/verified/);assert.equal(sha256(fs.readFileSync(output)),manifest.zipSha256);
 assert.ok(!fs.readdirSync(dir).some(name=>name.endsWith('.tmp')));
});
