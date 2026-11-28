#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
function verifyTap(text){
 const lines=text.split(/\r?\n/),headers=lines.filter(l=>l.startsWith('# Subtest:')).length,results=lines.filter(l=>/^(?:ok|not ok) \d+\b/.test(l)),plans=lines.filter(l=>/^1\.\.\d+\s*$/.test(l));
 if(plans.length!==1)throw Error('全量TAP缺少唯一结束计划');const count=Number(plans[0].slice(3));
 if(!Number.isSafeInteger(count)||count<=0)throw Error('全量TAP结束计划必须包含至少一个有效用例');
 const planIndex=lines.indexOf(plans[0]);
 if(lines.slice(planIndex+1).some(l=>l.startsWith('# Subtest:')||/^(?:ok|not ok) \d+\b/.test(l)))throw Error('全量TAP结束计划之后仍有用例');
 if(lines.some(l=>/^Bail out!/i.test(l)))throw Error('TAP中止，拒绝认定全量通过');
 for(const [key,label] of [['fail','失败'],['cancelled','取消']]){
  const summaries=lines.slice(planIndex+1).filter(l=>new RegExp('^# '+key+' \\d+\\s*$').test(l));
  if(summaries.length>1)throw Error('TAP结束摘要重复：'+key);
  if(summaries.length&&Number(summaries[0].slice(key.length+3))!==0)throw Error('TAP结束摘要包含'+label+'用例');
 }
 if(headers!==results.length||results.length!==count)throw Error('全量TAP用例未完整报告，拒绝认定全量通过');
 // Node's wrappers for plain script files use their file index, not the global case number.
 if(results.some((l,i)=>Number(l.match(/^(?:ok|not ok) (\d+)/)[1])!==i+1&&!/- (?:.*[\/])?tests[\/].+\.test\.[cm]?js(?: \#.*)?$/.test(l)))throw Error('TAP用例序号不连续');
 if(results.some(l=>l.startsWith('not ok')))throw Error('TAP包含失败用例');
 return {topLevelTests:count,complete:true};
}
if(require.main===module){try{verifyTap(fs.readFileSync(process.argv[2],'utf8'));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={verifyTap};
