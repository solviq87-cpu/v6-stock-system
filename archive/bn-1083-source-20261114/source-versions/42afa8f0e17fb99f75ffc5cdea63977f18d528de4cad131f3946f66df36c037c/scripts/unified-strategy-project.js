'use strict';
const fs=require('node:fs');
const {runUnifiedStrategyProject}=require('../src/core/unified-strategy-project');
const {executePythonNative}=require('../src/core/python-native-bridge');
if(require.main===module){
 try{
  const path=process.argv[2];if(!path)throw Error('用法: node scripts/unified-strategy-project.js history.json [snapshots.json] [python-evidence.json]');
  const history=JSON.parse(fs.readFileSync(path,'utf8'));
  const snapshots=process.argv[3]?JSON.parse(fs.readFileSync(process.argv[3],'utf8')):{};
  const nativeFlag=process.argv.indexOf('--python-native-script');
  if(nativeFlag!==-1&&(!process.argv[nativeFlag+1]||process.argv[4]&&process.argv[4]!=='--python-native-script'))throw Error('Python原生脚本与外部证据文件不能混用');
  const pythonEvidence=nativeFlag!==-1?executePythonNative(history,{script:process.argv[nativeFlag+1]}).evidence:(process.argv[4]?JSON.parse(fs.readFileSync(process.argv[4],'utf8')):{});
  process.stdout.write(JSON.stringify(runUnifiedStrategyProject(history,{snapshots,pythonEvidence,splitDay:history.splitDay}),null,2)+'\n');
 }catch(err){console.error(err.stack||err.message);process.exitCode=1;}
}
