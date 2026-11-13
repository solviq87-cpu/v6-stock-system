#!/usr/bin/env node
'use strict';
// Explicit offline research only: no fetch, account changes, archive overwrite or live tasks.
const fs=require('node:fs');
const {auditQuoteSourceWindow}=require('../src/core/quote-source-window-quality');
function main(){
 if(process.argv.length!==3)throw Error('用法: node scripts/quote-source-window-quality.js <预登记观测记录.json>');
 const file=process.argv[2];
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 let input;
 try {
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.size<=0||stat.size>4*1024*1024)
   throw Error('输入必须是非符号链接且小于4MiB的普通JSON文件');
  const buffer=Buffer.alloc(stat.size+1);
  let bytes=0,count;
  while(bytes<buffer.length&&(count=fs.readSync(fd,buffer,bytes,buffer.length-bytes,null))>0)bytes+=count;
  const after=fs.fstatSync(fd);
  if(bytes!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs)
   throw Error('读取期间输入发生变化');
  input=JSON.parse(buffer.subarray(0,bytes).toString('utf8'));
 } finally {fs.closeSync(fd);}
 const result=auditQuoteSourceWindow(input);
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
 if(result.status==='blocked')process.exitCode=2;
}
try{main();}catch(e){console.error('报价样本质量审核失败:',e.message);process.exitCode=2;}
