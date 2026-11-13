#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const engine=require('../src/strategy/research36');
try{
 const [action,file,output]=process.argv.slice(2);
 if(action==='catalog')process.stdout.write(JSON.stringify(engine.getCatalog(),null,2)+'\n');
 else{
  if(!['evaluate','backtest','experiment'].includes(action)||!file)throw Error('用法: node scripts/research36.js catalog | evaluate INPUT.json [NEW_OUTPUT.json] | backtest INPUT.json [NEW_OUTPUT.json] | experiment INPUT.json [NEW_OUTPUT.json]');
  if(fs.statSync(file).size>32*1024*1024)throw Error('研究文件超过32MB');
  const input=JSON.parse(fs.readFileSync(file,'utf8'));
  const result=action==='evaluate'?engine.evaluateResearch36(input):action==='experiment'?engine.experimentResearch36(input):engine.backtestResearch36(input);
  if(output){
   // Explicit offline export only. Refuse replacement so earlier configurations,
   // input evidence and results are not rewritten by a later experiment.
   const fd=fs.openSync(output,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600);
   try{fs.writeFileSync(fd,JSON.stringify({schemaVersion:1,recordedAt:Date.now(),action,input,result},null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   process.stdout.write('研究记录已创建；已有文件不会覆盖。\n');
  }else process.stdout.write(JSON.stringify(result,null,2)+'\n');
 }
}catch(e){process.stderr.write('研究输入拒绝: '+e.message+'\n');process.exitCode=1;}
