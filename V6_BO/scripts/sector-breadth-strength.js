#!/usr/bin/env node
'use strict';
// Explicit, local, read-only research. No remote polling, writes, trade or alerts.
const fs=require('node:fs'),path=require('node:path');
const {evaluateSectorBreadthStrength}=require('../src/core/sector-breadth-strength');
function main(argv){
 if(argv.length!==1||!path.isAbsolute(argv[0]))throw Error('用法：node scripts/sector-breadth-strength.js /绝对路径/当日板块观测.json');
 const file=argv[0],stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw Error('输入必须是不超过8MiB的普通JSON文件');
 const input=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!Number.isSafeInteger(input.asOf)||input.asOf<=0)throw Error('需提供真实采集时钟 asOf（毫秒）');
 return evaluateSectorBreadthStrength(input);
}
if(require.main===module){try{console.log(JSON.stringify(main(process.argv.slice(2)),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={main};
