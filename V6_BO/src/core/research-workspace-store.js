'use strict';
// Private append-only research history. It never owns accounts or production settings.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {withAccountLock}=require('./account-process-lock');
const FLAGS={researchOnly:true,canTrade:false,canNotify:false,productionWeightsChanged:false};
const MAX_EVENTS=2000,MAX_EVENT=2*1024*1024,MAX_TOTAL=128*1024*1024;
function canonical(value,depth=0){
 if(depth>32)throw Error('研究记录嵌套超限');
 if(value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number'&&Number.isFinite(value))return value;
 if(Array.isArray(value)){if(value.length>10000)throw Error('研究记录数组超限');return value.map(v=>canonical(v,depth+1));}
 if(value&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value))){
  const out={};for(const k of Object.keys(value).sort()){
   if(['__proto__','prototype','constructor'].includes(k))throw Error('研究字段无效');
   if(value[k]!==undefined)out[k]=canonical(value[k],depth+1);
  }return out;
 }throw Error('研究记录必须为有限JSON数据');
}
const encode=value=>JSON.stringify(canonical(value));
const digest=value=>crypto.createHash('sha256').update(encode(value)).digest('hex');
function privateRoot(root,create=false){
 if(typeof root!=='string'||!path.isAbsolute(root)||root.includes('\0'))throw Error('研究存储需要私有绝对路径');
 const full=path.resolve(root);if(full===path.parse(full).root||full.split(path.sep).some(p=>p.toLowerCase()==='public'))throw Error('禁止公开研究存储');
 let at=path.parse(full).root;
 for(const p of full.slice(at.length).split(path.sep).filter(Boolean)){
  at=path.join(at,p);try{const s=fs.lstatSync(at);if(s.isSymbolicLink()||!s.isDirectory())throw Error('研究路径禁止符号链接');}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 if(create)fs.mkdirSync(full,{recursive:true,mode:0o700});
 if(fs.existsSync(full)&&fs.statSync(full).mode&0o077)throw Error('研究目录须为0700');
 return full;
}
function readEvents(root,{asOf=Date.now()}={}){
 if(!Number.isSafeInteger(asOf)||asOf<=0||asOf>Date.now())throw Error('研究查询时点无效');
 const dir=privateRoot(root);if(!fs.existsSync(dir))return [];
 const names=fs.readdirSync(dir).filter(n=>n!=='workspace.guard'&&!/^\.stage-[a-f0-9]{24}$/.test(n)).sort();
 if(names.length>MAX_EVENTS||names.some(n=>!/^\d{6}\.json$/.test(n)))throw Error('研究历史目录损坏或超限');
 let previous=null,bytes=0;const out=[];
 for(const [i,name]of names.entries()){
  if(name!==String(i+1).padStart(6,'0')+'.json')throw Error('研究历史链缺失');
  const file=path.join(dir,name),fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));let e;
  try{const s=fs.fstatSync(fd);bytes+=s.size;if(!s.isFile()||s.mode&0o077||s.size>MAX_EVENT||bytes>MAX_TOTAL)throw Error('研究文件权限或容量无效');e=JSON.parse(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}
  const {hash,...body}=e;
  if(e.schemaVersion!==1||e.sequence!==i+1||e.previousHash!==(previous?.hash??null)||digest(body)!==hash||
    !['analysis','screen','preferences','preset','diagnostic'].includes(e.kind)||
    !Number.isSafeInteger(e.recordedAt)||e.recordedAt<=0||e.recordedAt>Date.now()||previous&&e.recordedAt<previous.recordedAt||
    Object.keys(FLAGS).some(k=>e[k]!==FLAGS[k]))throw Error('研究历史完整性校验失败');
  previous=e;if(e.recordedAt<=asOf&&(!Number.isSafeInteger(e.data?.asOf)||e.data.asOf<=asOf))out.push(e);
 }return out;
}
function appendEvent(root,kind,data,{requestId,expectedRevision,now=Date.now()}={}){
 if(!['analysis','screen','preferences','preset','diagnostic'].includes(kind)||!Number.isSafeInteger(now)||now<=0||now>Date.now())throw Error('研究记录类型或时点无效');
 if(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId))throw Error('需要有效的研究请求ID');
 const clean=canonical(data),inputHash=digest({kind,data:clean});
 if(Number.isSafeInteger(clean.asOf)&&clean.asOf>now)throw Error('禁止保存未来研究');
 const dir=privateRoot(root,true);
 return withAccountLock(path.join(dir,'workspace'),()=>{
  const events=readEvents(dir),old=events.find(e=>e.requestId===requestId);
  if(old){if(old.inputHash!==inputHash)throw Error('同请求ID内容冲突');return {...old,reused:true};}
  const revision=events.filter(e=>e.kind===kind&&(kind!=='preset'||e.data.name===clean.name)).length;
  if(expectedRevision!==undefined&&expectedRevision!==revision)throw Error('研究设置版本冲突，请重新读取');
  if(events.length>=MAX_EVENTS)throw Error('研究档案达到容量，请归档后继续');
  const previous=events.at(-1);if(previous&&now<previous.recordedAt)throw Error('研究记录时钟回退，未改写历史');
  const body={schemaVersion:1,sequence:events.length+1,previousHash:previous?.hash,
   kind,requestId,inputHash,recordedAt:now,revision:revision+1,...FLAGS,data:clean};
  // Absence is represented consistently as null in the first record.
  body.previousHash=previous?.hash??null;
  const event={...body,hash:digest(body)},raw=encode(event);
  if(Buffer.byteLength(raw)>MAX_EVENT)throw Error('单次研究记录超过2MiB');
  if(events.reduce((n,e)=>n+Buffer.byteLength(encode(e)),0)+Buffer.byteLength(raw)>MAX_TOTAL)throw Error('研究档案超过128MiB');
  const temp=path.join(dir,'.stage-'+crypto.randomBytes(12).toString('hex')),target=path.join(dir,String(event.sequence).padStart(6,'0')+'.json');let fd;
  try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,raw);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.linkSync(temp,target);
   const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
  }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
  return {...event,reused:false};
 });
}
function preferenceInput(value){
 if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(k=>!['objective','horizonDays','maxPositionPct','avoidSectors','excludedSymbols','unresolved'].includes(k)))throw Error('研究约束字段无效');
 const text=(s,max)=>typeof s==='string'&&s.length<=max&&!/(?:https?:\/\/|webhook|sharecode|api[_ -]?key|password|bearer\s|token\s*[:=])/i.test(s);
 if(!text(value.objective??'',500)||![1,5,20,60].includes(value.horizonDays??5)||value.maxPositionPct!==undefined&&value.maxPositionPct!==null&&
  (typeof value.maxPositionPct!=='number'||!Number.isFinite(value.maxPositionPct)||value.maxPositionPct<=0||value.maxPositionPct>100))throw Error('研究目标、周期或仓位约束无效');
 for(const key of ['avoidSectors','excludedSymbols','unresolved'])if(value[key]!==undefined&&(!Array.isArray(value[key])||value[key].length>50||value[key].some(s=>!text(s,200))))throw Error('研究约束列表无效，禁止存放凭据或URL');
 if(value.excludedSymbols?.some(s=>!/^\d{6}$/.test(s)))throw Error('排除股票须为六位代码');
 return {objective:value.objective??'',horizonDays:value.horizonDays??5,maxPositionPct:value.maxPositionPct??null,
  avoidSectors:value.avoidSectors??[],excludedSymbols:value.excludedSymbols??[],unresolved:value.unresolved??[],scope:'research-preferences-only'};
}
module.exports={FLAGS,digest,canonical,privateRoot,readEvents,appendEvent,preferenceInput};
