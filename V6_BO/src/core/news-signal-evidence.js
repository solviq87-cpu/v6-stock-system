'use strict';
// A bounded, read-only reference into the local journal. Same-security context
// does not establish sentiment, keyword causality, source truth or trade rights.
const fs=require('node:fs'),path=require('node:path');
const Journal=require('./news-evidence-journal');
const LIMITS=Object.freeze({events:10000,bytes:128*1024*1024,candidates:256,versions:32,outputBytes:64*1024,caches:4,metadataCheckMs:1000});
const eventKey=e=>JSON.stringify([e.source,e.eventId]);
const validTime=t=>Number.isSafeInteger(t)&&t>=946684800000&&t<4102444800000;
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const stamp=s=>[s.dev,s.ino,s.mode,s.size,s.mtimeMs,s.ctimeMs].join(':');
function visibleCount(events,at){
 let lo=0,hi=events.length;
 while(lo<hi){const mid=(lo+hi)>>>1;if(events[mid].recordedAt<=at)lo=mid+1;else hi=mid;}
 return lo;
}
function directoryStamp(root){
 Journal.safePath(root);
 if(!fs.existsSync(root))return null;
 const stat=fs.lstatSync(root);
 if(!stat.isDirectory()||(stat.mode&0o077)!==0||fs.existsSync(path.join(root,'.lock')))throw Error('NEWS_JOURNAL_UNAVAILABLE');
 return stamp(stat);
}
function metadata(root){
 const files=fs.readdirSync(root).filter(n=>!/^\.stage-[a-f0-9]{24}$/.test(n)).sort();
 if(files.length>LIMITS.events||files.some((n,i)=>n!==String(i+1).padStart(6,'0')+'.json'))throw Error('NEWS_JOURNAL_CAPACITY_OR_GAP');
 let bytes=0;
 return files.map(name=>{
  const stat=fs.lstatSync(path.join(root,name));bytes+=stat.size;
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||stat.size>128*1024||bytes>LIMITS.bytes)throw Error('NEWS_JOURNAL_CAPACITY_OR_FILE');
  return [name,stamp(stat)];
 });
}
function verifyReference(root,event){
 const file=Journal.safePath(path.join(root,String(event.sequence).padStart(6,'0')+'.json'));
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{
  const before=fs.fstatSync(fd);
  if(!before.isFile()||(before.mode&0o077)!==0||before.size<2||before.size>128*1024)throw Error('NEWS_REFERENCE_FILE_INVALID');
  const raw=fs.readFileSync(fd,'utf8'),after=fs.fstatSync(fd);
  const {eventHash,...payload}=JSON.parse(raw);
  if(stamp(before)!==stamp(after)||Buffer.byteLength(raw)!==before.size||eventHash!==event.eventHash||Journal.hash(payload)!==eventHash)throw Error('NEWS_REFERENCE_INTEGRITY_FAILURE');
 }finally{fs.closeSync(fd);}
}
function reference(event,current,code,at){
 const e=event.evidence;
 const issues=[];
 if(!current)issues.push('SUPERSEDED');
 if(!e.securities.includes(code))issues.push('SECURITY_REMOVED');
 if(e.kind==='retracted')issues.push('RETRACTED');
 if(!validTime(e.publishedAt)||e.publishedAt>at)issues.push('UNKNOWN_OR_INVALID_PUBLICATION_TIME');
 if(!validTime(e.receivedAt)||e.receivedAt>at||e.receivedAt>event.recordedAt)issues.push('UNKNOWN_OR_INVALID_RECEIPT_TIME');
 if(e.kind!=='original'&&(!validTime(e.revisedAt)||e.revisedAt>at))issues.push('UNKNOWN_OR_INVALID_REVISION_TIME');
 if(!e.url)issues.push('MISSING_ORIGINAL_LINK');
 if(!e.body)issues.push('MISSING_BODY');
 if(e.bodyScope!=='declared-body')issues.push('SUMMARY_ONLY');
 return {sequence:event.sequence,eventHash:event.eventHash,previousHash:event.previousHash,recordedAt:event.recordedAt,
  source:e.source,eventId:e.eventId,sourceRevisionId:e.sourceRevisionId,kind:e.kind,supersedes:e.supersedes,
  url:e.url,title:e.title,bodyScope:e.bodyScope,bodyHash:e.bodyHash,bodyIncluded:false,securities:e.securities.slice(),
  publishedAt:e.publishedAt,receivedAt:e.receivedAt,revisedAt:e.revisedAt,current,
  eligibleForResearchSupport:issues.length===0,issues,...Journal.FLAGS};
}
function createReader(){
 const caches=new Map();
 function snapshot(root,now){
  const currentStamp=directoryStamp(root);
  let cached=caches.get(root);
  if(currentStamp===null){caches.delete(root);return {events:[],bySecurity:new Map(),verifiedAt:now,stamp:null};}
  let files;
  // Full content validation is reused between appends. A bounded metadata sweep
  // also detects unrelated in-place changes; every emitted reference is always
  // reopened and hash checked below, including within this one-second window.
  if(cached&&cached.stamp===currentStamp&&now>=cached.checkedAt&&now-cached.checkedAt<LIMITS.metadataCheckMs)return cached;
  files=metadata(root);
  if(cached&&cached.stamp===currentStamp&&JSON.stringify(files)===cached.files){cached.checkedAt=now;return cached;}
  caches.delete(root);
  const events=Journal.readJournal(root,{now}),bySecurity=new Map(),chains=new Map();
  if(events.length>LIMITS.events)throw Error('NEWS_JOURNAL_CAPACITY');
  for(const event of events){
   const key=eventKey(event.evidence);
   if(!chains.has(key))chains.set(key,[]);
   chains.get(key).push(event);
   for(const code of event.evidence.securities){
    if(!bySecurity.has(code))bySecurity.set(code,new Map());
    if(!bySecurity.get(code).has(key))bySecurity.get(code).set(key,event.recordedAt);
   }
  }
  if(directoryStamp(root)!==currentStamp||JSON.stringify(metadata(root))!==JSON.stringify(files))throw Error('NEWS_JOURNAL_CHANGED_DURING_BINDING');
  cached={events,bySecurity,chains,stamp:currentStamp,files:JSON.stringify(files),checkedAt:now,verifiedAt:now};
  if(caches.size>=LIMITS.caches)caches.delete(caches.keys().next().value);
  caches.set(root,cached);return cached;
 }
 return function capture(root,{code,triggerAt,now=Date.now()}={}){
  const base={schemaVersion:1,mode:'signal-news-journal-reference',association:'same-security-context',
   code,asOf:triggerAt,readonly:true,...Journal.FLAGS};
  const failure=reason=>freeze({originalEvidence:null,binding:{...base,status:'partial',reasons:[reason],versions:[]}});
  try{
   if(!/^\d{6}$/.test(code||'')||!validTime(triggerAt)||!validTime(now)||triggerAt>now)return failure('INVALID_NEWS_BINDING_IDENTITY_OR_CLOCK');
   root=Journal.safePath(root);
   const cached=snapshot(root,now),keys=[...(cached.bySecurity.get(code)||new Map())].filter(([,firstKnownAt])=>firstKnownAt<=triggerAt);
   if(keys.length>LIMITS.candidates)return failure('NEWS_BINDING_CANDIDATE_LIMIT');
   const selected=[];
   for(const [key] of keys){
    const chain=cached.chains.get(key),count=visibleCount(chain,triggerAt);
    if(selected.length+count>LIMITS.versions)return failure('NEWS_BINDING_VERSION_LIMIT');
    const visible=chain.slice(0,count);
    const head=visible.at(-1);
    selected.push(...visible.map(event=>({event,ref:reference(event,event===head,code,triggerAt)})));
   }
   // Source timestamps alone cannot make a late local import visible. The
   // journal head is likewise selected at trigger time, even from a newer cache.
   const end=visibleCount(cached.events,triggerAt)-1;
   const head=end>=0?cached.events[end]:null;
   for(const {event} of selected)verifyReference(root,event);
   if(head&&!selected.some(x=>x.event===head))verifyReference(root,head);
   if(directoryStamp(root)!==cached.stamp)throw Error('NEWS_JOURNAL_CHANGED_DURING_BINDING');
   const versions=selected.map(x=>x.ref).sort((a,b)=>a.sequence-b.sequence),current=versions.filter(x=>x.current);
   const eligible=current.filter(x=>x.eligibleForResearchSupport);
   const reasons=[...new Set(current.flatMap(x=>x.issues))];
   if(!current.length)reasons.push('NO_NEWS_VERSION_KNOWN_AT_TRIGGER');
   const binding={...base,status:reasons.length?'partial':'recorded',reasons,versions,
    asOfHeadHash:head?.eventHash||null,asOfSequence:head?.sequence||0,chainVerifiedAt:cached.verifiedAt,
    validationScope:'cached-full-chain-and-current-reference-hashes',chainMetadataCheckedAt:cached.checkedAt??now,
    metadataCheckMaxAgeMs:LIMITS.metadataCheckMs,referencesVerifiedAt:now};
   // Existing schema2 tests truthiness: never pass [] or a partial object as
   // originalEvidence. Keep diagnostics without upgrading missing originals.
   const result={originalEvidence:reasons.length||!eligible.length?null:eligible,binding};
   if(Buffer.byteLength(JSON.stringify(result))>LIMITS.outputBytes)return failure('NEWS_BINDING_OUTPUT_LIMIT');
   return freeze(result);
  }catch{caches.delete(root);return failure('NEWS_JOURNAL_UNAVAILABLE_OR_INVALID');}
 };
}
module.exports={LIMITS,createReader,capture:createReader()};
