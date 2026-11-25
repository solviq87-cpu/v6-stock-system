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
function readRaw(root,reference){
 if(!HASH.test(reference?.sha256||'')||!Number.isSafeInteger(reference.byteLength)||reference.byteLength<1||reference.byteLength>MAX_RAW)
  throw Error('原始行情回执引用无效');
 const {blobs}=roots(root),file=path.join(blobs,reference.sha256+'.bin'),
  fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
 try{
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.mode&0o077||stat.size!==reference.byteLength)throw Error('原始行情回执权限或长度无效');
  const raw=fs.readFileSync(fd);if(sha(raw)!==reference.sha256)throw Error('原始行情回执哈希不一致');return raw;
 }finally{fs.closeSync(fd);}
}
function saveRaw(root,raw){
 if(!Buffer.isBuffer(raw)||!raw.length||raw.length>MAX_RAW)throw Error('原始行情回执为空或超过容量');
 const {blobs}=roots(root,true),reference={sha256:sha(raw),byteLength:raw.length},target=path.join(blobs,reference.sha256+'.bin');
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
 return reference;
}
function verifyReceiptRaw(root,events){
 const verified=new Set();
 for(const event of events)for(const reference of [event.data.rawEvidence,event.data.independentReference?.rawEvidence].filter(Boolean)){
  if(verified.has(reference.sha256))continue;
  readRaw(root,reference);verified.add(reference.sha256);
 }
}
function readReceipts(root,{asOf=Date.now(),provider,datasetId,verifyRaw=false}={}){
 const events=store.readEvents(roots(root).events,{asOf}).filter(event=>event.data?.protocol===PROTOCOL);
 for(const event of events){
  const d=event.data;
  if(!['admitted','quarantined'].includes(d.status)||!validTime(d.receivedAt)||d.receivedAt>event.recordedAt||d.availableAt!==event.recordedAt||
     !HASH.test(d.dataVersion||'')||d.dataVersion!==d.rawEvidence?.sha256||typeof d.provider!=='string'||typeof d.datasetId!=='string'||
     d.gateRequirements?.protocol!=='original-market-import-gates-v1'||typeof d.gateRequirements.independentReferenceRequired!=='boolean'||
     d.status==='admitted'&&d.gateRequirements.independentReferenceRequired&&!d.independentReference)
   throw Error('行情回执时点、版本或来源完整性无效');
 }
 if(verifyRaw)verifyReceiptRaw(root,events);
 return events.filter(event=>(provider===undefined||event.data.provider===provider)&&(datasetId===undefined||event.data.datasetId===datasetId));
}
function appendReceipt({root,raw,provider,datasetId,receivedAt,availableAt=receivedAt,status,reason=null,details=null,
  sourceObservedAt=null,factorVersion=null,replayOf=null,review=null,requestId,referenceRaw=null,referenceMetadata=null,independentReferenceRequired=false}){
 if(!validTime(receivedAt)||!validTime(availableAt)||receivedAt>availableAt||!['admitted','quarantined'].includes(status)||
    typeof independentReferenceRequired!=='boolean'||status==='admitted'&&independentReferenceRequired&&!referenceRaw)
  throw Error('行情回执时点或状态无效');
 // Validate every existing reference BEFORE saving a new hash. Checking only
 // the incoming blob would allow an append to hide corruption of an older raw
 // receipt, including an independent reference used for an earlier admission.
 const events=readReceipts(root,{provider,datasetId,verifyRaw:true}),previous=events.at(-1);
 const rawEvidence=saveRaw(root,raw),independentReference=referenceRaw?{rawEvidence:saveRaw(root,referenceRaw),capturedAt:availableAt,
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
 return store.appendEvent(roots(root,true).events,'diagnostic',data,
  {requestId:requestId||'market-'+rawEvidence.sha256.slice(0,24)+'-'+availableAt+'-'+status,now:availableAt});
}
function readMarketDataEvidence({root,asOf=Date.now(),provider,datasetId}={}){
 const events=readReceipts(root,{asOf,provider,datasetId}),admitted=events.filter(event=>event.data.status==='admitted'),
  quarantine=events.filter(event=>event.data.status==='quarantined'),originalQuarantine=quarantine.filter(event=>!event.data.replayOf),
  versions=new Set(events.map(event=>event.data.dataVersion));
 verifyReceiptRaw(root,events);
 const resolved=new Set(admitted.map(event=>event.data.replayOf).filter(Boolean));
 return {schemaVersion:1,mode:'original-market-history-import-evidence',status:events.length?'observed-with-source-clock-gaps':'missing-data',
  asOf,receipts:events.length,dataVersions:versions.size,admitted:admitted.length,
  quarantined:quarantine.length,quarantineCases:originalQuarantine.length,
  unresolvedQuarantine:originalQuarantine.filter(event=>!resolved.has(event.hash)).length,
  latestVersion:admitted.at(-1)?.data.dataVersion||null,
  historicalCoverage:admitted.at(-1)?.data.historicalCoverage||{status:'unknown',complete:false,verifiedExternal:false},
  entries:events.slice(-12).map(event=>({id:event.hash,recordedAt:event.recordedAt,...event.data,rawEvidence:{...event.data.rawEvidence}})),
  completePointInTime:false,missing:['供应商原始发布、修订时间和完整历史成分股覆盖尚未独立验证'],...store.FLAGS};
}
function readMarketDataAsOf({root,decisionAt,provider,datasetId}={}){
 if(!validTime(decisionAt)||typeof provider!=='string'||typeof datasetId!=='string')throw Error('行情历史回放需要明确时点及来源');
 const selected=readReceipts(root,{asOf:decisionAt,provider,datasetId}).filter(event=>event.data.status==='admitted').at(-1);
 if(!selected)return {status:'unavailable-at-decision',data:null,decisionAt,...store.FLAGS};
 const data=JSON.parse(readRaw(root,selected.data.rawEvidence).toString('utf8'));
 require('./market-data-center').validateImport(data,{provider,datasetId,now:selected.data.receivedAt});
 if(selected.data.independentReference){
  const reference=JSON.parse(readRaw(root,selected.data.independentReference.rawEvidence).toString('utf8')),
   consensus=require('./market-feed-consensus').compareMarketFeeds(data,reference);
  if(!consensus.consensus||consensus.evidenceQuality?.status!=='consistent-research-only'||reference.observedAt>selected.recordedAt)
   throw Error('原归档独立来源仍未通过既有一致性门禁');
 }
 return {status:'available-research-snapshot',data,decisionAt,archiveHash:selected.hash,version:selected.data.version,
  dataVersion:selected.data.dataVersion,receivedAt:selected.data.receivedAt,availableAt:selected.recordedAt,...store.FLAGS};
}
module.exports={PROTOCOL,readRaw,readReceipts,appendReceipt,readMarketDataEvidence,readMarketDataAsOf};
