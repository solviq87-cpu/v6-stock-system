'use strict';
const fs=require('node:fs');
const {runNativeDaily}=require('../src/core/native-strategy-daily-runner');
const {executePythonNative}=require('../src/core/python-native-bridge');

/** One-command daily research pipeline. Python is opt-in and must be an operator-trusted script. */
function runResearch(history,{snapshots={},pythonScript,python='python3',splitDay,generatedAt=new Date().toISOString()}={}){
 let pythonEvidence={},pythonExecution={mode:'not-configured',calls:0,verifiedStrategyRules:false};
 if(pythonScript){
  const result=executePythonNative(history,{script:pythonScript,python});
  pythonEvidence=result.evidence;
  pythonExecution=result.execution;
 }
 const report=runNativeDaily(history,{snapshots,pythonEvidence,splitDay,generatedAt});
 return {...report,pythonExecution};
}
if(require.main===module){
 try{
  const file=process.argv[2];
  if(!file)throw Error('用法: node scripts/native-strategy-daily.js history.json [snapshots.json] [trusted-python-script.py] [python3]');
  const history=JSON.parse(fs.readFileSync(file,'utf8'));
  const snapshots=process.argv[3]?JSON.parse(fs.readFileSync(process.argv[3],'utf8')):{};
  const result=runResearch(history,{snapshots,pythonScript:process.argv[4],python:process.argv[5]||'python3',splitDay:history.splitDay});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
 }catch(err){console.error(err.message);process.exitCode=1;}
}
module.exports={runResearch};
