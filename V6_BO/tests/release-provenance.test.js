'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {captureRunningRelease,inspectReleaseProvenance,inspectReleaseProvenanceAsync}=require('../src/core/release-provenance');
const sha='a'.repeat(40),hash=v=>crypto.createHash('sha256').update(v).digest('hex');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-release-')),app=path.join(root,'app');fs.mkdirSync(app,{mode:0o700});
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const files={'server.js':"const APP_VER='20261126test'; if (fayoEntries.has(p)) p = '/nova/index.html';",
  'public/nova/index.html':'<meta name="application-version" content="20261126test"><meta name="frontend-revision" content="deep-test-1">',
  'public/sw.js':"const APP_VER='20261126test';",'package.json':'{"name":"fixture"}',
  'package-lock.json':JSON.stringify({packages:{'node_modules/optional-package':{version:'1.2.3',optional:true}}})};
 for(const [name,value]of Object.entries(files)){const f=path.join(app,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,value,{mode:0o600});}
 function manifest(overrides={}){
  const data={schemaVersion:1,sourceSha:sha,files:Object.entries(files).map(([name,value])=>({path:name,sha256:hash(value)})),
   provenance:{schemaVersion:1,sourceSha:sha,sourceTree:'b'.repeat(40),builderSha256:'c'.repeat(64),dependencyLockSha256:hash(files['package-lock.json'])},
   sbom:{bomFormat:'CycloneDX',specVersion:'1.5',components:[{name:'optional-package',version:'1.2.3'}]},...overrides};
  const raw=JSON.stringify(data)+'\n';fs.writeFileSync(path.join(root,'source-manifest.json'),raw,{mode:0o600});
  fs.writeFileSync(path.join(root,'installation.json'),JSON.stringify({schemaVersion:1,ready:true,sourceSha:data.sourceSha,manifestHash:hash(raw)}),{mode:0o600});
 }
 manifest();return {root,app,files,manifest,running:captureRunningRelease({appRoot:app,appVersion:'20261126test'})};
}
const inspect=f=>inspectReleaseProvenance({appRoot:f.app,running:f.running});
test('installed source, lock and unified versions verify without claiming signed/CI/dependency-byte approval',t=>{
 const f=fixture(t),r=inspect(f);
 assert.equal(r.status,'verified-local-manifest');assert.equal(r.verifiedInstalled,true);assert.equal(r.sourceSha,sha);
 assert.equal(r.signatureVerified,false);assert.equal(r.ciVerified,false);assert.equal(r.sbom.installedDependenciesVerified,false);
 assert.equal(r.sbom.dependencyVersions.missingOptional,1);assert.equal(r.versions.browserCacheObserved,false);
});
test('changed executable and injected unmanifested code both invalidate installation',t=>{
 const f=fixture(t);fs.appendFileSync(path.join(f.app,'server.js'),'\n//tampered');
 assert.equal(inspect(f).reason,'release-code-mismatch');
 fs.writeFileSync(path.join(f.app,'server.js'),f.files['server.js']);fs.mkdirSync(path.join(f.app,'src'));
 fs.writeFileSync(path.join(f.app,'src/injected.js'),'module.exports=1;');
 assert.equal(inspect(f).reason,'release-unmanifested-executable');
});
test('manifest update cannot conceal a front/backend version mismatch',t=>{
 const f=fixture(t);f.files['public/sw.js']="const APP_VER='wrong-version';";
 fs.writeFileSync(path.join(f.app,'public/sw.js'),f.files['public/sw.js']);f.manifest();
 const r=inspect(f);assert.equal(r.verifiedInstalled,false);assert.equal(r.reason,'release-version-mismatch');
});
test('installed optional dependency with wrong version is detected and blocks local release verification',t=>{
 const f=fixture(t),dir=path.join(f.app,'node_modules/optional-package');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),'{"version":"9.9.9"}');
 const r=inspect(f);assert.equal(r.verifiedInstalled,false);assert.equal(r.sbom.dependencyVersions.status,'mismatch');
});
test('symlinks and forged manifest digest are rejected without exposing private content',t=>{
 const f=fixture(t);fs.unlinkSync(path.join(f.app,'server.js'));fs.symlinkSync('/etc/passwd',path.join(f.app,'server.js'));
 const r=inspect(f);assert.equal(r.status,'integrity-failed');assert.doesNotMatch(JSON.stringify(r),/root:|\/etc\/passwd/);
 fs.unlinkSync(path.join(f.app,'server.js'));fs.writeFileSync(path.join(f.app,'server.js'),f.files['server.js']);
 fs.appendFileSync(path.join(f.root,'source-manifest.json'),' ');assert.equal(inspect(f).reason,'release-manifest-invalid');
});
test('bounded asynchronous verification produces the same source result',async t=>{
 const f=fixture(t),r=await inspectReleaseProvenanceAsync({appRoot:f.app,running:f.running});assert.equal(r.status,'verified-local-manifest');assert.equal(r.sourceSha,sha);
});
test('changing an installed source manifest without restarting cannot attest the running process',t=>{
 const f=fixture(t);assert.equal(f.running.sourceSha,sha);assert.equal(Object.isFrozen(f.running),true);
 f.manifest({sourceSha:'d'.repeat(40)});
 const r=inspect(f);assert.equal(r.verifiedInstalled,false);assert.equal(r.runningMatches,false);assert.equal(r.reason,'running-source-binding-mismatch-or-missing');
 assert.equal(inspectReleaseProvenance({appRoot:f.app}).verifiedInstalled,false);
});
test('invalid application roots are harmless unknown evidence',()=>{
 assert.equal(inspectReleaseProvenance({appRoot:null}).reason,'release-absolute-root-required');
});
