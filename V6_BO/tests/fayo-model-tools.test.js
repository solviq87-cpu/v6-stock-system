'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {ensureModelPython,downloadPip}=require('../deploy/windows-host/fayo-model-tools');
function fixture(t){const home=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-model-tools-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));return home;}
test('a working pinned model interpreter is reused without downloads or directory changes',async t=>{
 const home=fixture(t);const result=await ensureModelPython({home,env:{PATH:'/usr/bin',V6_MODEL_PYTHON:'/existing/python'}},{run:(exe,args)=>{assert.equal(exe,'/existing/python');assert.equal(args[0],'-I');return {status:0};},downloadPip:()=>assert.fail('must not download')});assert.equal(result,'/existing/python');assert.deepEqual(fs.readdirSync(home),[]);
});
test('missing regression dependencies are prepared in a private venv without global pip or sudo',async t=>{
 const home=fixture(t),calls=[];let installed=false;
 const run=(exe,args,options)=>{calls.push({exe,args,options});if(args.includes('venv')){fs.mkdirSync(path.join(args.at(-1),'bin'));return{status:0};}if(args.includes('install')){installed=true;return{status:0};}return{status:installed?0:1};};
 const python=await ensureModelPython({home,env:{PATH:'/usr/bin',PRIVATE_TOKEN:'must-not-inherit'}},{run,downloadPip:async()=>Buffer.from('isolated fixture wheel')});
 assert.equal(python,path.join(home,'.fayo-upgrade-tools/models-1.8.0/bin/python3'));assert.ok(calls.some(c=>c.args.includes('--without-pip')));const install=calls.find(c=>c.args.includes('install'));assert.ok(install.args.includes('--isolated'));assert.ok(install.args.includes('--only-binary=:all:'));assert.ok(install.args.includes('https://pypi.org/simple'));assert.equal(install.options.env.PRIVATE_TOKEN,undefined);assert.equal(fs.statSync(path.dirname(path.dirname(python))).mode&0o777,0o700);assert.equal(calls.some(c=>c.exe==='sudo'),false);
});
test('a failed private dependency install cleans staging and leaves application data untouched',async t=>{
 const home=fixture(t);fs.mkdirSync(path.join(home,'original-app'));fs.writeFileSync(path.join(home,'original-app','account'),'preserve');
 await assert.rejects(ensureModelPython({home},{run:()=>({status:1}),downloadPip:()=>assert.fail('venv failed before download')}),{code:'model-tools-prepare-failed'});assert.deepEqual(fs.readdirSync(path.join(home,'.fayo-upgrade-tools')),[]);assert.equal(fs.readFileSync(path.join(home,'original-app/account'),'utf8'),'preserve');
});
test('a symlinked tools directory cannot redirect installation into another directory',async t=>{
 const home=fixture(t),other=fixture(t);fs.symlinkSync(other,path.join(home,'.fayo-upgrade-tools'));await assert.rejects(ensureModelPython({home},{run:()=>({status:1})}),{code:'model-tools-directory-unsafe'});assert.deepEqual(fs.readdirSync(other),[]);
});
test('pip bootstrap hash and size are checked before any executable wheel is returned',async()=>{
 await assert.rejects(downloadPip(async()=>({ok:true,body:[Buffer.from('wrong')]})),{code:'model-tools-hash-mismatch'});
 await assert.rejects(downloadPip(async()=>({ok:true,body:[Buffer.alloc(4*1024*1024+1)]})),{code:'model-tools-download-too-large'});
});
test('a PATH-selected working interpreter is resolved before regression changes its own PATH',async t=>{
 const home=fixture(t);const python=await ensureModelPython({home,env:{PATH:'/selected/bin'}},{run:(exe,args)=>({status:0,stdout:args.at(-1).includes('sys.executable')?'/selected/bin/python3\n':''})});assert.equal(python,'/selected/bin/python3');assert.deepEqual(fs.readdirSync(home),[]);
});
