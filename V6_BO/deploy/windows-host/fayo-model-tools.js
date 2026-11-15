'use strict';
// Private regression tools only. Never installs into system Python or app data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {readPublic,proxyEnv}=require('./fayo-network');
const PIP_URL='https://files.pythonhosted.org/packages/44/3c/d717024885424591d5376220b5e836c2d5293ce2011523c9de23ff7bf068/pip-25.3-py3-none-any.whl';
const PIP_HASH='9655943313a94722b7774661c21049070f6bbb0a1516bf02f7c8d5d9201514cd';
function fail(code){throw Object.assign(Error(code),{code});}
function privateDir(dir){if(!fs.existsSync(dir))fs.mkdirSync(dir,{mode:0o700});const st=fs.lstatSync(dir);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o077))fail('model-tools-directory-unsafe');}
async function downloadPip(fetchImpl=readPublic){
 const response=await fetchImpl(PIP_URL,{redirect:'error',signal:AbortSignal.timeout(60000)});
 if(!response.ok)fail('model-tools-download-failed');const chunks=[];let size=0;
 for await(const bytes of response.body){size+=bytes.length;if(size>4*1024*1024)fail('model-tools-download-too-large');chunks.push(bytes);}
 const wheel=Buffer.concat(chunks);if(crypto.createHash('sha256').update(wheel).digest('hex')!==PIP_HASH)fail('model-tools-hash-mismatch');return wheel;
}
async function ensureModelPython({home,env=process.env},deps={}){
 const run=deps.run||spawnSync;
 const cleanEnv={PATH:env.PATH||'/usr/bin:/bin',HOME:home,LANG:'C.UTF-8',PIP_CONFIG_FILE:'/dev/null',...proxyEnv(env)};
 const check=python=>{const r=run(python,['-I','-c','import sklearn; assert sklearn.__version__ == "1.8.0"'],{env:cleanEnv,timeout:15000,encoding:'utf8',maxBuffer:8192});return !r.error&&r.status===0;};
 const existing=env.V6_MODEL_PYTHON||'python3';
 if(check(existing)){
  if(path.isAbsolute(existing))return existing;
  const resolved=run(existing,['-I','-c','import sys; print(sys.executable)'],{env:cleanEnv,timeout:10000,encoding:'utf8',maxBuffer:8192});
  const absolute=String(resolved.stdout||'').trim();if(resolved.status!==0||!path.isAbsolute(absolute)||/[\r\n]/.test(absolute))fail('model-tools-interpreter-invalid');return absolute;
 }
 const base=path.join(home,'.fayo-upgrade-tools');privateDir(base);
 const final=path.join(base,'models-1.8.0'),python=path.join(final,'bin/python3');
 if(fs.existsSync(final)){privateDir(final);if(check(python))return python;fail('model-tools-existing-environment-invalid');}
 const stage=fs.mkdtempSync(path.join(base,'preparing-'));fs.chmodSync(stage,0o700);
 const invoke=(exe,args,timeout=60000)=>{const r=run(exe,args,{env:cleanEnv,timeout,encoding:'utf8',maxBuffer:65536});if(r.error||r.status!==0)fail('model-tools-prepare-failed');};
 try{
  invoke('python3',['-m','venv','--without-pip',stage]);
  const wheel=await (deps.downloadPip||downloadPip)();const wheelFile=path.join(stage,'pip.whl');fs.writeFileSync(wheelFile,wheel,{flag:'wx',mode:0o600});
  const stagedPython=path.join(stage,'bin/python3');
  invoke(stagedPython,['-I','-c','import runpy,sys; sys.path.insert(0,sys.argv.pop(1)); runpy.run_module("pip",run_name="__main__")',wheelFile,'--isolated','--disable-pip-version-check','install','--no-cache-dir','--only-binary=:all:','--index-url','https://pypi.org/simple','scikit-learn==1.8.0'],300000);
  if(!check(stagedPython))fail('model-tools-verification-failed');
  fs.unlinkSync(wheelFile);fs.renameSync(stage,final);
  if(!check(python))fail('model-tools-verification-failed');return python;
 }finally{if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});}
}
module.exports={ensureModelPython,downloadPip};
