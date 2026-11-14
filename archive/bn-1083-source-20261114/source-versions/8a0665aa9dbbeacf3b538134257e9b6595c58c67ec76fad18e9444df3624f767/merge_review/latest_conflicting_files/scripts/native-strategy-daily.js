'use strict';
const fs=require('node:fs');
const {runNativeDaily}=require('../src/core/native-strategy-daily-runner');
if(require.main===module){
 try{
  const file=process.argv[2];if(!file)throw Error('用法: node scripts/native-strategy-daily.js history.json [snapshots.json]');
  const history=JSON.parse(fs.readFileSync(file,'utf8'));
  const snapshots=process.argv[3]?JSON.parse(fs.readFileSync(process.argv[3],'utf8')):{};
  const result=runNativeDaily(history,{snapshots,splitDay:history.splitDay,generatedAt:new Date().toISOString()});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
 }catch(err){console.error(err.message);process.exitCode=1;}
}
