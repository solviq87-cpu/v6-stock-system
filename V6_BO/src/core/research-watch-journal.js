'use strict';
/**
 * A private, local, single-writer watch-state journal. Integrity fingerprint
 * detects accidental corruption, not a malicious person with filesystem write
 * access. Never stores holdings, credentials, orders or live quote payloads.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const rx=/^\d{6}$/,day=/^\d{4}-\d{2}-\d{2}$/,hex=/^[0-9a-f]{64}$/;
const stages=new Set(['observe','focus','risk-review','weakening','archived']);
const cleanDay=s=>typeof s==='string'&&day.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&
 new Date(Date.parse(s+'T00:00:00Z')).toISOString().slice(0,10)===s;
function safeFile(file){
 if(typeof file!=='string'||!path.isAbsolute(file)||file.length>2048||file.includes(String.fromCharCode(0)))
  throw Error('观察状态必须放在本机绝对路径');
 const p=path.resolve(file),root=path.parse(p).root;
 let cursor=root;
 for(const part of path.dirname(p).slice(root.length).split(path.sep).filter(Boolean)){
  cursor=path.join(cursor,part);
  const st=fs.lstatSync(cursor);
  if(st.isSymbolicLink()||!st.isDirectory())throw Error('观察状态父目录不是普通目录');
 }
 return p;
}
function readExisting(p){
 try{
  const st=fs.lstatSync(p);
  if(st.isSymbolicLink()||!st.isFile()||st.size<1||st.size>1024*1024)
   throw Error('观察状态文件格式或大小无效');
  const raw=fs.readFileSync(p,'utf8'),parsed=JSON.parse(raw);
  validateJournal(parsed);
  return parsed;
 }catch(e){
  if(e.code==='ENOENT')return null;
  throw e;
 }
}
function validateStates(states){
 if(!Array.isArray(states)||states.length>10000)throw Error('持久观察池记录数量无效');
 const seen=new Set();
 for(const s of states){
  if(!s||typeof s!=='object'||!rx.test(s.symbol)||seen.has(s.symbol)||
   !stages.has(s.stage)||!Number.isSafeInteger(s.streak)||s.streak<0||s.streak>10000||
   !Number.isSafeInteger(s.misses)||s.misses<0||s.misses>10000||
   (s.lastSeen!==null&&!cleanDay(s.lastSeen))||
   !['observed-research-only','unavailable'].includes(s.dataStatus)||
   !Array.isArray(s.matched)||s.matched.length>100||
   !Array.isArray(s.riskIds)||s.riskIds.length>100||
   s.matched.some(id=>typeof id!=='string'||id.length>90)||
   s.riskIds.some(id=>typeof id!=='string'||id.length>90)||
   typeof s.reason!=='string'||s.reason.length>500)
   throw Error('观察状态不可信，禁止继续推进');
  seen.add(s.symbol);
 }
}
function validateJournal(j){
 if(!j||j.schemaVersion!==1||j.mode!=='v6-private-research-watch-journal'||
   !Number.isSafeInteger(j.revision)||j.revision<1||
   !cleanDay(j.date)||!hex.test(j.inputFingerprint||'')||
   (j.previousDigest!==null&&!hex.test(j.previousDigest||''))||
   !hex.test(j.digest||'')||j.canTrade!==false||j.canNotify!==false||
   j.revision===1&&j.previousDigest!==null||j.revision>1&&j.previousDigest===null)
  throw Error('观察状态协议无效');
 validateStates(j.states);
 if(j.states.some(s=>s.lastSeen!==null&&s.lastSeen>j.date))throw Error('观察状态含未来日期');
 const {digest,...parts}=j;
 if(hash(parts)!==digest)throw Error('观察状态指纹校验失败，拒绝沿用');
}
function readWatchJournal(file){
 const p=safeFile(file),j=readExisting(p);
 return j?{present:true,revision:j.revision,date:j.date,digest:j.digest,
  inputFingerprint:j.inputFingerprint,states:j.states}:
  {present:false,revision:0,date:null,digest:null,inputFingerprint:null,states:[]};
}
function commitWatchJournal(file,{date,inputFingerprint,states,expectedDigest}={}){
 const p=safeFile(file);
 if(!cleanDay(date)||!hex.test(inputFingerprint||''))throw Error('研究日或输入指纹无效');
 validateStates(states);
 if(states.some(s=>s.lastSeen!==null&&s.lastSeen>date))throw Error('不能持久化未来观察');
 const lock=p+'.lock';
 const fd=fs.openSync(lock,'wx',0o600);
 let temp=null;
 try{
  const existing=readExisting(p);
  if((existing?.digest||null)!==(expectedDigest??null))throw Error('观察状态已变更，需重新读取');
  if(existing&&date<existing.date)throw Error('拒绝回填旧日期覆盖新观察池');
  if(existing&&date===existing.date){
   if(inputFingerprint!==existing.inputFingerprint)
    throw Error('同日导入内容变更，拒绝静默覆写；请先人工核对');
   return {persisted:true,reused:true,revision:existing.revision,date,
    digest:existing.digest,states:existing.states};
  }
  const record={schemaVersion:1,mode:'v6-private-research-watch-journal',
   revision:(existing?.revision||0)+1,date,inputFingerprint,
   previousDigest:existing?.digest||null,
   canTrade:false,canNotify:false,states};
  const data=JSON.stringify({...record,digest:hash(record)},null,2)+'\n';
  if(Buffer.byteLength(data)>1024*1024)throw Error('观察状态输出超过1MB');
  temp=p+'.tmp-'+process.pid+'-'+crypto.randomBytes(8).toString('hex');
  const tmpFd=fs.openSync(temp,'wx',0o600);
  try{fs.writeFileSync(tmpFd,data);fs.fsyncSync(tmpFd);}finally{fs.closeSync(tmpFd);}
  fs.renameSync(temp,p);temp=null;
  const parent=fs.openSync(path.dirname(p),'r');
  try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
  return {persisted:true,reused:false,revision:record.revision,date,
   digest:hash(record),states};
 }finally{
  if(temp)try{fs.unlinkSync(temp);}catch{}
  fs.closeSync(fd);fs.unlinkSync(lock);
 }
}
module.exports={readWatchJournal,commitWatchJournal,validateStates};
