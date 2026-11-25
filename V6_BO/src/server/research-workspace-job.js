'use strict';
// Archive validation and aggregation must not block quote polling on the server.
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
// Desktop/mobile can open the same private archive concurrently. Share only
// identical reads. One private edit can wait behind a hydration read or
// foreground notification poll; its revision is still checked in the worker.
const reads=new Map();
let tail=null,waitingEdit=false,epoch=0;
const busy=()=>Promise.resolve({ok:false,httpStatus:503,error:'研究档案任务正在运行，请稍后重试'});
function runWorkspaceJob(payload){
 const readOnly=!payload.input&&['shortline','manual-loop','intelligence-research','intelligence-history-pending'].includes(payload.action);
 const edit=payload.action==='shortline'&&Boolean(payload.input);
 const key=readOnly?epoch+'/'+JSON.stringify(payload):null;
 if(key&&reads.has(key))return reads.get(key);
 const canQueueEdit=edit&&!waitingEdit&&reads.size>0;
 if(tail&&(readOnly?reads.size>=2:!canQueueEdit))return busy();
 if(edit){waitingEdit=true;epoch++;}
 const task=(tail||Promise.resolve()).then(()=>runWorker(payload)).finally(()=>{
  if(key)reads.delete(key);
  if(edit)waitingEdit=false;
  if(tail===task)tail=null;
 });
 if(key)reads.set(key,task);
 tail=task;
 return task;
}
function runWorker(payload){
 return new Promise(resolve=>{let worker,timer,done=false;
  const finish=async value=>{if(done)return;done=true;clearTimeout(timer);try{await worker?.terminate();}finally{resolve(value);}};
  try{worker=new Worker(__filename,{workerData:{...payload,__v6ResearchWorkspaceJob:true},resourceLimits:{maxOldGenerationSizeMb:384}});
   worker.once('message',finish);worker.once('error',()=>finish({ok:false,httpStatus:503,error:'研究档案任务未完成，原档案保留'}));
   worker.once('exit',()=>finish({ok:false,httpStatus:503,error:'研究档案任务已停止，原档案保留'}));
   timer=setTimeout(()=>finish({ok:false,httpStatus:503,error:'研究档案任务超过55秒，原档案保留'}),55000);
  }catch{void finish({ok:false,httpStatus:503,error:'研究档案任务无法启动'});}
 });
}
if(!isMainThread&&workerData?.__v6ResearchWorkspaceJob===true){const p=workerData,W=require('../core/research-workspace');Promise.resolve().then(async()=>{
 try{
  if(p.action==='shortline'){
    try{return await (await import('../research/shortline/store.mjs')).shortlineJob(p);}
    catch(e){return {ok:false,httpStatus:e.httpStatus||503,error:e.httpStatus?e.message:'私有研究档案正忙或暂不可用，请重新读取'};}
  }
  if(p.action==='intelligence-research'){
    const archive=await (await import('../research/shortline/store.mjs')).shortlineJob({root:p.root,book:'main',replica:p.replica});
    if(!archive.ok)return archive;
    const codes=[...new Set([...(archive.state.checks||[]).slice(-100).reverse().map(row=>row.code),...(archive.state.plans||[]).slice(-20).map(row=>row.code)])];
    const history=require('../core/center-history').readCenterHistory({root:p.historyRoot||require('node:path').join(p.root,'center-history'),now:p.now,
      codes:codes.length?codes:undefined});
    const result=await require('../core/intelligence-research').buildIntelligenceResearch({day:p.day,now:p.now,archive:archive.state,quotes:p.quotes,
      bars:[...(archive.state.bars||[]),...history.bars],marketCalendars:history.marketCalendars,
      frozenObservations:history.frozenObservations,historyCoverage:history.coverage});
    return {ok:true,result};
  }
  if(p.action==='intelligence-history-collect'){
    if(p.replica)return {ok:false,httpStatus:403,error:'副本不能采集或写入中心研究历史'};
    const archive=await (await import('../research/shortline/store.mjs')).shortlineJob({root:p.root,book:'main',replica:false});
    if(!archive.ok)return archive;
    const result=await require('../core/center-history').collectCenterHistory({root:p.historyRoot,code:p.code,day:p.day,
      historyDays:p.historyDays,replica:false,archive:archive.state});
    return {ok:true,result};
  }
  if(p.action==='intelligence-history-pending'){
    const archive=await (await import('../research/shortline/store.mjs')).shortlineJob({root:p.root,book:'main',replica:p.replica});
    if(!archive.ok)return archive;
    return require('../core/center-history').readPendingCenterHistory({root:p.historyRoot,archive:archive.state,
      day:p.day,now:p.now,cursor:p.cursor});
  }
  if(p.action==='shortline-web-notices'){
    const {runBookNotices}=await import('../research/shortline/store.mjs');
    return {ok:true,result:await runBookNotices(p)};
  }
  if(p.action==='shortline-public-market'){
    const {saveRecoveredMarket}=await import('../research/shortline/store.mjs');
    return {ok:true,result:await saveRecoveredMarket(p.root,p.rows,p.day)};
  }
  if(p.action==='shortline-manual-ledger'){
    const {syncManualLedger}=await import('../research/shortline/store.mjs');
    return {ok:true,result:await syncManualLedger(p.shortlineRoot,p.root,p.accountDir)};
  }
  if(p.action==='manual-loop'){
    const M=require('../core/manual-decision-loop');
    try{
      const result=p.input?M.execute(p.root,p.input,p.options):M.view(p.root,p.options);
      if(p.input&&p.shortlineRoot){
        // The source commit is durable even if the derived archive is busy.
        try{await (await import('../research/shortline/store.mjs')).syncManualLedger(p.shortlineRoot,p.root);}
        catch{return {ok:true,result,shortlineSync:'待后台重试'};}
      }
      return {ok:true,result};
    }catch(e){return {ok:false,httpStatus:e.code==='LOOP_CONFLICT'?409:422,error:/^LOOP_/.test(e.code||'')?e.message:'闭环输入或私有档案校验失败，原记录保留'};}
  }
  if(p.action==='view'){const view=W.workspaceView(p.root,p.query,{accounts:p.accounts,quotes:new Map(p.quotes||[]),now:p.now});return {ok:true,result:p.export?W.exportResearch(view):view};}
  if(p.action==='review')return await W.reviewStored(p.input,p.options);
  if(p.action==='forecast')return W.saveModelForecast(p.root,p.input);
  if(p.action==='settings'){const e=W.saveSettings(p.root,p.input);return {ok:true,revision:e.revision,recordId:e.hash,reused:e.reused,researchOnly:true};}
  throw Error('invalid job');
 }catch(e){return {ok:false,httpStatus:p.action==='settings'?409:422,error:p.action==='forecast'&&/^FORECAST_/.test(e.code||'')?e.message:p.action==='settings'?'设置无效或版本冲突，请重新读取后再保存':'研究查询、输入或私有档案校验失败，原档案保留'};}
}).then(value=>parentPort.postMessage(value)).catch(()=>parentPort.postMessage({ok:false,httpStatus:503,error:'研究任务未完成，原档案保留'}));}
module.exports={runWorkspaceJob};
