'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {buildSignalRuleSourceManifest:manifest}=require('../src/core/signal-rule-manifest');
function root(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'signal-code-manifest-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('fixed code inventory is sorted and missing source is explicitly unknown',t=>{
 const dir=root(t),result=manifest(dir);assert.equal(result.status,'partial');assert.ok(result.files.every(file=>file.status==='unknown'&&file.sha256===null));
 assert.deepEqual(result.files.map(file=>file.path),result.files.map(file=>file.path).sort());assert.ok(Object.isFrozen(result.files[0]));
 assert.ok(result.files.some(file=>file.path==='src/core/quote-observation-view.js'));assert.ok(!result.files.some(file=>/\.json$|data\//.test(file.path)));
});
test('changes in pure quote/probability core affect the fingerprint while private configuration and data do not',t=>{
 const dir=root(t);for(const file of manifest(dir).files){const target=path.join(dir,file.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,'// source '+file.path+'\n');}
 const first=manifest(dir);assert.equal(first.status,'complete');assert.equal(manifest(dir).fingerprint,first.fingerprint);
 fs.writeFileSync(path.join(dir,'access.json'),'private fixture 1');fs.writeFileSync(path.join(dir,'stats.json'),'private fixture 2');assert.equal(manifest(dir).fingerprint,first.fingerprint);
 fs.appendFileSync(path.join(dir,'src/core/quote-observation-view.js'),'// quote contract changed\n');const quoteChange=manifest(dir);assert.notEqual(quoteChange.fingerprint,first.fingerprint);
 fs.appendFileSync(path.join(dir,'src/core/probability-contract.js'),'// probability contract changed\n');assert.notEqual(manifest(dir).fingerprint,quoteChange.fingerprint);
});
test('code inventory refuses a symlink to private data and bounds source reads',t=>{
 const dir=root(t),privateFile=path.join(dir,'private.json');fs.writeFileSync(privateFile,'private fixture');fs.symlinkSync(privateFile,path.join(dir,'analysis.js'));
 assert.equal(manifest(dir).files.find(file=>file.path==='analysis.js').status,'unknown');
 fs.writeFileSync(path.join(dir,'server.js'),Buffer.alloc(8*1024*1024+1));assert.equal(manifest(dir).files.find(file=>file.path==='server.js').status,'unknown');
 assert.throws(()=>manifest('relative'),/根目录/);
});
