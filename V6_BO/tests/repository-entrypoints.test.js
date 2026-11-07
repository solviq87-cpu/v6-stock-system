'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../..');
test('repository root check reaches the real V6 application without root server.js',()=>{
 const workspace=path.join(repo,'package.json');
 // Archive users may keep only V6_BO; the root entrypoint belongs to the GitHub layout.
 if(!fs.existsSync(workspace))return;
 const p=JSON.parse(fs.readFileSync(workspace,'utf8'));
 if(p.name!=='v6-stock-workspace')return;
 const r=spawnSync('npm',['run','check'],{cwd:repo,encoding:'utf8',timeout:30000});
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/--prefix V6_BO run check/);assert.match(r.stdout,/node --check server\.js/);
});
test('root start and test preserve the actual application working directory',()=>{
 const workspace=path.join(repo,'package.json');if(!fs.existsSync(workspace))return;
 const p=JSON.parse(fs.readFileSync(workspace,'utf8'));if(p.name!=='v6-stock-workspace')return;
 assert.equal(p.scripts.start,'npm --prefix V6_BO run start');assert.equal(p.scripts.test,'npm --prefix V6_BO run test');
 assert.equal(p.main,undefined);assert.equal(p.optionalDependencies,undefined);
});
