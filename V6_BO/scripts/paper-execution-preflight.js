#!/usr/bin/env node
'use strict';
const fs=require('node:fs');const path=require('node:path');
const {preflightPaperExecution}=require('../src/core/paper-execution-preflight');
function read(file){const p=path.resolve(process.cwd(),file);const st=fs.lstatSync(p);if(st.isSymbolicLink()||!st.isFile()||st.size>100*1024*1024)throw Error('输入文件无效或超过100MB');return JSON.parse(fs.readFileSync(p,'utf8'));}
function main(args){if(args.length!==3)throw Error('用法: npm run paper:preflight -- <intent-plan.json> <market-snapshot.json> <paper-account-summary.json>');const result=preflightPaperExecution(read(args[0]),read(args[1]),read(args[2]));process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;}
if(require.main===module){try{main(process.argv.slice(2));}catch(e){process.stderr.write('模拟盘执行预检失败：'+e.message+'\n');process.exitCode=1;}}
module.exports={main};
