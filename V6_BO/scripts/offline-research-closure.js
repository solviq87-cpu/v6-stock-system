'use strict';
/** node scripts/offline-research-closure.js history.json output.json */
const fs=require('node:fs');const path=require('node:path');
const {runOfflineResearchClosure}=require('../src/core/offline-research-closure');
function main(args=process.argv.slice(2)){
 if(args.length!==2)throw Error('用法: node scripts/offline-research-closure.js <历史数据.json> <报告.json>');
 const input=path.resolve(args[0]),output=path.resolve(args[1]);
 if(input===output)throw Error('输入与输出不能相同');
 if(fs.statSync(input).size>30*1024*1024)throw Error('历史文件超过30MB');
 const report=runOfflineResearchClosure(JSON.parse(fs.readFileSync(input,'utf8')));
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 process.stdout.write(JSON.stringify({mode:report.mode,source:report.source,stocks:report.ranking.length,backtest:report.backtest.status,output})+'\n');
 return report;
}
if(require.main===module){try{main();}catch(e){console.error('离线研究失败:',e.message);process.exitCode=1;}}
module.exports={main};
