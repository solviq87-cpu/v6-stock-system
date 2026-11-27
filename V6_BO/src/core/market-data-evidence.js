'use strict';
// Raw blobs complement the original bounded research-workspace-store journal;
// the journal owns sequencing, request idempotency, hashes and private access.
// A rejected response is never the current import and never trading authority.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const store=require('./research-workspace-store');
const PROTOCOL='market-history-import-evidence-v1',MAX_RAW=30*1024*1024,MAX_TOTAL=128*1024*1024;
const HASH=/^[a-f0-9]{64}$/,validTime=n=>Number.isSafeInteger(n)&&n>0&&n<=Date.now();
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
function roots(root,create=false){
 const base=store.privateRoot(root,create);
 return {base,events:store.privateRoot(path.join(base,'events'),create),blobs:store.privateRoot(path.join(base,'blobs'),create)};
}
function validateRawReference(reference){
 if(!reference||typeof reference.sha256!=='string'||!HASH.test(reference.sha256)||
  !Number.isSafeInteger(reference.byteLength)||reference.byteLength<1||reference.byteLength>MAX_RAW)
  throw Error('原始行情回执引用或长度无效');
 return reference;
}
const statOptions={bigint:true};
const fileIdentity=s=>[s.dev,s.ino,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
const dirIdentity=s=>[s.dev,s.ino,s.mode].join(':');
function readRaw(root,reference){
 validateRawReference(reference);
 const {blobs}=roots(root),file=path.join(blobs,reference.sha256+'.bin');
 const dirBefore=fs.lstatSync(blobs,statOptions),pathBefore=fs.lstatSync(file,statOptions);
 const expected=BigInt(reference.byteLength);
 if(!dirBefore.isDirectory()||dirBefore.isSymbolicLink()||!pathBefore.isFile()||
  pathBefore.isSymbolicLink()||pathBefore.mode&0o077n||pathBefore.size!==expected)
  throw Error('原始行情回执权限或长度无效');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
 try{
  const before=fs.fstatSync(fd,statOptions);
  if(!before.isFile()||fileIdentity(before)!==fileIdentity(pathBefore))throw Error('原始行情回执打开时已变化');
  // Read only the recorded length plus one byte, including when a writer
  // replaces or grows the file while the descriptor is open.
  const buffer=Buffer.alloc(reference.byteLength+1);let offset=0;
  while(offset<buffer.length){const n=fs.readSync(fd,buffer,offset,buffer.length-offset,offset);if(n===0)break;offset+=n;}
  const after=fs.fstatSync(fd,statOptions);
  roots(root);
  const pathAfter=fs.lstatSync(file,statOptions),dirAfter=fs.lstatSync(blobs,statOptions);
  if(offset!==reference.byteLength||fileIdentity(after)!==fileIdentity(before)||
   fileIdentity(pathAfter)!==fileIdentity(before)||dirIdentity(dirAfter)!==dirIdentity(dirBefore))
   throw Error('原始行情回执读取期间长度或文件身份变化');
  const raw=buffer.subarray(0,reference.byteLength);
  if(sha(raw)!==reference.sha256)throw Error('原始行情回执哈希不一致');
  return raw;
 }finally{fs.closeSync(fd);}
}
function describeRaw(raw){
 if(!Buffer.isBuffer(raw)||!raw.length||raw.length>MAX_RAW)throw Error('原始行情回执为空或超过容量');
 return {sha256:sha(raw),byteLength:raw.length};
}

function saveRaw(root,raw){
 const reference=describeRaw(raw),{blobs}=roots(root,true),target=path.join(blobs,reference.sha256+'.bin');
 if(fs.existsSync(target)){readRaw(root,reference);return reference;}
 let total=0;
 for(const name of fs.readdirSync(blobs)){
  if(/^\.stage-[a-f0-9]{24}$/.test(name))continue;
  if(!/^[a-f0-9]{64}\.bin$/.test(name))throw Error('原始行情证据目录损坏');
  const stat=fs.lstatSync(path.join(blobs,name));if(!stat.isFile()||stat.isSymbolicLink()||stat.mode&0o077)throw Error('原始行情证据文件不安全');
  total+=stat.size;
 }
 if(total+raw.length>MAX_TOTAL)throw Error('原始行情证据达到容量，需人工归档后继续');
 const temp=path.join(blobs,'.stage-'+crypto.randomBytes(12).toString('hex'));let fd;
 try{
  fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,raw);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  try{fs.linkSync(temp,target);}catch(error){if(error.code!=='EEXIST')throw error;readRaw(root,reference);}
  const directory=fs.openSync(blobs,'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
 readRaw(root,reference);
 return reference;
}
function verifyReceiptRaw(root,events){
 const verified=new Map();
 for(const event of events)for(const reference of [event.data.rawEvidence,event.data.independentReference?.rawEvidence].filter(Boolean)){
  validateRawReference(reference);
  if(verified.has(reference.sha256)){
   if(verified.get(reference.sha256)!==reference.byteLength)throw Error('相同原始行情哈希的回执长度冲突');
   continue;
  }
  readRaw(root,reference);verified.set(reference.sha256,reference.byteLength);
 }
}
const seriesKey=d=>JSON.stringify([d.provider,d.datasetId]);
const validId=(s,max)=>typeof s==='string'&&s.length>=3&&s.length<=max&&/^[a-zA-Z0-9_.:-]+$/.test(s);
function validateMarketReceipts(events){
 const latest=new Map(),first=new Map(),byHash=new Map(),referenceLengths=new Map(),required=new Set();
 for(const event of events){
  const d=event.data,key=seriesKey(d),previous=latest.get(key),versionKey=JSON.stringify([d.provider,d.datasetId,d.dataVersion]),
   expectedVersion=previous?.data.dataVersion===d.dataVersion?previous.data.version:(previous?.data.version||0)+1;
  if(event.kind!=='diagnostic'||!['admitted','quarantined'].includes(d.status)||!validTime(d.receivedAt)||d.receivedAt>event.recordedAt||d.availableAt!==event.recordedAt||
     typeof d.dataVersion!=='string'||!HASH.test(d.dataVersion)||d.dataVersion!==d.rawEvidence?.sha256||!validId(d.provider,100)||!validId(d.datasetId,120)||
     d.scope?.provider!==d.provider||d.scope?.datasetId!==d.datasetId||d.version!==expectedVersion||
     d.firstKnownAt!==(first.get(versionKey)??d.receivedAt)||d.revisionDetectedAt!==(expectedVersion>1?d.receivedAt:null)||
     d.gateRequirements?.protocol!=='original-market-import-gates-v1'||typeof d.gateRequirements.independentReferenceRequired!=='boolean'||
     required.has(key)&&!d.gateRequirements.independentReferenceRequired||
     d.status==='admitted'&&d.gateRequirements.independentReferenceRequired&&!d.independentReference||
     d.status==='admitted'&&d.sourceObservedAt!=null&&(!validTime(d.sourceObservedAt)||d.sourceObservedAt>d.receivedAt)||
     Object.keys(store.FLAGS).some(k=>d[k]!==store.FLAGS[k]))
   throw Error('行情回执时点、版本或来源完整性无效');
  const references=[validateRawReference(d.rawEvidence)];
  if(d.independentReference!=null){
   const r=d.independentReference;
   if(!r||r.capturedAt!==event.recordedAt||
    d.status==='admitted'&&(!validId(r.provider,128)||!validId(r.datasetId,128)||!validTime(r.observedAt)||r.observedAt>event.recordedAt))
    throw Error('独立行情回执身份或时点无效');
   references.push(validateRawReference(r.rawEvidence));
  }
  for(const ref of references){
   const previousLength=referenceLengths.get(ref.sha256);
   if(previousLength!==undefined&&previousLength!==ref.byteLength)throw Error('相同原始行情哈希的回执长度冲突');
   referenceLengths.set(ref.sha256,ref.byteLength);
  }
  if(d.replayOf!=null){
   const original=byHash.get(d.replayOf);
   if(typeof d.replayOf!=='string'||!HASH.test(d.replayOf)||!original||original.data.status!=='quarantined'||
    seriesKey(original.data)!==key||original.data.dataVersion!==d.dataVersion||original.data.receivedAt!==d.receivedAt||
    original.data.rawEvidence.byteLength!==d.rawEvidence.byteLength||d.review?.reviewedAt!==event.recordedAt||
    d.review?.method!=='immutable-raw-original-import-gates'||typeof d.review.reviewerId!=='string'||!d.review.reviewerId.trim()||d.review.reviewerId.length>128||/[\x00-\x1f\x7f]/.test(d.review.reviewerId)||
    typeof d.review.reason!=='string'||d.review.reason.trim().length<8||d.review.reason.length>1000||/[\x00-\x1f\x7f]/.test(d.review.reason))
    throw Error('行情隔离回放来源或复核记录无效');
  }else if(d.review!=null)throw Error('行情复核缺少原隔离回执');
  if(d.gateRequirements.independentReferenceRequired)required.add(key);
  latest.set(key,event);if(!first.has(versionKey))first.set(versionKey,d.receivedAt);byHash.set(event.hash,event);
 }
 return events;
}
function readReceipts(root,{asOf=Date.now(),provider,datasetId,verifyRaw=false}={}){
 const events=validateMarketReceipts(store.readEvents(roots(root).events,{asOf}).filter(event=>event.data?.protocol===PROTOCOL));
 if(verifyRaw)verifyReceiptRaw(root,events);
 return events.filter(event=>(provider===undefined||event.data.provider===provider)&&(datasetId===undefined||event.data.datasetId===datasetId));
}

 // A valid blob hash proves bytes, not the truth of the accompanying claims.
 // Reuse the existing importer and consensus gates at original recorded clocks.
function verifyAdmittedContent(d,raw,referenceRaw){
 const decode=(bytes,label)=>{
  if(!Buffer.isBuffer(bytes))throw Error(label+'缺少原始字节');
  const text=bytes.toString('utf8');
  if(!Buffer.from(text,'utf8').equals(bytes))throw Error(label+'不是有效UTF-8');
  return JSON.parse(text);
 };
 const data=decode(raw,'原始行情回执'),validate=require('./market-data-center').validateImport;
 const details=validate(data,{provider:d.provider,datasetId:d.datasetId,now:d.receivedAt});
 if((data.observedAt??null)!==d.sourceObservedAt||
  (typeof data.factorVersion==='string'&&data.factorVersion.length<=128?data.factorVersion:null)!==d.factorVersion)
  throw Error('原始行情回执版本或供应商时点与原始数据不一致');
 if(d.scope?.firstDate!==details.firstDate||d.scope?.lastDate!==details.lastDate||
  d.scope?.stocks!==details.stocks||d.eventAt!==Date.parse(details.lastDate+'T15:00:00+08:00'))
  throw Error('原始行情回执范围或事件时点与原始数据不一致');
 if(d.independentReference){
  const metadata=d.independentReference,reference=decode(referenceRaw,'独立行情原回执');
  if(reference.provider!==metadata.provider||reference.datasetId!==metadata.datasetId||reference.observedAt!==metadata.observedAt||
   !validTime(reference.observedAt)||reference.observedAt>d.availableAt)
   throw Error('原归档独立来源身份或时点不一致');
  validate(reference,{provider:metadata.provider,datasetId:metadata.datasetId,now:d.availableAt});
  const consensus=require('./market-feed-consensus').compareMarketFeeds(data,reference);
  if(!consensus.consensus||consensus.evidenceQuality?.status!=='consistent-research-only')
   throw Error('原归档独立来源仍未通过既有一致性门禁');
 }
 return {data,details};
}
function verifyArchivedAdmission(root,event){
 const d=event.data;
 return verifyAdmittedContent(d,readRaw(root,d.rawEvidence),
  d.independentReference?readRaw(root,d.independentReference.rawEvidence):null);
}

function appendReceipt({root,raw,provider,datasetId,receivedAt,availableAt=receivedAt,status,reason=null,details=null,
  sourceObservedAt=null,factorVersion=null,replayOf=null,review=null,requestId,referenceRaw=null,referenceMetadata=null,independentReferenceRequired=false}){
 if(!validTime(receivedAt)||!validTime(availableAt)||receivedAt>availableAt||!['admitted','quarantined'].includes(status)||
    typeof independentReferenceRequired!=='boolean'||status==='admitted'&&independentReferenceRequired&&!referenceRaw)
  throw Error('行情回执时点或状态无效');
 // Validate every existing reference BEFORE saving a new hash. Checking only
 // the incoming blob would allow an append to hide corruption of an older raw
 // receipt, including an independent reference used for an earlier admission.
 const all=readReceipts(root,{verifyRaw:true}),events=all.filter(e=>e.data.provider===provider&&e.data.datasetId===datasetId),previous=events.at(-1);
 const rawEvidence=describeRaw(raw),independentReference=referenceRaw?{rawEvidence:describeRaw(referenceRaw),capturedAt:availableAt,
  provider:typeof referenceMetadata?.provider==='string'&&referenceMetadata.provider.length<=128?referenceMetadata.provider:null,
  datasetId:typeof referenceMetadata?.datasetId==='string'&&referenceMetadata.datasetId.length<=128?referenceMetadata.datasetId:null,
  observedAt:Number.isSafeInteger(referenceMetadata?.observedAt)?referenceMetadata.observedAt:null}:null,
  version=previous?.data.dataVersion===rawEvidence.sha256?previous.data.version:(previous?.data.version||0)+1,
  first=events.find(event=>event.data.dataVersion===rawEvidence.sha256);
 const data={protocol:PROTOCOL,provider,datasetId,status,reason,rawEvidence,dataVersion:rawEvidence.sha256,version,
  eventAt:details?.lastDate?Date.parse(details.lastDate+'T15:00:00+08:00'):null,originalAt:null,
  receivedAt,firstKnownAt:first?.data.firstKnownAt??receivedAt,availableAt,revisedAt:null,
  revisionDetectedAt:version>1?receivedAt:null,sourceObservedAt,factorVersion,
  scope:{provider,datasetId,firstDate:details?.firstDate||null,lastDate:details?.lastDate||null,stocks:details?.stocks||null},
  historicalCoverage:details?.historicalCoverage||null,independentReference,
  gateRequirements:{protocol:'original-market-import-gates-v1',independentReferenceRequired},replayOf,review,...store.FLAGS};
 // Default IDs are scoped to the exact provider/dataset. Retain compatibility
 // with previously saved default IDs, and replay exact retries using the
 // original derived version rather than recomputing it from a newer head.
 const legacyId='market-'+rawEvidence.sha256.slice(0,24)+'-'+availableAt+'-'+status;
 const scopedId='market-'+store.digest({provider,datasetId,sha256:rawEvidence.sha256,availableAt,status}).slice(0,64);
 const id=requestId||(events.some(e=>e.requestId===legacyId)?legacyId:scopedId),prior=all.find(e=>e.requestId===id);
 const semantic=d=>{const {version,firstKnownAt,revisionDetectedAt,...rest}=d;return rest;};
 if(prior&&store.digest(semantic(prior.data))!==store.digest(semantic(data)))throw Error('同请求ID内容冲突');
 if(!prior){
  validateMarketReceipts([...all,{kind:'diagnostic',recordedAt:availableAt,data,hash:null}]);
  if(status==='admitted'){
   const verified=verifyAdmittedContent(data,raw,referenceRaw);
   if(store.digest(data.historicalCoverage)!==store.digest(verified.details.historicalCoverage??null))
    throw Error('原始行情回执历史覆盖声明与原始数据不一致');
  }
 }
 saveRaw(root,raw);if(referenceRaw)saveRaw(root,referenceRaw);
 const payload=prior?.data??data;
 return store.appendEvent(roots(root,true).events,'diagnostic',payload,{requestId:id,now:availableAt,beforeCommitLocked:({events:current,reused})=>{
  const receipts=validateMarketReceipts(current.filter(e=>e.data?.protocol===PROTOCOL));
  const last=receipts.filter(e=>e.data.provider===provider&&e.data.datasetId===datasetId).at(-1);
  if(!reused&&(last?.hash??null)!==(previous?.hash??null))return false;
  verifyReceiptRaw(root,receipts);
  verifyReceiptRaw(root,[{data:payload}]);
  return true;
 }});
}
function readMarketDataEvidence({root,asOf=Date.now(),provider,datasetId}={}){
 const events=readReceipts(root,{asOf,provider,datasetId}),admitted=events.filter(event=>event.data.status==='admitted'),
  quarantine=events.filter(event=>event.data.status==='quarantined'),originalQuarantine=quarantine.filter(event=>!event.data.replayOf),
  versions=new Set(events.map(event=>event.data.dataVersion));
 verifyReceiptRaw(root,events);
 const latest=admitted.at(-1),verified=latest?verifyArchivedAdmission(root,latest):null;
 const resolved=new Set(admitted.map(event=>event.data.replayOf).filter(Boolean));
 return {schemaVersion:1,mode:'original-market-history-import-evidence',status:events.length?'observed-with-source-clock-gaps':'missing-data',
  asOf,receipts:events.length,dataVersions:versions.size,admitted:admitted.length,
  quarantined:quarantine.length,quarantineCases:originalQuarantine.length,
  unresolvedQuarantine:originalQuarantine.filter(event=>!resolved.has(event.hash)).length,
  latestVersion:admitted.at(-1)?.data.dataVersion||null,
  historicalCoverage:verified?.details.historicalCoverage||{status:'unknown',complete:false,verifiedExternal:false},
  entries:events.slice(-12).map(event=>({id:event.hash,recordedAt:event.recordedAt,...event.data,rawEvidence:{...event.data.rawEvidence}})),
  completePointInTime:false,missing:['供应商原始发布、修订时间和完整历史成分股覆盖尚未独立验证'],...store.FLAGS};
}
function readMarketDataAsOf({root,decisionAt,provider,datasetId}={}){
 if(!validTime(decisionAt)||typeof provider!=='string'||typeof datasetId!=='string')throw Error('行情历史回放需要明确时点及来源');
 const events=readReceipts(root,{asOf:decisionAt,provider,datasetId});
 // Verify the entire locally visible series, including earlier quarantine
 // and independent-reference blobs; a newer intact snapshot cannot hide
 // corruption in the historical inputs. Later raw versions stay out of scope.
 verifyReceiptRaw(root,events);
 const selected=events.filter(event=>event.data.status==='admitted').at(-1);
 if(!selected)return {status:'unavailable-at-decision',data:null,decisionAt,...store.FLAGS};
 const {data}=verifyArchivedAdmission(root,selected);
 return {status:'available-research-snapshot',data,decisionAt,archiveHash:selected.hash,version:selected.data.version,
  dataVersion:selected.data.dataVersion,receivedAt:selected.data.receivedAt,availableAt:selected.recordedAt,...store.FLAGS};
}
// Official background receipts are a second *kind of record* in the existing
// evidence journal and blob directory, not a second store or market feed.
const BACKGROUND_PROTOCOL='fayo-event-data-v1';
const day=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\d$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
function backgroundScope(provider,value){
 if(!value||Array.isArray(value)||typeof value!=='object')throw Error('背景数据范围无效');
 let keys,scope;
 if(provider==='ecb'){
  keys=['currency','start','end'];scope={currency:value.currency,start:value.start,end:value.end};
  if(typeof scope.currency!=='string'||!day(scope.start)||!day(scope.end))throw Error('ECB背景数据范围无效');
 }else if(provider==='sec-edgar'){
  keys=['cik','tag','unit','asOf'];scope={cik:value.cik,tag:value.tag,unit:value.unit,asOf:value.asOf};
  if(!Number.isSafeInteger(scope.cik)||scope.cik<1||scope.cik>9999999999||typeof scope.tag!=='string'||!/^[A-Za-z][A-Za-z0-9]{1,63}$/.test(scope.tag)||!['USD','shares','USD/shares'].includes(scope.unit)||!day(scope.asOf)||scope.asOf<'1994-01-01')throw Error('SEC背景数据范围无效');
 }else if(provider==='worldbank'){
  keys=['country','indicator','startYear','endYear'];scope={country:value.country,indicator:value.indicator,startYear:value.startYear,endYear:value.endYear};
 }else throw Error('未登记的官方背景数据来源');
 if(Object.keys(value).length!==keys.length||Object.keys(value).some(k=>!keys.includes(k)))throw Error('背景数据范围存在未知字段');
 return scope;
}
function backgroundProjection(provider,scope,raw,observedAt){
 if(!Buffer.isBuffer(raw)||!raw.length||!validTime(observedAt))throw Error('背景数据原回执无效');
 const text=raw.toString('utf8');
 if(!Buffer.from(text,'utf8').equals(raw))throw Error('背景数据原响应不是有效UTF-8');
 if(provider==='ecb'){
  require('./ecb-fx-daily').validate({...scope,now:observedAt});
  return require('./ecb-fx-daily').projectEcbCsv(text,{...scope,observedAt});
 }
 if(provider==='sec-edgar'){
  if(raw.length>12*1024*1024||scope.asOf>new Date(observedAt).toISOString().slice(0,10))throw Error('SEC背景数据范围或响应超限');
  return require('./sec-companyfacts').projectCompanyFact(JSON.parse(text),{...scope,now:observedAt});
 }
 if(raw.length>128*1024)throw Error('World Bank背景数据响应超限');
 require('./worldbank-indicators').validate({...scope,now:observedAt});
 return require('./worldbank-indicators').parseWorldBankResponse(JSON.parse(text),{...scope,observedAt});
}
function backgroundRoot(root){
 const dir=store.privateRoot(root);
 if(dir.split(path.sep).some(x=>['www','htdocs'].includes(x.toLowerCase())))throw Error('禁止公开背景数据存储');
 return dir;
}
const backgroundScopeId=(provider,scope)=>store.digest({provider,scope});
function backgroundEvents(root,asOf=Date.now()){
 const events=store.readEvents(roots(backgroundRoot(root)).events,{asOf}).filter(e=>e.data?.protocol===BACKGROUND_PROTOCOL);
 const latest=new Map(),first=new Map(),observations=new Set();
 for(const e of events){
  const d=e.data,scope=backgroundScope(d.provider,d.scope),scopeId=backgroundScopeId(d.provider,scope),p=latest.get(scopeId),versionKey=scopeId+':'+d.dataVersion;
  const same=p?.data.dataVersion===d.dataVersion,known=first.get(versionKey)??e.recordedAt;
  const observationKey=scopeId+':'+d.observedAt;
  if(d.scopeId!==scopeId||d.upstreamGroup!==d.provider||!validTime(d.requestStartedAt)||!validTime(d.observedAt)||d.requestStartedAt>d.observedAt||d.observedAt>e.recordedAt||d.availableAt!==e.recordedAt||
     d.sourcePublishedAt!==null||d.sourceRevisedAt!==null||d.sourceRevisionKnown!==false||d.firstKnownAt!==known||d.version!==(same?p.data.version:(p?.data.version??0)+1)||
     d.previousReceipt!==(p?.hash??null)||d.revisionDetectedAt!==(p&&!same?d.observedAt:null)||p&&p.data.observedAt>=d.observedAt||observations.has(observationKey)||
     !HASH.test(d.dataVersion||'')||d.dataVersion!==d.rawEvidence?.sha256||!HASH.test(d.projectionHash||'')||!['response-body','decoded-body-text'].includes(d.byteBasis)||
     Object.keys(store.FLAGS).some(k=>d[k]!==store.FLAGS[k]))throw Error('背景数据版本或时点链完整性无效');
  observations.add(observationKey);latest.set(scopeId,e);if(!first.has(versionKey))first.set(versionKey,e.recordedAt);
 }
 return events;
}
function readBackgroundReceipt(root,event){
 const d=event.data,raw=readRaw(root,d.rawEvidence),scope=backgroundScope(d.provider,d.scope);
 const data=backgroundProjection(d.provider,scope,raw,d.observedAt);
 if(store.digest(data)!==d.projectionHash)throw Error('背景数据投影哈希不一致');
 return data;
}
function appendBackgroundReceipt({root,provider,scope:input,raw,byteBasis,requestStartedAt,observedAt}={}){
 root=backgroundRoot(root);const scope=backgroundScope(provider,input),scopeId=backgroundScopeId(provider,scope);
 const lineage=require('./data-source-lineage').resolveUpstream(provider);
 if(!lineage.known||lineage.group!==provider||!validTime(requestStartedAt)||!validTime(observedAt)||requestStartedAt>observedAt||!['response-body','decoded-body-text'].includes(byteBasis))throw Error('背景数据来源或时点无效');
 const projection=backgroundProjection(provider,scope,raw,observedAt),dataVersion=sha(raw),projectionHash=store.digest(projection);
 // Validate the existing original journal/raw references before extending it.
 // The per-series predecessor is rechecked inside the original store lock.
 readReceipts(root,{verifyRaw:true});
 const events=backgroundEvents(root);for(const e of events)readBackgroundReceipt(root,e);
 const series=events.filter(e=>e.data.scopeId===scopeId),previous=series.at(-1),sameObservation=series.find(e=>e.data.observedAt===observedAt);
 if(sameObservation){
  const d=sameObservation.data;
  if(d.dataVersion!==dataVersion||d.projectionHash!==projectionHash||d.requestStartedAt!==requestStartedAt||d.byteBasis!==byteBasis)throw Error('同一背景数据观察时点存在冲突');
  return {...sameObservation,reused:true};
 }
 if(previous&&previous.data.observedAt>=observedAt)throw Error('背景数据观察时钟回退');
 const rawEvidence=saveRaw(root,raw),availableAt=Date.now();
 if(!validTime(availableAt)||availableAt<observedAt)throw Error('背景数据归档时钟回退');
 const same=previous?.data.dataVersion===dataVersion,first=series.find(e=>e.data.dataVersion===dataVersion);
 const data={protocol:BACKGROUND_PROTOCOL,provider,upstreamGroup:provider,scope,scopeId,rawEvidence,dataVersion,projectionHash,byteBasis,
  requestStartedAt,observedAt,availableAt,firstKnownAt:first?.recordedAt??availableAt,sourcePublishedAt:null,sourceRevisedAt:null,sourceRevisionKnown:false,
  revisionDetectedAt:previous&&!same?observedAt:null,version:same?previous.data.version:(previous?.data.version??0)+1,previousReceipt:previous?.hash??null,
  sourceTimePrecision:provider==='ecb'?'observation-date':provider==='sec-edgar'?'filing-date':'observation-year',verifiedExternal:false,verifiedLive:false,pointInTimeBacktestReady:false,...store.FLAGS};
 const requestId='background-'+store.digest({scopeId,observedAt,dataVersion}).slice(0,64);
 return store.appendEvent(roots(root,true).events,'diagnostic',data,{now:availableAt,requestId,beforeCommitLocked:({events:current,reused})=>{
  if(reused)return true;
  const last=current.filter(e=>e.data?.protocol===BACKGROUND_PROTOCOL&&e.data.scopeId===scopeId).at(-1);
  return (last?.hash??null)===(previous?.hash??null);
 }});
}
function readBackgroundAsOf({root,provider,scope:input,decisionAt}={}){
 root=backgroundRoot(root);if(!validTime(decisionAt))throw Error('背景数据历史查询时点无效');
 const scope=backgroundScope(provider,input),scopeId=backgroundScopeId(provider,scope),events=backgroundEvents(root,decisionAt);
 const series=events.filter(e=>e.data.scopeId===scopeId);
 // Verify the visible immutable raw receipt chain; future records must not
 // become available merely because their reporting dates are earlier.
 let data=null;for(const e of series)data=readBackgroundReceipt(root,e);
 const selected=series.at(-1);
 return {schemaVersion:1,protocol:BACKGROUND_PROTOCOL,status:selected?'available-research-snapshot':'unavailable-at-decision',provider,scope,decisionAt,
  receipt:selected?{hash:selected.hash,...selected.data}:null,data,visibleReceipts:series.length,verifiedExternal:false,verifiedLive:false,pointInTimeBacktestReady:false,...store.FLAGS};
}
function archiveBackgroundResult(result,{root,raw,byteBasis,scope}={}){
 if(root===undefined)return result;
 const e=appendBackgroundReceipt({root,provider:result.provider,scope,raw,byteBasis,requestStartedAt:result.requestStartedAt,observedAt:result.observedAt});
 return {...result,archiveReceipt:{hash:e.hash,scopeId:e.data.scopeId,dataVersion:e.data.dataVersion,version:e.data.version,availableAt:e.recordedAt,firstKnownAt:e.data.firstKnownAt,sourceRevisionKnown:false}};
}

// A report can inspect the latest locally available revision per scope without
// expanding the private raw data into the shared state or starting a collector.
function readBackgroundOverview({root,asOf=Date.now()}={}){
 const limit=12,maxBytes=24*1024*1024;
 const empty={schemaVersion:1,mode:'official-background-archive-overview',asOf,status:'unconfigured',visibleReceipts:null,totalScopes:null,
  checkedLatestReceipts:0,unverifiedScopes:null,rows:[],limit,rawVerificationScope:'latest-displayed-receipts-only',historicalRawChainsVerified:false,
  verifiedExternal:false,verifiedLive:false,pointInTimeBacktestReady:false,...store.FLAGS};
 if(root===undefined)return empty;
 try{
  if(!validTime(asOf))throw Error('背景数据历史查询时点无效');
  const directory=backgroundRoot(root);
  if(!fs.existsSync(directory))return {...empty,status:'missing-archive'};
  const events=backgroundEvents(directory,asOf),series=new Map();
  for(const event of events){const id=event.data.scopeId,previous=series.get(id);series.set(id,{event,count:(previous?.count||0)+1});}
  const selected=[...series.values()].sort((a,b)=>b.event.sequence-a.event.sequence).slice(0,limit);
  let bytes=0,checked=0;
  const rows=selected.map(({event,count})=>{
   const d=event.data,provider=d.provider;
   const row={provider,scopeId:d.scopeId,archiveHash:event.hash,dataVersion:d.dataVersion,version:d.version,visibleReceipts:count,
    observedAt:d.observedAt,availableAt:d.availableAt,firstKnownAt:d.firstKnownAt,revisionDetectedAt:d.revisionDetectedAt,
    sourcePublishedAt:null,sourceRevisedAt:null,scope:null,records:[],recordCount:null,missingValues:null,status:'unavailable'};
   const size=d.rawEvidence?.byteLength;
   if(!Number.isSafeInteger(size)||size<1||size>MAX_RAW)return row;
   if(bytes+size>maxBytes)return {...row,status:'not-checked-budget'};
   bytes+=size;
   try{
    const projected=readBackgroundReceipt(directory,event),records=provider==='sec-edgar'?projected.records:projected.rows;
    // Only known source fields cross this boundary, not raw responses, paths,
    // arbitrary metadata, or an inferred original publication timestamp.
    const values=records.slice(-5).map(r=>provider==='ecb'?{period:r.date,value:r.unitsPerEuro,unit:projected.currency+' / EUR'}:
     provider==='sec-edgar'?{period:r.reportedEnd,value:r.reportedValue,unit:r.unit,filedDate:r.filedDate,accession:r.accession}:
      {period:String(r.year),value:r.value,unit:null});
    const missingValues=records.filter(r=>(provider==='ecb'?r.unitsPerEuro:provider==='sec-edgar'?r.reportedValue:r.value)===null).length;
    checked++;
    return {...row,status:'verified-latest-receipt',scope:backgroundScope(provider,d.scope),byteBasis:d.byteBasis,
     sourceTimePrecision:provider==='ecb'?'observation-date':provider==='sec-edgar'?'filing-date':'observation-year',
     records:values,recordCount:records.length,missingValues};
   }catch{return row;}
  });
  const totalScopes=series.size;
  return {...empty,status:totalScopes?(checked===totalScopes?'available':'partial'):'empty',visibleReceipts:events.length,totalScopes,
   checkedLatestReceipts:checked,unverifiedScopes:totalScopes-checked,rows};
 }catch{return {...empty,status:'unavailable'};}
}
module.exports={PROTOCOL,BACKGROUND_PROTOCOL,readRaw,readReceipts,appendReceipt,readMarketDataEvidence,readMarketDataAsOf,appendBackgroundReceipt,readBackgroundAsOf,archiveBackgroundResult,readBackgroundOverview};
