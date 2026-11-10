#!/usr/bin/env node
'use strict';
// Explicit offline research only: no fetch, account changes, archive overwrite or live tasks.
const fs=require('node:fs');
const {auditQuoteSourceWindow}=require('../src/core/quote-source-window-quality');
function main(){
 if(process.argv.length!==3)throw Error('用法: node scripts/quote-source-window-quality.js <预登记观测记录.json>');
 const file=process.argv[2],stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size<=0||stat.size>4*1024*1024)
  throw Error('输入必须是非符号链接且小于4MiB的普通JSON文件');
 const result=auditQuoteSourceWindow(JSON.parse(fs.readFileSync(file,'utf8')));
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
 if(result.status==='blocked')process.exitCode=2;
}
try{main();}catch(e){console.error('报价样本质量审核失败:',e.message);process.exitCode=2;}
