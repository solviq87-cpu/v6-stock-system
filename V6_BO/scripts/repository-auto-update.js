#!/usr/bin/env node
'use strict';
// The publisher reads immutable source. It never pulls into a running checkout.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const execute=promisify(execFile);
const {runRepositoryAutoUpdate}=require('../src/core/repository-auto-update');
const {createGitHubUpdateSource}=require('../src/core/github-update-source');
const {createWorkBuddyStaticPublisher,TARGET}=require('../src/core/workbuddy-static-publisher');
const {buildWorkBuddyStatic}=require('./build-workbuddy-static');
const SHA=/^[a-f0-9]{40}$/,HASH=/^[a-f0-9]{64}$/;
const DEFAULT_SOURCE='V6_WEB/workbuddy/index.html';
function error(code){const e=new Error(code);e.code=code;return e;}
function safePath(value,{create=false,directory=false}={}){
 if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0'))throw error('invalid-private-path');
 const full=path.resolve(value);if(full===path.parse(full).root||full.split(path.sep).some(x=>/^(public|www|htdocs)$/i.test(x)))throw error('invalid-private-path');
 let cursor=path.parse(full).root;for(const part of full.slice(cursor.length).split(path.sep).filter(Boolean)){
  cursor=path.join(cursor,part);try{if(fs.lstatSync(cursor).isSymbolicLink())throw error('invalid-private-path');}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 if(create)fs.mkdirSync(full,{recursive:true,mode:0o700});
 if(fs.existsSync(full)){const st=fs.statSync(full);if(directory?!st.isDirectory()||st.mode&0o077:!st.isFile()||st.mode&0o077)throw error('invalid-private-permissions');}
 return full;
}
function parseArgs(args){
 const [mode,configFile,...flags]=args;
 if(!['check','once','watch','bootstrap','restore-legacy'].includes(mode)||typeof configFile!=='string'||!path.isAbsolute(configFile))throw error('usage');
 let apply=false,expectedLegacyHash,expectedCurrentArtifactHash,legacySnapshotHash;
 for(let i=0;i<flags.length;i++){
  if(flags[i]==='--apply'&&!apply)apply=true;
  else if(flags[i]==='--expected-legacy-hash'&&mode==='bootstrap'&&expectedLegacyHash===undefined){expectedLegacyHash=flags[++i];if(!HASH.test(expectedLegacyHash||''))throw error('usage');}
  else if(flags[i]==='--expected-current-hash'&&mode==='restore-legacy'&&expectedCurrentArtifactHash===undefined){expectedCurrentArtifactHash=flags[++i];if(!HASH.test(expectedCurrentArtifactHash||''))throw error('usage');}
  else if(flags[i]==='--legacy-snapshot-hash'&&mode==='restore-legacy'&&legacySnapshotHash===undefined){legacySnapshotHash=flags[++i];if(!HASH.test(legacySnapshotHash||''))throw error('usage');}
  else throw error('usage');
 }
 if(mode==='check'&&apply||mode==='watch'&&!apply||mode==='bootstrap'&&(!apply||!expectedLegacyHash)||mode==='restore-legacy'&&(!apply||!expectedCurrentArtifactHash||!legacySnapshotHash))throw error('usage');
 return {mode,configFile,apply,expectedLegacyHash,expectedCurrentArtifactHash,legacySnapshotHash};
}
function loadConfig(file){
 safePath(file);const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));let config;
 try{if(fs.fstatSync(fd).size>16384)throw error('invalid-config');config=JSON.parse(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}
 const allowed=['schemaVersion','repository','branch','targetOrigin','stateDir','repositoryRoot','sourcePath','workflowPath','requiredJobs','intervalMs','shareCodeFile'];
 if(!config||Array.isArray(config)||Object.keys(config).some(k=>!allowed.includes(k))||config.schemaVersion!==1||
  config.repository!=='solviq87-cpu/v6-stock-system'||config.branch!=='dev'||config.targetOrigin!==TARGET||
  config.workflowPath!=='.github/workflows/v6-ci.yml'||JSON.stringify(config.requiredJobs)!==JSON.stringify(['verify','verify-web'])||
  !Number.isSafeInteger(config.intervalMs??300000)||(config.intervalMs??300000)<60000||(config.intervalMs??300000)>3600000)throw error('invalid-config');
 const sourcePath=config.sourcePath||DEFAULT_SOURCE;
 if(sourcePath!==DEFAULT_SOURCE)throw error('invalid-config');
 safePath(config.stateDir,{directory:true});if(config.shareCodeFile)safePath(config.shareCodeFile);
 if(config.repositoryRoot!==undefined&&(!path.isAbsolute(config.repositoryRoot)||config.repositoryRoot.includes('\0')))throw error('invalid-config');
 return {...config,sourcePath,intervalMs:config.intervalMs??300000};
}
function credential(config,env){
 let value=env.V6_WORKBUDDY_SHARECODE;
 if(!value&&config.shareCodeFile){const file=safePath(config.shareCodeFile),fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try{if(fs.fstatSync(fd).size>512)throw error('invalid-credential-file');value=fs.readFileSync(fd,'utf8').trim();}finally{fs.closeSync(fd);}}
 if(value===undefined||value==='')return null;
 if(typeof value!=='string'||!/^[A-Za-z0-9_-]{4,128}$/.test(value))throw error('invalid-credential');return value;
}
async function immutableArtifact(config,sha,{readGit,fetchFile,build=buildWorkBuddyStatic}={}){
 if(!SHA.test(sha))throw error('invalid-sha');
 let raw;
 try{
  raw=readGit?await readGit(sha,config.sourcePath):(await execute('git',['-C',config.repositoryRoot||path.resolve(__dirname,'../..'),'show',`${sha}:${config.sourcePath}`],
   {encoding:'buffer',timeout:15000,maxBuffer:2*1024*1024,windowsHide:true})).stdout;
 }catch{
  try{raw=fetchFile?await fetchFile(sha,config.sourcePath):(await execute('curl',['--disable','--fail','--silent','--show-error','--proto','=https','--max-redirs','0','--max-time','12',
   '--max-filesize',String(2*1024*1024),`https://raw.githubusercontent.com/${config.repository}/${sha}/${config.sourcePath}`],
   {encoding:'buffer',timeout:13000,maxBuffer:2*1024*1024,windowsHide:true})).stdout;}catch{throw error('artifact-unavailable');}
 }
 if((!Buffer.isBuffer(raw)&&typeof raw!=='string')||!Buffer.byteLength(raw)||Buffer.byteLength(raw)>2*1024*1024)throw error('artifact-unavailable');
 const dir=safePath(path.join(config.stateDir,'artifacts'),{directory:true,create:true}),file=path.join(dir,`${sha}-${crypto.randomBytes(12).toString('hex')}.html`);
 if(fs.readdirSync(dir).length>=64)throw error('artifact-staging-limit');
 const bytes=Buffer.isBuffer(raw)?raw:Buffer.from(raw);let fd;
 try{fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  return build({sourceFile:file,sha});
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
async function runCommand(options,dependencies={}){
 const {env=process.env,now=Date.now,sourceFactory=createGitHubUpdateSource,providerFactory=createWorkBuddyStaticPublisher}=dependencies;
 const config=loadConfig(options.configFile),source=options.mode==='restore-legacy'?null:sourceFactory(config,{token:env.GITHUB_TOKEN||undefined});
 const shareCode=credential(config,env);
 if(!shareCode){const candidate=source?await source.detect({repository:config.repository,branch:config.branch}):null;return {code:'credential-required',candidateSha:candidate?.sha,ciStatus:candidate?.ci?.status,targetOrigin:TARGET,scope:'static-frontend-only'};}
 safePath(config.stateDir,{create:true,directory:true});
 const provider=providerFactory({targetOrigin:TARGET,shareCode,stateDir:path.join(config.stateDir,'publisher'),artifactForSha:sha=>immutableArtifact(config,sha,dependencies.artifactDependencies)},dependencies.providerDependencies);
 if(options.mode==='restore-legacy'){
  const receipt=await provider.restoreLegacy({targetOrigin:TARGET,expectedCurrentArtifactHash:options.expectedCurrentArtifactHash,legacySnapshotHash:options.legacySnapshotHash});
  if(receipt?.targetOrigin!==TARGET||receipt.artifactHash!==options.legacySnapshotHash||receipt.sha!==undefined||!(/^[A-Za-z0-9_.:-]{1,160}$/).test(receipt.receiptId||''))throw error('invalid-restore-receipt');
  return {code:'legacy-restored',restoredArtifactHash:receipt.artifactHash,receiptId:receipt.receiptId,targetOrigin:TARGET,scope:'static-frontend-only'};
 }
 if(options.mode==='bootstrap'){
  const candidate=await source.detect({repository:config.repository,branch:config.branch});
  if(!candidate||!SHA.test(candidate.sha)||candidate.ci?.status!=='passed'||candidate.ci?.sha!==candidate.sha)return {code:'ci-blocked',candidateSha:candidate?.sha,targetOrigin:TARGET};
  // This explicit one-time action adopts only the exact previously reviewed page.
  const receipt=await provider.bootstrap({sha:candidate.sha,expectedLegacyHash:options.expectedLegacyHash});
  if(receipt?.sha!==candidate.sha||receipt.targetOrigin!==TARGET||!(/^[A-Za-z0-9_.:-]{1,160}$/).test(receipt.receiptId||''))throw error('invalid-bootstrap-receipt');
  return {code:'bootstrapped',candidateSha:candidate.sha,deployedSha:receipt.sha,receiptId:receipt.receiptId,targetOrigin:TARGET,scope:'static-frontend-only'};
 }
 const result=await runRepositoryAutoUpdate({...config,mode:options.apply?'apply':'check'},{source,deploy:provider,now});
 return {...result,scope:'static-frontend-only'};
}
function sanitizedFailure(){return {code:'auto-update-blocked',scope:'static-frontend-only'};}
async function main(args,dependencies={}){
 const options=parseArgs(args);
 if(options.mode!=='watch')return runCommand(options,dependencies);
 const config=loadConfig(options.configFile);let stopped=false,timer,inFlight;
 const emit=dependencies.emit||((value)=>process.stdout.write(JSON.stringify(value)+'\n'));
 const tick=async()=>{if(stopped)return;try{inFlight=runCommand(options,dependencies);emit(await inFlight);}catch{emit(sanitizedFailure());}finally{inFlight=null;}
  if(!stopped)timer=setTimeout(()=>{void tick();},config.intervalMs);};
 const stop=async()=>{stopped=true;clearTimeout(timer);if(inFlight)await inFlight.catch(()=>{});process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);void tick();return {stop};
}
if(require.main===module)main(process.argv.slice(2)).then(result=>{if(result.stop)return;process.stdout.write(JSON.stringify(result)+'\n');
 if(!['up-to-date','applied','recovered','bootstrapped','legacy-restored','update-available'].includes(result.code))process.exitCode=2;
}).catch(()=>{process.stderr.write(JSON.stringify(sanitizedFailure())+'\n');process.exitCode=1;});
module.exports={parseArgs,loadConfig,immutableArtifact,runCommand,main};
