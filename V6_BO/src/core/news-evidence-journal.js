'use strict';
// Local append-only evidence, not a source/timestamp attestation or sentiment model.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../../data/news-evidence');
const MAX_EVENTS=10000,MAX_FILE=128*1024,MAX_TOTAL=128*1024*1024;
const FLAGS=Object.freeze({canTrade:false,canTrain:false,canNotify:false,
 independentlyVerified:false,externallyTimestampCertified:false});
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?
 Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
const identity=v=>typeof v==='string'&&/^[A-Za-z0-9:._-]{1,120}$/.test(v);
const timestamp=v=>Number.isSafeInteger(v)&&v>=946684800000&&v<4102444800000;
const key=x=>JSON.stringify([x.source,x.eventId]);
function safePath(p){
 if(typeof p!=='string'||!path.isAbsolute(p)||p.includes('\0'))throw Error('PRIVATE_ABSOLUTE_PATH_REQUIRED');
 const full=path.resolve(p);if(full===path.parse(full).root||full.split(path.sep).includes('public'))throw Error('PUBLIC_PATH_FORBIDDEN');
 let part=path.parse(full).root;
 for(const bit of full.slice(part.length).split(path.sep).filter(Boolean)){
  part=path.join(part,bit);try{if(fs.lstatSync(part).isSymbolicLink())throw Error('SYMLINK_FORBIDDEN');}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 return full;
}
function safeUrl(v){
 if(v===null||v===undefined||v==='')return null;
 if(!text(v,2048))throw Error('INVALID_ORIGINAL_URL');
 let u;try{u=new URL(v);}catch{throw Error('INVALID_ORIGINAL_URL');}
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('INVALID_ORIGINAL_URL');
 return u.href;
}
function normalize(input,{now=Date.now()}={}){
 if(!timestamp(now)||!input||typeof input!=='object'||Array.isArray(input))throw Error('INVALID_NEWS_INPUT');
 const allowed=['schemaVersion','source','eventId','sourceRevisionId','kind','supersedes','url','title','body','bodyScope','securities','publishedAt','receivedAt','revisedAt'];
 if(Object.keys(input).some(k=>!allowed.includes(k))||input.schemaVersion!==1||
 !identity(input.source)||!identity(input.eventId)||!identity(input.sourceRevisionId)||
 !['original','revised','retracted'].includes(input.kind)||!text(input.title,1000)||
 typeof input.body!=='string'||input.body.length>50000||!timestamp(input.receivedAt)||input.receivedAt>now)
  throw Error('INVALID_NEWS_INPUT_OR_FUTURE_RECEIPT');
 if(!Array.isArray(input.securities)||input.securities.length>100||
 input.securities.some(s=>typeof s!=='string'||!/^\d{6}$/.test(s))||new Set(input.securities).size!==input.securities.length)
  throw Error('INVALID_NEWS_SECURITIES');
 const publishedAt=input.publishedAt??null,revisedAt=input.revisedAt??null;
 for(const t of [publishedAt,revisedAt])if(t!==null&&(!timestamp(t)||t>input.receivedAt||t>now))throw Error('INVALID_OR_FUTURE_SOURCE_TIME');
 if(input.kind==='original'&&(input.supersedes!==null||revisedAt!==null))throw Error('ORIGINAL_CANNOT_SUPERSEDE');
 if(input.kind!=='original'&&(!/^[a-f0-9]{64}$/.test(input.supersedes||'')||
 revisedAt!==null&&publishedAt!==null&&revisedAt<publishedAt))throw Error('INVALID_REVISION_CHAIN_OR_TIME');
 const bodyScope=input.bodyScope||'declared-body';
 if(!['declared-body','provider-summary'].includes(bodyScope))throw Error('INVALID_BODY_SCOPE');
 const url=safeUrl(input.url),bodyHash=crypto.createHash('sha256').update(input.body).digest('hex');
 const uncertainty=['SOURCE_NOT_INDEPENDENTLY_VERIFIED','LOCAL_CLOCK_NOT_ATTESTED'];
 if(publishedAt===null)uncertainty.push('UNKNOWN_ORIGINAL_PUBLICATION_TIME');
 if(input.kind!=='original'&&revisedAt===null)uncertainty.push('UNKNOWN_SOURCE_REVISION_TIME');
 if(!url)uncertainty.push('MISSING_ORIGINAL_LINK');
 if(!input.body)uncertainty.push('MISSING_BODY');
 if(bodyScope==='provider-summary')uncertainty.push('SUMMARY_ONLY');
 return {schemaVersion:1,source:input.source,eventId:input.eventId,sourceRevisionId:input.sourceRevisionId,
 kind:input.kind,supersedes:input.supersedes,url,title:input.title,body:input.body,bodyScope,bodyHash,
 securities:input.securities.slice().sort(),publishedAt,receivedAt:input.receivedAt,revisedAt,uncertainty};
}
function readFile(file){
 const fd=fs.openSync(safePath(file),fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{
  const before=fs.fstatSync(fd);if(!before.isFile()||(before.mode&0o077)!==0||before.size<2||before.size>MAX_FILE)throw Error('INVALID_PRIVATE_EVIDENCE_FILE');
  const raw=fs.readFileSync(fd,'utf8'),after=fs.fstatSync(fd);
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||Buffer.byteLength(raw)!==before.size)throw Error('EVIDENCE_CHANGED_DURING_READ');
  return {data:JSON.parse(raw),bytes:before.size};
 }finally{fs.closeSync(fd);}
}
function checkNext(events,evidence){
 const chain=events.filter(e=>key(e.evidence)===key(evidence)),last=chain.at(-1);
 const same=chain.find(e=>e.evidence.sourceRevisionId===evidence.sourceRevisionId);
 if(same){
  const omitReceipt=x=>{const {receivedAt,...rest}=x;return rest;};
  if(hash(omitReceipt(same.evidence))!==hash(omitReceipt(evidence)))throw Error('CONFLICTING_SOURCE_REVISION');
  return same;
 }
 if(!last&&evidence.kind!=='original')throw Error('MISSING_ORIGINAL_OR_WRONG_SOURCE');
 if(last&&(evidence.kind==='original'||last.evidence.kind==='retracted'||evidence.supersedes!==last.eventHash))throw Error('WRONG_SUPERSEDES_OR_TERMINAL_RETRACTION');
 if(last&&(evidence.receivedAt<last.evidence.receivedAt||evidence.publishedAt!==last.evidence.publishedAt||
 last.evidence.revisedAt!==null&&evidence.revisedAt!==null&&evidence.revisedAt<last.evidence.revisedAt))throw Error('REVISION_TIME_OR_ORIGINAL_PUBLICATION_CHANGED');
 return null;
}
function readJournal(root=ROOT,{now=Date.now(),allowLock=false}={}){
 root=safePath(root);if(!timestamp(now))throw Error('INVALID_QUERY_CLOCK');
 if(!fs.existsSync(root))return [];
 const dir=fs.lstatSync(root);if(!dir.isDirectory()||(dir.mode&0o077)!==0)throw Error('PRIVATE_DIRECTORY_REQUIRES_0700');
 if(!allowLock&&fs.existsSync(path.join(root,'.lock')))throw Error('EVIDENCE_WRITER_ACTIVE_OR_RECOVERY_REQUIRED');
 const names=fs.readdirSync(root).filter(n=>n!=='.lock'&&!/^\.stage-[a-f0-9]{24}$/.test(n)).sort();
 if(names.length>MAX_EVENTS||names.some(n=>!/^\d{6}\.json$/.test(n)))throw Error('UNRECOGNIZED_EVIDENCE_ARCHIVE');
 const events=[];let bytes=0;
 for(let i=0;i<names.length;i++){
  if(names[i]!==String(i+1).padStart(6,'0')+'.json')throw Error('NEWS_CHAIN_GAP');
  const read=readFile(path.join(root,names[i]));bytes+=read.bytes;if(bytes>MAX_TOTAL)throw Error('NEWS_ARCHIVE_LIMIT');
  const e=read.data,{eventHash,...payload}=e;
  const {bodyHash,uncertainty,...sourceInput}=e.evidence||{};
  if(e.schemaVersion!==1||e.sequence!==i+1||e.previousHash!==(events.at(-1)?.eventHash||null)||
   !timestamp(e.recordedAt)||e.recordedAt>now||e.recordedAt<(events.at(-1)?.recordedAt||0)||
   hash(payload)!==eventHash||Object.entries(FLAGS).some(([k,v])=>e[k]!==v)||
   hash(normalize(sourceInput,{now:e.recordedAt}))!==hash(e.evidence)||checkNext(events,e.evidence))throw Error('NEWS_CHAIN_INTEGRITY_FAILURE');
  events.push(e);
 }
 if(fs.lstatSync(root).mtimeMs!==dir.mtimeMs)throw Error('NEWS_ARCHIVE_CHANGED_DURING_QUERY');
 return events;
}
function appendBatch(root=ROOT,inputs,{now=Date.now()}={}){
 if(!Array.isArray(inputs)||inputs.length<1||inputs.length>200)throw Error('NEWS_IMPORT_BATCH_LIMIT');
 const prepared=inputs.map(x=>normalize(x,{now}));root=safePath(root);
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 if((fs.lstatSync(root).mode&0o077)!==0)throw Error('PRIVATE_DIRECTORY_REQUIRES_0700');
 const lock=path.join(root,'.lock'),fd=fs.openSync(lock,'wx',0o600);
 try{
  const events=readJournal(root,{now,allowLock:true}),writes=[],results=[];
  for(const evidence of prepared){
   const same=checkNext(events,evidence);
   if(same){results.push({eventHash:same.eventHash,sequence:same.sequence,reused:true});continue;}
   if(events.length>=MAX_EVENTS)throw Error('NEWS_ARCHIVE_LIMIT');
   const payload={schemaVersion:1,sequence:events.length+1,previousHash:events.at(-1)?.eventHash||null,
    recordedAt:now,evidence,...FLAGS};
   const event={...payload,eventHash:hash(payload)},raw=JSON.stringify(event)+'\n';
   if(Buffer.byteLength(raw)>MAX_FILE)throw Error('NEWS_RECORD_LIMIT');
   events.push(event);writes.push({event,raw});results.push({eventHash:event.eventHash,sequence:event.sequence,reused:false});
  }
  const existingBytes=fs.readdirSync(root).filter(n=>/^\d{6}\.json$/.test(n)).reduce((sum,n)=>sum+fs.lstatSync(path.join(root,n)).size,0);
  if(existingBytes+writes.reduce((sum,x)=>sum+Buffer.byteLength(x.raw),0)>MAX_TOTAL)throw Error('NEWS_ARCHIVE_LIMIT');
  for(const {event,raw} of writes){
   const temp=path.join(root,'.stage-'+crypto.randomBytes(12).toString('hex'));
   let writer;
   try{
    writer=fs.openSync(temp,'wx',0o600);fs.writeFileSync(writer,raw);fs.fsyncSync(writer);fs.closeSync(writer);writer=undefined;
    fs.linkSync(temp,path.join(root,String(event.sequence).padStart(6,'0')+'.json'));
   }finally{if(writer!==undefined)fs.closeSync(writer);try{fs.unlinkSync(temp);}catch{}}
  }
  const parent=fs.openSync(root,'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
  return {schemaVersion:1,mode:'local-news-evidence-import',results,...FLAGS};
 }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
function query(root=ROOT,{symbol=null,limit=50,now=Date.now()}={}){
 if(symbol!==null&&!/^\d{6}$/.test(symbol)||!Number.isSafeInteger(limit)||limit<1||limit>200)throw Error('INVALID_NEWS_QUERY');
 const all=readJournal(root,{now}),latest=new Map(all.map(e=>[key(e.evidence),e.eventHash]));
 const rows=all.filter(e=>symbol===null||e.evidence.securities.includes(symbol)).map(e=>{
  const current=latest.get(key(e.evidence))===e.eventHash,x=e.evidence;
  const unknown=x.uncertainty.some(s=>s.startsWith('UNKNOWN_')||s.startsWith('MISSING_')||s==='SUMMARY_ONLY');
  return {...e,current,eligibleForResearchSupport:current&&x.kind!=='retracted'&&!unknown,
   usableAsResearchSupport:current&&x.kind!=='retracted'&&!unknown,
   supportStatus:!current?'superseded':x.kind==='retracted'?'retracted':unknown?'unknown':'source-declared-unverified'};
 });
 const current=rows.filter(e=>e.current);
 return {schemaVersion:1,mode:'news-evidence-readonly',total:rows.length,rows:rows.slice(-limit).reverse(),
  summary:{totalRevisions:rows.length,currentEvents:current.length,
   retractedEvents:current.filter(e=>e.supportStatus==='retracted').length,
   eligibleForResearchSupport:current.filter(e=>e.eligibleForResearchSupport).length,
   unknownEvents:current.filter(e=>e.supportStatus==='unknown').length},
  headHash:all.at(-1)?.eventHash||null,readonly:true,...FLAGS};
}
// Eastmoney wall-clock strings have China timezone, never host-local timezone.
function sourceTime(v){
 if(v===null||v===undefined||v==='')return null;
 if(timestamp(v))return v;
 if(typeof v!=='string')throw Error('INVALID_SOURCE_TIME');
 let value=v;if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v))value=v.replace(' ','T')+'+08:00';
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|\+08:00)$/.test(value))throw Error('AMBIGUOUS_SOURCE_TIME');
 const t=Date.parse(value);if(!timestamp(t))throw Error('INVALID_SOURCE_TIME');
 const local=new Date(t+(value.endsWith('+08:00')?8*3600000:0)).toISOString();
 if(local.slice(0,19)!==value.slice(0,19))throw Error('INVALID_SOURCE_TIME');
 return t;
}
function providerInput(raw,last,{now=Date.now()}={}){
 const base={schemaVersion:1,source:'eastmoney-fast-news',eventId:String(raw.code||''),
  title:raw.title||'',body:raw.summary||'',bodyScope:'provider-summary',url:raw.url||raw.link||null,
  securities:[...new Set((raw.stockList||[]).map(s=>/^[013]\.(\d{6})$/.exec(String(s))?.[1]).filter(Boolean))],
  publishedAt:sourceTime(raw.showTime),receivedAt:now,revisedAt:sourceTime(raw.revisedAt),
  kind:raw.retracted===true?'retracted':last?'revised':'original',supersedes:last?.eventHash||null};
 if(!last)base.revisedAt=null;
 const edition=hash({title:base.title,body:base.body,url:base.url,securities:base.securities,
  publishedAt:base.publishedAt,revisedAt:base.revisedAt,retracted:raw.retracted===true});
 base.sourceRevisionId=edition;
 if(last?.evidence.sourceRevisionId===edition)return null;
 return base;
}
function captureProviderBatch(root=ROOT,raw,{now=Date.now()}={}){
 if(!Array.isArray(raw)||raw.length>2000)throw Error('PROVIDER_NEWS_BATCH_LIMIT');
 const events=readJournal(root,{now}),latest=new Map(events.map(e=>[key(e.evidence),e]));
 const inputs=[],rejectedEventIds=[];let rejected=0;
 for(const row of raw){
  try{
   const last=latest.get(JSON.stringify(['eastmoney-fast-news',String(row.code||'')]));
   const input=providerInput(row,last,{now});if(!input)continue;
   const normalized=normalize(input,{now});checkNext(events,normalized);
   // Duplicate events from overlapping provider columns are captured once.
   if(inputs.some(x=>key(x)===key(input)))continue;
   inputs.push(input);
  }catch{rejected++;rejectedEventIds.push(String(row?.code||''));}
 }
 let imported=0;
 for(let offset=0;offset<inputs.length;offset+=200)imported+=appendBatch(root,inputs.slice(offset,offset+200),{now}).results.filter(r=>!r.reused).length;
 return {captured:imported,rejected,rejectedEventIds,...FLAGS};
}
module.exports={ROOT,FLAGS,hash,safePath,safeUrl,normalize,readJournal,appendBatch,query,sourceTime,providerInput,captureProviderBatch};
