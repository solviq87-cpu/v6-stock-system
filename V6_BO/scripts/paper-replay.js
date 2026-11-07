'use strict';
const fs=require('node:fs');const path=require('node:path');
const {replayPaperAccount}=require('../src/core/paper-replay');
function main(args=process.argv.slice(2)){
 if(args.length!==2)throw Error('用法: node scripts/paper-replay.js <历史数据.json> <模拟盘报告.json>');
 const input=path.resolve(args[0]),output=path.resolve(args[1]);
 if(input===output)throw Error('输入和输出不能相同');
 if(fs.statSync(input).size>30*1024*1024)throw Error('历史文件超过30MB');
 const report=replayPaperAccount(JSON.parse(fs.readFileSync(input,'utf8')));
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 process.stdout.write(JSON.stringify({mode:report.mode,metrics:report.metrics,output})+'\n');return report;
}
if(require.main===module){try{main();}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={main};
