'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
test('original authenticated state consumes restored local history without dispatching suppliers',async t=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'index-http-'));t.after(()=>fs.rmSync(out,{recursive:true,force:true}));
 const cwd=path.resolve(__dirname,'..'),script=path.resolve(cwd,'../docs/validation/fayo-index-history-20261127/native.cjs');
 await promisify(execFile)(process.execPath,[script],{cwd,env:{...process.env,FAYO_STUDY_RECEIPTS:out,FAYO_INDEX_BROWSER:''},timeout:120000,maxBuffer:1024*1024});
 const receipt=JSON.parse(fs.readFileSync(path.join(out,'native.json')));
 assert.deepEqual(receipt.results.map(r=>r.case),['restored','empty','corrupt']);
 assert.ok(receipt.results.every(r=>r.http===200&&r.viewerExcluded&&r.syntheticInputs));
 const restored=receipt.results[0];assert.equal(restored.projection.history.daysLoaded,20);assert.equal(restored.archive.length,20);
 assert.ok(restored.projection.events.every(e=>e.references.every(ref=>restored.archive.some(a=>a.day===ref.date&&a.eventHash===ref.archiveHash))));
 assert.equal(receipt.results[1].projection.events.length,0);assert.equal(receipt.results[2].projection.history.status,'unavailable');
});
