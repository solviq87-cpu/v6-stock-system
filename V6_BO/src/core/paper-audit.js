'use strict';
/** Independent read-only account audit. Hashes alone are not authentication: replay every trade. */
const fs=require('node:fs');
const {loadSession,assertAppend}=require('./paper-session');
const {replayPaperAccount}=require('./paper-replay');
const {validateDataset}=require('./historical-validation');
const crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function auditSnapshot(s){
 const failures=[];
 if(!Number.isSafeInteger(s.revision)||s.revision<1)failures.push('账户版本号无效');
 try{
  const dataset=validateDataset(s.history);
  if(dataset.lastDate!==s.lastDate)failures.push('最后交易日与历史行情不一致');
  const replay=replayPaperAccount(s.history,s.config);
  if(hash(replay)!==hash(s.report))failures.push('报告与独立重新撮合结果不一致');
 }catch(e){failures.push('独立回放失败: '+e.message);}
 return failures;
}
function auditPaperAccount(filename,{checkBackup=true}={}){
 const failures=[],warnings=[];
 let current;
 try{current=loadSession(filename);}catch(e){return {ok:false,failures:['账户文件校验失败: '+e.message],warnings,canTrade:false};}
 failures.push(...auditSnapshot(current));
 if(checkBackup){
  const backup=filename+'.bak';
  if(fs.existsSync(backup)){
   try{
    const prev=loadSession(backup);
    failures.push(...auditSnapshot(prev).map(x=>'备份: '+x));
    if(current.revision!==prev.revision+1)failures.push('当前版本与备份版本不连续');
    if(hash(current.config)!==hash(prev.config))failures.push('备份与当前交易参数不一致');
    try{assertAppend(prev.history,current.history);}catch(e){failures.push('备份与当前历史不连续: '+e.message);}
   }catch(e){failures.push('备份文件校验失败: '+e.message);}
  }else if(current.revision>1)warnings.push('缺少上一版本备份，无法核对版本连续性');
 }
 return {ok:failures.length===0,revision:current.revision,lastDate:current.lastDate,failures,warnings,canTrade:false,verifiedLive:false};
}
module.exports={auditPaperAccount,auditSnapshot};
