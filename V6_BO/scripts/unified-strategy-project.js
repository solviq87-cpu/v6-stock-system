'use strict';
const fs=require('node:fs');
const {runUnifiedStrategyProject}=require('../src/core/unified-strategy-project');
const {executePythonNative}=require('../src/core/python-native-bridge');
function parseArgs(argv){
 const positional=[];let script=null;
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];
  if(arg==='--python-native-script'){
   if(script!==null||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Python原生脚本参数无效');
   script=argv[++i];
  }else if(arg.startsWith('--'))throw Error('未知参数: '+arg);
  else positional.push(arg);
 }
 if(positional.length<1||positional.length>3)throw Error('用法: node scripts/unified-strategy-project.js history.json [snapshots.json] [python-evidence.json] [--python-native-script /absolute/trusted.py]');
 if(script&&positional.length===3)throw Error('Python原生脚本与外部证据文件不能混用');
 return {historyPath:positional[0],snapshotsPath:positional[1],evidencePath:positional[2],script};
}
if(require.main===module){
 try{
  const args=parseArgs(process.argv.slice(2));
  const history=JSON.parse(fs.readFileSync(args.historyPath,'utf8'));
  const snapshots=args.snapshotsPath?JSON.parse(fs.readFileSync(args.snapshotsPath,'utf8')):{};
  const executed=args.script?executePythonNative(history,{script:args.script}):null;
  const pythonEvidence=executed?executed.evidence:(args.evidencePath?JSON.parse(fs.readFileSync(args.evidencePath,'utf8')):{});
  process.stdout.write(JSON.stringify(runUnifiedStrategyProject(history,{snapshots,pythonEvidence,pythonExecution:executed?.execution,splitDay:history.splitDay}),null,2)+'\n');
 }catch(err){console.error(err.stack||err.message);process.exitCode=1;}
}
module.exports={parseArgs};
