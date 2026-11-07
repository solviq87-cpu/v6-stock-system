'use strict';
const {auditPaperAccount}=require('../src/core/paper-audit');
const file=process.argv[2];
if(!file){console.error('用法: node scripts/paper-audit.js <账户JSON>');process.exitCode=2;}
else{try{const result=auditPaperAccount(file);console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;}catch(e){console.error('审计失败:',e.message);process.exitCode=1;}}
