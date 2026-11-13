'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync,execFileSync}=require('node:child_process');
const python=process.env.V6_MODEL_PYTHON||'python3';
const script=path.resolve(__dirname,'../scripts/compare-v6-archive.py');
function setup(t,entries){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-archive-audit-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const repo=path.join(dir,'repo');fs.mkdirSync(path.join(repo,'V6_BO'),{recursive:true});
 fs.writeFileSync(path.join(repo,'V6_BO/package.json'),'{}\n');
 const git=(...args)=>execFileSync('git',['-C',repo,...args],{stdio:'pipe'});
 git('init');git('add','.');
 git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture');
 const zip=path.join(dir,'fixture.zip');
 execFileSync(python,['-c',
  'import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n for name,text in json.loads(sys.argv[2]): z.writestr(name,text)',zip,JSON.stringify(entries)]);
 const run=(...args)=>spawnSync(python,[script,zip,'--repo',repo,...args],{encoding:'utf8'});
 return {dir,repo,run,git};
}
test('archive audit uses committed bytes, keeps repository unchanged and never replaces reports',t=>{
 const {dir,repo,run,git}=setup(t,[['v6/package.json','{}\n']]);
 fs.writeFileSync(path.join(repo,'V6_BO/package.json'),'dirty\n');
 const before=git('status','--porcelain').toString(),report=path.join(dir,'private.json');
 const result=run('--report',report);
 assert.equal(result.status,0,result.stderr);
 assert.equal(JSON.parse(fs.readFileSync(report,'utf8')).counts.identical,1);
 assert.equal(fs.statSync(report).mode&0o777,0o600);
 const original=fs.readFileSync(report);
 assert.notEqual(run('--report',report).status,0);
 assert.deepEqual(fs.readFileSync(report),original);
 assert.equal(git('status','--porcelain').toString(),before);
 const forbidden=path.join(repo,'new-dir/report.json');
 assert.notEqual(run('--report',forbidden).status,0);
 assert.equal(fs.existsSync(path.dirname(forbidden)),false);
 const link=path.join(dir,'report-link');fs.symlinkSync(report,link);
 assert.notEqual(run('--report',link).status,0);
 assert.deepEqual(fs.readFileSync(report),original);
});
test('archive audit rejects traversal, normalized aliases, duplicate and ambiguous roots',t=>{
 for(const entries of [
  [['v6/../escape','x']], [['v6/a/./b','x']], [['v6/a//b','x']],
  [['v6/package.json','{}'],['v6/package.json','changed']],
  [['v6/package.json','{}'],['v6-stock-system/V6_BO/package.json','{}']]
 ]){
  const {run}=setup(t,entries);const result=run();
  assert.notEqual(result.status,0);assert.match(result.stderr,/AUDIT FAILED/);
 }
});
test('archive manifest mismatch and whole-archive mismatch refuse a report',t=>{
 const {run,dir}=setup(t,[['v6/package.json','{}'],
  ['v6/integration/PACKAGE_SHA256_fixture.json',JSON.stringify({'package.json':'0'.repeat(64)})]]);
 const report=path.join(dir,'rejected.json');
 assert.notEqual(run('--report',report).status,0);assert.equal(fs.existsSync(report),false);
 const clean=setup(t,[['v6/package.json','{}']]);
 assert.notEqual(clean.run('--expected-sha256','0'.repeat(64)).status,0);
});
