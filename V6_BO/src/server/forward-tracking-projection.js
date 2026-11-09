'use strict';
/**
 * Opt-in projection into the already-authorized GET /api/quant-picks result.
 * Never creates a separate unauthenticated endpoint and never performs scanning.
 */
const {readSnapshot}=require('../core/forward-tracking-store');
const zlib=require('node:zlib');
const MAX_RESPONSE=2*1024*1024;
function joinAuthorizedFollowup(candidateBody,stored){
 if(!candidateBody||typeof candidateBody!=='object'||candidateBody.locked===true||
  candidateBody.ok===false||candidateBody.isMock===true||candidateBody.simulated===true||
  !Array.isArray(candidateBody.items)||candidateBody.items.length>500||
  !stored||stored.report?.feed?.source!=='imported')
  return null;
 const codes=new Set(candidateBody.items.map(x=>String(x?.code||x?.symbol||'')).
  filter(x=>/^\d{6}$/.test(x)));
 if(!codes.size)return null;
 // The server response (after its existing auth gate) defines what this viewer
 // can see; never leak other codes or private portfolio fields from the archive.
 const records=stored.report.records.filter(r=>codes.has(r.symbol));
 if(!records.length)return null;
 const report={...stored.report,records,groups:[],warning:
  '仅展示原选股接口可见股票的冻结信号价格观察；非净收益，未认证实时，非策略有效性结论'};
 return {...candidateBody,forwardTracking:report};
}
function decorateQuantPicksResponse(res,{stateFile}={}){
 if(typeof stateFile!=='string'||!stateFile)return;
 const end=res.end,write=res.write,writeHead=res.writeHead;
 let lastExplicitHeaders=null;
 // server.js json() uses writeHead(headers) instead of setHeader(); Node does
 // NOT expose writeHead-only fields via getHeader(). Capture, never alter them.
 res.writeHead=function(...args){
  const headers=typeof args[1]==='string'?args[2]:args[1];
  const captured=new Map();
  if(Array.isArray(headers)){
   for(let i=0;i+1<headers.length;i+=2)
    captured.set(String(headers[i]).toLowerCase(),headers[i+1]);
  }else if(headers&&typeof headers==='object'){
   for(const [name,value] of Object.entries(headers))
    captured.set(name.toLowerCase(),value);
  }
  lastExplicitHeaders=captured;
  return writeHead.apply(this,args);
 };
 const header=name=>lastExplicitHeaders?.get(name)??res.getHeader(name);
 let wrote=false;
 res.write=function(...args){wrote=true;return write.apply(this,args);};
 res.end=function(chunk,encoding,callback){
  res.end=end;res.write=write;res.writeHead=writeHead;
  if(wrote||res.statusCode!==200||res.writableEnded||res.destroyed||
    header('content-length')!==undefined||
    !/application\/json/i.test(String(header('content-type')||''))||
    (typeof chunk!=='string'&&!Buffer.isBuffer(chunk)))
   return end.call(this,chunk,encoding,callback);
  // The production json() helper compresses larger candidate lists before
  // res.end(). Unwrap bounded gzip data, join the report, then restore gzip
  // rather than silently dropping forwardTracking on ordinary browsers.
  const contentEncoding=String(header('content-encoding')||'').toLowerCase();
  if(contentEncoding&&contentEncoding!=='gzip')
   return end.call(this,chunk,encoding,callback);
  let raw;
  if(contentEncoding==='gzip'){
   if(!Buffer.isBuffer(chunk)||chunk.length>MAX_RESPONSE)
    return end.call(this,chunk,encoding,callback);
   try{raw=zlib.gunzipSync(chunk,{maxOutputLength:MAX_RESPONSE+1}).toString('utf8');}
   catch{return end.call(this,chunk,encoding,callback);}
  }else raw=Buffer.isBuffer(chunk)?chunk.toString('utf8'):chunk;
  if(Buffer.byteLength(raw)>MAX_RESPONSE)return end.call(this,chunk,encoding,callback);
  try{
   const original=JSON.parse(raw);
   const stored=readSnapshot(stateFile);
   const joined=joinAuthorizedFollowup(original,stored);
   if(joined){
    const updated=JSON.stringify(joined);
    if(Buffer.byteLength(updated)<=MAX_RESPONSE){
     const cb=typeof encoding==='function'?encoding:callback;
     if(contentEncoding==='gzip'){
      const zipped=zlib.gzipSync(Buffer.from(updated,'utf8'));
      return end.call(this,zipped,cb);
     }
     return end.call(this,updated,'utf8',cb);
    }
   }
  }catch(_){
   // Corrupt or absent archives never break the existing stock selection API.
   // Unverified data is omitted rather than presented as a current observation.
  }
  return end.call(this,chunk,encoding,callback);
 };
}
module.exports={decorateQuantPicksResponse,joinAuthorizedFollowup};
