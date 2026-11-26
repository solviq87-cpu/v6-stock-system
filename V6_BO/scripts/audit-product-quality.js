#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {evaluateProductQuality}=require('../src/core/product-quality-evaluation');
function readInput(file){
 const resolved=path.resolve(file);let dir=resolved;
 while(true){const st=fs.lstatSync(dir);if(st.isSymbolicLink())throw Error('评价输入路径不能经过符号链接');const parent=path.dirname(dir);if(parent===dir)break;dir=parent;}
 if(!fs.lstatSync(resolved).isFile())throw Error('评价输入须为普通JSON文件');
 const fd=fs.openSync(resolved,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const st=fs.fstatSync(fd),limit=1024*1024;if(!st.isFile()||st.size>limit)throw Error('评价输入须为不超过1MiB的普通JSON文件');const buffer=Buffer.alloc(limit+1);let size=0,n;while(size<buffer.length&&(n=fs.readSync(fd,buffer,size,buffer.length-size,null))>0)size+=n;if(size>limit)throw Error('评价输入读取期间超过1MiB');try{return JSON.parse(buffer.subarray(0,size).toString('utf8'));}catch{throw Error('评价输入不是合法JSON');}}finally{fs.closeSync(fd);}
}
function run(args=process.argv.slice(2)){
 let input;if(args.length===0){const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8',timeout:3000}).trim();input={revision,asOf:new Date().toISOString(),scope:{kind:'isolated-test',population:'未提供评价输入；本命令未读取账户或运行数据'}};}
 else if(args.length===2&&args[0]==='--input')input=readInput(args[1]);
 else if(args.length===4&&args[0]==='--runtime-root'&&args[2]==='--input')return require('../src/core/runtime-acceptance').evaluateRuntimeQuality({root:args[1],input:readInput(args[3])});
 else throw Error('用法：npm run quality:audit -- [--input 证据.json | --runtime-root 私有绝对路径 --input 预登记计划.json]');
 return evaluateProductQuality(input);
}
if(require.main===module){try{const report=run();process.stdout.write(JSON.stringify(report,null,2)+'\n');if(report.criticalReview.state==='blocked')process.exitCode=2;}catch(error){process.stderr.write('质量评价输入无效：'+error.message+'\n');process.exitCode=1;}}
module.exports={run,readInput};
