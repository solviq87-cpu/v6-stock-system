'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const time=value=>Number.isSafeInteger(value)&&value>0&&value<8e15;
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const numberFields=['mainInflow','superInflow','bigInflow','pct','upCount','downCount','totalCount','observedDirectionalCount','leaderPct'];
const textFields=['code','name','sector','category','kind','leader','leaderCode','source','upstream','fundsMethod','fundsUnit','unit','mode','freshness','missingReason'];
function normalizeDay(value){
 if(typeof value!=='string')return null;
 const day=value.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),at=Date.parse(day+'T00:00:00Z');
 return /^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(at)&&new Date(at).toISOString().slice(0,10)===day?day:null;
}
function projectSectors(snapshot,{day,now=Date.now()}={}){
 day=normalizeDay(day);
 const sourceDay=normalizeDay(snapshot?.sectorsDay||snapshot?.day),sourceRows=Array.isArray(snapshot?.rows)?snapshot.rows:snapshot?.sectors;
 if(!day||sourceDay!==day||!Array.isArray(sourceRows)||sourceRows.length>2000)return {rows:[],input:0,rejected:0,unknownSourceTime:0};
 const industry=new Set((snapshot.ind||snapshot.sectorsInd||[]).map(row=>row?.code)),rows=new Map(),conflicts=new Set();
 let rejected=0,unknownSourceTime=0;
 for(const original of sourceRows){
  const source=original?.source||original?.upstream,at=original?.retrievedAt,declared=original?.tradeDate||original?.sourceTradeDate;
  const aliases=[original?.source,original?.upstream,original?.fundsSource].filter(v=>v!=null);
  const units=[original?.fundsUnit,original?.unit].filter(v=>v!=null);
  const amountAliases=[original?.mainInflowYuan,original?.netInflowYuan].filter(v=>v!=null);
  const inconsistent=aliases.some(v=>typeof v!=='string'||v!==source)||units.some(v=>v!=='CNY')||
   amountAliases.some(v=>!finite(v)||v!==original?.mainInflow)||
   original?.fundsConflict===true||original?.fundsSourceConflict===true||
   original?.tradeDate!=null&&original?.sourceTradeDate!=null&&normalizeDay(original.tradeDate)!==normalizeDay(original.sourceTradeDate)||
   original?.fundsSourceTimestamp!=null&&original.fundsSourceTimestamp!==original.sourceTimestamp||
   original?.fundsRetrievedAt!=null&&original.fundsRetrievedAt!==at;
  if(inconsistent){rejected++;continue;}
  if(!original||typeof original.name!=='string'||!original.name.trim()||
   typeof source!=='string'||!source.trim()||/mock|synthetic|fixture|simulated|demo/i.test(source)||
   ['mock','synthetic','fixture','simulated'].some(key=>original[key]===true)||
   (original.fundsUnit||original.unit)!=='CNY'||original.fundsMethod!=='vendor-order-size-estimate'||
   !time(at)||at>now||at<Date.parse(day+'T00:00:00+08:00')||declared&&normalizeDay(declared)!==day||
   original.sourceTimestamp!=null&&(!time(original.sourceTimestamp)||original.sourceTimestamp>at||
    new Date(original.sourceTimestamp+28800000).toISOString().slice(0,10)!==day)){rejected++;continue;}
  const row={};
  for(const key of textFields)if(typeof original[key]==='string')row[key]=original[key].slice(0,160);
  for(const key of numberFields)row[key]=finite(original[key])?original[key]:null;
  Object.assign(row,{source,retrievedAt:at,sourceTimestamp:original.sourceTimestamp??null,
   tradeDate:declared?normalizeDay(declared):null,snapshotDay:day,
   dateBasis:declared?'供应商原始交易日':'既有板块快照归属日；供应商未提供逐行交易日',
   category:industry.has(original.code)?'industry':row.category||row.kind||'unknown',canTrade:false,canNotify:false});
  const key=row.code||row.name,previous=rows.get(key);
  if(previous&&previous.retrievedAt===row.retrievedAt&&hash(previous)!==hash(row)){conflicts.add(key);continue;}
  if(!previous||row.retrievedAt>previous.retrievedAt)rows.set(key,row);
 }
 for(const key of conflicts){rows.delete(key);rejected++;}
 const result=[...rows.values()];unknownSourceTime=result.filter(row=>row.sourceTimestamp===null).length;
 return {rows:result,input:sourceRows.length,rejected,unknownSourceTime};
}

