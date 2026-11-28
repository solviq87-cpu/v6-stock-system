'use strict';
// Read-only projection of the verified local journal. Exact text is not
// proof of independent reporting, a causal event or net capital flow.
const chain=e=>JSON.stringify([e.evidence.source,e.evidence.eventId]);
const group=e=>{
 const x=e.evidence;
 return x.url&&x.body&&x.body.trim()&&/^[a-f0-9]{64}$/.test(x.bodyHash)&&['declared-body','provider-summary'].includes(x.bodyScope)
  ?JSON.stringify([x.bodyScope,x.bodyHash]):null;
};
function projectNewsAttention(events,{asOf,symbol=null}={}){
 if(!Number.isSafeInteger(asOf)||asOf<=0||symbol!==null&&!/^\d{6}$/.test(symbol)||!Array.isArray(events)||events.length>10000)throw Error('INVALID_ATTENTION_SCOPE');
 const visible=events.filter(e=>e.recordedAt<=asOf),latest=new Map(),first=new Map(),withdrawn=new Set();
 const associated=e=>symbol===null||e.evidence.securities.includes(symbol);
 for(const e of visible){
  latest.set(chain(e),e);
  const k=group(e);
  if(k&&associated(e)&&e.evidence.kind!=='retracted'){
   const p=first.get(k);
   first.set(k,p===undefined?e.recordedAt:Math.min(p,e.recordedAt));
  }
 }
 // A withdrawn copy must not establish independence of any surviving copy.
 for(const e of visible){
  const k=group(e);
  if(k&&associated(e)&&latest.get(chain(e)).evidence.kind==='retracted')withdrawn.add(k);
 }
 const active=[...latest.values()].filter(e=>associated(e)&&e.evidence.kind!=='retracted'),groups=new Map();
 let ungrouped=0;
 for(const e of active){
  const k=group(e);if(!k){ungrouped++;continue;}
  const x=e.evidence,g=groups.get(k)||{bodyHash:x.bodyHash,bodyScope:x.bodyScope,firstArchivedAt:first.get(k),activeRecords:0,sources:new Set(),urls:new Set(),refs:[],withdrawalConflict:withdrawn.has(k)};
  g.activeRecords++;g.sources.add(x.source);g.urls.add(x.url);if(g.refs.length<10)g.refs.push(e.eventHash);groups.set(k,g);
 }
 const all=[...groups.values()].sort((a,b)=>b.activeRecords-a.activeRecords||a.firstArchivedAt-b.firstArchivedAt||a.bodyHash.localeCompare(b.bodyHash)||a.bodyScope.localeCompare(b.bodyScope));
 return {schemaVersion:1,mode:'news-attention-local-journal',asOf,symbol,status:active.length?'observed-local-archive':'no-active-archive-records',
  activeRecords:active.length,exactTextGroups:all.length,exactTextDuplicateRecords:all.reduce((n,g)=>n+g.activeRecords-1,0),ungroupedRecords:ungrouped,
  sourceCount:new Set(active.map(e=>e.evidence.source)).size,independentlyConfirmedFacts:null,confirmedReposts:null,attentionCrowding:null,capitalFlow:null,
  rows:all.slice(0,20).map(({sources,urls,...g})=>({...g,sourceCount:sources.size,urlCount:urls.size,independentConfirmationAt:null})),
  rowLimit:20,omittedGroups:Math.max(0,all.length-20),privateSocialCollection:false,researchOnly:true,canTrade:false,canTrain:false,canNotify:false,
  limitations:['仅统计本地可见新闻档案，不代表全市场关注度','同文重复不证明转载关系、独立确认或新事实；摘要与正文分组','首次入档时间不是原始发布时间','缺少授权舆情、独立确认及同期成交集中度，保持未知']};
}
module.exports={projectNewsAttention};
