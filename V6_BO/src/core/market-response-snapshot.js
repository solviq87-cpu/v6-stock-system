'use strict';
// Completed public scan responses are display evidence, never execution state.
const fs=require('node:fs');
const path=require('node:path');
const {quoteSnapshotFields}=require('./quote-observation-view');
const kinds=new Set(['quant','auction']);
const boards=new Set(['all','main','gem']);
const forbidden=/secret|token|password|credential|cookie|account|cash|balance|holding|webhook|private|sentinel/i;
const fields=['asOf','board','totalScanned','candidateCount','count','items','sectorView','note','auctionEvidence','isSnapshot'];
const dayOf=at=>Number.isSafeInteger(at)&&at>0&&at<8e15?new Date(at+28800000).toISOString().slice(0,10).replaceAll('-',''):'';
const validDay=day=>typeof day==='string'&&/^\d{8}$/.test(day)&&dayOf(Date.parse(day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6)+'T04:00:00Z'))===day;
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
  if(next!==undefined)result[key]=(key==='canTrade'||key==='canNotify')?false:next;
 }
 return result;
}
function copyResponse(value){
 return Object.fromEntries(fields.filter(k=>k in value).map(k=>[k,clean(value[k])]));
}
function belongs(row,board){
 return board==='all'||(board==='main'?/^(00|60)\d{4}$/:/^30\d{4}$/).test(row?.code||'');
}
function createMarketResponseSnapshot({file,clock=Date.now,onError=()=>{}}={}){
 let saved={};
 try{
  const stat=fs.statSync(file);
  if(!stat.isFile()||stat.size>16*1024*1024)throw Error('invalid snapshot file');
  const parsed=JSON.parse(fs.readFileSync(file,'utf8'));
  if(parsed?.schemaVersion===1&&parsed.entries&&typeof parsed.entries==='object'){
   for(const [key,entry] of Object.entries(parsed.entries)){
    const [kind,board]=key.split(':');
    if(kinds.has(kind)&&boards.has(board)&&validDay(entry?.day)&&dayOf(entry?.response?.asOf)===entry.day&&
       Array.isArray(entry.response.items)&&entry.response.items.length&&entry.response.items.length<=8000)
     saved[key]={day:entry.day,response:copyResponse(entry.response)};
   }
  }
 }catch(error){if(error.code!=='ENOENT')onError('market-response-snapshot-read');}
 function remember(kind,board,response,{day,now=clock()}={}){
  if(!kinds.has(kind)||!boards.has(board)||!validDay(day)||day>dayOf(now)||
     dayOf(response?.asOf)!==day||response?.asOf>now||response?.board!==board||response?.locked||response?.needAuth||response?.error||
     !Array.isArray(response?.items)||!response.items.length||response.items.length>8000)return false;
  const key=kind+':'+board,old=saved[key];
  if(old&&(old.day>day||(old.day===day&&old.response.asOf>response.asOf)))return false;
  const next={day,response:copyResponse(response)};
  // These rows are never fed to a price store, but retain a local use denial as
  // well so future display consumers cannot mistake a restored copy for live.
  next.response.items=next.response.items.map(row=>({...row,...quoteSnapshotFields(row),canTrade:false,canNotify:false}));
  saved={...saved,[key]:next};
  if(file){try{
   fs.mkdirSync(path.dirname(file),{recursive:true});
   const temp=file+'.'+process.pid+'.tmp';
   fs.writeFileSync(temp,JSON.stringify({schemaVersion:1,entries:saved}),{mode:0o600});
   fs.renameSync(temp,file);
  }catch{onError('market-response-snapshot-write');}}
  return true;
 }
 function read(kind,board,{max=20,now=clock()}={}){
  if(!kinds.has(kind)||!boards.has(board))return null;
  const exact=saved[kind+':'+board];
  const entry=exact||saved[kind+':all'];
  if(!entry||entry.day>dayOf(now)||entry.response.asOf>now)return null;
  const result=copyResponse(entry.response);
  const limit=Number.isFinite(max)?Math.max(1,Math.min(50,Math.floor(max))):20;
  result.items=result.items.filter(row=>belongs(row,board)).slice(0,limit);
  result.sectorView=(result.sectorView||[]).map(group=>({...group,picks:(group.picks||[]).filter(row=>belongs(row,board))})).filter(group=>group.picks.length);
  return {...result,board,isSnapshot:true,snapshotRetained:true,snapshotDay:entry.day,
   canTrade:false,canNotify:false,displayOnly:true,
   ...((kind==='auction'||!exact)?{count:result.items.length}:{}),
   ...(!exact?{sourceBoard:'all',completeForBoard:false,boardFallback:true}:{}),
   note:`休市保留 ${entry.day.slice(0,4)}-${entry.day.slice(4,6)}-${entry.day.slice(6)} 完成的扫描结果。${!exact?'当前板块从已保存的全部市场结果筛选，覆盖范围以现有记录为准。':''}${result.note||''}`};
 }
 return {remember,read};
}
module.exports={createMarketResponseSnapshot};
