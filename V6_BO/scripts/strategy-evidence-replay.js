'use strict';
/** node scripts/strategy-evidence-replay.js history.json evidence.json report.json */
const fs=require('node:fs'),path=require('node:path');
const {replayStrategyEvidence}=require('../src/core/strategy-evidence-replay');
function main(args=process.argv.slice(2)){
 if(args.length!==3)throw Error('用法: node scripts/strategy-evidence-replay.js <历史.json> <原生信号.json> <报告.json>');
 const [history,evidence,output]=args.map(x=>path.resolve(x));
 if(new Set([history,evidence,output]).size!==3)throw Error('输入与输出路径不能相同');
 for(const p of [history,evidence])if(fs.statSync(p).size>30*1024*1024)throw Error('输入文件超过30MB');
 const report=replayStrategyEvidence(JSON.parse(fs.readFileSync(history)),JSON.parse(fs.readFileSync(evidence)));
 const tmp=output+'.tmp-'+process.pid;
 try{fs.writeFileSync(tmp,JSON.stringify(report,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,output);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
 console.log(JSON.stringify({mode:report.mode,splitDate:report.splitDate,output}));return report;
}
if(require.main===module)try{main();}catch(e){console.error(e.message);process.exitCode=1;}
module.exports={main};
