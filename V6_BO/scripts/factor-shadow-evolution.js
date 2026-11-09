#!/usr/bin/env node
'use strict';
// Explicit offline research workflow; no external quotes, network, or orders.
const fs=require('node:fs'),path=require('node:path');
const {readJson}=require('../src/core/forward-tracking-store');
const {freezeFeatureEpisode,evolveShadowFactors}=require('../src/core/factor-shadow-evolution');
function safeNew(file){
 if(!path.isAbsolute(file)||file.includes('\0'))throw Error('输出必须使用私有绝对路径');
 const target=path.resolve(file);
 if(target.split(path.sep).includes('public'))throw Error('禁止公开发布研究因子文件');
 let cursor=path.parse(target).root;
 for(const part of target.slice(cursor.length).split(path.sep).filter(Boolean)){
  cursor=path.join(cursor,part);
  try{if(fs.lstatSync(cursor).isSymbolicLink())throw Error('禁止符号链接路径');}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
 return target;
}
function writeNew(file,report){
 file=safeNew(file);
 const dir=path.dirname(file);
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 safeNew(file); // Recheck ancestors after creating them.
 const stage=fs.mkdtempSync(path.join(dir,'.shadow-factor-'));
 try{
  const temp=path.join(stage,'report.json');
  const fd=fs.openSync(temp,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(report,null,2)+'\n');fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  fs.linkSync(temp,file); // Atomic no-overwrite: old models are immutable.
  const directory=fs.openSync(dir,'r');
  try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
 }finally{fs.rmSync(stage,{recursive:true,force:true});}
}
function execute(args,{now=Date.now()}={}){
 const [mode,...files]=args;
 if(mode==='freeze'&&files.length===3){
  const source=readJson(files[1]),cohort=readJson(files[0]);
  const result=freezeFeatureEpisode({...source,cohort},{now});
  writeNew(files[2],result);
  return {ok:true,mode,features:result.features.length,day:result.signalDay,
   fingerprint:result.fingerprint,canTrade:false};
 }
 if(mode==='evolve'&&(files.length===2||files.length===3)){
  const manifest=readJson(files[0]);
  if(manifest?.schemaVersion!==1||!Array.isArray(manifest.episodes)||
     manifest.episodes.length<36||manifest.episodes.length>400)
   throw Error('需要36至400个有冻结因子与到期观察的交易日批次');
  const episodes=manifest.episodes.map(entry=>{
   if(!entry||typeof entry.featuresFile!=='string'||typeof entry.reportFile!=='string')
    throw Error('每个批次须指定独立的冻结特征文件和观察报告文件');
   return {features:readJson(entry.featuresFile),report:readJson(entry.reportFile)};
  });
  const previous=files.length===3?readJson(files[2]):null;
  const result=evolveShadowFactors(episodes,{now,previous,
   marketContext:manifest.marketContext});
  writeNew(files[1],result);
  return {ok:true,mode,status:result.status,version:result.version,
   trainingDays:result.trainDays,validationDays:result.validationDays,
   testDays:result.testDays,fingerprint:result.fingerprint,
   productionWeightsChanged:false,canTrade:false};
 }
 throw Error('用法: factor-shadow-evolution.js freeze <冻结信号JSON> <因子证据JSON> <新特征JSON> | evolve <批次清单JSON> <新沙盒模型JSON> [上一已接受模型JSON]');
}
if(require.main===module){
 try{console.log(JSON.stringify(execute(process.argv.slice(2))));}
 catch(e){console.error(JSON.stringify({ok:false,error:String(e.message).slice(0,220)}));process.exitCode=1;}
}
module.exports={execute};
