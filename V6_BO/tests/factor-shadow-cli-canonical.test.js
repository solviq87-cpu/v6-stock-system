'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {hash}=require('../src/core/factor-maturity-manifest');
const script=path.resolve(__dirname,'../scripts/factor-shadow-worker.js');

function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-shadow-operator-manifest-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return {dir,manifestFile:path.join(dir,'manifest.json'),
  outputDir:path.join(dir,'shadow-models')};
}
function run(mode,manifestFile,outputDir,extra=[]){
 return spawnSync(process.execPath,[script,mode,manifestFile,outputDir,...extra],
  {encoding:'utf8',timeout:15000});
}
test('operational once rejects legacy signed-looking fixture manifests before writing model state',t=>{
 const p=setup(t);
 fs.writeFileSync(p.manifestFile,JSON.stringify({schemaVersion:1,
  episodes:Array.from({length:36},(_,i)=>({
   featuresFile:path.join(p.dir,'f'+i+'.json'),
   reportFile:path.join(p.dir,'r'+i+'.json')
  }))}));
 const result=run('once',p.manifestFile,p.outputDir);
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/仅接受冻结回执与首份成熟H5绑定的正式研究清单/);
 assert.equal(fs.existsSync(p.outputDir),false);
});
test('operator register-auto and manual register refuse the same noncanonical input',t=>{
 const p=setup(t);
 fs.writeFileSync(p.manifestFile,JSON.stringify({schemaVersion:1,episodes:[]}));
 for(const [mode,flags] of [['register-auto',[]],
  ['register',[path.join(p.dir,'weights.json')]]]){
  const result=run(mode,p.manifestFile,p.outputDir,flags);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/正式研究清单/);
  assert.equal(fs.existsSync(p.outputDir),false);
 }
});
test('a canonical manifest is allowed past format selection but still fails on insufficient episodes',t=>{
 const p=setup(t);
 const canonical={schemaVersion:1,mode:'v6-forward-training-manifest',
  evidenceBasis:'first-matured-sealed-5-trading-day',episodes:[],
  canTrade:false,productionWeightsChanged:false};
 fs.writeFileSync(p.manifestFile,JSON.stringify({
  ...canonical,integrity:hash(canonical)}));
 const r=run('once',p.manifestFile,p.outputDir);
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/完整时间排序研究批次目录/);
 assert.doesNotMatch(r.stderr,/仅接受冻结回执/);
 assert.equal(fs.existsSync(p.outputDir),false);
});
