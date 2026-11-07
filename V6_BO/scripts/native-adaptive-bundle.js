#!/usr/bin/env node
'use strict';
// A write-once offline export. Incomplete exports fail verification.
// Verification replays the original input,
// rather than accepting a manifest rewritten alongside a modified report.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {runAdaptiveResearch}=require('../src/core/adaptive-market-lab');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const json=x=>JSON.stringify(x,null,2)+'\n';
const FILES=['input.json','native-replay.json','adaptive-report.json'];
function read(file,max=32*1024*1024){const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const st=fs.fstatSync(fd);if(!st.isFile()||st.size>max)throw Error('需要限额内普通文件');const b=fs.readFileSync(fd);if(b.length>max)throw Error('文件超过限额');return b;}finally{fs.closeSync(fd);}}
function compute(input){
 if(!input.nativeEvidence)throw Error('输入缺少nativeEvidence，不能导出原生自动适配包');
 const report=runAdaptiveResearch(input);
 return {'input.json':json(input),'native-replay.json':json(report.nativeAdaptation),'adaptive-report.json':json(report)};
}
function create(inputFile,output){
 const data=compute(JSON.parse(read(inputFile,8*1024*1024))),target=path.resolve(output),parent=path.dirname(target);
 if(fs.existsSync(target))throw Error('输出已存在，拒绝覆盖');
 fs.mkdirSync(parent,{recursive:true});const stage=fs.mkdtempSync(path.join(parent,'.native-adaptive-'));
 try{
  const manifest={schemaVersion:1,mode:'native-adaptive-offline-bundle',canTrade:false,files:{}};
  for(const name of FILES){const bytes=Buffer.from(data[name]);if(bytes.length>32*1024*1024)throw Error('导出单文件超过32MiB');manifest.files[name]={sha256:hash(bytes),size:bytes.length};fs.writeFileSync(path.join(stage,name),bytes,{mode:0o600});}
  fs.writeFileSync(path.join(stage,'manifest.json'),json(manifest),{mode:0o600});
  for(const name of [...FILES,'manifest.json']){const fd=fs.openSync(path.join(stage,name),'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  // mkdir is the no-clobber reservation; never rename over another completed export.
  fs.mkdirSync(target,{mode:0o700});
  try{for(const name of [...FILES,'manifest.json'])fs.linkSync(path.join(stage,name),path.join(target,name));
   const fd=fs.openSync(target,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  }catch(e){fs.rmSync(target,{recursive:true,force:true});throw e;}
  const fd=fs.openSync(parent,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  return {ok:true,mode:manifest.mode,canTrade:false,output:target};
 }finally{fs.rmSync(stage,{recursive:true,force:true});}
}
function verify(directory){
 const dir=path.resolve(directory);if(!fs.lstatSync(dir).isDirectory()||fs.lstatSync(dir).isSymbolicLink())throw Error('归档须为普通目录');
 if(JSON.stringify(fs.readdirSync(dir).sort())!==JSON.stringify([...FILES,'manifest.json'].sort()))throw Error('归档文件缺失或多出');
 const manifest=JSON.parse(read(path.join(dir,'manifest.json'),16384));
 if(manifest.schemaVersion!==1||manifest.mode!=='native-adaptive-offline-bundle'||manifest.canTrade!==false||!manifest.files||JSON.stringify(Object.keys(manifest.files).sort())!==JSON.stringify([...FILES].sort()))throw Error('归档清单无效');
 const bytes={};for(const name of FILES){const b=read(path.join(dir,name));if(manifest.files[name]?.sha256!==hash(b)||manifest.files[name]?.size!==b.length)throw Error('归档指纹不一致: '+name);bytes[name]=b;}
 const recomputed=compute(JSON.parse(bytes['input.json']));
 for(const name of FILES)if(!bytes[name].equals(Buffer.from(recomputed[name])))throw Error('确定性重放不一致: '+name);
 return {ok:true,mode:manifest.mode,canTrade:false,deterministicReplay:true};
}
function main(args){if(args.length===2&&args[0]==='--verify')return verify(args[1]);if(args.length!==2||args.some(a=>a.startsWith('--')))throw Error('用法: node scripts/native-adaptive-bundle.js <输入JSON> <新目录> 或 --verify <目录>');return create(...args);}
if(require.main===module)try{console.log(JSON.stringify(main(process.argv.slice(2))));}catch(e){console.error(JSON.stringify({ok:false,error:String(e.message).slice(0,220)}));process.exitCode=1;}
module.exports={create,verify,main};
