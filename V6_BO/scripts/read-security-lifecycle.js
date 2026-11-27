#!/usr/bin/env node
'use strict';
const path=require('node:path');
const {readSecurityLifecycleEvidence}=require('../src/core/security-lifecycle-evidence');
function main(args){
 if(args.length!==3||!path.isAbsolute(args[0])||!/^\d+$/.test(args[2]))throw Error('用法: read-security-lifecycle.js <私有公告归档绝对目录> <A股代码> <决策时点毫秒>');
 const result=readSecurityLifecycleEvidence({root:args[0],symbol:args[1],asOf:Number(args[2])});
 console.log(JSON.stringify(result,null,2));
 if(result.status==='archive-unavailable')process.exitCode=1;
}
if(require.main===module)try{main(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}
module.exports={main};
