'use strict';
// Completed public scan responses are display evidence, never execution state.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {quoteSnapshotFields,quoteObservationView}=require('./quote-observation-view');
const kinds=new Set(['quant','auction']),boards=new Set(['all','main','gem']);
const forbidden=/secret|token|password|credential|cookie|account|cash|balance|holding|webhook|private|sentinel/i;
const fields=['asOf','board','totalScanned','candidateCount','count','items','sectorView','note','auctionEvidence','isSnapshot'];
const MAX_BYTES=16*1024*1024;
const dayOf=at=>Number.isSafeInteger(at)&&at>0&&at<8e15?new Date(at+28800000).toISOString().slice(0,10).replaceAll('-',''):'';
const validDay=day=>typeof day==='string'&&/^\d{8}$/.test(day)&&dayOf(Date.parse(day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6)+'T04:00:00Z'))===day;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const denied=new Set(['canTrade','canNotify','verifiedLive','canTrain','autoPromotion','canExecute']);
function clean(v,depth=0){
 if(depth>16)return undefined;
 if(v==null||typeof v==='string'||typeof v==='boolean')return v;
 if(typeof v==='number')return Number.isFinite(v)?v:null;
 if(Array.isArray(v))return v.slice(0,8000).map(x=>clean(x,depth+1)).filter(x=>x!==undefined);
 if(typeof v!=='object')return undefined;
 const result={};
 for(const [key,value] of Object.entries(v)){
  if(forbidden.test(key)||['__proto__','constructor','prototype'].includes(key))continue;
  const next=clean(value,depth+1);
  if(next!==undefined)result[key]=denied.has(key)?false:next;
 }
 return result;
}
function copyResponse(value){
 return Object.fromEntries(fields.filter(k=>Object.hasOwn(value,k)).map(k=>[k,clean(value[k])]));
}
function belongs(row,board){
 return object(row)&&typeof row.code==='string'&&/^\d{6}$/.test(row.code)&&
  (board==='all'||(board==='main'?/^(00|60)\d{4}$/:/^30\d{4}$/).test(row.code));
}
function validResponse(response,board,day){
 return object(response)&&response.board===board&&validDay(day)&&dayOf(response.asOf)===day&&
  !response.locked&&!response.needAuth&&!response.error&&!response.snapshotRetained&&!response.displayOnly&&!response.boardFallback&&
  Array.isArray(response.items)&&response.items.length>0&&response.items.length<=8000&&
  response.items.every(row=>belongs(row,board))&&new Set(response.items.map(row=>row.code)).size===response.items.length&&
  (response.sectorView==null||Array.isArray(response.sectorView)&&response.sectorView.length<=8000&&
   response.sectorView.every(group=>object(group)&&Array.isArray(group.picks)&&group.picks.length<=8000&&group.picks.every(row=>belongs(row,'all'))));
}
function sanitizeResponse(response){
 const result=copyResponse(response);
 result.items=result.items.map(row=>({...row,...quoteSnapshotFields(row),canTrade:false,canNotify:false,verifiedLive:false,canTrain:false}));
 if(Array.isArray(result.sectorView))result.sectorView=result.sectorView.map(group=>({...group,picks:group.picks.map(row=>({...row,canTrade:false,canNotify:false,verifiedLive:false,canTrain:false}))}));
 return result;
}
function readFile(file){
 let fd;
 try{
  fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  const before=fs.fstatSync(fd);
  if(!before.isFile()||before.size>MAX_BYTES)throw Error('invalid snapshot file');
  // Read the original bounded length plus one byte to reject growth.
  const bytes=Buffer.alloc(before.size+1);let total=0;
  while(total<bytes.length){const n=fs.readSync(fd,bytes,total,bytes.length-total,total);if(!n)break;total+=n;}
  const after=fs.fstatSync(fd),current=fs.lstatSync(file);
  if(total!==before.size||after.size!==before.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||
   current.isSymbolicLink()||current.dev!==after.dev||current.ino!==after.ino||current.size!==after.size||
   current.mtimeMs!==after.mtimeMs||current.ctimeMs!==after.ctimeMs)throw Error('snapshot changed during read');
  return JSON.parse(bytes.subarray(0,total).toString('utf8'));
 }finally{if(fd!==undefined)fs.closeSync(fd);}
}
function createMarketResponseSnapshot({file,clock=Date.now,onError=()=>{}}={}){
 let saved={};
 if(file)try{
  const parsed=readFile(file);
  if(!object(parsed)||![1,2].includes(parsed.schemaVersion)||!object(parsed.entries)||
    parsed.schemaVersion===2&&digest({schemaVersion:2,entries:parsed.entries})!==parsed.fingerprint)
   throw Error('snapshot schema or fingerprint invalid');
  for(const [key,entry] of Object.entries(parsed.entries)){
   const parts=key.split(':'),[kind,board]=parts;
   if(parts.length!==2||!kinds.has(kind)||!boards.has(board)||!validResponse(entry?.response,board,entry?.day)){
    onError('market-response-snapshot-read');continue;
   }
   saved[key]={day:entry.day,response:sanitizeResponse(entry.response)};
  }
 }catch(error){if(error.code!=='ENOENT')onError('market-response-snapshot-read');}
 function remember(kind,board,response,{day,now=clock()}={}){
  if(!kinds.has(kind)||!boards.has(board)||!dayOf(now)||day>dayOf(now)||!validResponse(response,board,day)||response.asOf>now)return false;
  const key=kind+':'+board,old=saved[key];
  if(old&&(old.day>day||(old.day===day&&old.response.asOf>=response.asOf)))return false;
  const next={day,response:sanitizeResponse(response)};
  const entries={...saved,[key]:next};
  if(file){let temp;
   try{
    const payload={schemaVersion:2,entries},data=JSON.stringify({...payload,fingerprint:digest(payload)});
    if(Buffer.byteLength(data,'utf8')>MAX_BYTES)throw Error('snapshot too large');
    fs.mkdirSync(path.dirname(file),{recursive:true});
    temp=file+'.'+process.pid+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';
    fs.writeFileSync(temp,data,{flag:'wx',mode:0o600});fs.renameSync(temp,file);temp=null;
   }catch{onError('market-response-snapshot-write');}
   finally{if(temp)try{fs.unlinkSync(temp);}catch{}}
  }
  saved=entries;return true;
 }
 function read(kind,board,{max=20,now=clock()}={}){
  if(!kinds.has(kind)||!boards.has(board)||!dayOf(now))return null;
  const available=e=>e&&e.day<=dayOf(now)&&e.response.asOf<=now;
  const exact=saved[kind+':'+board],all=saved[kind+':all'];
  const entry=available(exact)?exact:available(all)?all:null;
  if(!entry)return null;
  const isExact=entry===exact,result=copyResponse(entry.response);
  const limit=Number.isFinite(max)?Math.max(1,Math.min(50,Math.floor(max))):20;
  const retainedRow=row=>{
   const view=quoteObservationView(row,now);
   return {...row,quoteStatus:view.quoteStatus,quoteAgeMs:view.quoteAgeMs,quoteFreshness:view.freshness,
    canTrade:false,canNotify:false,verifiedLive:false,canTrain:false,snapshotDisplayOnly:true};
  };
  result.items=result.items.filter(row=>belongs(row,board)).slice(0,limit).map(retainedRow);
  result.sectorView=(result.sectorView||[]).map(group=>({...group,picks:group.picks.filter(row=>belongs(row,board)).map(retainedRow)})).filter(group=>group.picks.length);
  return {...result,board,isSnapshot:true,snapshotRetained:true,snapshotDay:entry.day,
   snapshotAgeMs:now-result.asOf,snapshotSameDay:entry.day===dayOf(now),snapshotFreshness:'historical-display-only',
   canTrade:false,canNotify:false,verifiedLive:false,canTrain:false,displayOnly:true,
   ...((kind==='auction'||!isExact)?{count:result.items.length}:{}),
   ...(!isExact?{sourceBoard:'all',completeForBoard:false,boardFallback:true}:{}),
   note:`休市保留 ${entry.day.slice(0,4)}-${entry.day.slice(4,6)}-${entry.day.slice(6)} 完成的扫描结果。${!isExact?'当前板块从已保存的全部市场结果筛选，覆盖范围以现有记录为准。':''}${result.note||''}`};
 }
 return {remember,read};
}
module.exports={createMarketResponseSnapshot};
