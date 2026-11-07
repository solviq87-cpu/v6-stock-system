'use strict';
/** Offline only: node scripts/validate-history.js dataset.json report.json */
const fs=require('node:fs');const path=require('node:path');
const {runValidatedBacktest}=require('../src/core/historical-validation');
function main(argv=process.argv.slice(2)){
 if(argv.length!==2)throw Error('用法: node scripts/validate-history.js <历史数据.json> <报告.json>');
 const input=path.resolve(argv[0]),output=path.resolve(argv[1]);
 if(input===output)throw Error('输入和报告路径不能相同');
 if(fs.statSync(input).size>30*1024*1024)throw Error('历史文件超过30MB');
 const data=JSON.parse(fs.readFileSync(input,'utf8'));
 const report={schemaVersion:1,generatedAt:new Date().toISOString(),...runValidatedBacktest(data)};
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'w',mode:0o600});
 process.stdout.write(JSON.stringify({status:report.status,metrics:report.metrics,holdout:report.holdout,dataset:report.dataset})+'\n');
 return report;
}
if(require.main===module){try{main();}catch(e){console.error('历史回测失败:',e.message);process.exitCode=1;}}
module.exports={main};
