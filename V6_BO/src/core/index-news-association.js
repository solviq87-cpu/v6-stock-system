'use strict';
// Bounded, point-in-time association of cached news with an index window.
// The caller supplies the existing local journal gate, not a network fetch.
const HASH=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9:._-]{1,120}$/;
const CODE=/^\d{6}$/;
const SOURCE='eastmoney-fast-news';
const time=t=>Number.isSafeInteger(t)&&t>=946684800000&&t<4102444800000;
const identity=v=>typeof v==='string'?v:Number.isSafeInteger(v)?String(v):'';
const label=v=>typeof v==='string'&&v.trim()===v&&v.length>=2&&v.length<=80&&!/[\u0000-\u001f<>]/.test(v);
// Headline matches are review clues only; archive text and references remain
// separate from verified causes, independent publishers, or exposure estimates.
const {createHash}=require('node:crypto');
const topicRules=[['monetary-fiscal',/央行|中国人民银行|降准|财政政策|货币政策|财政部/],
 ['industrial-policy',/产业政策|产业规划|产业扶持|技术标准|行业政策/],
 ['issuer-earnings',/业绩|财报|净利润|年度报告|季度报告/],
 ['overseas',/美联储|美国|欧央行|欧洲央行|海外|境外|地缘/],
 ['market-mechanics',/指数调样|指数调仓|申购|赎回|回购|减持/]];
