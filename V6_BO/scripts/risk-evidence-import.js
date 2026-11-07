#!/usr/bin/env node
'use strict';
// Local operator workflow, never a market-data scraper or an order writer.
const fs=require('node:fs'),crypto=require('node:crypto');
const {createPaperApplicationService}=require('../src/core/paper-application-service');
const MAX_BYTES=2*1024*1024;
function loadBundle(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{
  const st=fs.fstatSync(fd);if(!st.isFile()||st.size>MAX_BYTES)throw Error('证据文件须为2MiB以内的普通文件');
  const buffer=Buffer.alloc(MAX_BYTES+1);let count=0,n;
  while(count<buffer.length&&(n=fs.readSync(fd,buffer,count,buffer.length-count,null))>0)count+=n;
  if(count>MAX_BYTES)throw Error('证据文件超过2MiB');
  const bytes=buffer.subarray(0,count),evidenceList=JSON.parse(bytes.toString('utf8'));
  if(!Array.isArray(evidenceList)||!evidenceList.length||evidenceList.length>100)throw Error('证据文件必须为1至100条JSON数组');
  return {evidenceList,inputSHA256:crypto.createHash('sha256').update(bytes).digest('hex')};
 }finally{fs.closeSync(fd);}
}
function parseArgs(args){
 const [accountFile,evidenceFile,...rest]=args;if(!accountFile||!evidenceFile||accountFile.startsWith('--')||evidenceFile.startsWith('--'))throw Error('用法: node scripts/risk-evidence-import.js <账户文件> <证据数组JSON> --expected-revision N [--apply --expected-sha256 SHA256]');
 const options={accountFile,evidenceFile,apply:false};const seen=new Set();
 for(let i=0;i<rest.length;i++){
  const key=rest[i];if(seen.has(key))throw Error('选项重复');seen.add(key);
  if(key==='--apply'){options.apply=true;continue;}
  if(!['--expected-revision','--expected-sha256'].includes(key)||!rest[i+1]||rest[i+1].startsWith('--'))throw Error('未知选项或缺少选项值');
  const value=rest[++i];if(key==='--expected-revision'){
   if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('账户预期修订无效');options.expectedRevision=Number(value);
  }else{if(!/^[a-f0-9]{64}$/.test(value))throw Error('文件SHA256无效');options.expectedSHA256=value;}
 }
 if(options.expectedRevision===undefined)throw Error('必须明确提供--expected-revision');
 if(options.apply&&!options.expectedSHA256)throw Error('正式导入必须提供预检返回的--expected-sha256');
 return options;
}
function execute(options){
 const {evidenceList,inputSHA256}=loadBundle(options.evidenceFile);
 if(options.expectedSHA256&&options.expectedSHA256!==inputSHA256)throw Error('证据文件SHA256与预检不符，请重新预检');
 const service=createPaperApplicationService({file:options.accountFile});
 const preview=service.previewRiskEvidenceImport(evidenceList,options.expectedRevision);
 if(!options.apply)return {...preview,inputSHA256};
 const result=service.importRiskEvidenceBatch(evidenceList,options.expectedRevision);
 return {applied:true,accountRevision:result.revision,previousRevision:preview.accountRevision,imported:preview.imported,unchanged:preview.unchanged,total:result.riskEvidence.length,inputSHA256,evidenceRefs:preview.evidenceRefs,paperOnly:true,verifiedLive:false};
}
if(require.main===module){try{console.log(JSON.stringify({ok:true,result:execute(parseArgs(process.argv.slice(2)))}));}catch(e){console.error(JSON.stringify({ok:false,error:String(e.message).slice(0,240)}));process.exitCode=1;}}
module.exports={parseArgs,loadBundle,execute};
