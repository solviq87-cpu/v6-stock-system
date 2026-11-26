#!/usr/bin/env node
'use strict';
// Explicit operator-run. journal-* persists research evidence only; stdout may
// contain private evidence. It never writes accounts or production parameters.
const fs=require('node:fs');
const {register,freezePrediction,evaluate}=require('../src/core/probability-reliability');
try{
 const [, ,operation,file,root,...args]=process.argv;
 const journal=operation?.startsWith('journal-');
 if(!file||!['register','freeze','evaluate','journal-register','journal-freeze','journal-outcome','journal-evaluate','journal-read'].includes(operation))throw Error('usage: node scripts/probability-reliability.js register|freeze|evaluate PRIVATE_INPUT.json OR journal-register|journal-freeze|journal-outcome|journal-evaluate|journal-read PRIVATE_INPUT.json PRIVATE_ROOT [--signals-root PRIVATE_ROOT] [--observations-root PRIVATE_ROOT]');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));let input;
 try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>32*1024*1024||journal&&(stat.mode&0o077))throw Error('输入必须是有界的私有 JSON 文件（journal 输入权限0600）');input=JSON.parse(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}
 const now=Date.now();
 const asOf=input.asOf??now;
 if((operation==='evaluate'||operation==='journal-read')&&(!Number.isSafeInteger(asOf)||asOf>now))throw Error('评估截止时间不可在未来');
 let result;
 if(journal){
  const options={now},seen=new Set();
  for(let i=0;i<args.length;i+=2){const flag=args[i];if(!['--signals-root','--observations-root'].includes(flag)||!args[i+1]||seen.has(flag))throw Error('研究来源目录参数无效');seen.add(flag);options[flag==='--signals-root'?'signalRoot':'observationRoot']=args[i+1];}
  const store=require('../src/core/probability-reliability-store');
  result=operation==='journal-read'?store.readProbabilityResearch(root,{scope:input.scope,asOf}):store.probabilityResearch(root,{...input,operation:operation.slice(8)},options);
  if(result.status==='rejected')process.exitCode=1;
 }else result=operation==='register'?register(input.plan,{now}):operation==='freeze'?freezePrediction(input.plan,input.prediction,input.calendar,{now}):evaluate(input.plan,input.predictions,input.outcomes,input.calendar,{now:asOf});
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch(e){process.stderr.write(String(e.message||e)+'\n');process.exitCode=1;}
