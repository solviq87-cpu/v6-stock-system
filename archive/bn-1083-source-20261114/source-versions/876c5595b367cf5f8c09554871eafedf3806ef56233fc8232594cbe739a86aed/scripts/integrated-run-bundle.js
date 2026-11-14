#!/usr/bin/env node
'use strict';
const path=require('node:path');
const {makeBundle,verifyBundle}=require('../src/core/integrated-run-bundle');
function parse(argv){
 if(argv[0]==='verify'&&argv.length===2)return {verify:path.resolve(argv[1])};
 if(argv[0]!=='run')throw Error('用法: run history.json output-root [--snapshots file] [--evidence file | --python-script file]；verify run-directory');
 if(argv.length<3)throw Error('需要历史数据与输出目录');
 const args={historyPath:path.resolve(argv[1]),outputRoot:path.resolve(argv[2])};
 const keys={'--snapshots':'snapshotsPath','--evidence':'evidencePath','--python-script':'pythonScript'};
 for(let i=3;i<argv.length;i+=2){
  const key=keys[argv[i]];if(!key||!argv[i+1]||args[key])throw Error('未知、重复或缺失的参数: '+argv[i]);
  args[key]=path.resolve(argv[i+1]);
 }
 return args;
}
if(require.main===module){try{const args=parse(process.argv.slice(2));process.stdout.write(JSON.stringify(args.verify?verifyBundle(args.verify):makeBundle(args),null,2)+'\n');}catch(err){console.error(err.message);process.exitCode=1;}}
module.exports={parse};
