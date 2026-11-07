'use strict';
const fs=require('node:fs');
const {executePythonNative}=require('../src/core/python-native-bridge');
if(require.main===module){
 try{
  if(!process.argv[2]||!process.argv[3])throw Error('用法: node scripts/python-native-evidence.js history.json /absolute/path/trusted-native-strategy.py [python3]');
  const history=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  process.stdout.write(JSON.stringify(executePythonNative(history,{script:process.argv[3],python:process.argv[4]||'python3'}),null,2)+'\n');
 }catch(err){console.error(err.message);process.exitCode=1;}
}
