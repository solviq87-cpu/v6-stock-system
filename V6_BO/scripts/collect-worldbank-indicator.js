#!/usr/bin/env node
'use strict';
/** One explicit operator-initiated official macro query, no recurring polling. */
const fs=require('node:fs'),path=require('node:path');
const {collectWorldBankIndicator}=require('../src/core/worldbank-indicators');
async function main(args){
 if(args.length!==5)throw Error('用法: node scripts/collect-worldbank-indicator.js <CHN> <indicator> <startYear> <endYear> <new-file.json>');
 const [country,indicator,from,to,dest]=args;
 if(!/^\d{4}$/.test(from)||!/^\d{4}$/.test(to))
  throw Error('年份必须为四位整数');
 const file=path.resolve(dest);
 if(!fs.existsSync(path.dirname(file)))throw Error('输出目录不存在');
 if(fs.existsSync(file))throw Error('拒绝覆盖已存的宏观证据');
 const report=await collectWorldBankIndicator({country,indicator,startYear:Number(from),endYear:Number(to)});
 const fd=fs.openSync(file,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(report,null,2)+'\n');fs.fsyncSync(fd);}
 finally{fs.closeSync(fd);}
 console.log(JSON.stringify({file,country,indicator,rows:report.rows.length,canTrade:false}));
}
if(require.main===module)main(process.argv.slice(2)).catch(e=>{
 console.error(String(e.message||e));process.exitCode=1;
});
module.exports={main};