function safeRoot(root,create=false){
 if(typeof root!=='string'||!path.isAbsolute(root)||root===path.parse(root).root||root.includes('\0')||root.split(path.sep).includes('public'))throw Error('板块证据目录无效');
 let current=path.parse(root).root;
 for(const part of root.slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);
  try{const st=fs.lstatSync(current);if(st.isSymbolicLink()||!st.isDirectory())throw Error('板块证据目录含符号链接或非目录');}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
 if(create)fs.mkdirSync(root,{recursive:true,mode:0o700});
}
function readSnapshot(file){
 let fd;
 try{
  fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));const st=fs.fstatSync(fd);
  if(!st.isFile()||st.size>2*1024*1024)throw Error('板块快照类型或大小无效');
  return JSON.parse(fs.readFileSync(fd,'utf8'));
 }catch(error){if(error.code==='ENOENT')return null;throw error;}
 finally{if(fd!==undefined)fs.closeSync(fd);}
}
function createDecisionSectorContext({root,readCurrent=()=>null,readRetained=()=>[],canWrite=()=>false,clock=Date.now}={}){
 safeRoot(root);
 function read(day){
  const now=clock();day=normalizeDay(day);
  if(!day||day>new Date(now+28800000).toISOString().slice(0,10))throw Error('板块读取日期无效或尚未发生');
  safeRoot(root);
  const saved=readSnapshot(path.join(root,day+'.json'));
  if(saved){const {fingerprint,...payload}=saved;
   if(saved.schemaVersion!==1||saved.day!==day||hash(payload)!==fingerprint)throw Error('板块历史证据校验失败');}
  const sources=[readCurrent(),...(readRetained()||[]),saved].filter(Boolean);
  const projected=sources.map(snapshot=>projectSectors(snapshot,{day,now}));
  const valid=projected.filter(value=>value.rows.length).sort((a,b)=>
   Math.max(...b.rows.map(row=>row.retrievedAt))-Math.max(...a.rows.map(row=>row.retrievedAt))||b.rows.length-a.rows.length)[0];
  const selected=valid||{rows:[],input:0,rejected:projected.reduce((sum,p)=>sum+p.rejected,0),unknownSourceTime:0};
  return {ok:true,day,sectorsDay:day,rows:selected.rows,
   coverage:{input:selected.input,returned:selected.rows.length,rejected:selected.rejected,unknownSourceTime:selected.unknownSourceTime,
    scope:'既有同日行业与概念板块原始资金快照'},
   missing:!selected.rows.length?['未留存 '+day+' 带来源、人民币单位与实际取得时间的板块快照；本次读取不触发补采']:
    selected.unknownSourceTime?['部分板块源端资金时刻未提供；快照归属日与实际取得时间分别展示']:[],
   canTrade:false,canNotify:false};
 }
 function capture(snapshot){
  if(!canWrite())return {saved:false,reason:'read-only-instance'};
  const now=clock(),day=normalizeDay(snapshot?.day||snapshot?.sectorsDay);
  if(!day||day>new Date(now+28800000).toISOString().slice(0,10))return {saved:false,reason:'invalid-day'};
  const projected=projectSectors(snapshot,{day,now});if(!projected.rows.length)return {saved:false,reason:'missing-evidence'};
  safeRoot(root,true);const file=path.join(root,day+'.json'),previous=readSnapshot(file);
  if(previous){const {fingerprint,...payload}=previous;
   if(previous.schemaVersion!==1||previous.day!==day||hash(payload)!==fingerprint)throw Error('板块历史证据损坏，拒绝覆盖');
   if(Math.max(...previous.rows.map(row=>row.retrievedAt))>=Math.max(...projected.rows.map(row=>row.retrievedAt)))return {saved:false,reason:'already-recorded'};
  }
  const payload={schemaVersion:1,day,recordedAt:now,rows:projected.rows,coverage:{input:projected.input,rejected:projected.rejected},canTrade:false};
  const record={...payload,fingerprint:hash(payload)},temp=file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';
  try{
   fs.writeFileSync(temp,JSON.stringify(record)+'\n',{flag:'wx',mode:0o600});
   if(!canWrite())return {saved:false,reason:'role-changed'};
   fs.renameSync(temp,file);return {saved:true,day,count:record.rows.length};
  }finally{try{fs.unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
 }
 return {read,capture};
}
module.exports={createDecisionSectorContext,projectSectors,readSnapshot};
