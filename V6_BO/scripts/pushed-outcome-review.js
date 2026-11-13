'use strict';
const fs=require('node:fs'),path=require('node:path');
const {dateKey,reviewPushedOutcomes,summarizeOutcomes}=require('../src/core/pushed-outcome-review');
function readJson(file,optional=false){
 try{const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>32*1024*1024)throw Error('复盘输入文件不安全或过大');return JSON.parse(fs.readFileSync(file,'utf8'));}
 catch(e){if(optional&&e.code==='ENOENT')return null;throw e;}
}
function main(args=process.argv.slice(2)){
 if(args.length>1)throw Error('用法：node _learn_pushed_outcomes.js [YYYYMMDD]');
 const now=Date.now(),date=args[0]||new Date(now+28800000).toISOString().slice(0,10).replace(/-/g,'');if(!dateKey(date))throw Error('复盘日期无效');
 const root=path.resolve(process.env.V6_PUSH_OUTCOME_ROOT||path.join(__dirname,'..'));
 if(!fs.lstatSync(root).isDirectory()||fs.lstatSync(root).isSymbolicLink())throw Error('复盘目录无效');
 const output=path.join(root,'learn_pushed_outcomes_review.json'),lock=output+'.lock',lockFd=fs.openSync(lock,'wx',0o600);let tmp;
 try{
  const pushlog=readJson(path.join(root,'pushlog.json')),histories=new Map(),cache=path.join(root,'.kline_cache');
  if(fs.lstatSync(cache).isSymbolicLink()||!fs.lstatSync(cache).isDirectory())throw Error('K线目录无效');
  for(const file of fs.readdirSync(cache))if(/^\d{6}\.json$/.test(file)){const data=readJson(path.join(cache,file));histories.set(file.slice(0,6),data);}
  const report=reviewPushedOutcomes({date,pushlog,histories,now}),prior=readJson(output,true);
  if(prior&&(prior.schemaVersion!==2||prior.mode!==report.mode||!Array.isArray(prior.samples)))throw Error('既有复盘文件格式不兼容，保留原文件');
  const merged=new Map((prior?.samples||[]).map(s=>[s.id,s]));if(merged.size!==(prior?.samples||[]).length)throw Error('既有复盘存在重复记录');
  for(const sample of report.samples){const old=merged.get(sample.id);
   // A later cache retrieval alone is not a revision of the observed close.
   const comparable=x=>JSON.stringify({...x,outcomeReceivedAt:null});
   if(old&&comparable(old)!==comparable(sample))throw Error('已封存同日结果发生变化，拒绝覆盖');if(!old)merged.set(sample.id,sample);}
  const samples=[...merged.values()].sort((a,b)=>a.id.localeCompare(b.id)),result={...report,samples,summary:summarizeOutcomes(samples),updatedAt:now};
  tmp=output+'.'+process.pid+'.tmp';const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(result,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(tmp,output);tmp=null;console.log(JSON.stringify({date:report.date,newDaySamples:report.samples.length,totalSamples:samples.length,skipped:report.skipped,mode:report.mode,trainEligible:false,output:path.basename(output)}));return result;
 }finally{if(tmp)try{fs.unlinkSync(tmp);}catch{}fs.closeSync(lockFd);fs.unlinkSync(lock);}
}
if(require.main===module){try{main();}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={main};
