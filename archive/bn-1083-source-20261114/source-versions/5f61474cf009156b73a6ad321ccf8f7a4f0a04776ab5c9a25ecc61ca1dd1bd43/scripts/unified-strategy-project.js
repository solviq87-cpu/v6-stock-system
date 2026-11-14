'use strict';
const fs=require('node:fs');
const {runUnifiedStrategyProject}=require('../src/core/unified-strategy-project');
if(require.main===module){
 try{
  const path=process.argv[2];if(!path)throw Error('用法: node scripts/unified-strategy-project.js history.json [snapshots.json]');
  const history=JSON.parse(fs.readFileSync(path,'utf8'));
  const snapshots=process.argv[3]?JSON.parse(fs.readFileSync(process.argv[3],'utf8')):{};
  process.stdout.write(JSON.stringify(runUnifiedStrategyProject(history,{snapshots,splitDay:history.splitDay}),null,2)+'\n');
 }catch(err){console.error(err.stack||err.message);process.exitCode=1;}
}
