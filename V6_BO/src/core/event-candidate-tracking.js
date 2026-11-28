'use strict';
// Project the existing private news chain and original screening receipt. A
// shared security code is not proof that the news caused a candidate signal.
const Journal=require('./news-evidence-journal');
const time=x=>Number.isSafeInteger(x)&&x>=946684800000&&x<4102444800000;
const day=t=>new Date(t+28800000).toISOString().slice(0,10);
const seal=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const code=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const id=x=>typeof x==='string'&&/^[A-Za-z0-9:._-]{1,120}$/.test(x);
const workspaceFlags={researchOnly:true,canTrade:false,canNotify:false,productionWeightsChanged:false};
function trackEventCandidates({journalRows=[],workspaceEvents=[],asOf}={}){
 const base={mode:'source-event-revision-candidate-tracking-v1',status:'unknown',asOf,rows:[],totalEvents:null,truncatedEvents:null,screen:null,newsDependencyVerified:false,canTrade:false,canNotify:false};
 const bad=reason=>({...base,reason});
 if(!time(asOf)||!Array.isArray(journalRows)||journalRows.length>10000||!Array.isArray(workspaceEvents)||workspaceEvents.length>2000)return bad('archive-unavailable-or-over-budget');
 const chains=new Map(),revisionIds=new Map();let visibleCount=0;let previous=null;
 try{
  for(const row of journalRows){
   if(!time(row?.recordedAt))return bad('invalid-news-clock');
   if(row.recordedAt>asOf)continue;
   const {eventHash,...payload}=row,e=row.evidence;
   if(row.schemaVersion!==1||row.sequence!==visibleCount+1||row.previousHash!==(previous?.eventHash??null)||previous&&row.recordedAt<previous.recordedAt||!seal(eventHash)||Journal.hash(payload)!==eventHash||Object.entries(Journal.FLAGS).some(([k,v])=>row[k]!==v)||!id(e?.source)||!id(e?.eventId)||!id(e?.sourceRevisionId))return bad('news-chain-integrity-failed');
   const {bodyHash,uncertainty,...original}=e;
   if(Journal.hash(Journal.normalize(original,{now:row.recordedAt}))!==Journal.hash(e))return bad('news-body-integrity-failed');
   const key=JSON.stringify([e.source,e.eventId]),chain=chains.get(key)||[],prior=chain.at(-1),ids=revisionIds.get(key)||new Set();
   if(!prior&&e.kind!=='original'||prior&&(e.kind==='original'||prior.evidence.kind==='retracted'||e.supersedes!==prior.eventHash||e.publishedAt!==prior.evidence.publishedAt||e.receivedAt<prior.evidence.receivedAt||prior.evidence.revisedAt!==null&&e.revisedAt!==null&&e.revisedAt<prior.evidence.revisedAt)||ids.has(e.sourceRevisionId))return bad('news-revision-integrity-failed');
   chain.push(row);chains.set(key,chain);ids.add(e.sourceRevisionId);revisionIds.set(key,ids);visibleCount++;previous=row;
  }
 }catch{return bad('news-chain-unavailable');}
 const screens=workspaceEvents.filter(e=>e?.kind==='screen'&&time(e.recordedAt)&&e.recordedAt<=asOf).sort((a,b)=>b.recordedAt-a.recordedAt||(b.sequence||0)-(a.sequence||0));
 const latest=screens[0],d=latest?.data;let screen=null,byCode=null;
 try{if(latest){const {hash,...payload}=latest;
  const good=latest.schemaVersion===1&&seal(hash)&&Journal.hash(payload)===hash&&Object.entries(workspaceFlags).every(([k,v])=>latest[k]===v&&d?.[k]===v)&&time(d.asOf)&&d.asOf<=latest.recordedAt&&typeof d.provenance==='string'&&d.provenance.length>0&&seal(d.codeVersion?.fingerprint)&&Array.isArray(d.rows)&&d.rows.length<=2000&&d.total===d.rows.length&&new Set(d.rows.map(r=>r?.symbol)).size===d.rows.length&&Array.from(d.rows).every(r=>r&&code(r.symbol)&&['selected','rejected','unknown'].includes(r.status))&&!screens.some(e=>e!==latest&&e.recordedAt===latest.recordedAt&&e.hash!==hash);
  screen={status:good?day(d.asOf)===day(asOf)&&day(latest.recordedAt)===day(asOf)?'same-day-frozen-screen':'historical-screen-not-current':'unavailable',runId:good?hash:null,recordedAt:good?latest.recordedAt:null,asOf:good?d.asOf:null,provenance:good?d.provenance:null,codeVersion:good?d.codeVersion.fingerprint:null};
  if(screen.status==='same-day-frozen-screen')byCode=new Map(d.rows.map(r=>[r.symbol,r]));
 }}catch{screen={status:'unavailable',runId:null};}
 const reference=(r)=>({sequence:r.sequence,eventHash:r.eventHash,sourceRevisionId:r.evidence.sourceRevisionId,kind:r.evidence.kind,title:r.evidence.title,url:r.evidence.url,bodyHash:r.evidence.bodyHash,bodyScope:r.evidence.bodyScope,publishedAt:r.evidence.publishedAt,receivedAt:r.evidence.receivedAt,revisedAt:r.evidence.revisedAt,recordedAt:r.recordedAt,securities:r.evidence.securities.slice()});
 const ordered=[...chains.values()].sort((a,b)=>b.at(-1).sequence-a.at(-1).sequence);
 const rows=ordered.slice(0,100).map(chain=>{
  const first=chain[0],last=chain.at(-1),e=last.evidence,removed=[...new Set(chain.flatMap(r=>r.evidence.securities))].filter(s=>!e.securities.includes(s)||e.kind==='retracted').sort();
  const unavailable=e.uncertainty.some(s=>s.startsWith('UNKNOWN_')||s.startsWith('MISSING_')||s==='SUMMARY_ONLY'),screenReady=!!byCode&&screen.asOf>=last.recordedAt;
  const active=e.kind!=='retracted'&&!unavailable;
  const candidates=active&&screenReady?e.securities.map(symbol=>({symbol,screenStatus:byCode.get(symbol)?.status??'not-evaluated-in-screen',screenRunId:screen.runId,association:'same-security-only'})):[];
  return {source:e.source,eventId:e.eventId,title:e.title,status:e.kind==='retracted'?'retracted':unavailable?'source-evidence-unknown':!e.securities.length?'no-current-security-association':'source-declared-unverified',original:reference(first),current:reference(last),revisionCount:chain.length,revisions:chain.slice(-20).map(reference),truncatedRevisions:Math.max(0,chain.length-20),removedSecurities:removed,candidates,candidateStatus:!active?'no-current-support':!e.securities.length?'no-current-security-association':!screenReady?'needs-new-screen-after-revision':'same-day-frozen-screen-association',newsDependencyVerified:false,canTrade:false,canNotify:false};
 });
 return {...base,status:rows.length?'observed-readonly':'no-visible-event-records',totalEvents:chains.size,truncatedEvents:Math.max(0,chains.size-100),screen,rows};
}
module.exports={trackEventCandidates};
