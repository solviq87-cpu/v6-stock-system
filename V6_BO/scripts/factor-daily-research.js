#!/usr/bin/env node
'use strict';
// Deliberately no watch daemon or provider calls. Scheduling, legal access and
// durable secrets are external operator responsibilities.
const path=require('node:path');
const {readJson}=require('../src/core/forward-tracking-store');
const {runDailyCycle}=require('../src/core/factor-daily-research-cycle');
function parse(args){
 const [mode,configFile,...rest]=args;
 if(!['capture','observe'].includes(mode)||
    typeof configFile!=='string'||!path.isAbsolute(configFile)||
    rest.length>1||(rest.length===1&&rest[0]!=='--apply'))
  throw Error('用法: factor-daily-research.js capture|observe <私有配置JSON绝对路径> [--apply]；默认零写入预览');
 return {mode,configFile,apply:rest.length===1};
}
function main(args,{now=Date.now()}={}){
 const opts=parse(args);
 return runDailyCycle(readJson(opts.configFile),{
  mode:opts.mode,apply:opts.apply,now});
}
if(require.main===module){
 try{
  const result=main(process.argv.slice(2));
  if(result&&typeof result.then==='function')result.then(value=>{console.log(JSON.stringify(value,null,2));if(value.status.startsWith('blocked-'))process.exitCode=2;}).catch(()=>{console.error(JSON.stringify({status:'failed-stop-and-audit-before-retry',canTrade:false,productionWeightsChanged:false}));process.exitCode=1;});
  else{console.log(JSON.stringify(result,null,2));if(result.status.startsWith('blocked-'))process.exitCode=2;}
 }catch(error){
  console.error(JSON.stringify({ok:false,
   stage:error.stage||'preflight',
   completedStages:error.completedStages||[],
   status:'failed-stop-and-audit-before-retry',
   // Never print private JSON, file paths, tokens or raw provider payload.
   canTrade:false,productionWeightsChanged:false}));
  process.exitCode=1;
 }
}
module.exports={parse,main};
