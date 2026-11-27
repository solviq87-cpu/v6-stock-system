'use strict';
// Research-only projection of the EXISTING private news evidence journal.
// A disclosure title is not proof of shares, debt, execution or delisting.
const {readJournal,ROOT}=require('./news-evidence-journal');
const DAY=86400000,validTime=t=>Number.isSafeInteger(t)&&t>=946684800000&&t<4102444800000;
const validDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const chinaDay=t=>new Date(t+28800000).toISOString().slice(0,10);
const codeOK=s=>typeof s==='string'&&/^(?:(?:600|601|603|605|688|689|000|001|002|003|300|301)\d{3}|(?:43|83|87|88|92)\d{4})$/.test(s);
const CATEGORIES=['unlock','pledge','delisting'];
const testSource=s=>/(?:^|[-_.:/])(?:fixture|mock|demo|simulated|synthetic|test)(?:$|[-_.:/])/i.test(s);
function documentKey(url,receivedAt){
 if(typeof url!=='string')return null;
 const m=/^https:\/\/static\.cninfo\.com\.cn\/finalpage\/(\d{4}-\d{2}-\d{2})\/(\d{1,30})\.pdf$/i.exec(url);
 if(!m||!validDay(m[1])||m[1]>chinaDay(receivedAt))return null;
 return 'https://static.cninfo.com.cn/finalpage/'+m[1]+'/'+m[2]+'.pdf';
}
function classify(title){
 const kinds=[];
 if(/解除限售|限售股.{0,18}上市流通|解禁|限售股份上市/.test(title))kinds.push('unlock');
 if(/质押|解质押/.test(title))kinds.push('pledge');
 if(/退市|终止上市/.test(title))kinds.push('delisting');
 if(!kinds.length)return null;
 const ambiguous=/传闻|谣言|澄清|否认|未发生|尚未|暂未|不涉及|不存在|取消|更正|修订|补充|撤回|可能|风险提示/.test(title);
 let phase='manual-review';
 if(!ambiguous&&kinds.length===1){
  switch(kinds[0]){
   case 'unlock':
    phase=/计划|拟|申请|提示性/.test(title)?'unlock-plan-clue':'unlock-release-clue';break;
   case 'pledge':{
    const release=/解除质押|解除股份质押|解质押/.test(title);
    const both=release&&/及|暨|同时|新增|再质押|补充质押/.test(title);
    phase=both?'manual-review':release?'pledge-release-clue':'pledge-disclosure-clue';break;
   }
   case 'delisting':
    phase=/撤销|解除/.test(title)?'delisting-warning-removal-clue':
     /终止上市决定|退市整理期|终止上市暨/.test(title)?'delisting-decision-or-process-clue':'delisting-warning-clue';break;
  }
 }
 return {categories:kinds,phase,requiresManualReview:true};
}
function readSecurityLifecycleEvidence({root=ROOT,symbol,asOf=Date.now(),now=Date.now(),lookbackDays=90,limit=100}={}){
 if(!codeOK(symbol)||!validTime(now)||!validTime(asOf)||asOf>now||
    !Number.isSafeInteger(lookbackDays)||lookbackDays<1||lookbackDays>366||
    !Number.isSafeInteger(limit)||limit<1||limit>200)throw Error('证券生命周期查询参数无效');
 // Validate the original entire journal once. Never bypass a corrupted later
 // record by scanning just the older files. This is read-only, no polling.
 const base={schemaVersion:1,mode:'security-lifecycle-disclosure-research',symbol,asOf,lookbackDays,limit,
  readonly:true,researchOnly:true,canTrade:false,canNotify:false,canTrain:false,verifiedLive:false,
  independentlyVerified:false,providerLicensed:false,completeMarketCoverage:false,
  verifiedFacts:0,shareQuantity:null,pledgedShares:null,delisted:null,
  impactScore:null,absenceClaim:null,rows:[],conflicts:[],excluded:{withdrawn:0,securityRemoved:0,changedOriginalLink:0,unknownTimeOrSource:0},
  note:'仅归档公告标题线索；不确认解禁实施、质押余额、退市决定真伪或可交易状态；无记录不是没有风险。'};
 let all;try{all=readJournal(root,{now});}catch{return {...base,status:'archive-unavailable',visibleJournalHead:null,coverage:{scannedVisibleEvents:null,displayedDocuments:0,truncated:null}};}
 const visible=all.filter(e=>e.recordedAt<=asOf),head=visible.at(-1)?.eventHash??null;
 const chains=new Map();
 for(const e of visible){
  const x=e.evidence,id=JSON.stringify([x.source,x.eventId]);
  if(!chains.has(id))chains.set(id,{associated:false,urls:new Set(),latest:null});
  const c=chains.get(id);
  if(x.securities.includes(symbol))c.associated=true;
  const url=documentKey(x.url,x.receivedAt);if(url)c.urls.add(url);
  c.latest=e;
 }
 const blocked=new Map(),groups=new Map(),excluded={...base.excluded};
 const block=(url,reason)=>{if(!blocked.has(url))blocked.set(url,new Set());blocked.get(url).add(reason);};
 for(const c of chains.values()){
  if(!c.associated)continue;
  const e=c.latest,x=e.evidence,url=documentKey(x.url,x.receivedAt);
  if(x.kind==='retracted'||!x.securities.includes(symbol)){
   const reason=x.kind==='retracted'?'withdrawn':'securityRemoved';excluded[reason]++;
   for(const key of c.urls)block(key,reason);
   continue;
  }
  for(const key of c.urls)if(key!==url){block(key,'changedOriginalLink');excluded.changedOriginalLink++;}
  if(!url||testSource(x.source)||!validTime(x.publishedAt)||x.publishedAt>x.receivedAt||
     x.receivedAt>e.recordedAt||x.kind==='revised'&&!validTime(x.revisedAt)){
   excluded.unknownTimeOrSource++;
   if(url)block(url,'unknownTimeOrSource');
   continue;
  }
  if(x.publishedAt<asOf-lookbackDays*DAY)continue;
  const item={eventHash:e.eventHash,source:x.source,eventId:x.eventId,sourceRevisionId:x.sourceRevisionId,
   title:x.title,publishedAt:x.publishedAt,receivedAt:x.receivedAt,knownAt:e.recordedAt,originalUrl:url,
   bodyScope:x.bodyScope,bodyHash:x.bodyHash};
  if(!groups.has(url))groups.set(url,[]);
  groups.get(url).push(item);
 }
 const rows=[],conflicts=[];
 for(const [url,group] of groups){
  const relevant=group.filter(x=>classify(x.title)!==null);
  if(!relevant.length)continue;
  const variants=new Set(group.map(x=>JSON.stringify([x.title,x.publishedAt])));
  if(blocked.has(url)||variants.size!==1){
   conflicts.push({originalUrl:url,reasons:[...(blocked.get(url)||[]),...(variants.size!==1?['conflicting-title-or-publication']:[])],
    eventHashes:group.map(x=>x.eventHash).sort(),categories:[...new Set(relevant.flatMap(x=>classify(x.title).categories))].sort()});
   continue;
  }
  const ordered=group.slice().sort((a,b)=>a.knownAt-b.knownAt||a.eventHash.localeCompare(b.eventHash)),x=ordered[0];
  const {bodyHash,...first}=x;
  rows.push({...first,...classify(x.title),status:'headline-clue-unverified',eventHashes:ordered.map(x=>x.eventHash).sort(),
   sourceLabels:[...new Set(ordered.map(x=>x.source))].sort(),independentPublisherCount:null,
   eventEffectiveDate:null,quantity:null,amount:null,actualEventConfirmed:false,
   sourcePublicationVerified:false});
 }
 rows.sort((a,b)=>b.publishedAt-a.publishedAt||a.originalUrl.localeCompare(b.originalUrl));
 conflicts.sort((a,b)=>a.originalUrl.localeCompare(b.originalUrl));
 const categories=Object.fromEntries(CATEGORIES.map(k=>[k,{status:rows.some(x=>x.categories.includes(k))?'headline-clues-only':'unknown',
  clueDocuments:rows.filter(x=>x.categories.includes(k)).length,confirmedEvents:null,absenceClaim:null}]));
 return {...base,status:rows.length?'headline-research-only':conflicts.length?'conflicting-evidence':'no-qualified-evidence',
  visibleJournalHead:head,rows:rows.slice(0,limit),conflicts:conflicts.slice(0,limit),excluded,categories,
  coverage:{scannedVisibleEvents:visible.length,qualifiedDocuments:rows.length,displayedDocuments:Math.min(rows.length,limit),
   conflictDocuments:conflicts.length,truncated:rows.length>limit||conflicts.length>limit,completeSourceCoverage:false}};
}
module.exports={readSecurityLifecycleEvidence};
