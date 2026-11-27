'use strict';
// Private regression tools only. Never installs into system Python or app data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {readPublic,proxyEnv}=require('./fayo-network');
const PIP_URL='https://files.pythonhosted.org/packages/44/3c/d717024885424591d5376220b5e836c2d5293ce2011523c9de23ff7bf068/pip-25.3-py3-none-any.whl';
const PIP_HASH='9655943313a94722b7774661c21049070f6bbb0a1516bf02f7c8d5d9201514cd';
// Fixed wheel inventory for the Ubuntu x86_64 CPython 3.12 host.
const offlineWheels = [
  { filename: 'pip-25.3-py3-none-any.whl', size: 1778622, sha256: PIP_HASH },
  { filename: 'cloudpickle-3.1.3-py3-none-any.whl', size: 22399, sha256: '1654f4f18e416447210a63c5c25a135d65a292156aa5fa519dfa4baf7726dddb' },
  { filename: 'joblib-1.6.0-py3-none-any.whl', size: 306115, sha256: '3dbbf9f6e4b592a2357b854608e980fe6390d131d7a82f011a377ef2ebef7aba' },
  { filename: 'numpy-2.5.5-cp312-cp312-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl', size: 15720599, sha256: '704d819265e5d1064d932968e9ee85fff2103ccc78c05b878c06943ba27b8507' },
  { filename: 'scikit_learn-1.8.0-cp312-cp312-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl', size: 8931904, sha256: 'a0bcfe4d0d14aec44921545fd2af2338c7471de9cb701f1da4c9d85906ab847a' },
  { filename: 'scipy-1.18.1-cp312-cp312-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl', size: 35344199, sha256: 'f55fa87b6c612ecd6b058f167c53231b1d14e412efe361d3d6e38b3631c73218' },
  { filename: 'threadpoolctl-3.8.0-py3-none-any.whl', size: 32091, sha256: 'f1b49c82704d50f13ffae019c727b0fa4f6791a58f48f06a09c45face1be66da' }
];
function fail(code){throw Object.assign(Error(code),{code});}
function privateDir(dir){try{fs.mkdirSync(dir,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}const st=fs.lstatSync(dir);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o077))fail('model-tools-directory-unsafe');}
async function downloadPip(fetchImpl=readPublic){
 const response=await fetchImpl(PIP_URL,{redirect:'error',signal:AbortSignal.timeout(60000)});
 if(!response.ok)fail('model-tools-download-failed');const chunks=[];let size=0;
 for await(const bytes of response.body){size+=bytes.length;if(size>4*1024*1024)fail('model-tools-download-too-large');chunks.push(bytes);}
 const wheel=Buffer.concat(chunks);if(crypto.createHash('sha256').update(wheel).digest('hex')!==PIP_HASH)fail('model-tools-hash-mismatch');return wheel;
}
// Stage only pinned bytes from removable or read-only media before executing pip.
function copyOfflineWheel(media, destination, wheel) {
  const source = path.join(media, wheel.filename);
  let fd;
  try {
    fd = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) fail('model-tools-offline-wheel-unsafe');
    if (stat.size !== wheel.size) fail('model-tools-hash-mismatch');
    const bytes = Buffer.alloc(wheel.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!count) fail('model-tools-hash-mismatch');
      offset += count;
    }
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== wheel.sha256) fail('model-tools-hash-mismatch');
    fs.writeFileSync(path.join(destination, wheel.filename), bytes, {flag:'wx',mode:0o600});
  } catch (error) {
    if (error.code === 'ENOENT') fail('model-tools-offline-wheel-missing');
    if (error.code === 'ELOOP') fail('model-tools-offline-wheel-unsafe');
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function stageOfflineWheels(media, stage) {
  if (!path.isAbsolute(media) || !fs.lstatSync(media, {throwIfNoEntry:false})?.isDirectory()) fail('model-tools-offline-directory-invalid');
  const directory = path.join(stage, 'wheelhouse');
  fs.mkdirSync(directory, {mode:0o700});
  for (const wheel of offlineWheels) copyOfflineWheel(media, directory, wheel);
  const [pip, ...packages] = offlineWheels;
  const lock = path.join(directory, 'requirements.txt');
  // pip normalizes wheel distribution names. This private index contains only the verified closure.
  const requirements = packages.map(({filename, sha256}) => {
    const [name, version] = filename.split('-');
    return name + '==' + version + ' --hash=sha256:' + sha256;
  });
  fs.writeFileSync(lock, requirements.join('\n')+'\n', {flag:'wx',mode:0o600});
  return {bootstrap:path.join(directory,pip.filename), inputs:['--no-index','--find-links',directory,'--require-hashes','-r',lock], cleanup:directory};
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
  const stagedPython=path.join(stage,'bin/python3');
  const standardMedia = path.join(base, 'offline-wheels');
  const media = env.V6_MODEL_OFFLINE_DIR ?? (fs.lstatSync(standardMedia,{throwIfNoEntry:false}) ? standardMedia : undefined);
  let bootstrap, inputs, cleanup;
  if (media !== undefined) {
    const supported = run(stagedPython, ['-I','-c','import platform,sys; sys.exit(0 if (sys.implementation.name,sys.version_info[:2],sys.platform,platform.machine()) == ("cpython",(3,12),"linux","x86_64") else 1)'], {env:cleanEnv,timeout:10000});
    if (supported.error || supported.status !== 0) fail('model-tools-offline-platform-unsupported');
    ({bootstrap, inputs, cleanup} = stageOfflineWheels(media, stage));
  } else {
    const wheel=await (deps.downloadPip||downloadPip)();
    bootstrap = cleanup = path.join(stage,'pip.whl');
    fs.writeFileSync(bootstrap,wheel,{flag:'wx',mode:0o600});
    inputs = ['--index-url','https://pypi.org/simple','scikit-learn==1.8.0'];
  }
  invoke(stagedPython,['-I','-c','import runpy,sys; sys.path.insert(0,sys.argv.pop(1)); runpy.run_module("pip",run_name="__main__")',bootstrap,'--isolated','--disable-pip-version-check','install','--no-cache-dir','--only-binary=:all:',...inputs],300000);
  if(!check(stagedPython))fail('model-tools-verification-failed');
  fs.rmSync(cleanup,{recursive:true});
  try { fs.renameSync(stage,final); }
  catch (error) {
    if (!['ENOTEMPTY','EEXIST'].includes(error.code)) throw error;
    privateDir(final);
  }
  if(!check(python))fail('model-tools-verification-failed');return python;
 }finally{if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});}
}
if (require.main === module) {
  const [option, directory, ...rest] = process.argv.slice(2);
  if (option === '--list-offline-wheels' && directory === undefined) {
    console.log(JSON.stringify(offlineWheels, null, 2));
  } else if (option === '--offline-dir' && directory && rest.length === 0) {
    ensureModelPython({home:require('node:os').homedir(), env:{...process.env,V6_MODEL_OFFLINE_DIR:path.resolve(directory)}})
      .then(python=>console.log(JSON.stringify({status:'research-tools-ready',python})))
      .catch(error=>{console.error(error.code || 'model-tools-prepare-failed');process.exitCode=1;});
  } else {
    console.error('Usage: node fayo-model-tools.js --list-offline-wheels | --offline-dir DIRECTORY');
    process.exitCode=2;
  }
}
module.exports={ensureModelPython,downloadPip};
