#!/usr/bin/env node
'use strict';
// Explicit operator-run, read-only input. Stdout contains private research evidence.
const fs=require('node:fs');
const {register,freezePrediction,evaluate}=require('../src/core/probability-reliability');
try{
 const [, ,operation,file]=process.argv;
 if(!file||!['register','freeze','evaluate'].includes(operation))throw Error('usage: node scripts/probability-reliability.js register|freeze|evaluate PRIVATE_INPUT.json');
 const fd=fs.openSync(file,'r');let input;
 try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>32*1024*1024)throw Error('输入必须是有界的私有 JSON 文件');input=JSON.parse(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}
 const now=Date.now();
 const asOf=input.asOf??now;
 if(operation==='evaluate'&&(!Number.isSafeInteger(asOf)||asOf>now))throw Error('评估截止时间不可在未来');
 const result=operation==='register'?register(input.plan,{now}):operation==='freeze'?freezePrediction(input.plan,input.prediction,input.calendar,{now}):evaluate(input.plan,input.predictions,input.outcomes,input.calendar,{now:asOf});
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch(e){process.stderr.write(String(e.message||e)+'\n');process.exitCode=1;}