const contraryRules=[['clarification',/澄清|更正|辟谣/],['negation',/否认|未签订|未中标|未获批|未发生|未实施|不涉及|不存在/],['withdrawal-mention',/撤回|撤销|终止|取消/]];
const textScope=e=>typeof e.title==='string'&&e.title.trim()&&e.title.length<=1000&&typeof e.body==='string'&&e.body.trim()&&e.body.length<=50000&&['declared-body','provider-summary'].includes(e.bodyScope)?e.bodyScope:'unknown';
function collectHypothesis(groups,e,hash){
 const scope=textScope(e),textHash=scope==='unknown'?null:createHash('sha256').update(JSON.stringify([scope,e.title,e.body])).digest('hex');
 const key=textHash?'text:'+textHash:'ref:'+hash;let group=groups.get(key);
 if(!group){
  const title=scope==='unknown'?'':e.title;
  group={textHash,textScope:scope,evidenceHashes:[],topicHints:topicRules.filter(([,rule])=>rule.test(title)).map(([name])=>name),
   counterTextHints:contraryRules.filter(([,rule])=>rule.test(title)).map(([name])=>name)};
  groups.set(key,group);
 }
 group.evidenceHashes.push(hash);
}
function hypothesisContext(groups,status){
 const textGroups=[...groups.values()],distinctTextGroups=textGroups.filter(g=>g.textHash!==null).length;
 return {mode:'same-window-archived-text-clues-v1',status:status==='unavailable'?'unavailable':distinctTextGroups>1?'multiple-text-clues':distinctTextGroups?'single-text-clue':'no-qualified-text-clues',
  referenceCount:textGroups.reduce((n,g)=>n+g.evidenceHashes.length,0),distinctTextGroups,unknownReferenceGroups:textGroups.length-distinctTextGroups,textGroups,
  counterTextGroupCount:textGroups.filter(g=>g.counterTextHints.length>0).length,confirmedCounterEvidenceCount:null,
  cause:'unknown',exposureStatus:'unknown',independentSourcesVerified:false,marketOnlyAlternativeRetained:true};
}
function investigateCurrentNews(event,news,{resolveCurrent,allowedHashes}={}){
 const result=(status,reason,extra={})=>({status,reason,inspected:0,evidenceHashes:[],relatedSecurities:[],explicitSectors:[],
  currentLocalEvidence:false,attribution:'unknown',canTrade:false,canNotify:false,hypothesisContext:hypothesisContext(new Map(),status),...extra});
 if(!event||![event.baseAt,event.quoteAt,event.detectedAt].every(time)||event.baseAt>=event.quoteAt||event.quoteAt>event.detectedAt||
    !news||news.evidenceIntake?.status==='unknown'||typeof resolveCurrent!=='function')return result('unavailable','invalid-window-or-evidence');
 const allowed=allowedHashes===undefined?null:new Set(Array.isArray(allowedHashes)?allowedHashes.filter(x=>typeof x==='string'&&HASH.test(x)).slice(0,150):[]);
 const refs=new Set(),codes=new Set(),sectors=new Set(),groups=new Map();let inspected=0,truncated=false;
 try{
  for(const key of ['goodAll','badAll','neutralAll']){
   const rows=news[key];if(!Array.isArray(rows))continue;
   if(rows.length>50)truncated=true;
   for(const row of rows.slice(0,50)){
    inspected++;
    const p=row?.newsEvidence,id=identity(row?.id);
    if(!ID.test(id)||row.source!==SOURCE||row.type!==key.slice(0,-3)||typeof p?.eventHash!=='string'||!HASH.test(p.eventHash)||
       typeof p.sourceRevisionId!=='string'||!ID.test(p.sourceRevisionId)||!Number.isSafeInteger(p.sequence)||p.sequence<1||
       allowed&&!allowed.has(p.eventHash)||refs.has(p.eventHash)||![row.publishedAt,row.receivedAt,p.recordedAt].every(time)||
       row.publishedAt<event.baseAt||row.publishedAt>event.quoteAt||row.publishedAt>row.receivedAt||row.receivedAt>event.detectedAt||
       p.recordedAt<row.publishedAt||p.recordedAt>event.detectedAt)continue;
    const current=resolveCurrent(row),entry=current?.entry,e=entry?.evidence;
    if(!e||e.source!==SOURCE||e.eventId!==id||e.sourceRevisionId!==p.sourceRevisionId||entry.eventHash!==p.eventHash||
       entry.sequence!==p.sequence||entry.recordedAt!==p.recordedAt||!['original','revised'].includes(e.kind)||e.publishedAt!==row.publishedAt||
       !time(e.receivedAt)||e.receivedAt<e.publishedAt||e.receivedAt>entry.recordedAt||e.receivedAt>event.detectedAt||
       (e.kind==='original'?e.revisedAt!==null:!time(e.revisedAt)||e.revisedAt<e.publishedAt||e.revisedAt>event.quoteAt||e.revisedAt>e.receivedAt)||
       !Array.isArray(e.securities)||e.securities.length>100||e.securities.some(x=>typeof x!=='string'||!CODE.test(x))||
       !Array.isArray(row.codes)||row.codes.length>100||JSON.stringify([...new Set(row.codes)].sort())!==JSON.stringify(e.securities))continue;
    refs.add(p.eventHash);
    collectHypothesis(groups,e,p.eventHash);
    for(const code of e.securities)if(codes.size<100)codes.add(code);
    for(const sector of Array.isArray(current.explicitSectors)?current.explicitSectors.slice(0,2):[])if(label(sector)&&sectors.size<30)sectors.add(sector);
   }
  }
 }catch{return result('unavailable','local-journal-check-failed',{inspected,truncated});}
 return result(inspected?'cached-window-checked':'unavailable',refs.size?'current-local-cooccurrence':'no-qualified-cached-match',{
  inspected,truncated,hypothesisContext:hypothesisContext(groups,inspected?'cached-window-checked':'unavailable'),evidenceHashes:[...refs],relatedSecurities:[...codes].sort(),explicitSectors:[...sectors].sort(),currentLocalEvidence:refs.size>0});
}
// Reuse the server's existing reference-specific archive verification. Sector
// names are text-only associations, not frozen membership or a causal claim.
function createIndexNewsInvestigator({readNews,allowsItem,currentState,readSectors,explicitSectorMatch}){
 return (event,allowedHashes)=>investigateCurrentNews(event,readNews(),{allowedHashes,resolveCurrent:row=>{
  const id=identity(row.id),allowed=allowsItem(row),state=currentState(id);
  if(!state||state.unknown||!(state.latest instanceof Map))throw Error('INDEX_NEWS_ARCHIVE_UNAVAILABLE');
  const entry=state.latest.get(id);
  if(!allowed||!entry||entry.eventHash!==row.newsEvidence.eventHash)return null;
  const body=entry.evidence.title+'\n'+entry.evidence.body;
  const marketSectors=readSectors();
  const explicitSectors=(Array.isArray(row.sectors)?row.sectors.slice(0,2):[]).filter(name=>label(name)&&
   Array.isArray(marketSectors)&&marketSectors.some(s=>s?.name===name)&&explicitSectorMatch(body,name));
  return {entry,explicitSectors};
 }});
}
module.exports={investigateCurrentNews,createIndexNewsInvestigator};
