#!/usr/bin/env node
'use strict';
// Read-only, operator-provided snapshot files. No network, no account or signal writes.
const fs=require('node:fs'),path=require('node:path');
const {evaluateObservedIndustryParticipation}=
 require('../src/core/observed-industry-participation');
function read(file){
 if(typeof file!=='string'||!path.isAbsolute(file))throw Error('研究输入需要绝对路径');
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw Error('输入必须为≤8MiB普通文件');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
function main(argv,{now=Date.now()}={}){
 if(!Array.isArray(argv)||argv.length!==2||argv[0]===argv[1])
  throw Error('用法: node scripts/observed-industry-participation.js /报价快照.json /BaoStock行业分类.json');
 return evaluateObservedIndustryParticipation({
  snapshot:read(argv[0]),classification:read(argv[1]),asOf:now});
}
if(require.main===module){
 try{console.log(JSON.stringify(main(process.argv.slice(2)),null,2));}
 catch(e){console.error(String(e.message).slice(0,180));process.exitCode=1;}
}
module.exports={main};
