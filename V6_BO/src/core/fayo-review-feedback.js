'use strict';
// Explicit private review receipts. Never infer a preference from passive views.
const S=require('./research-workspace-store');
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const code=v=>typeof v==='string'&&/^\d{6}$/.test(v);
const time=(v,max)=>Number.isSafeInteger(v)&&v>0&&v<=max;
const subtype='explicit-review-feedback-v1',kinds=['reviewed','ignored'];
const flags={researchOnly:true,canTrade:false,canNotify:false,accountMutated:false,productionWeightsChanged:false,canTrain:false};
function runFor(events,symbol,runId,asOf){
 if(!code(symbol)||!hash(runId)||!time(asOf,Date.now()))throw Error('研究反馈身份或时点无效');
 const e=events.find(e=>e.kind==='analysis'&&e.hash===runId&&e.data?.symbol===symbol&&time(e.recordedAt,asOf)&&time(e.data.asOf,e.recordedAt));
 if(!e)throw Error('原研究版本不在所选范围');return e;
}
function projectFeedback(events,{symbol,runId,asOf=Date.now()}){
 const original=runFor(events,symbol,runId,asOf),byKind=new Map();
 for(const e of events){
  const d=e.data;if(e.kind!=='diagnostic'||d?.subtype!==subtype||d.runId!==runId||!time(e.recordedAt,asOf))continue;
  if(d.symbol!==symbol||!kinds.includes(d.feedback)||e.recordedAt<original.recordedAt||d.originalRecordedAt!==original.recordedAt||
    d.originalAsOf!==original.data.asOf||d.source!=='explicit-editor-action'||d.performanceLabel!==null||!hash(e.hash))throw Error('原反馈档案校验失败');
  if(!byKind.has(d.feedback))byKind.set(d.feedback,{feedback:d.feedback,recordedAt:e.recordedAt,id:e.hash,sequence:e.sequence});
 }
 const receipts=[...byKind.values()].sort((a,b)=>a.recordedAt-b.recordedAt||a.sequence-b.sequence);
 return {mode:subtype,symbol,runId,asOf,originalRecordedAt:original.recordedAt,receipts,latest:receipts.at(-1)??null,performanceLabel:null,actualNetReturn:null,
  unobservedFeedback:'unknown',scope:'authorized-private-workspace-not-per-device-profile',note:'只登记明确阅读/忽略，各动作仅登记一次；未点击不等于忽略，收益由原结算链独立提供。',...flags};
}
function readFeedback(root,query){const asOf=query.asOf??Date.now();return projectFeedback(S.readEvents(root,{asOf}),{...query,asOf});}
function saveFeedback(root,input,{authorize=()=>false}={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['action','symbol','runId','feedback'].includes(k))||
    input.action!=='save-feedback'||!kinds.includes(input.feedback)||!code(input.symbol)||!hash(input.runId))throw Error('仅允许明确的原研究阅读或忽略选择');
 const deny=()=>{throw Object.assign(Error('原编辑授权已变化'),{httpStatus:403,code:'WORKSPACE_AUTHORIZATION'});};
 if(authorize()!==true)deny();
 const now=Date.now(),events=S.readEvents(root,{asOf:now}),original=runFor(events,input.symbol,input.runId,now);
 const d={subtype,symbol:input.symbol,runId:input.runId,feedback:input.feedback,originalRecordedAt:original.recordedAt,originalAsOf:original.data.asOf,source:'explicit-editor-action',performanceLabel:null};
 const requestId='review_'+S.digest([input.runId,input.feedback]);
 const saved=S.appendEvent(root,'diagnostic',d,{requestId,now,beforeCommit:authorize,beforeCommitLocked:({events})=>runFor(events,input.symbol,input.runId,now).hash===original.hash});
 if(authorize()!==true)deny();
 return {mode:subtype,symbol:input.symbol,runId:input.runId,feedback:input.feedback,recordId:saved.hash,recordedAt:saved.recordedAt,reused:saved.reused,performanceLabel:null,actualNetReturn:null,...flags};
}
module.exports={projectFeedback,readFeedback,saveFeedback};
