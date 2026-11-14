'use strict';
// Archive validation and aggregation must not block quote polling on the server.
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
let active=false;
function runWorkspaceJob(payload){
 if(active)return Promise.resolve({ok:false,httpStatus:503,error:'研究档案任务正在运行，请稍后重试'});
 active=true;
 return new Promise(resolve=>{let worker,timer,done=false;
  const finish=async value=>{if(done)return;done=true;clearTimeout(timer);try{await worker?.terminate();}finally{active=false;resolve(value);}};
  try{worker=new Worker(__filename,{workerData:{...payload,__v6ResearchWorkspaceJob:true},resourceLimits:{maxOldGenerationSizeMb:384}});
   worker.once('message',finish);worker.once('error',()=>finish({ok:false,httpStatus:503,error:'研究档案任务未完成，原档案保留'}));
   worker.once('exit',()=>finish({ok:false,httpStatus:503,error:'研究档案任务已停止，原档案保留'}));
   timer=setTimeout(()=>finish({ok:false,httpStatus:503,error:'研究档案任务超过55秒，原档案保留'}),55000);
  }catch{void finish({ok:false,httpStatus:503,error:'研究档案任务无法启动'});}
 });
}
if(!isMainThread&&workerData?.__v6ResearchWorkspaceJob===true){const p=workerData,W=require('../core/research-workspace');Promise.resolve().then(async()=>{
 try{
  if(p.action==='view'){const view=W.workspaceView(p.root,p.query,{accounts:p.accounts,quotes:new Map(p.quotes||[]),now:p.now});return {ok:true,result:p.export?W.exportResearch(view):view};}
  if(p.action==='review')return await W.reviewStored(p.input,p.options);
  if(p.action==='settings'){const e=W.saveSettings(p.root,p.input);return {ok:true,revision:e.revision,recordId:e.hash,reused:e.reused,researchOnly:true};}
  throw Error('invalid job');
 }catch{return {ok:false,httpStatus:p.action==='settings'?409:422,error:p.action==='settings'?'设置无效或版本冲突，请重新读取后再保存':'研究查询、输入或私有档案校验失败，原档案保留'};}
}).then(value=>parentPort.postMessage(value)).catch(()=>parentPort.postMessage({ok:false,httpStatus:503,error:'研究任务未完成，原档案保留'}));}
module.exports={runWorkspaceJob};
